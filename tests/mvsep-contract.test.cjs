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
function harness({files=['Vocals','Drums','Bass','Other'].map(output),status='done',statusHTTP=200,downloadHTTP=200,empty=false}={}){
 const requests=[];
 const el={style:{},addEventListener(){}};
 const context=vm.createContext({
  console,Blob,File,FormData,URL,
  localStorage:{getItem(){return 'test-token';}},
  document:{getElementById(){return el;}},
  window:{addEventListener(){}},
  setTimeout(cb){queueMicrotask(cb);},
  fetch:async(url,options)=>{
   requests.push({url,options});
   if(url.endsWith('/create'))return {ok:true,json:async()=>({success:true,data:{hash:'test + mix.wav'}})};
   if(url.includes('/status?'))return {ok:statusHTTP===200,json:async()=>({success:status==='done',status,data:{message:'File or File Hash not found',files}})};
   return {ok:downloadHTTP===200,status:downloadHTTP,blob:async()=>new Blob(empty?[]:['audio'])};
  }
 });
 vm.runInContext(source,context);
 return {requests,run:()=>vm.runInContext("runCloud(new File(['test'],'APS_test.wav'))",context)};
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
 await assert.rejects(harness({downloadHTTP:403}).run(),/baixar a pista Voz \(HTTP 403\)/);
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
