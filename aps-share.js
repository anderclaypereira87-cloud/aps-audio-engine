/* APS 2.7.0 — Exportar MP3/WAV e compartilhar (WhatsApp etc.) pelo próprio aparelho.
 * MP3 codificado no navegador com lamejs (vendor/lame.min.js, LGPL). Nada é enviado a servidor do APS. */
(function(root){'use strict';
const idle=()=>new Promise(r=>setTimeout(r,0));const $=id=>document.getElementById(id);
function loadLame(){if(root.lamejs)return Promise.resolve();return new Promise((ok,err)=>{const s=document.createElement('script');s.src='./vendor/lame.min.js';s.onload=()=>ok();s.onerror=()=>err(Error('Não foi possível carregar o codificador MP3.'));document.head.appendChild(s);});}
function peakNormalize(buf,target=.98){let pk=0;for(let c=0;c<buf.numberOfChannels;c++){const x=buf.getChannelData(c);for(let i=0;i<x.length;i++){const v=Math.abs(x[i]);if(v>pk)pk=v;}}return pk>target?target/pk:1;}
async function mp3(buf,{kbps=192,onProgress}={}){await loadLame();const ch=Math.min(2,buf.numberOfChannels),enc=new root.lamejs.Mp3Encoder(ch,buf.sampleRate,kbps),g=peakNormalize(buf),L=buf.getChannelData(0),R=ch>1?buf.getChannelData(1):null,B=1152*20,parts=[];
 const to16=(x,a,n)=>{const o=new Int16Array(n);for(let i=0;i<n;i++){let v=x[a+i]*g;v=v<-1?-1:v>1?1:v;o[i]=v<0?v*32768:v*32767;}return o;};
 for(let i=0;i<L.length;i+=B){const n=Math.min(B,L.length-i),d=ch>1?enc.encodeBuffer(to16(L,i,n),to16(R,i,n)):enc.encodeBuffer(to16(L,i,n));if(d.length)parts.push(new Uint8Array(d));if((i/B)%10===0){onProgress?.(i/L.length);await idle();}}
 const e=enc.flush();if(e.length)parts.push(new Uint8Array(e));return new Blob(parts,{type:'audio/mpeg'});}
function wav(buf){const ch=buf.numberOfChannels,n=buf.length,sr=buf.sampleRate,g=peakNormalize(buf),ab=new ArrayBuffer(44+n*ch*2),v=new DataView(ab),w=(o,s)=>{for(let i=0;i<s.length;i++)v.setUint8(o+i,s.charCodeAt(i));};
 w(0,'RIFF');v.setUint32(4,36+n*ch*2,true);w(8,'WAVE');w(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,ch,true);v.setUint32(24,sr,true);v.setUint32(28,sr*ch*2,true);v.setUint16(32,ch*2,true);v.setUint16(34,16,true);w(36,'data');v.setUint32(40,n*ch*2,true);
 const C=[...Array(ch)].map((_,c)=>buf.getChannelData(c));let o=44;for(let i=0;i<n;i++)for(let c=0;c<ch;c++){let s=C[c][i]*g;s=s<-1?-1:s>1?1:s;v.setInt16(o,s<0?s*32768:s*32767,true);o+=2;}return new Blob([ab],{type:'audio/wav'});}
const safe=s=>(String(s||'APS').replace(/[\\/:*?"<>|]+/g,'').trim()||'APS').slice(0,60);
function save(blob,name){const u=URL.createObjectURL(blob),a=document.createElement('a');a.href=u;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),60000);}
function canShareFile(file){try{return !!(navigator.share&&navigator.canShare&&navigator.canShare({files:[file]}));}catch{return false;}}
/** Compartilha um arquivo pelo menu do sistema (WhatsApp aparece se instalado). Retorna 'shared'|'downloaded'|'cancelled'. */
async function share(blob,name,text){const file=new File([blob],name,{type:blob.type||'application/octet-stream'});
 if(canShareFile(file)){try{await navigator.share({files:[file],title:name,text});return 'shared';}catch(e){if(e&&e.name==='AbortError')return 'cancelled';}}
 save(blob,name);return 'downloaded';}
const allowed=f=>!root.APSPlan||root.APSPlan.allowed(f);
function ui(){const B=root.APSMixBridge,row=$('export')?.parentElement;if(!B||!row)return;const st=(t,bad)=>{const s=$('status');if(s){s.textContent=t;s.classList.toggle('bad',!!bad);}};
 row.insertAdjacentHTML('beforeend','<button id="apsMp3">↓ Mixagem MP3</button><button id="apsShareMix" class="accent">📤 Compartilhar música</button>');
 row.insertAdjacentHTML('afterend','<div class="aps-share-opts"><label>Formato para compartilhar <select id="apsShareFmt" class="compact"><option value="mp3" selected>MP3 (leve, ideal p/ WhatsApp)</option><option value="wav">WAV (qualidade máxima)</option></select></label><label>MP3 <select id="apsMp3Rate" class="compact"><option value="128">128 kbps</option><option value="192" selected>192 kbps</option><option value="320">320 kbps</option></select></label></div>');
 const pr=$('apsSaveProjects')?.parentElement;if(pr)pr.insertAdjacentHTML('beforeend','<button id="apsShareProject">📤 Compartilhar projeto (.aps)</button>');
 const name=()=>safe($('projectName')?.value);
 const render=async()=>{if(!B.all().length)throw Error('Adicione uma pista primeiro.');st('Renderizando sua mixagem…');return await B.renderMix();};
 const busy=async(btn,fn)=>{btn.disabled=true;const old=btn.textContent;btn.textContent='Preparando…';try{await fn();}catch(e){st(e.message||String(e),true);}finally{btn.disabled=false;btn.textContent=old;}};
 const makeAudio=async fmt=>{const buf=await render();if(fmt==='wav')return{blob:wav(buf),name:name()+'.wav'};const kb=+$('apsMp3Rate').value;const blob=await mp3(buf,{kbps:kb,onProgress:p=>st('Codificando MP3… '+Math.round(p*100)+'%')});return{blob,name:name()+'.mp3'};};
 const sizeTxt=b=>(b.size/1048576).toFixed(1).replace('.',',')+' MB';
 $('apsMp3').onclick=e=>busy(e.target,async()=>{if(!allowed('exportar.mp3'))throw Error('Recurso do plano Pro.');const r=await makeAudio('mp3');save(r.blob,r.name);st('MP3 pronto: '+r.name+' ('+sizeTxt(r.blob)+').');});
 const msg=(how,r)=>how==='shared'?'Enviado pelo menu de compartilhar ('+sizeTxt(r.blob)+').':how==='cancelled'?'Compartilhamento cancelado.':'Este navegador não compartilha arquivos direto; o arquivo foi baixado ('+sizeTxt(r.blob)+'). No WhatsApp, use 📎 > Documento/Áudio e escolha "'+r.name+'".';
 $('apsShareMix').onclick=e=>busy(e.target,async()=>{if(!allowed('compartilhar'))throw Error('Recurso do plano Pro.');const r=await makeAudio($('apsShareFmt').value);st('Abrindo compartilhamento…');st(msg(await share(r.blob,r.name,'Música feita no APS Audio Engine'),r));});
 if($('apsShareProject'))$('apsShareProject').onclick=e=>busy(e.target,async()=>{if(!allowed('compartilhar'))throw Error('Recurso do plano Pro.');if(!B.all().length)throw Error('Adicione uma pista primeiro.');const blob=await root.APSProject.build(),r={blob:new Blob([blob],{type:'application/octet-stream'}),name:name()+'.aps'};st(msg(await share(r.blob,r.name,'Projeto APS: abra em Meus Projetos > Importar'),r));});
}
root.APSShare={mp3,wav,share,canShareFile,loadLame};
if(document.readyState==='complete')ui();else root.addEventListener('load',ui);
})(window);
