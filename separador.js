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
 selected.forEach(id=>{
  const info=STEM_MAP[id];if(!info||!blobsByStem[id])return;
  const card=document.createElement('div');card.className='resultcard';
  card.innerHTML=`<h3>${info.icon} ${info.name}</h3><div class="buttons"><button class="listen">▶ Ouvir</button><button class="dl">↓ Baixar</button></div>`;
  card.querySelector('.listen').onclick=()=>preview(blobsByStem[id]).catch(e=>phase('Erro ao tocar: '+e.message,undefined,true));
  card.querySelector('.dl').onclick=()=>download(blobsByStem[id],prefix()+'_'+id+'.mp3');
  box.append(card);
 });
 $('resultsPanel').hidden=false;
 $('resultsPanel').scrollIntoView({behavior:'smooth'});
}
async function runCloud(file){
 const token=localStorage.getItem('aps_mvsep_token')||DEFAULT_MVSEP_TOKEN;
 phase('Enviando música…',15);
 const form=new FormData();
 form.append('audiofile',file);
 form.append('api_token',token);
 form.append('sep_type','20');
 form.append('output_format','0');
 const res=await fetch(PROXY+'/create',{method:'POST',body:form});
 const job=await res.json().catch(()=>({}));
 if(!res.ok||!job.success||!job.data?.hash){
  throw Error(job.message||job.error||'Erro ao enviar (verifique token ou limite do MVSEP).');
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
  if(status==='failed')throw Error(data.message||'Separação falhou.');
  if(status==='done')finalData=data;
 }
 if(status!=='done'||!finalData)throw Error('Demorou demais. Tente de novo.');
 const files=finalData.data?.files||[];
 phase('Baixando pistas…',90);
 const blobsByStem={};
 for(const f of files){
  if(!f.url)continue;
  const name=(f.name||'').toLowerCase();
  let stem=null;
  if(name.includes('vocal'))stem='vocals';
  else if(name.includes('drum'))stem='drums';
  else if(name.includes('bass'))stem='bass';
  else if(name.includes('other'))stem='other';
  if(!stem)continue;
  const audioRes=await fetch(f.url);
  if(audioRes.ok)blobsByStem[stem]=await audioRes.blob();
 }
 return blobsByStem;
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
window.addEventListener('pagehide',stopPreview);
