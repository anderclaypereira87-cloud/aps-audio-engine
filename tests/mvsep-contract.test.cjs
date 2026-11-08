// Contract verified against the public MVSEP API on 2026-11-08.
// Files contain `type`, `url` and `download`; they do not contain `name`.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../separador.js'),'utf8');
const html=fs.readFileSync(path.join(__dirname,'../separador.html'),'utf8');

function output(type){
 return {type,url:'https://de2.mvsep.com/storage/processed/test_'+type.toLowerCase()+'.mp3',download:'test_'+type.toLowerCase()+'.mp3',bytes:16,size:'16 B'};
}
function harness({files=['Vocals','Drums','Bass','Other'].map(output),status='done',statusHTTP=200,downloadHTTP=200,empty=false,statuses=[],savedJob=null,onStatus=null}={}){
 const requests=[],messages=[],elements=new Map(),storage=new Map();
 if(savedJob)storage.set('aps_mvsep_pending_v1',JSON.stringify(savedJob));
 const instruments=['vocals','drums','bass','other'].map(value=>({value,checked:true,closest(){return {classList:{toggle(){}}};}}));
 const element=id=>{
  if(!elements.has(id)){
   const el={style:{},files:[],addEventListener(){}};
   Object.defineProperty(el,'textContent',{set(value){this.text=value;if(id==='phase')messages.push(value);},get(){return this.text;}});
   elements.set(id,el);
  }
  return elements.get(id);
 };
 let clock=1_000_000,statusCalls=0;
 class Clock extends Date {static now(){return clock;}}
 const context=vm.createContext({
  console,Blob,File,FormData,URL,AbortController,DOMException,Date:Clock,
  localStorage:{getItem(key){return key==='aps_mvsep_token'?'test-token':storage.get(key)||null;},setItem(key,value){storage.set(key,value);},removeItem(key){storage.delete(key);}},
  document:{getElementById:element,querySelectorAll(selector){return selector.includes(':checked')?instruments.filter(i=>i.checked):instruments;}},
  window:{addEventListener(){}},
  setTimeout(cb,ms){clock+=ms;queueMicrotask(cb);return 1;},clearTimeout(){},
  fetch:async(url,options)=>{
   requests.push({url,options});
   if(url.endsWith('/create'))return {ok:true,json:async()=>({success:true,data:{hash:'test + mix.wav'}})};
   if(url.includes('/status?')){
    statusCalls++;onStatus?.(statusCalls);
    const reply=statuses.shift();
    if(reply instanceof Error)throw reply;
    return {ok:statusHTTP===200,json:async()=>reply||({success:status!=='not_found'&&status!=='failed',status,data:{message:'File or File Hash not found',files}})};
   }
   return {ok:downloadHTTP===200,status:downloadHTTP,blob:async()=>new Blob(empty?[]:['audio'])};
  }
 });
 vm.runInContext(source,context);
 return {requests,messages,storage,context,get clock(){return clock;},run:(file=true,signal)=>{context.testSignal=signal;return vm.runInContext(file?"runCloud(new File(['test'],'APS_test.wav'),{signal:testSignal})":"runCloud(null,{signal:testSignal})",context);}};
}

test('downloads all four MVSEP stems when the response has type and no name',async()=>{
 const h=harness();
 const result=await h.run();
 assert.deepEqual(Object.keys(result),['vocals','drums','bass','other']);
 assert.equal(h.requests.filter(r=>r.url.includes('/download?')).length,4);
 assert.equal(h.requests[0].options.body.get('audiofile').name,'APS_test.wav');
 assert.equal(h.requests[0].options.body.get('audiofile').size,4);
 assert.equal(new URL(h.requests[1].url).searchParams.get('hash'),'test + mix.wav');
});

test('uses the stem type before a song filename containing another instrument',async()=>{
 const file={...output('Drums'),name:'vocals_song_bass.mp3',download:'vocals_song_bass_drums.mp3'};
 assert.deepEqual(Object.keys(await harness({files:[file]}).run()),['drums']);
});

test('keeps compatibility with files labelled by name',async()=>{
 assert.deepEqual(Object.keys(await harness({files:[{name:'Bass',url:'https://de2.mvsep.com/test.mp3'}]}).run()),['bass']);
});

test('uses the download filename if a legacy response has no label',async()=>{
 assert.deepEqual(Object.keys(await harness({files:[{download:'test_vocals.mp3',url:'https://de2.mvsep.com/test.mp3'}]}).run()),['vocals']);
});

test('reports download failures instead of claiming no files were recognized',async()=>{
 const h=harness({downloadHTTP:403});
 await assert.rejects(h.run(),/baixar a pista Voz \(HTTP 403\)/);
 assert.ok(h.storage.has('aps_mvsep_pending_v1'),'keep the job for retrying downloads without a new upload');
});

test('rejects an empty audio download',async()=>{
 await assert.rejects(harness({empty:true}).run(),/arquivo vazio/);
});

test('reports missing results',async()=>{
 await assert.rejects(harness({files:[]}).run(),/não retornou arquivos/);
});

test('reports unsupported result types',async()=>{
 await assert.rejects(harness({files:[output('Instrumental')]}).run(),/tipos de pista/);
});

test('stops immediately when a job hash is missing or expired',async()=>{
 const h=harness({status:'not_found'});
 await assert.rejects(h.run(),/File or File Hash not found/);
 assert.equal(h.requests.length,2);
 assert.equal(h.storage.has('aps_mvsep_pending_v1'),false);
});

test('waits beyond ten minutes and reports the real queue position before downloading',async()=>{
 const statuses=Array.from({length:130},(_,i)=>({success:true,status:'waiting',data:{current_order:140-i,queue_count:150}}));
 statuses.push({success:true,status:'processing',data:{}});
 const h=harness({statuses});
 assert.deepEqual(Object.keys(await h.run()),['vocals','drums','bass','other']);
 assert.equal(h.requests.filter(r=>r.url.endsWith('/create')).length,1);
 assert.ok(h.clock-1_000_000>600_000);
 assert.ok(h.messages.some(m=>m.includes('Na fila')&&m.includes('posição 140')));
 assert.ok(h.messages.some(m=>m.includes('10 min')));
 assert.ok(h.messages.some(m=>m.includes('Separando os instrumentos')));
 assert.equal(JSON.parse(h.storage.get('aps_mvsep_pending_v1')).status,'done');
});

test('resumes a saved job after reopening without selecting or uploading the audio again',async()=>{
 const savedJob={hash:'saved + job.wav',name:'Minha música.wav',instruments:['bass','drums'],createdAt:1};
 const h=harness({savedJob});
 await h.run(false);
 assert.equal(h.requests.filter(r=>r.url.endsWith('/create')).length,0);
 assert.equal(new URL(h.requests[0].url).searchParams.get('hash'),'saved + job.wav');
 assert.equal(JSON.parse(h.storage.get('aps_mvsep_pending_v1')).status,'done');
});

test('retains a queued job after a connection error and continues the same hash',async()=>{
 const h=harness({statuses:[new TypeError('Failed to fetch')]});
 await assert.rejects(h.run(),/Failed to fetch/);
 assert.ok(h.storage.has('aps_mvsep_pending_v1'));
 await h.run(false);
 assert.equal(h.requests.filter(r=>r.url.endsWith('/create')).length,1);
 const polls=h.requests.filter(r=>r.url.includes('/status?'));
 assert.equal(polls[0].url,polls[1].url);
});

test('pausing stops the active poll and preserves the existing job',async()=>{
 const controller=new AbortController();
 const h=harness({onStatus(){controller.abort();}});
 await assert.rejects(h.run(true,controller.signal),{name:'AbortError'});
 assert.ok(h.storage.has('aps_mvsep_pending_v1'));
 assert.equal(h.requests.filter(r=>r.url.includes('/download?')).length,0);
 assert.equal(h.requests.filter(r=>r.url.endsWith('/create')).length,1);
});

test('checkbox native changes keep the selected instruments and appearance aligned',()=>{
 const checkbox={checked:true,listeners:{},addEventListener(type,callback){this.listeners[type]=callback;}};
 const classes=new Set(['active']);
 const label={querySelector(){return checkbox;},classList:{toggle(name,on){if(on)classes.add(name);else classes.delete(name);}}};
 const picker={addEventListener(){}};
 const list={querySelectorAll(){return [label];}};
 const inline=html.match(/<script>\s*([\s\S]*?)<\/script>/)[1];
 vm.runInNewContext(inline,{document:{getElementById(id){return id==='instList'?list:picker;}}});
 assert.equal(typeof checkbox.listeners.change,'function');
 checkbox.checked=false;
 checkbox.listeners.change();
 assert.equal(checkbox.checked,false);
 assert.equal(classes.has('active'),false);
 checkbox.checked=true;
 checkbox.listeners.change();
 assert.equal(classes.has('active'),true);
});
