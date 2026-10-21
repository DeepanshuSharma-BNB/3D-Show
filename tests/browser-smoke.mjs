import assert from "node:assert/strict";
import puppeteer from "puppeteer-core";

const BASE="https://deepanshusharma-bnb.github.io/3D-Show/";
const executable=process.env.CHROME_BIN||"/usr/bin/google-chrome";
const browser=await puppeteer.launch({
  headless:true,executablePath:executable,
  args:["--no-sandbox","--disable-dev-shm-usage","--use-gl=angle","--use-angle=swiftshader",
    "--ignore-gpu-blocklist","--enable-webgl"]
});
const glasses=await browser.newPage();
const studio=await browser.newPage();
const issues=[];
for(const [tab,page] of [["glasses",glasses],["studio",studio]]){
  await page.setViewport({width:tab==="glasses"?600:1280,height:tab==="glasses"?600:840,deviceScaleFactor:1});
  page.on("pageerror",e=>issues.push(tab+": "+e.message));
  page.on("console",e=>{if(e.type()==="error")issues.push(tab+": "+e.text())});
}
const wait=async(ms)=>new Promise(r=>setTimeout(r,ms));
try{
  console.log("Testing site",BASE);
  await glasses.goto(BASE+"?view=glasses",{waitUntil:"domcontentloaded",timeout:25000});
  await glasses.waitForSelector("#pairCode",{visible:true,timeout:30000});
  await glasses.waitForFunction(()=>document.querySelector("#pairCode").textContent.replaceAll("-","").length===15,{timeout:20000});
  const code=await glasses.$eval("#pairCode",e=>e.textContent);
  console.log("Glasses generated a 15-character pairing key");
  await glasses.screenshot({path:"glasses-before.png"});
  await studio.goto(BASE+"?view=studio",{waitUntil:"domcontentloaded",timeout:25000});
  await studio.waitForSelector("#pairInput",{visible:true,timeout:30000});
  await studio.click("#addDemoBtn");
  await studio.waitForFunction(()=>document.querySelectorAll(".model-row").length===3,{timeout:25000});
  console.log("Studio generated three sample CAD-like meshes");
  await studio.type("#pairInput",code);
  await studio.click("#connectBtn");
  console.log("Studio connecting to encrypted relay");
  await glasses.waitForFunction(()=>document.querySelector("#gStatus").textContent.includes("CONNECTED"),{polling:250,timeout:70000});
  console.log("Pairing succeeded");
  await glasses.waitForFunction(()=>document.querySelector("#glassActive").textContent.includes("/ 03"),{polling:250,timeout:70000});
  console.log("Three models transferred to glasses");
  await glasses.click("#gMode");
  assert.equal(await glasses.$eval("#gMode",e=>e.textContent),"DUO");
  await glasses.click("#gMode");
  assert.equal(await glasses.$eval("#gMode",e=>e.textContent),"TRIO");
  console.log("Solo/Duo/Trio mode controls work");
  await glasses.$eval("#glassesCanvas",element=>element.focus());
  await glasses.keyboard.press("ArrowDown");
  assert.equal(await glasses.evaluate(()=>document.activeElement?.id),"gWrist");
  console.log("Neural Band D-pad can focus wrist activation");
  assert.equal(await glasses.$eval("#glassesCanvas",el=>el.querySelectorAll("canvas").length),1);
  await glasses.bringToFront();
  await wait(1500);
  await glasses.screenshot({path:"glasses-after.png"});
  await studio.bringToFront();
  await wait(750);
  await studio.screenshot({path:"studio.png"});
  console.log("Cross-device smoke test PASSED");
  if(issues.length)console.log("Non-fatal browser warnings:",issues.slice(0,12));
}catch(err){
  console.error("Cross-device smoke test FAILED:",err.stack||err);
  console.error("Browser errors:",issues.slice(0,30));
  console.log("Glasses status:",await glasses.$eval("#pairOverlayState",e=>e.textContent).catch(()=>"(missing)"));
  console.log("Studio status:",await studio.$eval("#pairHint",e=>e.textContent).catch(()=>"(missing)"));
  await glasses.screenshot({path:"glasses-after.png"}).catch(()=>{});
  await studio.screenshot({path:"studio.png"}).catch(()=>{});
  process.exitCode=1;
}finally{
  await browser.close();
}
