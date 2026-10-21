import test from "node:test";
import assert from "node:assert/strict";
import {WristTracker,relativeQuat,rotationVector,normalizeQuat,quatDistance,multiply} from "../wrist.js";

const axis=(x,y,z,deg)=>{
  const rad=deg*Math.PI/180;
  return [x*Math.sin(rad/2),y*Math.sin(rad/2),z*Math.sin(rad/2),Math.cos(rad/2)];
};
function calibrated(tracker,neutral=[0,0,0,1]){
  for(let i=0;i<tracker.referenceSamples;i++)tracker.sample(neutral);
  const observed=tracker.reference;
  assert.ok(observed&&quatDistance(observed,neutral)<.001);
}
const within=(a,b,tolerance=.001)=>assert.ok(Math.abs(a-b)<tolerance);
test("rejects malformed sensor quaternions",()=>{
  assert.equal(normalizeQuat([0,0,0,0]),null);
  assert.equal(normalizeQuat([NaN,0,0,1]),null);
  assert.equal(normalizeQuat([1,2,3]),null);
  assert.deepEqual(normalizeQuat([0,0,0,2]),[0,0,0,1]);
});
test("uses initial wrist coordinate system rather than global axes",()=>{
  const ref=axis(0,0,1,70);
  const rotated=multiply(ref,axis(0,1,0,35));
  const delta=relativeQuat(rotated,ref);
  const [pitch,yaw,roll]=rotationVector(delta);
  within(yaw,35*Math.PI/180);
  within(pitch,0);within(roll,0);
});
test("quaternion sign change causes no movement",()=>{
  const q=axis(0,1,0,42),flipped=q.map(x=>-x);
  within(quatDistance(q,flipped),0,1e-6);
  const delta=relativeQuat(flipped,q);
  for(let i=0;i<3;i++)within(delta[i],0);
  within(delta[3],1);
});
test("yaw wrist rotation does not cause unintended pitch",()=>{
  const t=new WristTracker({filter:1,referenceSamples:3,deadzoneDegrees:0});
  calibrated(t);
  const v=t.sample(axis(0,1,0,35));
  assert.ok(v.yaw>.60&&v.yaw<.63);
  within(v.pitch,0);within(v.roll,0);
});
test("wrist pitch does not cause unwanted horizontal turn",()=>{
  const t=new WristTracker({filter:1,referenceSamples:3,deadzoneDegrees:0});
  calibrated(t);
  const v=t.sample(axis(1,0,0,-27));
  assert.ok(v.pitch<-.46&&v.pitch>-.48);
  within(v.yaw,0);within(v.roll,0);
});
test("full-3D mode exposes pure roll without unwanted pitch/yaw",()=>{
  const t=new WristTracker({filter:1,referenceSamples:3,deadzoneDegrees:0});
  calibrated(t);
  const v=t.sample(axis(0,0,1,23));
  assert.ok(v.roll>.39 && v.roll<.41);
  within(v.yaw,0);within(v.pitch,0);
  const roundtrip=rotationVector(v.quaternion);
  within(roundtrip[2],v.roll);
});
test("deadzone ignores small wrist tremor",()=>{
  const t=new WristTracker({filter:1,referenceSamples:3,deadzoneDegrees:1.3});
  calibrated(t);
  const v=t.sample(axis(0,1,0,.7));
  within(v.yaw,0);
});
test("recenter resets drift and learns new stable neutral",()=>{
  const t=new WristTracker({filter:1,referenceSamples:3,deadzoneDegrees:0});
  calibrated(t);
  t.sample(axis(0,1,0,20));
  t.reset();
  calibrated(t,axis(0,1,0,20));
  const v=t.sample(axis(0,1,0,20));
  within(v.yaw,0);within(v.pitch,0);
});
test("invert and sensitivity settings change chosen axis only",()=>{
  const t=new WristTracker({filter:1,referenceSamples:3,deadzoneDegrees:0,sensitivity:1.5,reverseX:true});
  calibrated(t);
  const v=t.sample(axis(0,1,0,25));
  assert.ok(v.yaw<-.6 && v.yaw>-.7);
  within(v.pitch,0);
});
test("calibration waits for stationary readings",()=>{
  const t=new WristTracker({referenceSamples:4});
  t.sample(axis(0,1,0,0));t.sample(axis(0,1,0,24));
  assert.equal(t.samples.length,1);
  for(let i=0;i<3;i++)t.sample(axis(0,1,0,24));
  assert.notEqual(t.reference,null);
});

test("wrist twist can serve as a horizontal turn input without vertical drift",()=>{
  const t=new WristTracker({filter:1,referenceSamples:3,deadzoneDegrees:0,turnAxis:"TWIST"});
  calibrated(t);
  const v=t.sample(axis(0,0,1,30));
  assert.ok(v.yaw>.51&&v.yaw<.53);
  within(v.pitch,0);
  // Full-3D orientation stays a pure roll, not duplicated on the yaw axis.
  const vector=rotationVector(v.quaternion);
  within(vector[1],0);within(vector[2],30*Math.PI/180);
});
test("balanced input can combine yaw and twist, without vertical pitch",()=>{
  const t=new WristTracker({filter:1,referenceSamples:3,deadzoneDegrees:0,turnAxis:"MIX"});
  calibrated(t);
  const v=t.sample(axis(0,0,1,30));
  assert.ok(v.yaw>.30&&v.yaw<.32);
  within(v.pitch,0);
});
