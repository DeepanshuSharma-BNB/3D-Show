import test from "node:test";
import assert from "node:assert/strict";
import {makeCode,formatCode,normalizeCode,Room} from "../transport.js";
test("creates high-entropy 15-character pairing keys",()=>{
 const keys=new Set(Array.from({length:500},makeCode));
 assert.equal(keys.size,500);
 for(const code of keys)assert.match(code,/^[A-HJ-NP-Z2-9]{15}$/);
});
test("pairing code formats and normalizes",()=>{
 const code="ABCDE23456FGHJK";
 assert.equal(formatCode(code),"ABCDE-23456-FGHJK");
 assert.equal(normalizeCode("abcde-23456-fghjk"),code);
});
test("room constructor does not expose raw code as a topic",()=>{
 const room=new Room("ABCDE23456FGHJK","glasses");
 assert.equal(room.code,"ABCDE23456FGHJK");
 assert.equal(room.topic,"");room.close();
});