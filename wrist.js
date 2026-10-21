/**
 * Wrist orientation -> neutral-relative model rotation.
 *
 * Sensor quaternion [x, y, z, w] is an orientation (NOT Euler angles).
 * Relative rotations are computed in the neutral wrist's local reference
 * frame: inverse(qNeutral) * qCurrent. This avoids axis cross-coupling
 * introduced by qCurrent * inverse(qNeutral) and ad-hoc yaw/roll mixing.
 *
 * Quaternion signs are canonicalized, so q and -q remain equivalent.
 * We use an exponential-map rotation vector for stable, isolated axis
 * components near the neutral position. For full 3D, the unmodified
 * relative quaternion is available as well.
 */

const TAU=Math.PI*2;
const clamp=(x,a,b)=>Math.min(b,Math.max(a,x));
export function normalizeQuat(raw){
  if(!raw||raw.length!==4)return null;
  const q=Array.from(raw,Number);
  if(!q.every(Number.isFinite))return null;
  const n=Math.hypot(...q);
  if(n<.001)return null;
  return q.map(v=>v/n);
}
export function conjugate(q){return [-q[0],-q[1],-q[2],q[3]]}
export function multiply(a,b){
  const [x,y,z,w]=a,[X,Y,Z,W]=b;
  return [w*X+x*W+y*Z-z*Y, w*Y-x*Z+y*W+z*X,
          w*Z+x*Y-y*X+z*W, w*W-x*X-y*Y-z*Z];
}
export function relativeQuat(current,reference){
  const result=normalizeQuat(multiply(conjugate(reference),current));
  if(!result)return null;
  // Quaternions differing by a sign describe the same orientation.
  return result[3]<0?result.map(v=>-v):result;
}
export function rotationVector(q){
  const [x,y,z,w]=q;
  const length=Math.hypot(x,y,z);
  if(length<1e-8)return [2*x,2*y,2*z];
  const angle=2*Math.atan2(length,clamp(w,-1,1));
  const scale=angle/length;
  return [x*scale,y*scale,z*scale];
}
export function quatFromVector(v){
  const angle=Math.hypot(...v);
  if(angle<1e-8)return [v[0]/2,v[1]/2,v[2]/2,1];
  const s=Math.sin(angle/2)/angle;
  return [v[0]*s,v[1]*s,v[2]*s,Math.cos(angle/2)];
}
export function quatDistance(a,b){
  return 2*Math.acos(clamp(Math.abs(a.reduce((sum,v,i)=>sum+v*b[i],0)),-1,1));
}
function deadzone(n,radians=.021){
  if(Math.abs(n)<radians)return 0;
  // Soft onset eliminates snapping at the threshold.
  const abs=Math.abs(n),outside=abs-radians;
  return Math.sign(n)*Math.min(abs, outside * (1.05 - .05*Math.exp(-outside*15)));
}
export class WristTracker{
  constructor({sensitivity=1,reverseX=false,reverseY=false,turnAxis="YAW",filter=.26,deadzoneDegrees=1.2,referenceSamples=7}={}){
    this.sensitivity=clamp(sensitivity,.45,2.25);
    this.reverseX=reverseX;this.reverseY=reverseY;this.turnAxis=turnAxis;
    this.filter=filter;this.deadzoneDegrees=deadzoneDegrees;
    this.referenceSamples=referenceSamples;
    this.reset();
  }
  reset(){
    this.reference=null;
    this.samples=[];
    this.smoothed=[0,0,0];
    this.freeSmoothed=[0,0,0];
    this.neutral=true;
    this.lastRaw=null;
  }
  /**
   * Returns null while calibrating. Called with each sensor reading, not on a
   * frame loop. Returns {yaw,pitch,roll,quaternion,reference}.
   */
  sample(value){
    let q=normalizeQuat(value);
    if(!q)return null;
    if(this.reference===null){
      if(this.samples.length){
        // Reject motion larger than 3.5° during initial calibration.
        const last=this.samples[this.samples.length-1];
        if(quatDistance(q,last)>.061){
          this.samples=[q];return null;
        }
        if(q.reduce((dot,v,i)=>dot+v*this.samples[0][i],0)<0)q=q.map(v=>-v);
      }
      this.samples.push(q);
      if(this.samples.length<this.referenceSamples)return null;
      const mean=[0,0,0,0];
      for(const point of this.samples)point.forEach((v,i)=>mean[i]+=v);
      this.reference=normalizeQuat(mean);
      this.samples=[];
      this.lastRaw=this.reference;
      return {yaw:0,pitch:0,roll:0,quaternion:[0,0,0,1],calibrated:true};
    }
    // Cap discontinuities > 90° between consecutive readings (tracking dropout).
    if(this.lastRaw&&quatDistance(q,this.lastRaw)>Math.PI/2){
      this.lastRaw=q;
      return null;
    }
    this.lastRaw=q;
    const delta=relativeQuat(q,this.reference);
    if(!delta)return null;
    const [rawX,rawY,rawZ]=rotationVector(delta);
    const rad=this.deadzoneDegrees*Math.PI/180;
    const sx=(this.reverseX?-1:1)*this.sensitivity;
    const sy=(this.reverseY?-1:1)*this.sensitivity;
    const yawAxis=this.turnAxis==="TWIST"?rawZ:
      this.turnAxis==="MIX"?(rawY+.6*rawZ):rawY;
    const source=[
      rawX*sy, yawAxis*sx, rawZ*sx
    ];
    const freeSource=[rawX*sy,rawY*sx,rawZ*sx];
    const target=source.map(v=>clamp(deadzone(v,rad),-2.8,2.8));
    const freeTarget=freeSource.map(v=>clamp(deadzone(v,rad),-2.8,2.8));
    // Two separate filters ensure free-3D mapping never duplicates the
    // roll axis when the Precision mode uses twist for horizontal turning.
    for(let i=0;i<3;i++){
      this.smoothed[i]+=this.filter*(target[i]-this.smoothed[i]);
      this.freeSmoothed[i]+=this.filter*(freeTarget[i]-this.freeSmoothed[i]);
    }
    const [pitch,yaw,roll]=this.smoothed;
    return {yaw,pitch,roll,quaternion:quatFromVector(this.freeSmoothed),calibrated:false};
  }
}
