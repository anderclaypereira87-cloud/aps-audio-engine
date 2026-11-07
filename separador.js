// APS Separador · MVSEP via Cloudflare Worker proxy
const PROXY = 'https://aps-mvsep.aps-audio.workers.dev';
const DEFAULT_MVSEP_TOKEN = 'vQOURmyYsPeSJrSwWTvoEUj1CghfVj';
const $=id=>document.getElementById(id);
let working=false,resultBlobs=null,player=null;

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
function stopPreview(){try{player?.pause();}catch{}player=null;}
async function preview(blob){stopPreview();const u=URL.createObjectURL(blob);const a=new Audio(u);player=a;a.onended=()=>URL.revokeObjectURL(u);await a.play();}
function download(blob,name){const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);}
function prefix(){return(($('song').files[0]?.name)||'APS').replace(/\.[^.]+$/,'').replace(/[^a-z0-9_-]/gi,'_').slice(0,40)||'APS';}
function showResult(blobsByStem){
 const box=$('result');box.replaceChildren();
 const selected=selectedInstruments();
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
async function runCloud(file){
 const token=localStorage.getItem('aps_mvsep_token')||DEFAULT_MVSEP_TOKEN;
 phase('Enviando música…',15);
 const form=new FormData();
 form.append('audiofile',file,file.name);
 form.append('api_token',token);
 form.append('sep_type','20');
 form.append('output_format','0');
 const res=await fetch(PROXY+'/create',{method:'POST',body:form});
 const job=await res.json().catch(()=>({}));
 if(!res.ok||!job.success||!job.data?.hash){
  const msg=job.data?.message||job.message||job.error||(job.errors&&job.errors[0])||'Erro ao enviar';
  throw Error(msg);
 }
 const hash=job.data.hash;
 phase('Separando na nuvem…',40);
 let status='waiting',tries=0,finalData=null;
 while(status!=='done'&&tries<120){
  await new Promise(r=>setTimeout(r,5000));tries++;
  const st=await fetch(PROXY+'/status?hash='+hash);
  const data=await st.json().catch(()=>({}));
  status=data.status||'waiting';
  phase('Processando… ('+status+')',40+Math.min(40,tries*0.6));
  if(status==='failed')throw Error(data.data?.message||data.message||'Separação falhou.');
  if(status==='done')finalData=data;
 }
 if(status!=='done'||!finalData)throw Error('Demorou demais. Tente de novo.');
 const files=finalData.data?.files||[];
 phase('Baixando pistas…',90);
 const blobsByStem={};
 for(const f of files){
  if(!f.url)continue;
  const stem=mapStem(f.name);
  if(!stem)continue;
  try{
   const proxyUrl=PROXY+'/download?url='+encodeURIComponent(f.url);
   const audioRes=await fetch(proxyUrl);
   if(audioRes.ok)blobsByStem[stem]=await audioRes.blob();
  }catch(e){console.warn('Falha ao baixar',f.name,e);}
 }
 return blobsByStem;
}
function openInDaw(){
 if(!resultBlobs)return;
 const stems={};
 for(const [id,blob] of Object.entries(resultBlobs)){
  stems[id]=URL.createObjectURL(blob);
 }
 sessionStorage.setItem('aps_stems',JSON.stringify(stems));
 sessionStorage.setItem('aps_stems_name',prefix());
 location.href='./index.html?from=separador';
}
function downloadAll(){
 if(!resultBlobs)return;
 for(const [id,blob] of Object.entries(resultBlobs)){
  download(blob,prefix()+'_'+id+'.mp3');
 }
}
async function main(){
 if(working)return;
 const file=$('song').files[0];if(!file){phase('Escolha um arquivo de áudio primeiro.',0,true);return;}
 const selected=selectedInstruments();if(!selected.length){phase('Selecione pelo menos um instrumento.',0,true);return;}
 working=true;$('start').disabled=true;$('cancel').disabled=false;$('resultsPanel').hidden=true;stopPreview();resultBlobs=null;
 try{
  const blobs=await runCloud(file);
  resultBlobs=blobs;
  phase('Pronto! Ouça ou baixe as pistas.',100);
  showResult(blobs);
 }catch(e){phase(e?.message||'Erro desconhecido.',0,true);console.error(e);}
 finally{working=false;$('start').disabled=false;$('cancel').disabled=true;}
}
$('start').addEventListener('click',main);
$('cancel').addEventListener('click',()=>{if(working)phase('Cancelado.',0);working=false;$('start').disabled=false;$('cancel').disabled=true;});
$('openDaw')?.addEventListener('click',openInDaw);
$('downloadAll')?.addEventListener('click',downloadAll);
window.addEventListener('pagehide',stopPreview);
