import * as THREE from "three";

/* Independent WebGL stage for desktop and on-glasses viewing. */
export class ShowStage {
  constructor(host,{glasses=false,onMove=()=>{}}={}){
    this.host=host;this.glasses=glasses;this.onMove=onMove;
    this.models=[];this.index=0;this.count=1;this.active=0;
    this.yaw=.42;this.pitch=.19;this.targetYaw=.42;this.targetPitch=.19;
    this.distance=5.1;this.targetDistance=5.1;
    this.moving=false;this.dragging=false;this.pointer={x:0,y:0};
    this.root=new THREE.Group();
    this.scene=new THREE.Scene();
    this.scene.background=new THREE.Color(glasses?"#000000":"#081422");
    this.scene.add(this.root);
    this.camera=new THREE.PerspectiveCamera(40,1,.03,140);
    this.camera.position.set(0,0,5.1);
    this.renderer=new THREE.WebGLRenderer({antialias:!glasses,alpha:false,
      powerPreference:glasses?"low-power":"high-performance"});
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,glasses?1.2:1.75));
    this.renderer.outputColorSpace=THREE.SRGBColorSpace;
    this.renderer.toneMapping=THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure=1.3;
    host.replaceChildren(this.renderer.domElement);
    this.scene.add(new THREE.AmbientLight("#c6d9ff",1.9));
    const light=new THREE.DirectionalLight("#eaf7ff",2.7);light.position.set(3.3,5.3,4.7);this.scene.add(light);
    const rim=new THREE.DirectionalLight("#4b9eff",1.5);rim.position.set(-4,-1,-3);this.scene.add(rim);
    this.frame=new THREE.Group();this.scene.add(this.frame);
    if(glasses){
      const grid=new THREE.GridHelper(6,9,"#205479","#0c2b42");
      grid.position.y=-1.47;grid.material.transparent=true;grid.material.opacity=.22;
      this.scene.add(grid);
    }
    this.onPointerDown=e=>{if(e.button>0)return;this.dragging=true;this.pointer={x:e.clientX,y:e.clientY};
      host.setPointerCapture?.(e.pointerId)};
    this.onPointerMove=e=>{
      if(!this.dragging)return;
      const dx=e.clientX-this.pointer.x,dy=e.clientY-this.pointer.y;
      this.pointer={x:e.clientX,y:e.clientY};
      if(this.moving){
        this.moveSelection(dx*.009,-dy*.009,0);
      }else{
        this.targetYaw+=dx*.008;
        this.targetPitch=Math.max(-1.2,Math.min(1.2,this.targetPitch+dy*.008));
      }
    };
    this.onPointerUp=()=>{this.dragging=false};
    this.onWheel=e=>{e.preventDefault();this.zoom(e.deltaY>0?-1:1)};
    host.addEventListener("pointerdown",this.onPointerDown);
    host.addEventListener("pointermove",this.onPointerMove);
    host.addEventListener("pointerup",this.onPointerUp);
    host.addEventListener("pointercancel",this.onPointerUp);
    host.addEventListener("wheel",this.onWheel,{passive:false});
    this.observer=new ResizeObserver(()=>this.resize());
    this.observer.observe(host);
    this.resize();
    this.lastTime=0;
    this.running=true;
    this.raf=requestAnimationFrame(t=>this.animate(t));
  }
  resize(){
    let w=Math.max(1,this.host.clientWidth),h=Math.max(1,this.host.clientHeight);
    if(this.glasses){w=this.host.width||w;h=this.host.height||h}
    if(w!==this.width||h!==this.height){
      this.width=w;this.height=h;
      this.camera.aspect=w/h;this.camera.updateProjectionMatrix();
      this.renderer.setSize(w,h,false);
    }
  }
  disposeObjects(){
    while(this.root.children.length){
      const child=this.root.children[0];
      this.root.remove(child);
      child.traverse(obj=>{if(obj.geometry)obj.geometry.dispose();
        if(obj.material){
          (Array.isArray(obj.material)?obj.material:[obj.material]).forEach(m=>m.dispose());
        }});
    }
  }
  update(models=this.models,index=this.index,count=this.count){
    this.models=models;this.index=Math.max(0,index||0);this.count=Math.max(1,Math.min(3,count||1));
    this.disposeObjects();
    this.shown=[];
    if(!models.length)return;
    const n=Math.min(this.count,models.length);
    const scaleFactor=n===1?2.0:(n===2?1.63:1.27);
    const gap=n===1?0:(n===2?2.35:1.91);
    for(let slot=0;slot<n;slot++){
      const idx=(this.index+slot)%models.length;
      const model=models[idx];
      const pivot=new THREE.Group();
      const group=new THREE.Group();
      let count=0;
      for(const mesh of model.mesh||[]){
        if(!mesh?.p?.length)continue;
        try{
          const geometry=new THREE.BufferGeometry();
          geometry.setAttribute("position",new THREE.Float32BufferAttribute(mesh.p,3));
          if(mesh.i?.length)geometry.setIndex(mesh.i);
          geometry.computeVertexNormals();
          const surface=new THREE.MeshPhysicalMaterial({
            color:mesh.color||"#8cbeef",roughness:.42,metalness:.27,
            side:THREE.DoubleSide,clearcoat:.18
          });
          const object=new THREE.Mesh(geometry,surface);
          group.add(object);count++;
        }catch(e){console.warn("Skipped malformed mesh",e)}
      }
      if(!count)continue;
      const box=new THREE.Box3().setFromObject(group),center=box.getCenter(new THREE.Vector3());
      const size=box.getSize(new THREE.Vector3());
      const dimension=Math.max(size.x,size.y,size.z,.0001);
      group.position.sub(center);
      group.scale.setScalar(scaleFactor/dimension);
      pivot.position.x=(slot-(n-1)/2)*gap;
      const offset=model.offset||[0,0,0];
      pivot.position.add(new THREE.Vector3(...offset.map(v=>Number(v)||0)));
      pivot.add(group);this.root.add(pivot);
      this.shown.push({model,pivot,idx});
    }
    this.active=0;
    this.distance=n===1?5.1:n===2?7.5:9;
    this.targetDistance=this.distance;
  }
  select(delta){if(!this.models.length)return;
    this.index=(this.index+delta+this.models.length)%this.models.length;
    this.update(this.models,this.index,this.count);
  }
  setCount(count){this.update(this.models,this.index,count)}
  setMove(enabled){this.moving=!!enabled}
  moveSelection(x,y,z=0){
    const item=this.shown?.[this.active];if(!item)return;
    const p=item.pivot.position;
    p.x=Math.max(-3.5,Math.min(3.5,p.x+x));
    p.y=Math.max(-2.2,Math.min(2.2,p.y+y));
    p.z=Math.max(-2,Math.min(2,p.z+z));
    const base=(this.active-(this.shown.length-1)/2)*(this.shown.length===2?2.35:1.91);
    item.model.offset=[Number((p.x-base).toFixed(3)),Number(p.y.toFixed(3)),Number(p.z.toFixed(3))];
    this.onMove(item.model);
  }
  reset(){this.targetYaw=.42;this.targetPitch=.19;this.targetDistance=this.count>1?7.5:5.1;
    for(const item of this.models)item.offset=[0,0,0];
    this.update(this.models,this.index,this.count);
  }
  centerWrist(){this.targetYaw=.42;this.targetPitch=.19}
  zoom(d){this.targetDistance=Math.max(2.5,Math.min(16,this.targetDistance*(d>0?.85:1.17)))}
  wristInput(yaw,pitch){
    if(this.moving){
      const obj=this.shown?.[this.active];
      if(!obj)return;
      // Wrist-controlled relative translation, smoothed by the caller.
      const baseline=(this.active-(this.shown.length-1)/2)*(this.shown.length===2?2.35:1.91);
      const wantedX=Math.max(-3.5,Math.min(3.5,baseline+yaw*.7));
      const wantedY=Math.max(-2,Math.min(2,-pitch*.65));
      const movementX=(wantedX-obj.pivot.position.x)*.16;
      const movementY=(wantedY-obj.pivot.position.y)*.16;
      if(Math.abs(movementX)+Math.abs(movementY)>.003)this.moveSelection(movementX,movementY,0);
    }else{
      this.targetYaw=Math.max(-3.4,Math.min(3.4,.42+yaw*1.3));
      this.targetPitch=Math.max(-1.12,Math.min(1.12,.19+pitch*.9));
    }
  }
  animate(now){
    if(!this.running)return;
    this.raf=requestAnimationFrame(t=>this.animate(t));
    if(document.hidden)return;
    if(this.glasses&&now-this.lastTime<32)return;this.lastTime=now;
    this.yaw+=(this.targetYaw-this.yaw)*.13;
    this.pitch+=(this.targetPitch-this.pitch)*.13;
    this.distance+=(this.targetDistance-this.distance)*.15;
    this.root.rotation.set(this.pitch,this.yaw,.02);
    this.camera.position.set(0,.15,this.distance);
    this.camera.lookAt(0,0,0);
    this.renderer.render(this.scene,this.camera);
  }
  destroy(){
    this.running=false;cancelAnimationFrame(this.raf);
    this.observer.disconnect();this.disposeObjects();
    const h=this.host;
    h.removeEventListener("pointerdown",this.onPointerDown);
    h.removeEventListener("pointermove",this.onPointerMove);
    h.removeEventListener("pointerup",this.onPointerUp);
    h.removeEventListener("pointercancel",this.onPointerUp);
    h.removeEventListener("wheel",this.onWheel);
    this.renderer.dispose();
  }
}
