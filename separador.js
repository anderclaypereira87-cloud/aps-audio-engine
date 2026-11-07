// APS Separador simplificado · só nuvem StemConsole + escolha de instrumentos
const DEFAULT_STEMCONSOLE_KEY='sc_live_qhfUakGoAeELErZBncHc7Qxlz_VIOhTyPkvuO_8OrXE';
const $=id=>document.getElementById(id);
let working=false,resultBlobs=null,player=null;

const STEM_MAP={
 vocals:{name:'Voz',icon:'🎤'},
 drums:{name:'Bateria',icon:'🥁'},
 bass:{name:'Baixo',icon:'🎸'},
 guitar:{name:'Guitarra',icon:'🎸'},
 piano:{name:'Teclado / Piano',icon:'🎹'},
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
 const key=localStorage.getItem('aps_stemconsole_key')||DEFAULT_STEMCONSOLE_KEY;
 phase('Enviando música…',15);
 const form=new FormData();form.append('file',file);form.append('model','full');
 const res=await fetch('https://stemconsole.ai/api/v1/splits',{method:'POST',headers:{Authorization:'Bearer '+key},body:form});
 if(!res.ok){const err=await res.json().catch(()=>({}));throw Error(err.message||err.error||'Erro na API (verifique crédito/chave).');}
 const job=await res.json();const id=job.id;if(!id)throw Error('Resposta inválida.');
 phase('Separando na nuvem…',40);
 let status='queued',tries=0;
 while(status!=='done'&&tries<90){
  await new Promise(r=>setTimeout(r,4000));tries++;
  const st=await fetch('https://stemconsole.ai/api/v1/splits/'+id,{headers:{Authorization:'Bearer '+key}});
  if(!st.ok)throw Error('Falha ao consultar status.');
  const data=await st.json();status=data.status;
  phase('Processando… ('+status+')',40+Math.min(40,tries*0.8));
  if(status==='failed')throw Error(data.message||'Separação falhou.');
 }
 if(status!=='done')throw Error('Demorou demais. Tente de novo.');
 const final=await (await fetch('https://stemconsole.ai/api/v1/splits/'+id,{headers:{Authorization:'Bearer '+key}})).json();
 const stems=final.stems||[];
 phase('Baixando pistas…',90);
 const blobsByStem={};
 for(const s of stems){
  if(!s.mp3_url)continue;
  const audioRes=await fetch(s.mp3_url);
  if(audioRes.ok)blobsByStem[s.name]=await audioRes.blob();
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
