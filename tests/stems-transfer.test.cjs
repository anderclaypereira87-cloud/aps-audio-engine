const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'..');
const separator=fs.readFileSync(path.join(root,'separador.js'),'utf8');
const daw=fs.readFileSync(path.join(root,'daw.html'),'utf8');
const receiver=daw.slice(daw.indexOf('let apsReceivingStems=false;'),daw.indexOf("window.addEventListener('aps:import-transferred-stems'"));
const ids=['vocals','drums','bass','other'];
const blob=id=>new Blob([new TextEncoder().encode('audio-original-'+id)],{type:'audio/mpeg'});

// Minimal IndexedDB transaction model: writes become visible only on commit.
function database(){
 const records=new Map(),commits=[];
 const fixture={records,commits,failNextWrite:false,closed:0};
 const db={objectStoreNames:{contains:()=>true},createObjectStore(){},close(){fixture.closed++;},transaction(name,mode='readonly'){
  const tx={},copy=new Map(records),writes=[];let pending=0,finished=false;
  const fail=mode==='readwrite'&&fixture.failNextWrite;if(fail)fixture.failNextWrite=false;
  function request(action){
   const r={};pending++;
   queueMicrotask(()=>{
    r.result=action();r.onsuccess?.();pending--;
    queueMicrotask(()=>{
     if(pending||finished)return;finished=true;
     if(fail){tx.error=Error('Armazenamento cheio');tx.onabort?.();return;}
     if(mode==='readwrite'){records.clear();for(const [k,v] of copy)records.set(k,v);commits.push(writes);}
     tx.oncomplete?.();
    });
   });return r;
  }
  tx.objectStore=()=>({get:key=>request(()=>structuredClone(copy.get(key))),put:(value,key)=>request(()=>{copy.set(key,structuredClone(value));writes.push('put');}),delete:key=>request(()=>{copy.delete(key);writes.push('delete');})});
  return tx;
 }};
 fixture.indexedDB={open(){const r={};queueMicrotask(()=>{r.result=db;r.onsuccess?.();});return r;}};
 return fixture;
}
function ui(){
 const elements=new Map();
 const el=id=>{if(!elements.has(id))elements.set(id,{style:{},files:[],value:'',textContent:'',hidden:true,disabled:false,addEventListener(){}});return elements.get(id);};
 return {el};
}
function sender(db,selected=ids){
 const {el}=ui(),downloads=[],navigations=[];
 const location={};Object.defineProperty(location,'href',{get:()=>navigations.at(-1)?.url||'https://apsaudio.com.br/separador.html',set:url=>navigations.push({url,commits:db.commits.length})});
 const context=vm.createContext({console,Blob,URL,AbortController,DOMException,setTimeout,clearTimeout,
  localStorage:{getItem(){return null;}},document:{getElementById:el,querySelectorAll(){return selected.map(value=>({value,checked:true}));}},
  window:{indexedDB:db.indexedDB,addEventListener(){}},indexedDB:db.indexedDB,location,
  testBlobs:Object.fromEntries(ids.map(id=>[id,blob(id)])),testDownloads:downloads
 });
 vm.runInContext(separator,context);
 vm.runInContext('resultBlobs=testBlobs;resultName="Minha música.wav";download=(blob,name)=>testDownloads.push({blob,name});',context);
 return {context,el,downloads,navigations,open:()=>vm.runInContext('openInDaw()',context),download:()=>vm.runInContext('downloadAll()',context)};
}
function editor(db,{maxBytes=1_000_000,decodeFailure=0}={}){
 const {el}=ui(),decoded=[],history=[];el('projectName').value='Projeto vazio';el('saveState').textContent='Projeto aberto';
 const context=vm.createContext({console,URL,indexedDB:db.indexedDB,window:{indexedDB:db.indexedDB},MAX_SECONDS:600,MAX_BYTES:maxBytes,
  $:el,D:{infer:id=>id},location:{href:'https://apsaudio.com.br/daw.html?modulo=gravacao&importStems=1&v=451'},
  history:{replaceState(a,b,url){history.push(url);}},
  initAudio:()=>({decodeAudioData:async bytes=>{decoded.push(new TextDecoder().decode(bytes));if(decoded.length===decodeFailure)throw Error('Codec inválido');return {length:4,duration:1,numberOfChannels:2};}}),
  stopPlayback(){},updateDuration(){},redraw(){},selectUI(){},say:message=>{el('status').textContent=message;}
 });
 vm.runInContext('let tracks=[],selected=null,dirty=false,busy=false,notes=[],notesTrack=null;function guard(){return !busy;}function memoryBytes(){return tracks.length*32;}function addTrack(name,buf,type,settings){tracks.push({name,buf,type,...settings});selected=name;dirty=true;}',context);
 vm.runInContext(receiver,context);
 return {context,el,decoded,history,receive:()=>vm.runInContext('apsReceiveStems()',context),state:()=>JSON.parse(vm.runInContext('JSON.stringify({tracks,busy,dirty,selected})',context))};
}

test('commits four real audio blobs before navigating directly to the DAW',async()=>{
 const db=database(),s=sender(db);await s.open();
 const row=db.records.get('latest');
 assert.deepEqual(row.stems.map(s=>s.id),ids);
 assert.equal(row.name,'Minha música');
 for(const stem of row.stems){assert.equal(await stem.blob.text(),'audio-original-'+stem.id);assert.equal(stem.type,'audio/mpeg');assert.match(stem.name,/\.mp3$/);}
 assert.match(s.navigations[0].url,/daw\.html\?modulo=gravacao&importStems=1/);
 assert.equal(s.navigations[0].commits,1);
 assert.equal(s.downloads.length,0);
});

test('opens only the instruments selected by the user',async()=>{
 const db=database();await sender(db,['bass']).open();
 assert.deepEqual(db.records.get('latest').stems.map(s=>s.id),['bass']);
});

test('device download saves the selected files and keeps the separator open',async()=>{
 const db=database(),s=sender(db);await s.download();
 assert.equal(s.downloads.length,4);assert.equal(s.navigations.length,0);
 assert.ok(s.downloads.every(d=>d.name.endsWith('.mp3')));
 assert.equal(db.records.has('latest'),false);
 assert.match(s.el('phase').textContent,/iniciado no aparelho/);
});

test('device download respects the instrument selection without preparing a DAW transfer',async()=>{
 const db=database(),s=sender(db,['bass']);await s.download();
 assert.equal(s.downloads.length,1);assert.match(s.downloads[0].name,/_bass\.mp3$/);
 assert.equal(s.navigations.length,0);assert.equal(db.commits.length,0);
});

test('a failed storage commit keeps the separator results available and does not navigate',async()=>{
 const db=database();db.failNextWrite=true;const s=sender(db);await s.open();
 assert.equal(s.navigations.length,0);assert.equal(s.downloads.length,0);assert.equal(db.records.has('latest'),false);
 assert.match(s.el('phase').textContent,/Não foi possível abrir/);assert.equal(s.el('openDaw').disabled,false);
});

test('separator-to-DAW handoff loads all four stems at zero and consumes the committed transfer',async()=>{
 const db=database();await sender(db).open();const e=editor(db);await e.receive();
 assert.deepEqual(e.state().tracks.map(t=>t.name),['Voz','Bateria','Baixo','Outros']);
 assert.ok(e.state().tracks.every(t=>t.start===0&&t.trimIn===0));
 assert.deepEqual(e.decoded,ids.map(id=>'audio-original-'+id));
 assert.equal(e.el('projectName').value,'Minha música');assert.equal(db.records.has('latest'),false);
 assert.equal(e.state().busy,false);assert.equal(e.el('apsTransferNotice').hidden,true);
 assert.ok(!e.history[0].includes('importStems'));
});

test('legacy six-stem WAV transfers remain supported',async()=>{
 const db=database();db.records.set('latest',{stems:Array.from({length:6},(_,i)=>({name:'Pista '+i+'.wav',blob:new Blob(['wav-original-'+i],{type:'audio/wav'})}))});
 const e=editor(db);await e.receive();assert.equal(e.state().tracks.length,6);assert.equal(db.records.has('latest'),false);
});

test('a codec failure leaves no partial tracks and retains audio for retry',async()=>{
 const db=database();await sender(db).open();const e=editor(db,{decodeFailure:3});
 await assert.rejects(e.receive(),/Não foi possível ler a pista/);
 assert.equal(e.state().tracks.length,0);assert.ok(db.records.has('latest'));assert.equal(e.state().busy,false);
 await e.receive();assert.equal(e.state().tracks.length,4);
});

test('memory limits are checked before adding any stem',async()=>{
 const db=database();await sender(db).open();const e=editor(db,{maxBytes:64});
 await assert.rejects(e.receive(),/memória disponível/);assert.equal(e.state().tracks.length,0);assert.ok(db.records.has('latest'));
});

test('concurrent receive clicks do not duplicate tracks',async()=>{
 const db=database();await sender(db).open();const e=editor(db);await Promise.all([e.receive(),e.receive()]);
 assert.equal(e.state().tracks.length,4);assert.equal(e.decoded.length,4);
});

test('a failed consume transaction rolls back tracks and retains the audio',async()=>{
 const db=database();await sender(db).open();db.failNextWrite=true;const e=editor(db);
 await assert.rejects(e.receive(),/Armazenamento cheio/);
 assert.equal(e.state().tracks.length,0);assert.equal(e.state().dirty,false);assert.ok(db.records.has('latest'));
 assert.equal(e.el('projectName').value,'Projeto vazio');assert.equal(e.el('saveState').textContent,'Projeto aberto');
});

test('the DAW requests automatic import on load without another button click',()=>{
 const script=daw.match(/<script id="apsStemsBridge">([\s\S]*?)<\/script>/)[1],events=[],handlers={};
 const context={URLSearchParams,location:{search:'?modulo=gravacao&importStems=1'},CustomEvent:class{constructor(type){this.type=type;}},document:{readyState:'loading',getElementById(){return {hidden:true,addEventListener(){}};}},window:{addEventListener(type,fn){handlers[type]=fn;},dispatchEvent(e){events.push(e.type);}}};
 vm.runInNewContext(script,context);assert.equal(events.length,0);handlers.load();assert.deepEqual(events,['aps:import-transferred-stems']);
});
