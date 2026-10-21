import {Room,makeCode,formatCode,normalizeCode} from "./transport.js";
import {demoModels,convertStep,loadSavedModels,saveModel,deleteModel,clearSavedModels} from "./converter.js";
import {ShowStage} from "./stage.js";

const $=id=>document.getElementById(id);
const mode=new URLSearchParams(location.search).get("view")||"home";
const valid=["glasses","studio"].includes(mode)?mode:"home";
for(const m of ["chooser","studio","glasses"])$(m).classList.toggle("hidden",valid!==({"chooser":"home","studio":"studio","glasses":"glasses"}[m]));
let stage=null,room=null,models=[],index=0,stageCount=1;
const session={
  online:false,paired:false,wrist:false,move:false,ref:null,sensor:null,calibrate:true,lastQuat:null
};
let lastSynced=0,lastMoveSent=0;
const status=(id,message)=>{if($(id))$(id).textContent=message};
const announce=(msg)=>{if(valid==="glasses")status("glassHint",msg)};
const safe=(text)=>String(text??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const clamp=(n,a,b)=>Math.min(b,Math.max(a,n));
function buildScene(host,glasses){
  try{return new ShowStage(host,{glasses,onMove:(model)=>{
    if(valid==="glasses"&&room?.connected&&Date.now()-lastMoveSent>180){
      lastMoveSent=Date.now();room.send("transform",{id:model.id,offset:model.offset}).catch(()=>{})
    }
  }})}catch(e){
    host.textContent="3D rendering unavailable: "+e.message;
    console.error(e);return null;
  }
}
function updateStage(){
  if(stage)stage.update(models,index,stageCount);
  if(valid==="glasses")updateGlassUI();
  else if(valid==="studio")drawList();
}
function next(delta){
  if(!models.length)return;
  if(valid==="glasses"&&session.move&&stageCount>1){
    stage?.chooseActive(delta);
    updateGlassUI();
    announce("Selected part: "+(stage?.shown?.[stage.active]?.model?.name||"object"));
    return;
  }
  index=(index+delta+models.length)%models.length;
  updateStage();sendState();
}
function changeStage(count){stageCount=clamp(count,1,3);updateStage();sendState()}
function sendState(){
  if(room?.connected)room.send("state",{index,stageCount}).catch(()=>{});
}
function applyState(payload){
  if(!payload)return;
  index=clamp(Number(payload.index)||0,0,Math.max(0,models.length-1));
  stageCount=clamp(Number(payload.stageCount)||1,1,3);
  updateStage();
}
function receiveModel(model){
  if(!model?.id||!Array.isArray(model.mesh)||model.mesh.length>256)return;
  const idx=models.findIndex(m=>m.id===model.id);
  if(idx>=0)models[idx]=model;else models.push(model);
  if(models.length>16)models=models.slice(-16);
  updateStage();
  if(valid==="studio")saveModel(model).catch(()=>{});
}
async function sendAllModels(){
  if(!room?.connected||!session.paired)return;
  try{
    status("pairHint","Sending "+models.length+" optimized model(s) to your glasses…");
    await room.send("clear",{});
    for(let n=0;n<models.length;n++){
      await room.sendModel(models[n],p=>{
        status("pairHint","Sending "+(n+1)+"/"+models.length+": "+Math.round(p*100)+"%");
      });
    }
    await room.send("state",{index,stageCount});
    if(valid==="studio")status("pairHint","Sync finished: "+models.length+" model(s) sent. Select an object or choose Solo/Duo/Trio.");
  }catch(e){
    status("pairHint","Transfer failed: "+String(e.message||e));
    $("pairHint")?.classList.add("error");
  }
}
let sendingAll=false;
async function maybeSync(){
  if(valid!=="studio" || sendingAll)return;
  sendingAll=true;
  try{await sendAllModels()}finally{sendingAll=false}
}

// ------------------------- Upload Studio -------------------------
async function startStudio(){
  stage=buildScene($("desktopScene"),false);
  try{models=await loadSavedModels()}catch(e){console.warn("Local model saving unavailable",e)}
  if(!Array.isArray(models))models=[];
  updateStage();
  $("pairInput").addEventListener("input",e=>{e.target.value=formatCode(normalizeCode(e.target.value).slice(0,15))});
  $("pairInput").addEventListener("keydown",e=>{if(e.key==="Enter")joinRoom()});
  $("connectBtn").addEventListener("click",joinRoom);
  $("tabLibrary").onclick=()=>document.querySelector(".library-panel").scrollIntoView({behavior:"smooth"});
  $("tabStage").onclick=()=>document.querySelector(".canvas-panel").scrollIntoView({behavior:"smooth"});
  $("addDemoBtn").onclick=async()=>{
    const add=demoModels();models.push(...add);index=Math.max(0,models.length-add.length);
    for(const m of add){try{await saveModel(m)}catch{}}
    updateStage();if(session.paired)maybeSync();
  };
  $("clearBtn").onclick=async()=>{
    if(!confirm("Remove all models from this browser's library and the connected glasses?"))return;
    models=[];index=0;stageCount=1;
    await clearSavedModels().catch(()=>{});updateStage();
    if(room?.connected)room.send("clear",{}).catch(()=>{});
  };
  $("sendAllBtn").onclick=()=>maybeSync();
  $("deskPrev").onclick=()=>next(-1);
  $("deskNext").onclick=()=>next(1);
  $("fitAllBtn").onclick=()=>stage?.reset();
  $("syncBtn").onclick=()=>maybeSync();
  document.querySelectorAll("[data-stage]").forEach(b=>b.addEventListener("click",()=>{
    changeStage(Number(b.dataset.stage));
    document.querySelectorAll("[data-stage]").forEach(x=>x.classList.toggle("selected",x===b));
  }));
  const dz=$("dropZone");
  dz.addEventListener("dragover",e=>{e.preventDefault();dz.classList.add("over")});
  dz.addEventListener("dragleave",()=>dz.classList.remove("over"));
  dz.addEventListener("drop",e=>{e.preventDefault();dz.classList.remove("over");importFiles(e.dataTransfer.files)});
  $("fileInput").addEventListener("change",e=>{importFiles(e.target.files);e.target.value=""});
  $("sidebarCount").textContent=models.length;
}
async function joinRoom(){
  const code=normalizeCode($("pairInput").value);
  if(code.length!==15){
    status("pairHint","Enter the complete 15-character key from your glasses.");return
  }
  if(room)room.close();
  session.paired=false;
  $("connectBtn").disabled=true;
  status("pairHint","Connecting to the encrypted session…");
  room=new Room(code,"studio",{
    onStatus(message){status("deskStatus",message);status("pairHint",message)},
    onPresence(paired){
      if(session.paired===paired)return;
      session.paired=paired;
      $("pairPill").textContent=paired?"GLASSES CONNECTED":"WAITING";
      $("pairPill").style.color=paired?"#83edcc":"";
      if(paired)maybeSync();
    },
    async onMessage(msg){
      if(msg.type==="request-library")maybeSync();
      if(msg.type==="state"){
        applyState(msg.payload);
        document.querySelectorAll("[data-stage]").forEach(b=>b.classList.toggle("selected",Number(b.dataset.stage)===stageCount));
      }
      if(msg.type==="transform"){
        const model=models.find(m=>m.id===msg.payload?.id);
        if(model){model.offset=msg.payload.offset||[0,0,0];
          stage?.update(models,index,stageCount);saveModel(model).catch(()=>{})}
      }
      if(msg.type==="received")status("pairHint","Glasses received "+(msg.payload?.name||"model"));
    }
  });
  try{await room.start();$("pairPill").textContent="SESSION OPEN";status("pairHint","Relay ready. Confirm the same key is visible on your glasses.");}
  catch(e){status("pairHint",String(e.message||e));$("pairHint").classList.add("error");room?.close()}
  finally{$("connectBtn").disabled=false}
}
function drawList(){
  if(valid!=="studio")return;
  $("fileCount").textContent=models.length+" object"+(models.length===1?"":"s");
  $("sidebarCount").textContent=models.length;
  $("modelList").innerHTML=models.length?models.map((model,i)=>
    '<div class="model-row '+(i===index?"active":"")+'" data-index="'+i+'">'+
    '<div class="model-icon">'+(model.format==="DEMO"?"◇":"⬡")+'</div>'+
    '<div class="model-meta"><strong>'+safe(model.name)+'</strong><small>'+safe(model.format)+" · "+
    Number(model.triangles||0).toLocaleString()+" triangles</small></div>"+
    '<button class="model-select" data-index="'+i+'" aria-label="Inspect '+safe(model.name)+'">View</button>'+
    '<button class="model-delete" data-id="'+safe(model.id)+'" aria-label="Delete model">×</button></div>'
    ).join(""):'<div class="empty"><span>◇</span><strong>No models yet</strong><small>Import STEP files or add sample objects.</small></div>';
  document.querySelectorAll(".model-select").forEach(b=>b.onclick=()=>{
    index=Number(b.dataset.index);updateStage();sendState();
  });
  document.querySelectorAll(".model-delete").forEach(b=>b.onclick=async()=>{
    models=models.filter(m=>m.id!==b.dataset.id);index=clamp(index,0,Math.max(0,models.length-1));
    await deleteModel(b.dataset.id).catch(()=>{});updateStage();if(session.paired)maybeSync();
  });
}
async function importFiles(files){
  if(!files||!files.length)return;
  $("progress").classList.remove("hidden");
  for(const file of [...files]){
    try{
      $("importStatus").classList.remove("error");
      const model=await convertStep(file,(message,percent)=>{
        status("importStatus",message);
        $("progressBar").style.width=Math.max(5,Math.round(percent*100))+"%";
      });
      models.push(model);index=models.length-1;
      try{await saveModel(model)}catch(e){status("importStatus","Imported, but local save failed: "+e.message)}
      updateStage();
      status("importStatus","Imported "+model.name+": "+model.triangles.toLocaleString()+" triangles. Ready for glasses.");
      if(session.paired)await maybeSync();
    }catch(e){status("importStatus","Can't import "+file.name+": "+e.message);$("importStatus").classList.add("error");}
  }
  $("progress").classList.add("hidden");
}

// ---------------------- Glasses Viewer ---------------------------
async function startGlasses(){
  stage=buildScene($("glassesCanvas"),true);
  models=demoModels().slice(0,1);
  updateStage();
  const code=makeCode();
  $("pairCode").textContent=formatCode(code);
  $("pairOverlay").classList.remove("hidden");
  room=new Room(code,"glasses",{
    onStatus(message){
      status("pairOverlayState",message);
      if(!session.paired)status("gStatus","● WAITING");
    },
    onPresence(paired){
      if(session.paired===paired)return;
      session.paired=paired;
      $("pairOverlay").classList.toggle("hidden",paired);
      status("gStatus",paired?"● CONNECTED":"● WAITING");
      if(paired){
        models=[];index=0;stageCount=1;updateStage();
        announce("Connected · Waiting for models");
        room.send("request-library",{}).catch(()=>{});
      }else{
        announce("Studio disconnected · reconnect with the same key");
        $("pairOverlay").classList.remove("hidden");
      }
    },
    async onMessage(msg){
      if(msg.type==="clear"){
        models=[];index=0;updateStage();announce("Collection cleared");
      }
      if(msg.type==="model"){
        receiveModel(msg.payload);announce("Received "+msg.payload?.name);
      }
      if(msg.type==="state"){applyState(msg.payload)}
      if(msg.type==="transform"){
        const model=models.find(m=>m.id===msg.payload?.id);
        if(model){model.offset=msg.payload.offset||[0,0,0];updateStage();}
      }
    }
  });
  try{await room.start()}catch(e){status("pairOverlayState","Pairing error: "+e.message)}
  $("gPrev").onclick=()=>next(-1);$("gNext").onclick=()=>next(1);
  $("gMode").onclick=()=>changeStage(stageCount%3+1);
  $("gMove").onclick=toggleMove;
  $("gWrist").onclick=toggleWrist;
  $("gRecenter").onclick=recenterWrist;
  $("glassesCanvas").focus();
  document.addEventListener("keydown",glassKeys);
  $("glassesCanvas").addEventListener("click",()=>{if(!session.wrist)announce("Drag to orbit · Enable WRIST for Neural Band control")});
}
function updateGlassUI(){
  if(valid!=="glasses")return;
  $("gMode").textContent=["","SOLO","DUO","TRIO"][stageCount];
  $("gMove").textContent=session.move?"MOVE":"ORBIT";
  $("modelBadge").textContent=(session.move?stage?.shown?.[stage.active]?.model?.name:models[index]?.name)?.slice(0,28)||"NO OBJECT";
  $("glassActive").textContent=models.length?
    "OBJECT "+String(index+1).padStart(2,"0")+" / "+String(models.length).padStart(2,"0"):
    "WAITING FOR CAD MODELS";
  $("glassDots").textContent=models.length?models.slice(0,9).map((_,i)=>i===index?"●":"·").join(" "):"◇";
  $("glassHelp").textContent=session.move?"← → select part · ↑ ↓ zoom · Enter orbit":
    "← → objects · ↑ ↓ zoom · Enter move";
}
function toggleMove(){session.move=!session.move;stage?.setMove(session.move);
  updateGlassUI();announce(session.move?"MOVE: tilt wrist to shift selected object":"ORBIT: rotate to inspect")}
function glassKeys(e){
  if(["ArrowLeft","ArrowRight","ArrowUp","ArrowDown","Enter","Escape","Backspace"].includes(e.key)){
    e.preventDefault();
    if(e.key==="ArrowLeft")next(-1);
    if(e.key==="ArrowRight")next(1);
    if(e.key==="ArrowUp")stage?.zoom(1);
    if(e.key==="ArrowDown")stage?.zoom(-1);
    if(e.key==="Enter")toggleMove();
    if(e.key==="Escape"||e.key==="Backspace")changeStage(stageCount%3+1);
    $("glassesCanvas").focus({preventScroll:true});
  }
}
function relativeQuaternion(q,ref){
  const [x,y,z,w]=q,[rx,ry,rz,rw]=ref;
  // q * inverse(reference), both unit quaternions
  const bx=-rx,by=-ry,bz=-rz,bw=rw;
  return [w*bx+x*bw+y*bz-z*by,w*by-x*bz+y*bw+z*bx,
    w*bz+x*by-y*bx+z*bw,w*bw-x*bx-y*by-z*bz];
}
let lastWrist=0;
function readWrist(quat){
  if(!session.wrist||!quat||quat.length!==4||!Array.from(quat).every(Number.isFinite))return;
  if(!session.ref){session.ref=Array.from(quat);announce("Wrist calibrated · Rotate to inspect");return}
  if(performance.now()-lastWrist<28)return;lastWrist=performance.now();
  const [x,y,z,w]=relativeQuaternion(quat,session.ref);
  const yaw=2*Math.atan2(y,w)+.7*2*Math.atan2(z,w);
  const pitch=2*Math.atan2(x,w)-.25*2*Math.atan2(z,w);
  stage?.wristInput(clamp(yaw,-2.6,2.6),clamp(pitch,-1.7,1.7));
}
function toggleWrist(){
  if(session.wrist){
    try{session.sensor?.stop()}catch{}
    session.sensor=null;session.wrist=false;session.ref=null;
    $("gWrist").textContent="WRIST";announce("Wrist motion paused");return;
  }
  if(!("RelativeOrientationSensor" in globalThis)){
    announce("Wrist API unavailable · use touch or arrow controls");return;
  }
  try{
    const sensor=new RelativeOrientationSensor({frequency:30,referenceFrame:"device",sensorId:"emg-wrist"});
    session.sensor=sensor;session.ref=null;session.wrist=true;
    sensor.addEventListener("reading",()=>readWrist(sensor.quaternion));
    sensor.addEventListener("error",e=>{
      announce("Wrist sensor: "+(e.error?.name||"unavailable"));
      try{sensor.stop()}catch{}session.wrist=false;session.sensor=null;
      $("gWrist").textContent="WRIST";
    });
    sensor.start();
    $("gWrist").textContent="ACTIVE";
    announce("Hold your wrist still to calibrate");
  }catch(e){session.wrist=false;session.sensor=null;announce("Wrist unavailable: "+e.message)}
}
function recenterWrist(){session.ref=null;stage?.centerWrist();announce("Hold wrist still to recenter")}

if(valid==="studio")startStudio();
else if(valid==="glasses")startGlasses();
window.addEventListener("pagehide",()=>{room?.close();session.sensor?.stop()});
