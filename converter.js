/* Client-side CAD tessellation (STEP / STP) and lightweight local library. */
import * as THREE from "three";
const DATABASE="3dshow-local-geometry-v1";
const STORE="models";
const MAX_TRIANGLES=20000;
let occtPromise=null;
export function demoModels(){
  const types=[
    ["Demo turbine",new THREE.TorusKnotGeometry(.7,.23,85,9,2,5),"#69c7ff"],
    ["Demo housing",new THREE.BoxGeometry(1.65,1.5,1.3,2,2,2),"#70e3cb"],
    ["Demo sensor",new THREE.IcosahedronGeometry(1.06,2),"#ffb775"]
  ];
  return types.map(([name,g,color])=>{
    const p=[...g.attributes.position.array].map(v=>Number(v.toFixed(5)));
    const indices=g.index?[...g.index.array]:Array.from({length:p.length/3},(_,i)=>i);
    g.dispose();
    return {id:crypto.randomUUID(),name,format:"DEMO",triangles:Math.floor(indices.length/3),
      mesh:[{p,i:indices,color}],offset:[0,0,0],created:Date.now()};
  });
}
function openDb(){
  return new Promise((resolve,reject)=>{
    const req=indexedDB.open(DATABASE,1);
    req.onupgradeneeded=()=>req.result.createObjectStore(STORE,{keyPath:"id"});
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>reject(req.error);
  });
}
export async function loadSavedModels(){
  const db=await openDb();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(STORE,"readonly");
    const req=tx.objectStore(STORE).getAll();
    req.onsuccess=()=>resolve(req.result||[]);
    req.onerror=()=>reject(req.error);
    tx.oncomplete=()=>db.close();
  });
}
export async function saveModel(model){
  const db=await openDb();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(STORE,"readwrite");
    tx.objectStore(STORE).put(model);
    tx.oncomplete=()=>{db.close();resolve()};
    tx.onerror=()=>reject(tx.error);
  });
}
export async function deleteModel(id){
  const db=await openDb();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(STORE,"readwrite");tx.objectStore(STORE).delete(id);
    tx.oncomplete=()=>{db.close();resolve()};
    tx.onerror=()=>reject(tx.error);
  });
}
export async function clearSavedModels(){
  const db=await openDb();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(STORE,"readwrite");tx.objectStore(STORE).clear();
    tx.oncomplete=()=>{db.close();resolve()};
    tx.onerror=()=>reject(tx.error);
  });
}
async function engine(){
  if(occtPromise)return occtPromise;
  occtPromise=(async()=>{
    const deadline=Date.now()+13000;
    while(typeof globalThis.occtimportjs!=="function"){
      if(Date.now()>deadline)throw Error("OpenCascade CAD converter could not load. Check internet/CDN access.");
      await new Promise(resolve=>setTimeout(resolve,180));
    }
    return await globalThis.occtimportjs({
      locateFile(name){return new URL("./vendor/"+name,import.meta.url).href}
    });
  })();
  try{return await occtPromise}catch(e){occtPromise=null;throw e}
}
export async function convertStep(file,onProgress=()=>{}){
  const ext=(file.name.split(".").pop()||"").toLowerCase();
  if(!["stp","step"].includes(ext))throw Error("Please upload a .step or .stp CAD file.");
  if(file.size>45*1024*1024)throw Error("STEP file exceeds the 45 MB browser import limit.");
  onProgress("Loading OpenCascade CAD engine…",0.13);
  const occt=await engine();
  onProgress("Parsing and tessellating "+file.name+"…",0.32);
  const raw=new Uint8Array(await file.arrayBuffer());
  const data=occt.ReadStepFile(raw,{
     linearUnit:"millimeter",
     linearDeflectionType:"bounding_box_ratio",
     linearDeflection:0.15,
     angularDeflection:0.55
  });
  if(!data||!data.success||!Array.isArray(data.meshes)||data.meshes.length===0){
    throw Error("Could not tessellate this STEP file. Try re-exporting from your CAD software.");
  }
  onProgress("Optimizing triangles for Meta Display…",0.65);
  const total=(data.meshes||[]).reduce((s,m)=>s+(m.index?.array?.length||0)/3,0);
  const every=Math.max(1,Math.ceil(total/MAX_TRIANGLES));
  const output=[],palette=["#79bfff","#8ae7e0","#ffc28c","#bba7ff","#ff98a8"];
  let tri=0,globalNum=0;
  for(let mIndex=0;mIndex<data.meshes.length;mIndex++){
    const mesh=data.meshes[mIndex];
    const positions=mesh.attributes?.position?.array ||[];
    const sourceIndex=mesh.index?.array||[];
    if(positions.length<9)continue;
    const outP=[],outI=[];
    const idx=sourceIndex.length?sourceIndex:Array.from({length:Math.floor(positions.length/3)},(_,i)=>i);
    // Tessellation can be huge; sample whole triangles, never half a triangle.
    for(let k=0;k+2<idx.length;k+=3){
      if(globalNum++%every!==0)continue;
      const a=idx[k]*3,b=idx[k+1]*3,c=idx[k+2]*3;
      if(![a,b,c].every(n=>n>=0&&n+2<positions.length))continue;
      const src=[positions[a],positions[a+1],positions[a+2],positions[b],positions[b+1],
          positions[b+2],positions[c],positions[c+1],positions[c+2]];
      if(!src.every(Number.isFinite))continue;
      const start=outP.length/3;
      outP.push(...src.map(x=>Number(x.toFixed(4))));
      outI.push(start,start+1,start+2);
    }
    if(outI.length===0)continue;
    const color=mesh.color&&mesh.color.length===3?
      "#"+mesh.color.map(x=>Math.max(0,Math.min(255,Math.round(x*255))).toString(16).padStart(2,"0")).join(""):
      palette[mIndex%palette.length];
    output.push({p:outP,i:outI,color});
    tri+=outI.length/3;
  }
  if(!output.length)throw Error("No visible triangles were found in this STEP file.");
  onProgress("Model ready",1);
  return {
    id:crypto.randomUUID(),name:file.name.replace(/\.(step|stp)$/i,""),
    format:"STEP",triangles:Math.round(tri),originalSize:file.size,
    mesh:output,offset:[0,0,0],created:Date.now()
  };
}
