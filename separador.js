// APS Separador · MVSEP via Cloudflare Worker proxy
const PROXY = 'https://aps-mvsep.aps-audio.workers.dev';
const DEFAULT_MVSEP_TOKEN = 'vQOURmyYsPeSJrSwWTvoEUj1CghfVj';
const $=id=>document.getElementById(id);
let working=false,transferring=false,resultBlobs=null,player=null,activeController=null,pendingJob=null,resultName='',handedFile=null,waitingHandoff=null;
const PENDING_JOB_KEY='aps_mvsep_pending_v1';

const STEM_MAP={
 vocals:{name:'Voz',icon:'🎤'},
 drums:{name:'Bateria',icon:'🥁'},
 bass:{name:'Baixo',icon:'🎸'},
 other:{name:'Outros',icon:'🎼'}
};

function phase(msg,percent,error=false){
 const el=$('phase');if(!el)return;
 el.textContent=msg;el.style.color=error?'#ffb4a8':'#dbcaab';
 if(percent!==undefined)$('bar').style.width=percent+'%';
}
function selectedInstruments(){
 return [...document.querySelectorAll('#instList input:checked')].map(cb=>cb.value);
}
function readPendingJob(){
 try{
  const job=JSON.parse(localStorage.getItem(PENDING_JOB_KEY)||'null');
  if(job&&typeof job.hash==='string'&&job.hash&&typeof job.name==='string'&&Array.isArray(job.instruments)&&job.instruments.length&&job.instruments.every(id=>STEM_MAP[id]))return job;
 }catch{}
 return pendingJob;
}
function rememberJob(job){
 pendingJob=job;
 try{localStorage.setItem(PENDING_JOB_KEY,JSON.stringify(job));}catch{}
 syncControls();
}
function forgetJob(hash){
 if(pendingJob?.hash===hash)pendingJob=null;
 try{
  const saved=JSON.parse(localStorage.getItem(PENDING_JOB_KEY)||'null');
  if(saved?.hash===hash)localStorage.removeItem(PENDING_JOB_KEY);
 }catch{}
}
function syncControls(){
 const saved=!!pendingJob;
 const completed=pendingJob?.status==='done';
 $('start').disabled=working||transferring;
 $('start').textContent=saved?(completed?'Reabrir resultado':'Continuar separação'):'♫ Separar agora';
 $('cancel').disabled=!working;
 $('song').disabled=working||saved||transferring;
 document.querySelectorAll('#instList input').forEach(cb=>{cb.disabled=working||saved||transferring;});
 const reset=$('newSeparation');if(reset){reset.hidden=!saved;reset.disabled=working||transferring;reset.textContent=completed?'Escolher outra música':'Escolher outra música (o pedido anterior continua no serviço)';}
 const note=$('pendingNote');if(note){
  note.hidden=!saved;
  note.textContent=completed?'Você pode reabrir as pistas neste aparelho, sem reenviar a música, enquanto o resultado estiver disponível no serviço.':'Seu pedido está salvo neste aparelho. Você pode voltar a esta página e tocar em Continuar separação, sem reenviar a música. Pausar o acompanhamento mantém o pedido na fila do serviço.';
 }
}
function ensureActive(signal){if(signal?.aborted)throw signal.reason||new DOMException('Acompanhamento pausado.','AbortError');}
function waitForPoll(signal){
 ensureActive(signal);
 return new Promise((resolve,reject)=>{
  const stop=()=>{clearTimeout(timer);reject(signal.reason||new DOMException('Acompanhamento pausado.','AbortError'));};
  const timer=setTimeout(()=>{signal?.removeEventListener('abort',stop);resolve();},5000);
  signal?.addEventListener('abort',stop,{once:true});
 });
}
function elapsed(job){
 const seconds=Math.max(0,Math.floor((Date.now()-(job.createdAt||Date.now()))/1000));
 return Math.floor(seconds/60)+' min '+String(seconds%60).padStart(2,'0')+' s';
}
function showCloudStatus(data,job){
 const details=data.data||{};
 if(data.status==='waiting'){
  const order=Number(details.current_order);
  const position=Number.isFinite(order)&&order>0?' · posição '+order:'';
  phase('Na fila do serviço de separação'+position+' · '+elapsed(job)+' de espera.',20);
 }else if(data.status==='distributing'){
  phase('Preparando o áudio para separar os instrumentos…',35);
 }else if(data.status==='merging'){
  phase('Finalizando as pistas separadas…',80);
 }else if(data.status==='processing'){
  phase('Separando os instrumentos… · '+elapsed(job)+' desde o envio.',55);
 }else{
  throw Error('O serviço retornou um estado desconhecido. Seu pedido foi mantido para nova consulta.');
 }
}
function stopPreview(){try{player?.pause();}catch{}player=null;}
async function preview(blob){stopPreview();const u=URL.createObjectURL(blob);const a=new Audio(u);player=a;a.onended=()=>URL.revokeObjectURL(u);await a.play();}
function download(blob,name){const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);}
function prefix(){return(resultName||$('song').files[0]?.name||handedFile?.name||'APS').replace(/\.[^.]+$/,'').replace(/[^a-z0-9_-]/gi,'_').slice(0,40)||'APS';}
function showResult(blobsByStem,selected=selectedInstruments()){
 const box=$('result');box.replaceChildren();
 let shown=0;
 selected.forEach(id=>{
  const info=STEM_MAP[id];if(!info||!blobsByStem[id])return;
  shown++;
  const card=document.createElement('div');card.className='resultcard';
  card.innerHTML=`<h3>${info.icon} ${info.name}</h3><div class="buttons"><button class="listen">▶ Ouvir</button><button class="dl">↓ Baixar</button></div>`;
  card.querySelector('.listen').onclick=()=>preview(blobsByStem[id]).catch(e=>phase('Erro ao tocar: '+e.message,undefined,true));
  card.querySelector('.dl').onclick=()=>download(blobsByStem[id],prefix()+'_'+id+'.mp3');
  box.append(card);
 });
 if(shown===0){
  phase('Separação concluída, mas nenhum arquivo reconhecido. Tente de novo.',100,true);
  return;
 }
 resultBlobs=blobsByStem;
 $('resultsPanel').hidden=false;
 $('resultsPanel').scrollIntoView({behavior:'smooth'});
}
function mapStem(name){
 const n=(name||'').toLowerCase();
 if(n.includes('vocal')||n.includes('voz'))return 'vocals';
 if(n.includes('drum')||n.includes('bateria'))return 'drums';
 if(n.includes('bass')||n.includes('baixo'))return 'bass';
 if(n.includes('other')||n.includes('outro'))return 'other';
 return null;
}
async function runCloud(file,{signal}={}){
 let saved=readPendingJob();
 if(!saved){
  if(!file)throw Error('Escolha um arquivo de áudio primeiro.');
  const token=localStorage.getItem('aps_mvsep_token')||DEFAULT_MVSEP_TOKEN;
  phase('Enviando música…',10);
  const form=new FormData();
  form.append('audiofile',file,file.name);
  form.append('api_token',token);
  form.append('sep_type','20');
  form.append('output_format','0');
  const res=await fetch(PROXY+'/create',{method:'POST',body:form,signal});
  const created=await res.json().catch(()=>({}));
  if(!res.ok||!created.success||!created.data?.hash){
   const msg=created.data?.message||created.message||created.error||(created.errors&&created.errors[0])||'Erro ao enviar';
   throw Error(msg);
  }
  saved={hash:created.data.hash,name:file.name,instruments:selectedInstruments(),createdAt:Date.now()};
  rememberJob(saved);
 }
 resultName=saved.name;
 const hash=saved.hash;
 let finalData;
 while(true){
  ensureActive(signal);
  const st=await fetch(PROXY+'/status?hash='+encodeURIComponent(hash),{signal});
  const data=await st.json().catch(()=>null);
  ensureActive(signal);
  if(data?.status==='failed'||data?.status==='not_found'){
   forgetJob(hash);
   throw Error(data.data?.message||data.message||'O serviço não encontrou uma separação válida. Escolha a música para um novo envio.');
  }
  if(!st.ok||!data||data.success===false)throw Error(data?.data?.message||data?.message||'Não foi possível consultar a separação.');
  if(data.status==='done'){finalData=data;break;}
  showCloudStatus(data,saved);
  await waitForPoll(signal);
 }
 const files=finalData.data?.files||[];
 if(!Array.isArray(files)||files.length===0)throw Error('A separação terminou, mas o serviço não retornou arquivos de áudio.');
 phase('Baixando pistas…',90);
 const blobsByStem={};
 for(const f of files){
  if(!f.url)continue;
  // MVSEP identifica as pistas em `type`; `download` é o nome do arquivo.
  const stem=mapStem(f.type||f.name||f.download);
  if(!stem)continue;
  const proxyUrl=PROXY+'/download?url='+encodeURIComponent(f.url);
  ensureActive(signal);
  const audioRes=await fetch(proxyUrl,{signal});
  if(!audioRes.ok)throw Error('Não foi possível baixar a pista '+STEM_MAP[stem].name+' (HTTP '+audioRes.status+'). Tente novamente.');
  const blob=await audioRes.blob();
  ensureActive(signal);
  if(!blob.size)throw Error('O serviço retornou um arquivo vazio para a pista '+STEM_MAP[stem].name+'.');
  blobsByStem[stem]=blob;
 }
 if(!Object.keys(blobsByStem).length)throw Error('A separação terminou, mas os tipos de pista retornados pelo serviço não foram reconhecidos.');
 rememberJob({...saved,status:'done'});
 return blobsByStem;
}
function selectedResultStems(){
 if(!resultBlobs)return [];
 const selected=selectedInstruments();
 const extensions={'audio/mpeg':'mp3','audio/wav':'wav','audio/x-wav':'wav','audio/flac':'flac','audio/mp4':'m4a','audio/ogg':'ogg','audio/webm':'webm'};
 return Object.entries(resultBlobs).filter(([id])=>selected.includes(id)).map(([id,blob])=>{
  const mime=blob.type.split(';')[0].toLowerCase();
  const ext=extensions[mime]||'mp3';
  return {id,name:STEM_MAP[id].name+'.'+ext,type:extensions[mime]?mime:'audio/mpeg',blob};
 });
}
async function openInDaw(){
 if(!resultBlobs||transferring)return;
 const stems=selectedResultStems();
 if(!stems.length){phase('Não há pistas selecionadas para abrir na DAW.',undefined,true);return;}
 transferring=true;syncControls();$('openDaw').disabled=true;$('downloadAll').disabled=true;
 phase('Abrindo as pistas no estúdio…',100);
 let db;
 try{
  if(!window.indexedDB)throw Error('Este navegador não permite a transferência automática das pistas.');
  db=await new Promise((resolve,reject)=>{
   const r=indexedDB.open('aps-stems-transfer-v1',1);
   r.onupgradeneeded=()=>{if(!r.result.objectStoreNames.contains('sessions'))r.result.createObjectStore('sessions');};
   r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);
  });
  const row={id:Date.now()+'-'+Math.random().toString(36).slice(2),name:(resultName||prefix()).replace(/\.[^.]+$/,''),stems,createdAt:Date.now()};
  await new Promise((resolve,reject)=>{
   const tx=db.transaction('sessions','readwrite');
   tx.objectStore('sessions').put(row,'latest');
   tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||Error('Não foi possível salvar as pistas para abrir no estúdio.'));
  });
  location.href='./daw.html?modulo=gravacao&importStems=1&v=451';
 }catch(e){
  phase('Não foi possível abrir as pistas na DAW: '+(e?.message||'tente novamente.'),undefined,true);
 }finally{
  db?.close();transferring=false;syncControls();$('openDaw').disabled=false;$('downloadAll').disabled=false;
 }
}
function downloadAll(){
 if(transferring)return;
 const stems=selectedResultStems();
 if(!stems.length){phase('Não há pistas selecionadas para baixar.',undefined,true);return;}
 for(const stem of stems)download(stem.blob,prefix()+'_'+stem.id+'.'+stem.name.split('.').pop());
 phase('Download das pistas iniciado no aparelho.',100);
}
async function main(){
 if(working||transferring)return;
 pendingJob=readPendingJob();
 const file=$('song').files[0]||handedFile;if(!pendingJob&&!file){phase('Escolha um arquivo de áudio primeiro.',0,true);return;}
 const selected=pendingJob?.instruments||selectedInstruments();if(!selected.length){phase('Selecione pelo menos um instrumento.',0,true);return;}
 const controller=new AbortController();activeController=controller;
 working=true;syncControls();$('resultsPanel').hidden=true;stopPreview();resultBlobs=null;
 try{
  const blobs=await runCloud(file,{signal:controller.signal});
  ensureActive(controller.signal);
  resultBlobs=blobs;
  phase('Pronto! Escolha baixar no aparelho ou abrir na DAW de gravação.',100);
  showResult(blobs,selected);
 }catch(e){
  if(controller.signal.aborted){
   phase(pendingJob?'Acompanhamento pausado. Seu pedido continua salvo; toque em Continuar separação.':'Envio interrompido.',undefined);
  }else{
   const resume=pendingJob?' Toque em '+(pendingJob.status==='done'?'Reabrir resultado':'Continuar separação')+' para consultar o mesmo pedido.':'';
   phase((e?.message||'Não foi possível concluir a separação.')+resume,undefined,true);
   console.error(e);
  }
 }finally{working=false;activeController=null;syncControls();}
}
$('start').addEventListener('click',main);
$('cancel').addEventListener('click',()=>activeController?.abort());
$('newSeparation')?.addEventListener('click',()=>{
 if(working||transferring)return;
 if(pendingJob)forgetJob(pendingJob.hash);
 $('song').value='';handedFile=null;$('song').dispatchEvent(new Event('change'));
 syncControls();
 if(waitingHandoff){if(applyHandoff(waitingHandoff,{fromPending:true}))readHandoffRow(true).catch(()=>{});return;}
 phase('Escolha a música para iniciar outra separação.',0);
});
$('openDaw')?.addEventListener('click',openInDaw);
$('downloadAll')?.addEventListener('click',downloadAll);
window.addEventListener('pagehide',()=>{stopPreview();activeController?.abort();});
pendingJob=readPendingJob();
if(pendingJob){
 resultName=pendingJob.name;
 $('apsChosenSong').textContent=pendingJob.name+' · pedido salvo';
 $('fileBtn').textContent='✔ '+pendingJob.name;
 document.querySelectorAll('#instList input').forEach(cb=>{
  cb.checked=pendingJob.instruments.includes(cb.value);
  cb.closest('label').classList.toggle('active',cb.checked);
 });
 syncControls();
 phase(pendingJob.status==='done'?'Toque em Reabrir resultado para baixar novamente suas pistas.':'Pedido salvo. Toque em Continuar separação para consultar o resultado sem reenviar a música.',20);
}

const HANDOFF_DB='aps-separator-handoff-v1';
const HANDOFF_MAX_AGE_MS=30*60*1000;
const SEPARATOR_MAX_SECONDS=300;
function formatHandoffDuration(seconds){
 const total=Math.max(0,Math.round(Number(seconds)||0));
 return Math.floor(total/60)+' min '+String(total%60).padStart(2,'0')+' s';
}
function wantedAudioImport(){
 const params=new URLSearchParams(location.search);
 if(params.get('importAudio')!=='1')return false;
 params.delete('importAudio');
 const qs=params.toString();
 const url=location.pathname+(qs?'?'+qs:'')+location.hash;
 try{history.replaceState({},'',url);}catch{}
 return true;
}
function openHandoffDb(){
 return new Promise((resolve,reject)=>{
  if(!window.indexedDB)return reject(Error('Este navegador não permite a transferência automática.'));
  const r=indexedDB.open(HANDOFF_DB,1);
  r.onupgradeneeded=()=>{if(!r.result.objectStoreNames.contains('sessions'))r.result.createObjectStore('sessions');};
  r.onsuccess=()=>resolve(r.result);
  r.onerror=()=>reject(r.error);
 });
}
async function readHandoffRow(consume){
 let db;
 try{
  db=await openHandoffDb();
  return await new Promise((resolve,reject)=>{
   const tx=db.transaction('sessions',consume?'readwrite':'readonly');
   const store=tx.objectStore('sessions');
   const get=store.get('latest');
   get.onsuccess=()=>{
    const row=get.result||null;
    if(consume&&row)store.delete('latest');
    resolve(row);
   };
   get.onerror=()=>reject(get.error);
  });
 }finally{db?.close();}
}
function showChosenSong(file){
 const status=$('apsChosenSong'),btn=$('fileBtn');
 if(!file)return;
 if(status)status.textContent='Selecionado: '+file.name;
 if(btn){
  btn.textContent='✔ '+file.name;
  btn.classList.add('has-file');
 }
}
function assignSongFile(file){
 const picker=$('song');
 handedFile=file;
 try{
  const dt=new DataTransfer();
  dt.items.add(file);
  picker.files=dt.files;
 }catch{}
 picker.dispatchEvent(new Event('change'));
 if(!picker.files?.length)showChosenSong(file);
}
function applyHandoff(row,{fromPending=false}={}){
 if(!row?.blob||!(row.blob instanceof Blob)||!row.blob.size){
  phase('Não encontrei a música enviada da página de IA. Escolha o arquivo de novo.',0,true);
  waitingHandoff=null;
  return false;
 }
 if(row.createdAt&&Date.now()-Number(row.createdAt)>HANDOFF_MAX_AGE_MS){
  phase('A música enviada da página de IA expirou. Gere ou envie o arquivo de novo.',0,true);
  waitingHandoff=null;
  return false;
 }
 const name=row.name||'musica-ia.mp3';
 const file=new File([row.blob],name,{type:row.type||row.blob.type||'audio/mpeg'});
 assignSongFile(file);
 waitingHandoff=null;
 const duration=Number(row.duration);
 const overLimit=Number.isFinite(duration)&&duration>SEPARATOR_MAX_SECONDS;
 const label=Number.isFinite(duration)?' ('+formatHandoffDuration(duration)+')':'';
 if(overLimit){
  phase('Música da criação com IA carregada'+label+'. O separador usa no máximo 5 minutos por vez. Escolha os instrumentos e toque em Separar agora.',0,true);
 }else{
  phase((fromPending?'Pedido anterior encerrado. ':'')+'Música da criação com IA carregada'+label+'. Escolha os instrumentos e toque em Separar agora. A contagem do plano gratuito segue a mesma de sempre.',0);
 }
 return true;
}
async function importAudioHandoff(){
 if(!wantedAudioImport())return;
 try{
  const row=await readHandoffRow(false);
  if(!row){
   phase('Não encontrei a música enviada da página de IA. Escolha o arquivo de novo.',0,true);
   return;
  }
  if(pendingJob){
   waitingHandoff=row;
   phase('Há uma separação salva neste aparelho. Toque em Escolher outra música para carregar a música da IA, ou continue o pedido anterior.',20);
   return;
  }
  if(applyHandoff(row))await readHandoffRow(true);
 }catch(e){
  phase('Não foi possível carregar a música da criação com IA. Escolha o arquivo manualmente.',0,true);
  console.error(e);
 }
}
importAudioHandoff();
