// APS Audio Engine v4.0 · Separador de 6 pistas (HTDemucs-6s ONNX, no aparelho).
// Regras: nenhuma pista é sintetizada; erro aparece na tela; Cancelar encerra o worker e libera a memória.
import {SOURCES,SAMPLE_RATE,SEG,STRIDE,blockCount,wavHeader,pcmToWav,zipBlobs,deviceLimits,MAX_SECONDS,estimateSeconds} from './aps-sep-core.js?v=410';
const $=id=>document.getElementById(id);
let working=false,resultBlobs=null,resultInfo=null,context=null,player=null,activeWorker=null,stopWorker=null,elapsedTimer=null;

function phase(msg,percent,error=false){const el=$('phase');el.textContent=msg;el.classList.toggle('err',!!error);if(percent!==undefined){$('bar').style.width=percent+'%';document.querySelector('[role=progressbar]').setAttribute('aria-valuenow',String(percent));}}
export function deviceInfo(){
 const mobile=/Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
 return {deviceMemory:navigator.deviceMemory??null,cores:navigator.hardwareConcurrency||null,mobile,wasmThreads:!!globalThis.crossOriginIsolated&&typeof SharedArrayBuffer!=='undefined',webgpu:!!navigator.gpu};
}
let LIMITS=deviceLimits(deviceInfo());
function engine(){return document.querySelector('input[name="apsEngine"]:checked')?.value||'leve';}
async function showModelCache(){try{const c=await caches.open('aps-models-v1');const keys=(await c.keys()).map(r=>r.url);$('apsEngLeveCache').textContent=keys.some(u=>u.includes('htdemucs_6s_leve'))?'✔ já baixado neste aparelho':'';$('apsEngCompletoCache').textContent=keys.some(u=>u.includes('fp16weights'))?'✔ já baixado neste aparelho':'';}catch{}}
function applyLimits(){
 const d=deviceInfo();LIMITS=deviceLimits(d);const el=$('deviceCheck');
 const desc='Memória: '+(d.deviceMemory?('~'+d.deviceMemory+' GB'):'não informada')+' · Processadores: '+(d.cores||'?')+' · Threads WASM: '+(d.wasmThreads?'sim':'não (1 núcleo)')+' · WebGPU: '+(d.webgpu?'presente (não usado ainda)':'não');
 el.className='aps-devcheck'+(LIMITS.local&&LIMITS.recommendedSeconds>=180?'':' weak');
 el.textContent=(LIMITS.local?'':'⛔ ')+LIMITS.reason+' ('+desc+')';
 for(const r of document.querySelectorAll('input[name="apsEngine"]')){const ok=LIMITS.engines.includes(r.value);r.disabled=!ok;r.closest('label').style.opacity=ok?1:.45;}
 if(!LIMITS.engines.includes(engine())){const f=document.querySelector('input[name="apsEngine"]:not(:disabled)');if(f)f.checked=true;}
 for(const o of $('duration').options){const v=Number(o.value);o.disabled=v>LIMITS.maxSeconds;o.textContent=o.textContent.replace(/ ⚠.*$/,'')+(v>LIMITS.recommendedSeconds&&!o.disabled?' ⚠ acima do recomendado':'');}
 if(Number($('duration').value)>LIMITS.recommendedSeconds)$('duration').value=String([...$('duration').options].map(o=>Number(o.value)).filter(v=>v<=LIMITS.recommendedSeconds).pop()||10);
 if(Number($('duration').value)>LIMITS.maxSeconds){const ok=[...$('duration').options].filter(o=>!o.disabled).pop();if(ok)$('duration').value=ok.value;}
 $('start').disabled=!LIMITS.local;
 if(!LIMITS.local)phase('Este aparelho não tem memória suficiente para o modelo de separação. Use um computador, ou importe uma bateria já separada abaixo. Nenhuma pista será inventada.',0,true);
 showModelCache();showEstimate();
}
function fmtMin(s){s=Math.round(s);return s<90?s+' s':Math.round(s/60)+' min';}
function showEstimate(){const sec=Number($('duration').value),[a,b]=estimateSeconds(sec,deviceInfo().mobile),el=$('apsEstimate');if(!el)return;
 el.textContent='⏱ Tempo estimado de processamento para '+fmtMin(sec)+' de música: ~'+fmtMin(a)+' a '+fmtMin(b)+(deviceInfo().mobile?' (estimativa para celular, NÃO medida em aparelho real; pode ser mais).':' (medido em computador de 8 núcleos; o seu pode variar).')+' Deixe a tela ligada e o APS aberto até terminar.'+(sec>LIMITS.recommendedSeconds?' ⚠ Acima do recomendado para este aparelho: pode travar ou ficar sem memória.':'');}
$('duration').addEventListener('change',showEstimate);
// Mostra a duração da música e explica o corte de até 5 min.
async function songDuration(file){return new Promise(ok=>{const a=document.createElement('audio'),u=URL.createObjectURL(file);a.preload='metadata';a.onloadedmetadata=()=>{URL.revokeObjectURL(u);ok(a.duration)};a.onerror=()=>{URL.revokeObjectURL(u);ok(null)};a.src=u;});}
$('song').addEventListener('change',async()=>{const f=$('song').files[0],el=$('apsSongInfo');if(!f||!el)return;const d=await songDuration(f);if(!d||!isFinite(d)){el.textContent='';return;}
 el.textContent=d>MAX_SECONDS?'Esta música tem '+fmtMin(d)+'. O APS separa no máximo 5 min por vez: escolha em "Começar em" o ponto inicial; será usado só o trecho de até 5 min a partir dali, sem mudar andamento nem alinhamento. Para o resto, separe outro trecho depois.':'Duração da música: '+fmtMin(d)+'.';});
function stopPreview(){try{player?.stop();}catch{}player=null;}
async function preview(i){stopPreview();const u=URL.createObjectURL(resultBlobs[i]);const a=new Audio(u);player={stop:()=>{a.pause();URL.revokeObjectURL(u);}};a.onended=()=>{if(player){URL.revokeObjectURL(u);player=null;}};await a.play();}
function download(blob,name){const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);}
function prefix(){return(($('song').files[0]?.name)||'APS_stems').replace(/\.[^.]+$/,'').replace(/[^a-z0-9_-]/gi,'_').slice(0,45)||'APS';}
function showResult(){
 const box=$('result');box.replaceChildren();
 SOURCES.forEach((s,i)=>{const card=document.createElement('div');card.className='resultcard';const title=document.createElement('h3');title.textContent=s.head+' '+s.name;
  const note=document.createElement('div');note.className='cardnote';note.textContent='WAV '+(resultInfo.channels===1?'mono':'estéreo')+' '+(resultInfo.rate/1000).toFixed(2).replace('.',',')+' kHz · '+(resultBlobs[i].size/1048576).toFixed(1)+' MB · saída do modelo (não editada)';
  const actions=document.createElement('div');actions.className='buttons';
  const listen=document.createElement('button');listen.className='alt';listen.textContent='▶ Ouvir';listen.dataset.stem=s.id;listen.addEventListener('click',()=>preview(i).catch(e=>phase('Erro ao reproduzir: '+e.message,undefined,true)));
  const dl=document.createElement('button');dl.textContent='↓ WAV';dl.dataset.download=s.id;dl.addEventListener('click',()=>download(resultBlobs[i],prefix()+'_'+s.id+'.wav'));
  actions.append(listen,dl);card.append(title,note,actions);box.append(card);});
 const dIn=resultInfo.inputFrames/SAMPLE_RATE,dOut=resultInfo.frames/resultInfo.rate;
 $('resultCheck').textContent='Verificação automática: duração de entrada '+dIn.toFixed(3)+' s · duração de cada pista '+dOut.toFixed(3)+' s (diferença '+Math.abs(dIn-dOut).toFixed(3)+' s). Todas começam no mesmo instante (amostra 0). Soma das 6 pistas × original: '+resultInfo.sumSnrDb.toFixed(1)+' dB de semelhança (quanto maior, menos áudio perdido; não mede a qualidade de cada pista). Tempo de processamento: '+resultInfo.seconds.toFixed(0)+' s.';
 $('resultsPanel').hidden=false;$('resultsPanel').scrollIntoView({behavior:'smooth',block:'start'});
}
function closeWorker(){if(activeWorker){try{activeWorker.postMessage({type:'cancel'});}catch{}activeWorker.terminate();activeWorker=null;}if(elapsedTimer){clearInterval(elapsedTimer);elapsedTimer=null;}}
function runWorker(audio,durationSec){
 return new Promise((resolve,reject)=>{
  let settled=false,etaStart=0;const chunks=Array.from({length:6},()=>[]);
  const worker=new Worker('./separador-worker.js?v=410',{type:'module'});activeWorker=worker;const started=Date.now();
  const steps=blockCount(audio[0].length);
  // limite de tempo proporcional: 4 min por bloco no pior caso (celular lento), mínimo 10 min
  const maxMs=Math.max(10,steps*4)*60000;
  const finish=(err,out)=>{if(settled)return;settled=true;stopWorker=null;closeWorker();if(err){chunks.length=0;reject(err);}else resolve(out);};
  stopWorker=()=>finish(Object.assign(Error('Cancelado pelo usuário. O processamento foi encerrado e a memória liberada.'),{cancelled:true}));
  elapsedTimer=setInterval(()=>{const s=Math.floor((Date.now()-started)/1000);$('elapsed').textContent=`Tempo de processamento: ${Math.floor(s/60)}m ${String(s%60).padStart(2,'0')}s`;
   if(Date.now()-started>maxMs)finish(Error('Tempo limite atingido ('+Math.round(maxMs/60000)+' min). O aparelho não concluiu o modelo; a gravação original não foi alterada.'));},1000);
  worker.onmessage=evt=>{if(settled)return;const d=evt.data;
   if(d.type==='phase'){phase(d.message,d.percent);if(d.block){if(d.block===1)etaStart=Date.now()-d.blockSeconds*1000;const per=(Date.now()-etaStart)/d.block,left=Math.round(per*(d.steps-d.block)/1000);$('eta').textContent=d.block<d.steps?`Tempo estimado restante: ~${Math.floor(left/60)}m ${String(left%60).padStart(2,'0')}s`:'';}}
   else if(d.type==='chunk')d.parts.forEach((p,i)=>chunks[i].push(new Blob([p])));
   else if(d.type==='done'){const h=wavHeader(d.frames,d.rate,d.channels);finish(null,{blobs:chunks.map(parts=>new Blob([h,...parts],{type:'audio/wav'})),info:d});}
   else if(d.type==='error')finish(Error(d.message||'Erro desconhecido do motor.'));};
  worker.onerror=evt=>finish(Error('O motor falhou ao iniciar: '+(evt.message||'erro de execução')+'. Seu navegador pode não suportar Web Workers de módulo.'));
  worker.onmessageerror=()=>finish(Error('Falha ao receber as pistas processadas.'));
  try{worker.postMessage({type:'separate',engine:engine(),quality:$('outputQuality').value,threads:LIMITS.threads,left:audio[0],right:audio[1]},[audio[0].buffer,audio[1].buffer]);}catch(err){finish(err);}
 });
}
async function decodeInput(file){
 phase('Decodificando o áudio…',2);context=context||new (window.AudioContext||window.webkitAudioContext)();
 const raw=await context.decodeAudioData(await file.arrayBuffer());const from=Math.max(0,Number($('from').value)||0),selection=Number($('duration').value);
 if(from>=raw.duration)throw Error('O início do trecho ultrapassa a duração da música ('+raw.duration.toFixed(1)+' s).');
 const time=Math.min(selection,MAX_SECONDS,raw.duration-from),offset=Math.floor(from*raw.sampleRate),width=Math.round(time*raw.sampleRate);if(width<=0)throw Error('Áudio vazio');
 const clip=context.createBuffer(Math.min(raw.numberOfChannels,2),width,raw.sampleRate);for(let ch=0;ch<clip.numberOfChannels;ch++)clip.copyToChannel(raw.getChannelData(ch).subarray(offset,offset+width),ch);
 // O modelo trabalha a 44,1 kHz estéreo. Reamostrar não muda andamento (BPM) nem duração.
 const off=new OfflineAudioContext(2,Math.round(time*SAMPLE_RATE),SAMPLE_RATE);const src=off.createBufferSource();src.buffer=clip;src.connect(off.destination);src.start();const res=await off.startRendering();
 return [new Float32Array(res.getChannelData(0)),new Float32Array(res.getChannelData(1))];
}
async function main(){
 if(working)return;const file=$('song').files[0];if(!file){phase('Escolha um áudio primeiro.',0,true);return;}
 if(!LIMITS.local){phase(LIMITS.reason,0,true);return;}
 if(file.size>220*1048576){phase('Arquivo acima de 220 MB. Recorte ou converta para MP3 antes.',0,true);return;}
 const sel=Number($('duration').value);
 if(!(sel>0)||sel>LIMITS.maxSeconds){phase('Duração acima do máximo do APS (5 min por separação). Escolha um trecho menor.',0,true);return;}
 if(sel>LIMITS.recommendedSeconds){const [a,b]=estimateSeconds(sel,deviceInfo().mobile);if(!confirm('Atenção: '+fmtMin(sel)+' está acima do recomendado para este aparelho ('+fmtMin(LIMITS.recommendedSeconds)+'). Tempo estimado: ~'+fmtMin(a)+' a '+fmtMin(b)+' (estimativa, sem garantia). Pode travar ou faltar memória; nenhuma pista falsa será criada. Mantenha a tela ligada. Continuar?'))return;}
 working=true;$('eta').textContent='';$('start').disabled=true;$('cancel').disabled=false;$('resultsPanel').hidden=true;stopPreview();resultBlobs=null;resultInfo=null;
 let lock=null;try{lock=await navigator.wakeLock?.request('screen');}catch{}
 try{const mix=await decodeInput(file);const dur=mix[0].length/SAMPLE_RATE;
  phase('Trecho de '+dur.toFixed(1)+' s pronto ('+blockCount(mix[0].length)+' blocos). Carregando o motor…',3);
  const out=await runWorker(mix,dur);resultBlobs=out.blobs;resultInfo=out.info;
  phase('Separação concluída. Ouça e baixe as 6 pistas geradas pelo modelo.',100);showResult();}
 catch(e){phase((e.cancelled?'':'Não foi possível concluir: ')+(e?.message||e)+(e.cancelled?'':' Nenhuma pista foi criada. Tente um trecho menor ou o modo leve.'),0,true);console.error(e);}
 finally{try{await lock?.release();}catch{}closeWorker();showModelCache();working=false;$('start').disabled=!LIMITS.local;$('cancel').disabled=true;}
}
function openDB(name,store){return new Promise((ok,fail)=>{if(!window.indexedDB)return fail(Error('Armazenamento local indisponível.'));const r=indexedDB.open(name,1);r.onupgradeneeded=()=>{if(!r.result.objectStoreNames.contains(store))r.result.createObjectStore(store);};r.onsuccess=()=>ok(r.result);r.onerror=()=>fail(r.error);});}
async function put(name,store,value){const db=await openDB(name,store);try{await new Promise((ok,fail)=>{const tx=db.transaction(store,'readwrite');tx.objectStore(store).put(value,'latest');tx.oncomplete=ok;tx.onerror=()=>fail(tx.error||Error('Armazenamento insuficiente.'));tx.onabort=()=>fail(tx.error||Error('Transferência cancelada.'));});}finally{db.close();}}
// Integração com a DAW: o mesmo canal já existente (IndexedDB "aps-stems-transfer-v1" + daw.html?importStems=1).
async function sendStemsToMixer(){
 if(!resultBlobs||working){$('transferStatus').textContent='Conclua a separação primeiro.';return;}
 $('sendMixer').disabled=true;
 try{$('transferStatus').textContent='Salvando as seis pistas para abrir no mixer…';
  await put('aps-stems-transfer-v1','sessions',{stems:SOURCES.map((s,i)=>({name:s.name+'.wav',type:s.id,blob:resultBlobs[i]})),savedAt:Date.now()});
  location.href='./daw.html?modulo=mixagem&importStems=1';
 }catch(e){$('transferStatus').textContent='Não foi possível enviar: '+(e?.message||e)+'. Use os botões WAV.';$('sendMixer').disabled=false;}
}
async function sendDrumStem(){
 if(!resultBlobs||working){$('transferStatus').textContent='Primeiro conclua a separação das seis pistas.';return;}
 try{await put('aps-drum-separated-v1','pending',{blob:resultBlobs[0],name:prefix()+'-bateria-separada.wav',source:'htdemucs_6s'});location.href='./bateria.html?importar=separador#aps-drum-analyzer';}
 catch(e){$('transferStatus').textContent='Falha ao transferir bateria: '+e.message+'. Baixe o WAV de Bateria e importe manualmente.';}
}
async function downloadZip(){
 if(!resultBlobs)return;const b=$('zipAll');b.disabled=true;
 try{const zip=await zipBlobs(SOURCES.map((s,i)=>({name:prefix()+'_'+s.id+'.wav',blob:resultBlobs[i]})),(i,n)=>{$('transferStatus').textContent='Montando ZIP: pista '+(i+1)+' de '+n+'…';});
  download(zip,prefix()+'_6-pistas.zip');$('transferStatus').textContent='ZIP com as 6 pistas pronto ('+(zip.size/1048576).toFixed(1)+' MB).';}
 catch(e){$('transferStatus').textContent='Falha ao montar ZIP: '+e.message+'. Baixe as pistas uma a uma.';}finally{b.disabled=false;}
}
$('sendMixer').addEventListener('click',sendStemsToMixer);$('apsOpenDrumSwap').addEventListener('click',sendDrumStem);$('zipAll').addEventListener('click',downloadZip);
$('start').addEventListener('click',main);
$('cancel').addEventListener('click',()=>{if(!working)return;phase('Cancelando…',0);stopWorker?.();});
window.addEventListener('pagehide',()=>{stopPreview();closeWorker();});
$('apsDrumOnlyGo')?.addEventListener('click',async()=>{const st=$('apsDrumOnlyStatus'),file=$('apsDrumOnlyFile')?.files?.[0];if(!file){st.textContent='Escolha primeiro um WAV ou MP3 de bateria.';return;}
 if(file.size>220*1048576){st.textContent='Arquivo grande demais (máximo 220 MB).';return;}
 try{st.textContent='Salvando a bateria dentro do APS…';await put('aps-drum-separated-v1','pending',{blob:file,name:file.name,source:'usuario'});location.href='./bateria.html?importar=separador#aps-drum-analyzer';}catch(e){st.textContent='Armazenamento indisponível: '+e.message;}});
// Recebe a pista enviada pelo estúdio (daw.html → Separar pista selecionada)
(async()=>{if(new URLSearchParams(location.search).get('importar')!=='daw')return;try{const db=await openDB('aps-sep-input-v1','pending');const item=await new Promise((ok,fail)=>{const tx=db.transaction('pending','readwrite'),st=tx.objectStore('pending'),g=st.get('latest');g.onsuccess=()=>{st.delete('latest');ok(g.result);};g.onerror=()=>fail(g.error);});db.close();if(!item?.blob)return;const f=new File([item.blob],item.name||'pista.wav',{type:'audio/wav'});const dt=new DataTransfer();dt.items.add(f);$('song').files=dt.files;$('song').dispatchEvent(new Event('change',{bubbles:true}));phase('Pista do estúdio carregada: '+f.name+'. Escolha a duração e toque em Separar.',0);}catch(e){phase('Não consegui receber a pista do estúdio: '+e.message,0,true);}})();
applyLimits();
window.APS6Stem={pcmToWav,SOURCES,SAMPLE_RATE,SEG,STRIDE,limits:()=>LIMITS,state:()=>({working,hasResult:!!resultBlobs,info:resultInfo,sizes:resultBlobs?.map(b=>b.size)}),blobs:()=>resultBlobs};
