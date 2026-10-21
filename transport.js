/* 3D Show encrypted cross-device channel.
 * Experimental zero-account relay: public MQTT broker over secure WebSockets.
 * The broker sees encrypted packets and an opaque hashed room name, not CAD geometry.
 * This is not a certified secure CAD collaboration service.
 */
const BROKERS = [
  "wss://broker.emqx.io:8084/mqtt",
  "wss://test.mosquitto.org:8081/mqtt"
];
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const encoder = new TextEncoder(), decoder = new TextDecoder();
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const base64 = bytes => {
  let result = "";
  for (let i = 0; i < bytes.length; i += 8192) {
    result += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  return btoa(result);
};
const unbase64 = text => Uint8Array.from(atob(text), c => c.charCodeAt(0));
export function makeCode(){
  const bits = crypto.getRandomValues(new Uint8Array(15));
  return Array.from(bits, b => ALPHABET[b & 31]).join("");
}
export function formatCode(code){return (code||"").replace(/(.{5})/g,"$1-").replace(/-$/,"")}
export function normalizeCode(code){return String(code||"").toUpperCase().replace(/[^A-Z2-9]/g,"")}
export class Room {
  constructor(code, role, {onStatus=()=>{},onMessage=()=>{},onPresence=()=>{}}={}){
    this.code=normalizeCode(code);
    this.role=role;
    this.onStatus=onStatus;
    this.onMessage=onMessage;
    this.onPresence=onPresence;
    this.sender=crypto.randomUUID();
    this.client=null;
    this.connected=false;
    this.closed=false;
    this.transfers=new Map();
    this.seen=new Set();
    this.lastSeen=0;
    this.timer=null;
    this.key=null;
    this.topic="";
    this.brokerIndex=0;
  }
  async start(){
    if(this.code.length!==15)throw Error("Enter all 15 characters of the glasses pairing key.");
    if(!globalThis.mqtt?.connect)throw Error("Messaging library unavailable. Check your connection to the library CDN.");
    if(!globalThis.crypto?.subtle)throw Error("Encrypted pairing requires HTTPS.");
    const hash=new Uint8Array(await crypto.subtle.digest("SHA-256",encoder.encode("3dshow-room-v1:"+this.code)));
    this.topic="3dshow/v1/ephemeral/"+Array.from(hash.subarray(0,16),b=>b.toString(16).padStart(2,"0")).join("");
    const raw=await crypto.subtle.digest("SHA-256",encoder.encode("3dshow-aes-key-v1:"+this.code));
    this.key=await crypto.subtle.importKey("raw",raw,{name:"AES-GCM"},false,["encrypt","decrypt"]);
    await this.openBroker();
    this.timer=setInterval(()=>{
      if(this.closed)return;
      if(this.connected)this.send("hello",{role:this.role}).catch(()=>{});
      if(this.lastSeen && Date.now()-this.lastSeen>25000){
        this.lastSeen=0;this.onPresence(false);
      }
    },8500);
  }
  async openBroker(){
    if(this.closed)return;
    const broker=BROKERS[this.brokerIndex%BROKERS.length];
    this.onStatus("Connecting encrypted relay…");
    try{this.client?.end(true)}catch{}
    const c=globalThis.mqtt.connect(broker,{clientId:"show-"+this.sender.replaceAll("-","").slice(0,20),
      clean:true,connectTimeout:10000,reconnectPeriod:4000,keepalive:25,
      protocolVersion:4,queueQoSZero:false});
    this.client=c;
    c.on("connect",()=>{
      if(this.closed)return;
      c.subscribe(this.topic,{qos:1},(error)=>{
        if(error){this.onStatus("Relay subscription failed: "+error.message);return}
        this.connected=true;
        this.onStatus("Encrypted relay ready · waiting for other device");
        this.send("hello",{role:this.role}).catch(()=>{});
      });
    });
    c.on("reconnect",()=>this.onStatus("Reconnecting relay…"));
    c.on("offline",()=>{this.connected=false;this.onStatus("Relay temporarily offline")});
    c.on("close",()=>{this.connected=false});
    c.on("error",(err)=>this.onStatus("Relay error: "+err.message));
    c.on("message",(topic,data)=>{
      if(topic!==this.topic)return;
      this.receive(data.toString()).catch(()=>{});
    });
    setTimeout(()=>{
      if(!this.closed&&!this.connected&&this.brokerIndex===0){
        this.brokerIndex=1;this.openBroker();
      }
    },12500);
  }
  async send(type,payload={}){
    if(!this.client?.connected||!this.key)throw Error("Relay not connected");
    const packet={type,payload,from:this.sender,role:this.role,seq:crypto.randomUUID(),time:Date.now()};
    const iv=crypto.getRandomValues(new Uint8Array(12));
    const bytes=encoder.encode(JSON.stringify(packet));
    const cipher=new Uint8Array(await crypto.subtle.encrypt({name:"AES-GCM",iv},this.key,bytes));
    const envelope=JSON.stringify({v:1,iv:base64(iv),data:base64(cipher)});
    return new Promise((resolve,reject)=>{
      if(this.closed)return reject(Error("Session closed"));
      this.client.publish(this.topic,envelope,{qos:1,retain:false},
        error=>error?reject(error):resolve());
    });
  }
  async receive(raw){
    if(this.closed || raw.length>165000)return;
    try{
      const envelope=JSON.parse(raw);
      if(envelope.v!==1||!envelope.iv||!envelope.data)return;
      const decrypted=await crypto.subtle.decrypt(
        {name:"AES-GCM",iv:unbase64(envelope.iv)},this.key,unbase64(envelope.data));
      const msg=JSON.parse(decoder.decode(decrypted));
      if(msg.from===this.sender||this.seen.has(msg.seq)||!msg.type)return;
      this.seen.add(msg.seq);
      if(this.seen.size>1600)this.seen.clear();
      if(msg.role===this.role)return;
      this.lastSeen=Date.now();
      this.onPresence(true);
      if(msg.type==="hello"){
        if(this.lastHelloReply===undefined || Date.now()-this.lastHelloReply>4000){
          this.lastHelloReply=Date.now();
          this.send("hello-reply",{role:this.role}).catch(()=>{});
        }
      }
      if(msg.type==="chunk-start"){
        const {id,n,name,gzip}=msg.payload;
        if(typeof id!=="string" || n<1||n>440)return;
        this.transfers.set(id,{parts:Array(n),name,gzip,count:0,created:Date.now()});
        this.onStatus("Receiving "+name+"…");
        return;
      }
      if(msg.type==="chunk"){
        const {id,i,data}=msg.payload;
        const transfer=this.transfers.get(id);
        if(!transfer||i<0||i>=transfer.parts.length||typeof data!=="string")return;
        if(!transfer.parts[i]){transfer.parts[i]=data;transfer.count++}
        if(transfer.count===transfer.parts.length){
          this.transfers.delete(id);
          const encoded=transfer.parts.join("");
          const bytes=unbase64(encoded);
          let plain=bytes;
          if(transfer.gzip && "DecompressionStream" in globalThis){
            plain=new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer());
          } else if(transfer.gzip){throw Error("This browser lacks gzip support for transferred models")}
          if(plain.byteLength>18*1024*1024)throw Error("Received mesh is too large");
          const model=JSON.parse(decoder.decode(plain));
          await this.onMessage({type:"model",payload:model});
          this.send("received",{id,name:transfer.name}).catch(()=>{});
        }
        return;
      }
      await this.onMessage(msg);
    }catch(error){
      if(error.name==="OperationError"||error instanceof SyntaxError)return;
      this.onStatus("Message error: "+String(error.message||error));
    }
  }
  async sendModel(model,progress=()=>{}){
    const raw=encoder.encode(JSON.stringify(model));
    if(raw.byteLength>12*1024*1024)throw Error("Optimized model exceeds 12 MB. Reduce CAD mesh detail.");
    let payload=raw,gzip=false;
    if("CompressionStream" in globalThis){
      payload=new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer());
      gzip=true;
    }
    const b64=base64(payload);
    const unit=18000,n=Math.ceil(b64.length/unit);
    if(n>440)throw Error("Model exceeds the relay's chunk limit.");
    const id=crypto.randomUUID();
    await this.send("chunk-start",{id,n,name:model.name,gzip});
    for(let i=0;i<n;i++){
      await this.send("chunk",{id,i,data:b64.slice(i*unit,(i+1)*unit)});
      progress((i+1)/n);
      // Yield to keep frame updates responsive on wearable browsers.
      if(i%4===3)await sleep(10);
    }
    return id;
  }
  close(){
    this.closed=true;
    clearInterval(this.timer);
    try{this.client?.end(true)}catch{}
    this.client=null;this.connected=false;this.transfers.clear();
  }
}
