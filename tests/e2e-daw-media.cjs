// Teste real em Chromium headless: Central de Mídia -> DAW via IndexedDB aps-media-transfer/files/next.
// Uso: ORT_DIR=/workspace/sep-node node tests/e2e-daw-media.cjs
const {createRequire}=require('module');const {chromium}=createRequire(process.env.ORT_DIR+'/')('playwright');
const {spawn}=require('child_process'),path=require('path');const ROOT=path.resolve(__dirname,'..'),PORT=Number(process.env.PORT||8821),BASE=`http://127.0.0.1:${PORT}`;
function wavB64(sec,rate=48000){const n=Math.round(sec*rate),b=Buffer.alloc(44+n*2);b.write('RIFF',0);b.writeUInt32LE(36+n*2,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(rate,24);b.writeUInt32LE(rate*2,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(n*2,40);for(let i=0;i<n;i++)b.writeInt16LE(Math.round(8000*Math.sin(2*Math.PI*440*i/rate)),44+i*2);return b.toString('base64');}
const put=async(p,b64,name,type)=>p.evaluate(async([b64,name,type])=>{const bytes=Uint8Array.from(atob(b64),c=>c.charCodeAt(0));const file=new File([bytes],name,{type});const db=await new Promise((ok,no)=>{const r=indexedDB.open('aps-media-transfer',1);r.onupgradeneeded=()=>r.result.createObjectStore('files');r.onsuccess=()=>ok(r.result);r.onerror=()=>no(r.error);});await new Promise((ok,no)=>{const tx=db.transaction('files','readwrite');tx.objectStore('files').put({file,created:Date.now()},'next');tx.oncomplete=ok;tx.onerror=()=>no(tx.error);});db.close();},[b64,name,type]);
(async()=>{const srv=spawn('python3',['-m','http.server',String(PORT),'--bind','127.0.0.1'],{cwd:ROOT,stdio:'ignore'});await new Promise(r=>setTimeout(r,1200));
 const browser=await chromium.launch({args:['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream','--autoplay-policy=no-user-gesture-required']});const R={};
 try{const ctx=await browser.newContext({permissions:['microphone'],serviceWorkers:'block'});const p=await ctx.newPage();const errors=[];p.on('pageerror',e=>errors.push(String(e)));
  await p.goto(BASE+'/daw.html');await put(p,wavB64(3.25),'APS-camera-take.wav','audio/wav');
  await p.goto(BASE+'/daw.html?modulo=gravacao&importar=midia');await p.waitForFunction(()=>window.Timbra?.getState().tracks.length>0,null,{timeout:20000});
  R.wav=await p.evaluate(()=>({tracks:Timbra.getState().tracks,left:null}));
  R.wav.keyRemoved=await p.evaluate(async()=>{const db=await new Promise(ok=>{const r=indexedDB.open('aps-media-transfer',1);r.onsuccess=()=>ok(r.result);});const v=await new Promise(ok=>{const q=db.transaction('files').objectStore('files').get('next');q.onsuccess=()=>ok(q.result);});db.close();return v===undefined;});
  // arquivo com codec inválido
  await put(p,Buffer.from('nao e audio de verdade').toString('base64'),'quebrado.m4a','audio/mp4');
  await p.goto(BASE+'/daw.html?modulo=gravacao&importar=midia');await p.waitForTimeout(4000);
  R.badCodec=await p.evaluate(()=>({tracks:Timbra.getState().tracks.length,text:document.body.innerText.match(/O navegador não conseguiu ler[^\n]*/)?.[0]||null}));
  // painel de interface/latência com microfone falso do Chromium
  await p.waitForSelector('#apsIo',{state:'attached',timeout:15000});await p.evaluate(()=>{document.getElementById('apsIo').open=true;});await p.waitForTimeout(1500);
  R.panel=await p.evaluate(()=>document.getElementById('apsIoInfo').innerText);
  R.measure=await p.evaluate(()=>APSDawIO.measure().then(r=>r,e=>'erro '+e.message));R.measureStatus=await p.evaluate(()=>document.getElementById('apsIoStatus').textContent);
  // tomada real pelo microfone falso: sem compensação e com 100 ms de compensação
  const take=async(comp)=>{await p.evaluate(c=>localStorage.setItem('aps-daw-latency-v1',JSON.stringify({enabled:c>0,ms:c})),comp);await p.evaluate(()=>{const c=document.getElementById('countIn');if(c.checked)c.click();const a=document.getElementById('recordAlong');if(a&&a.checked)a.click();});const before=await p.evaluate(()=>Timbra.getState().tracks.length);await p.evaluate(()=>document.getElementById('record').click());await p.waitForFunction(()=>Timbra.getState().recording,null,{timeout:10000});await p.waitForTimeout(1500);await p.evaluate(()=>document.getElementById('record').click());await p.waitForFunction(n=>Timbra.getState().tracks.length>n,before,{timeout:10000});return p.evaluate(()=>{const t=Timbra.getState().tracks;return t[t.length-1].duration;});};
  R.takeNoComp=await take(0);R.takeComp100=await take(100);
  R.errors=errors;await ctx.close();
 }finally{await browser.close();srv.kill();}
 console.log(JSON.stringify(R,null,1));
 const ok=R.wav.tracks.length===1&&Math.abs(R.wav.tracks[0].duration-3.25)<0.002&&R.wav.tracks[0].start===0&&R.wav.keyRemoved&&R.badCodec.tracks===0&&!!R.badCodec.text;
 console.log(ok?'E2E OK':'E2E FALHOU');process.exit(ok?0:1);})();
