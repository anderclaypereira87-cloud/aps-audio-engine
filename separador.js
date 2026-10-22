// APS Audio Engine: separação local experimental via HTDemucs-6s ONNX.
// Fontes: https://stemsplit.github.io/demucs-onnx/browser/ e https://huggingface.co/StemSplitio/htdemucs-6s-onnx
const modelUrl = 'https://huggingface.co/StemSplitio/htdemucs-6s-onnx/resolve/main/htdemucs_6s_fp16weights.onnx';
const ortUrl='https://cdn.jsdelivr.net/npm/onnxruntime-web@1.21.0/dist/ort.min.mjs';
const WASM_URL='https://cdn.jsdelivr.net/npm/onnxruntime-web@1.21.0/dist/';
const SAMPLE_RATE=44100;
const SEG=343980;
const OVERLAP=Math.floor(SEG/4);
const STRIDE=SEG-OVERLAP;
const SOURCES=[{name:'Bateria',id:'bateria',head:'🥁'},{name:'Baixo',id:'baixo',head:'🎸'},{name:'Outros',id:'outros',head:'🎼'},{name:'Voz',id:'voz',head:'🎤'},{name:'Guitarra',id:'guitarra',head:'🎸'},{name:'Teclado / Piano',id:'piano',head:'🎹'}];
const $=id=>document.getElementById(id);
let cancelled=false,working=false,resultAudio=null,resultBlobs=null,context=null,session=null,ort=null,player=null;
function phase(msg,percent){$('phase').textContent=msg;if(percent!==undefined){$('bar').style.width=percent+'%';document.querySelector('[role=progressbar]').setAttribute('aria-valuenow',String(percent));}}
// 1.8.0: verificação do aparelho antes de separar
function deviceInfo(){const mem=navigator.deviceMemory||null,cpu=navigator.hardwareConcurrency||null,mobile=/Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
 const weak=(mem!==null&&mem<=4)||(cpu!==null&&cpu<=4)||(mobile&&mem===null);const strong=(mem===null||mem>=8)&&(cpu===null||cpu>=8)&&!mobile;return{mem,cpu,mobile,weak,strong};}
function showDeviceCheck(){const el=$('deviceCheck');if(!el)return;const d=deviceInfo();
 const desc='Memória: '+(d.mem?('~'+d.mem+' GB'):'não informada')+' · Processadores: '+(d.cpu||'não informado');
 if(d.weak){el.className='aps-devcheck weak';el.textContent='📱 Aparelho com poucos recursos ('+desc+'). Recomendado: 10 segundos. Para músicas longas, use a saída compacta ou importe a bateria já separada.';$('duration').value='10';}
 else if(d.strong){el.className='aps-devcheck';el.textContent='💻 Aparelho potente ('+desc+'). Pode tentar trechos maiores.';}
 else{el.className='aps-devcheck';el.textContent='🙂 Aparelho intermediário ('+desc+'). Comece com 10 a 30 segundos.';}}
let etaStart=0;
function nextPaint(){return new Promise(r=>setTimeout(r,20));}
function pcmToWav(left,right){
 const length=left.length, bytes=44+length*4,b=new ArrayBuffer(bytes),v=new DataView(b);
 const str=(offset,s)=>{for(let i=0;i<s.length;i++)v.setUint8(offset+i,s.charCodeAt(i));};
 str(0,'RIFF');v.setUint32(4,bytes-8,true);str(8,'WAVE');str(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,2,true);v.setUint32(24,SAMPLE_RATE,true);v.setUint32(28,SAMPLE_RATE*4,true);v.setUint16(32,4,true);v.setUint16(34,16,true);str(36,'data');v.setUint32(40,length*4,true);
 for(let i=0,p=44;i<length;i++){const l=Math.max(-1,Math.min(1,left[i])),r=Math.max(-1,Math.min(1,right[i]));v.setInt16(p,l<0?l*32768:l*32767,true);v.setInt16(p+2,r<0?r*32768:r*32767,true);p+=4;}
 return new Blob([b],{type:'audio/wav'});
}
function wavHeader(frames,rate,channels){
 const length=frames*channels*2;const b=new ArrayBuffer(44),v=new DataView(b);
 const str=(offset,text)=>{for(let i=0;i<text.length;i++)v.setUint8(offset+i,text.charCodeAt(i));};
 str(0,'RIFF');v.setUint32(4,36+length,true);str(8,'WAVE');str(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,channels,true);v.setUint32(24,rate,true);v.setUint32(28,rate*channels*2,true);v.setUint16(32,channels*2,true);v.setUint16(34,16,true);str(36,'data');v.setUint32(40,length,true);return b;
}
function sourceWav(i){if(resultBlobs)return resultBlobs[i];if(!resultAudio)throw Error('Sem stems');return pcmToWav(resultAudio[i][0],resultAudio[i][1]);}
function stopPreview(){try{player?.stop();}catch{}player=null;}
async function preview(i){
 if(resultBlobs){stopPreview();const u=URL.createObjectURL(resultBlobs[i]);const a=new Audio(u);player={stop:()=>{a.pause();URL.revokeObjectURL(u);}};a.onended=()=>{if(player){URL.revokeObjectURL(u);player=null;}};await a.play();return;}
 stopPreview();context=context||new (window.AudioContext||window.webkitAudioContext)();await context.resume();const [l,r]=resultAudio[i],b=context.createBuffer(2,l.length,SAMPLE_RATE);b.copyToChannel(l,0);b.copyToChannel(r,1);player=context.createBufferSource();player.buffer=b;player.connect(context.destination);player.start();}
function showResult(){const box=$('result');box.replaceChildren();const prefix=($('song').files[0].name||'APS_stems').replace(/\.[^.]+$/,'').replace(/[^a-z0-9_-]/gi,'_').slice(0,45)||'APS';
 SOURCES.forEach((s,i)=>{const card=document.createElement('div');card.className='resultcard';const title=document.createElement('h3');title.textContent=s.head+' '+s.name;const actions=document.createElement('div');actions.className='buttons';const listen=document.createElement('button');listen.className='alt';listen.textContent='▶ Ouvir';listen.addEventListener('click',()=>preview(i).catch(e=>phase('Erro ao reproduzir: '+e.message)));const download=document.createElement('button');download.textContent='↓ WAV';download.addEventListener('click',()=>{try{const url=URL.createObjectURL(sourceWav(i));const a=document.createElement('a');a.href=url;a.download=prefix+'_'+s.id+'.wav';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);}catch(e){phase('Não foi possível salvar: '+e.message);}});actions.append(listen,download);card.append(title,actions);box.append(card);});$('resultsPanel').hidden=false;$('resultsPanel').scrollIntoView({behavior:'smooth',block:'start'});}
function triangularWindow(){const win=new Float32Array(SEG);win.fill(1);for(let i=0;i<OVERLAP;i++){win[i]=Math.max(1e-5,i/OVERLAP);win[SEG-1-i]=Math.max(1e-5,i/OVERLAP);}return win;}
// O processamento pesado ocorre fora da interface, em um Web Worker.
// Assim o botão Cancelar continua responsivo mesmo durante inferência ONNX.
let activeWorker = null;
let stopWorker = null;
let elapsedTimer = null;
let jobStarted = 0;
function closeWorker(){
 if(activeWorker){activeWorker.terminate();activeWorker=null;}
 if(elapsedTimer){clearInterval(elapsedTimer);elapsedTimer=null;}
}
function runWorker(audio){
 return new Promise((resolve,reject)=>{
  let settled=false;
  const worker=new Worker('./separador-worker.js?v=190',{type:'module'});
  activeWorker=worker;
  jobStarted=Date.now();
  const maxMinutes=Number($('duration').value)<=30?8:Math.max(25,Math.ceil(Number($('duration').value)/10)*2);
  const maxMs=maxMinutes*60000;
  const finish=(err,out)=>{if(settled)return;settled=true;stopWorker=null;closeWorker();err?reject(err):resolve(out);};
  stopWorker=()=>finish(Error('Cancelado pelo usuário.'));
  elapsedTimer=setInterval(()=>{
   if(settled)return;
   const seconds=Math.floor((Date.now()-jobStarted)/1000);
   $('elapsed').textContent=`Tempo de processamento: ${Math.floor(seconds/60)}m ${String(seconds%60).padStart(2,'0')}s`;
   if(Date.now()-jobStarted>maxMs){finish(Error('Tempo limite atingido. O aparelho não conseguiu concluir o modelo local; a gravação original não foi alterada.'));}
  },1000);
  worker.onmessage=(evt)=>{
   if(settled)return;
   const data=evt.data;
   if(data.type==='phase'){phase(data.message,data.percent);if(data.block){if(data.block===1)etaStart=Date.now();else{const per=(Date.now()-etaStart)/(data.block-1),left=Math.round(per*(data.steps-data.block+1)/1000);$('eta').textContent=`Tempo estimado restante: ~${Math.floor(left/60)}m ${String(left%60).padStart(2,'0')}s`;}}}
   else if(data.type==='chunk'){
    if(!worker._chunks)worker._chunks=Array.from({length:6},()=>[]);
    worker._frames=(worker._frames||0)+data.frames;
    worker._rate=data.rate;worker._channels=data.channels;
    data.parts.forEach((part,i)=>worker._chunks[i].push(new Blob([part],{type:'application/octet-stream'})));
   }
   else if(data.type==='done'){
    const header=wavHeader(worker._frames||data.frames,data.rate,data.channels);
    resultBlobs=worker._chunks.map(parts=>new Blob([header,...parts],{type:'audio/wav'}));
    finish(null,null);
   }
   else if(data.type==='result')finish(null,data.stems.map(pair=>[new Float32Array(pair[0]),new Float32Array(pair[1])]));
   else if(data.type==='error')finish(Error(data.message||'Erro desconhecido do motor de IA.'));
  };
  worker.onerror=(evt)=>finish(Error('O motor de IA falhou ao iniciar: '+(evt.message||'erro de execução.')));
  worker.onmessageerror=()=>finish(Error('Falha ao receber as pistas processadas.'));
  try{worker.postMessage({type:'separate',mode:'stream',quality:$('outputQuality').value,left:audio[0],right:audio[1]},[audio[0].buffer,audio[1].buffer]);}
  catch(err){finish(err);}
 });
}
async function decodeInput(file){phase('Preparando o áudio…',2);context=context||new (window.AudioContext||window.webkitAudioContext)();const raw=await context.decodeAudioData(await file.arrayBuffer());const from=Number($('from').value)||0,selection=Number($('duration').value);if(from>=raw.duration)throw Error('O início do trecho ultrapassa a duração da música.');
 const time=Math.min(selection,Math.max(.1,raw.duration-from));const offset=Math.floor(from*raw.sampleRate),width=Math.round(time*raw.sampleRate);if(width<=0)throw Error('Áudio vazio');const clip=context.createBuffer(Math.min(raw.numberOfChannels,2),width,raw.sampleRate);for(let ch=0;ch<clip.numberOfChannels;ch++){clip.copyToChannel(raw.getChannelData(ch).subarray(offset,offset+width),ch);}const outputLength=Math.ceil(time*SAMPLE_RATE);const off=new OfflineAudioContext(2,outputLength,SAMPLE_RATE);const src=off.createBufferSource();src.buffer=clip;src.connect(off.destination);src.start();const resampled=await off.startRendering();if(cancelled)throw Error('Operação cancelada');const l=resampled.getChannelData(0),r=resampled.getChannelData(1);const left=new Float32Array(l),right=new Float32Array(r);return [left,right];}
async function main(){if(working)return;const file=$('song').files[0];if(!file){phase('Escolha um áudio primeiro.');return;}if(file.size>220*1024*1024){phase('O arquivo é grande demais para separação local no celular. Use um áudio de até 220 MB.');return;}
 {const d=deviceInfo(),dur=Number($('duration').value);if(d.weak&&dur>10&&!confirm('Este aparelho tem poucos recursos e pode travar com '+dur+' segundos. Recomendado: 10 segundos. Continuar mesmo assim?'))return;}
 working=true;cancelled=false;if($('eta'))$('eta').textContent='';$('start').disabled=true;$('cancel').disabled=false;$('resultsPanel').hidden=true;stopPreview();resultAudio=null;resultBlobs=null;
 try{const mix=await decodeInput(file);if(cancelled)throw Error('Cancelado');phase('Carregando motor de IA em segundo plano…',6);resultAudio=await runWorker(mix);if(cancelled)throw Error('Cancelado');phase('Separação finalizada! Ouça e baixe as pistas produzidas pelo motor.',100);showResult();}
 catch(e){const msg=String(e?.message||e);phase((cancelled?'Cancelado. ':'Não foi possível concluir no aparelho. ')+msg+'. O motor local não conseguiu concluir. Tente o modo menor, ou use uma bateria já isolada diretamente no APS.',0);console.error(e);}
 finally{closeWorker();working=false;$('start').disabled=false;$('cancel').disabled=true;}
}

// Transferência local dos WAVs: IndexedDB mantém os arquivos entre as duas telas.
function apsOpenDB(){return new Promise((resolve,reject)=>{
 if(!window.indexedDB){reject(Error('O navegador não permite transferir arquivos entre páginas. Baixe os WAVs manualmente.'));return;}
 const request=indexedDB.open('aps-stems-transfer-v1',1);
 request.onupgradeneeded=()=>{const db=request.result;if(!db.objectStoreNames.contains('sessions'))db.createObjectStore('sessions');};
 request.onsuccess=()=>resolve(request.result);
 request.onerror=()=>reject(request.error||Error('Falha ao acessar o armazenamento de arquivos.'));
});}
async function sendStemsToMixer(){
 if(!(resultAudio||resultBlobs)||working){$('transferStatus').textContent='Conclua a separação primeiro.';return;}
 const btn=$('sendMixer');btn.disabled=true;
 try{
  const db=await apsOpenDB();
  const stems=SOURCES.map((s,i)=>({name:s.name+'.wav',type:s.id,blob:sourceWav(i)}));
  $('transferStatus').textContent='Salvando as seis pistas para abrir no mixer…';
  await new Promise((resolve,reject)=>{
   const tx=db.transaction('sessions','readwrite');
   tx.objectStore('sessions').put({stems,savedAt:Date.now()},'latest');
   tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error||Error('Armazenamento insuficiente.'));tx.onabort=()=>reject(tx.error||Error('Transferência cancelada.'));
  });
  db.close();
  window.location.href='./daw.html?modulo=mixagem&importStems=1';
 }catch(e){$('transferStatus').textContent='Não foi possível enviar: '+(e?.message||e)+'. Use os botões WAV.';btn.disabled=false;}
}
$('sendMixer').addEventListener('click',sendStemsToMixer);


// O stem real de bateria (primeira saída do modelo de 6 pistas) é transferido
// localmente, em WAV, para o Drum Sampler. Não publica o arquivo.
async function apsSendDrumStem(){
 if(!(resultAudio||resultBlobs)||working){$('transferStatus').textContent='Primeiro conclua a separação das seis pistas.';return;}
 const button=$('apsOpenDrumSwap');button.disabled=true;
 try{
  const db=await new Promise((res,rej)=>{const q=indexedDB.open('aps-drum-separated-v1',1);q.onupgradeneeded=()=>{if(!q.result.objectStoreNames.contains('pending'))q.result.createObjectStore('pending');};q.onsuccess=()=>res(q.result);q.onerror=()=>rej(q.error);});
  const blob=sourceWav(0);const rawName=($('song').files[0]?.name||'Bateria').replace(/\.[^.]+$/,'');
  await new Promise((res,rej)=>{const tx=db.transaction('pending','readwrite');tx.objectStore('pending').put({blob,name:rawName+'-bateria-separada.wav'},'latest');tx.oncomplete=res;tx.onerror=()=>rej(tx.error||Error('Espaço insuficiente'));});
  db.close();location.href='./bateria.html?importar=separador#aps-drum-analyzer';
 }catch(e){$('transferStatus').textContent='Falha ao transferir bateria: '+e.message+'. Baixe o WAV de Bateria e importe manualmente.';button.disabled=false;}
}
$('apsOpenDrumSwap')?.addEventListener('click',apsSendDrumStem);

showDeviceCheck();
{const el=$('elapsed');if(el&&!$('eta')){const e=document.createElement('div');e.id='eta';e.setAttribute('role','status');e.style.cssText='color:#e5bd72;font-size:14px;margin-top:4px';el.after(e);}}

// Pista de bateria previamente separada entra no mesmo APS, sem app externo.
$('apsDrumOnlyGo')?.addEventListener('click',async()=>{
 const status=$('apsDrumOnlyStatus'),input=$('apsDrumOnlyFile');
 const file=input?.files?.[0];if(!file){status.textContent='Escolha primeiro um WAV ou MP3 de bateria.';return;}
 if(file.size>220*1024*1024){status.textContent='Arquivo grande demais para este modo (máximo 220 MB).';return;}
 try{
  status.textContent='Salvando a bateria dentro do APS…';
  const db=await new Promise((ok,fail)=>{const r=indexedDB.open('aps-drum-separated-v1',1);r.onupgradeneeded=()=>{if(!r.result.objectStoreNames.contains('pending'))r.result.createObjectStore('pending');};r.onsuccess=()=>ok(r.result);r.onerror=()=>fail(r.error);});
  await new Promise((ok,fail)=>{const tx=db.transaction('pending','readwrite');tx.objectStore('pending').put({blob:file,name:file.name},'latest');tx.oncomplete=ok;tx.onerror=()=>fail(tx.error);});db.close();
  location.href='./bateria.html?importar=separador#aps-drum-analyzer';
 }catch(e){status.textContent='Armazenamento indisponível: '+e.message;}
});

const apsDeviceMemory=navigator.deviceMemory;
if($('apsMemoryInfo')){
 $('apsMemoryInfo').textContent=apsDeviceMemory?
  'Memória aproximada informada pelo dispositivo: '+apsDeviceMemory+' GB. Para sessões longas, prefira saída compacta e feche outros aplicativos.':
  'Este navegador não informa a memória disponível. Se a separação longa falhar, reduza a duração ou importe a bateria já isolada diretamente.';
}
$('start').addEventListener('click',main);$('cancel').addEventListener('click',()=>{cancelled=true;phase('Cancelado pelo usuário.',0);stopWorker?.();});window.addEventListener('pagehide',stopPreview);
window.APS6Stem={pcmToWav,triangularWindow,SOURCES,SAMPLE_RATE,SEG,STRIDE};
