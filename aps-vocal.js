/* APS 2.5.0 — Afinação de voz no aparelho. API YIN/PSOLA mantida para Partituras e MIDI;
 * a tela do estúdio usa o Motor Elástico (aps-elastic-*.js): arraste de nota, vibrato e formantes preservados.
 * Detecção de altura YIN + correção por PSOLA (preserva o tempo). Tonalidade/escala, velocidade de correção,
 * intensidade e edição simples por nota. Nada é enviado para a internet. */
(function(root){'use strict';
const NOTE=['Dó','Dó#','Ré','Ré#','Mi','Fá','Fá#','Sol','Sol#','Lá','Lá#','Si'];
const SCALES={maior:[0,2,4,5,7,9,11],menor:[0,2,3,5,7,8,10],cromatica:[0,1,2,3,4,5,6,7,8,9,10,11],pent_maior:[0,2,4,7,9],pent_menor:[0,3,5,7,10],blues:[0,3,5,6,7,10],harm_menor:[0,2,3,5,7,8,11]};
const SCALE_NAMES={maior:'Maior',menor:'Menor',harm_menor:'Menor harmônica',pent_maior:'Pentatônica maior',pent_menor:'Pentatônica menor',blues:'Blues',cromatica:'Cromática (todas as notas)'};
const idle=()=>new Promise(r=>setTimeout(r,0));
const midiOf=f=>69+12*Math.log2(f/440),freqOf=m=>440*Math.pow(2,(m-69)/12);
// ---- detecção de altura (YIN em 11025 Hz) ----
async function track(x,sr,{fmin=70,fmax=1000,onProgress}={}){
 const dec=Math.max(1,Math.round(sr/11025)),r=sr/dec,n=Math.floor(x.length/dec),y=new Float32Array(n);
 for(let i=0;i<n;i++){let s=0;for(let k=0;k<dec;k++)s+=x[i*dec+k];y[i]=s/dec;}
 const W=512,tmin=Math.floor(r/fmax),tmax=Math.min(W-1,Math.ceil(r/fmin)),hop=128,frames=Math.max(0,Math.floor((n-W-tmax)/hop)),f0=new Float32Array(frames),conf=new Float32Array(frames),rms=new Float32Array(frames),d=new Float32Array(tmax+1);
 for(let fi=0;fi<frames;fi++){const s=fi*hop;let e=0;for(let i=0;i<W;i++)e+=y[s+i]*y[s+i];rms[fi]=Math.sqrt(e/W);
  if(rms[fi]<.004){f0[fi]=0;continue;}
  for(let t=1;t<=tmax;t++){let a=0;for(let i=0;i<W;i++){const v=y[s+i]-y[s+i+t];a+=v*v;}d[t]=a;}
  let run=0,best=-1;for(let t=1;t<=tmax;t++){run+=d[t];d[t]=d[t]*t/(run||1);}
  for(let t=tmin;t<=tmax;t++){if(d[t]<.15){while(t+1<=tmax&&d[t+1]<d[t])t++;best=t;break;}}
  if(best<0){f0[fi]=0;continue;}
  const a=d[best-1]??d[best],b=d[best],c=d[best+1]??d[best],den=a-2*b+c,tau=best+(den?(a-c)/(2*den):0);
  f0[fi]=r/tau;conf[fi]=1-b;if(fi%200===0){onProgress?.(fi/frames);await idle();}}
 // limpa saltos isolados (mediana de 5)
 const out=new Float32Array(frames);for(let i=0;i<frames;i++){const w=[];for(let k=-2;k<=2;k++){const v=f0[i+k];if(v>0)w.push(v);}out[i]=f0[i]>0&&w.length>=3?w.sort((p,q)=>p-q)[Math.floor(w.length/2)]:0;}
 return{f0:out,conf,rms,hopSec:hop*dec/sr,offset:W*dec/2};}
function snap(m,key,scale){const sc=SCALES[scale]||SCALES.cromatica;let best=Math.round(m),bd=1e9;for(let o=Math.floor(m)-2;o<=Math.ceil(m)+2;o++){if(!sc.includes(((o-key)%12+12)%12))continue;const dd=Math.abs(o-m);if(dd<bd){bd=dd;best=o;}}return best;}
// segmentos de notas (para a visão manual)
function notes(trk,key,scale){const segs=[];let cur=null;for(let i=0;i<trk.f0.length;i++){const f=trk.f0[i];if(!f){if(cur){segs.push(cur);cur=null;}continue;}const t=snap(midiOf(f),key,scale);if(cur&&cur.note===t)cur.end=i;else{if(cur)segs.push(cur);cur={start:i,end:i,note:t,shift:0,off:false};}}if(cur)segs.push(cur);return segs.filter(s=>s.end-s.start>=3);}
// curva de razão de correção por frame
function ratios(trk,{key=0,scale='maior',speed=50,amount=100,segs=null}={}){const n=trk.f0.length,ratio=new Float32Array(n).fill(1),tgt=new Float32Array(n);
 const segAt=new Int32Array(n).fill(-1);if(segs)segs.forEach((s,k)=>{for(let i=s.start;i<=s.end;i++)segAt[i]=k;});
 const tau=Math.max(.001,speed/1000),a=Math.exp(-trk.hopSec/tau);let sm=null;
 for(let i=0;i<n;i++){const f=trk.f0[i];if(!f){sm=null;continue;}const m=midiOf(f);let target=snap(m,key,scale);const s=segAt[i]>=0?segs[segAt[i]]:null;if(s){if(s.off){sm=null;continue;}target=s.note+s.shift;}
  const want=target-m;sm=sm===null?want:want+(sm-want)*a;const corr=sm*amount/100;ratio[i]=Math.pow(2,corr/12);tgt[i]=m+corr;}
 return{ratio,tgt};}
// ---- PSOLA ----
async function psola(x,sr,trk,ratio,onProgress){const N=x.length,y=new Float32Array(N),wsum=new Float32Array(N);
 const fAt=t=>{const i=Math.floor((t-trk.offset)/(trk.hopSec*sr));return i>=0&&i<trk.f0.length?i:-1;};
 // marcas de análise
 const marks=[];let t=0;while(t<N){const i=fAt(t),f=i>=0?trk.f0[i]:0;const P=f?sr/f:Math.round(sr*.005);
  if(f){const lo=Math.max(0,Math.floor(t-P/4)),hi=Math.min(N-1,Math.floor(t+P/4));let bi=lo,bv=-1;for(let k=lo;k<=hi;k++){const v=Math.abs(x[k]);if(v>bv){bv=v;bi=k;}}t=Math.max(t,bi);}
  marks.push({t,P,v:!!f,i});t+=P;}
 let ts=marks[0]?.t||0,mi=0,step=0;
 while(ts<N){while(mi+1<marks.length&&Math.abs(marks[mi+1].t-ts)<=Math.abs(marks[mi].t-ts))mi++;const m=marks[mi],r=m.v&&m.i>=0?ratio[m.i]:1,P=Math.round(m.P),L=2*P;
  for(let k=-P;k<P;k++){const src=Math.round(m.t)+k,dst=Math.round(ts)+k;if(src<0||src>=N||dst<0||dst>=N)continue;const w=.5-.5*Math.cos(Math.PI*(k+P)/P);y[dst]+=x[src]*w;wsum[dst]+=w;}
  ts+=m.P/r;if(++step%2000===0){onProgress?.(ts/N);await idle();}}
 for(let i=0;i<N;i++)if(wsum[i]>1e-3)y[i]/=wsum[i];else y[i]=x[i];return y;}
async function tune(buffer,ctx,opts,onProgress){const sr=buffer.sampleRate,mono=new Float32Array(buffer.length);for(let c=0;c<buffer.numberOfChannels;c++){const d=buffer.getChannelData(c);for(let i=0;i<d.length;i++)mono[i]+=d[i]/buffer.numberOfChannels;}
 const trk=opts.trk||await track(mono,sr,{onProgress:p=>onProgress?.(p*.4)});const {ratio,tgt}=ratios(trk,opts);
 const out=ctx.createBuffer(buffer.numberOfChannels,buffer.length,sr);for(let c=0;c<buffer.numberOfChannels;c++){const y=await psola(buffer.getChannelData(c),sr,trk,ratio,p=>onProgress?.(.4+.6*(c+p)/buffer.numberOfChannels));out.copyToChannel(y,c);}
 return{buffer:out,trk,tgt};}
function guessKey(trk){const h=new Float64Array(12);let first=-1,last=-1;for(let i=0;i<trk.f0.length;i++)if(trk.f0[i]){const pc=((Math.round(midiOf(trk.f0[i]))%12)+12)%12;h[pc]+=trk.rms[i];if(first<0)first=pc;last=pc;}trk._first=first;trk._last=last;trk._w=h.reduce((a,b)=>a+b,0)*.08;let best=[0,'maior',-1];for(let k=0;k<12;k++)for(const s of ['maior','menor']){const sc=SCALES[s];let v=0;for(let p=0;p<12;p++)v+=sc.includes(((p-k)%12+12)%12)?h[p]:-.5*h[p];v+=h[k]*.5+(k===trk._first?trk._w:0)+(k===trk._last?trk._w:0);if(v>best[2])best=[k,s,v];}return{key:best[0],scale:best[1]};}
const API={track,snap,notes,ratios,psola,tune,guessKey,midiOf,freqOf,NOTE,SCALES,SCALE_NAMES};root.APSVocal=API;
// ================= Interface no estúdio =================
if(typeof document==='undefined')return;
// ================= Interface no estúdio: APS Afinação Natural (Motor Elástico) =================
// A API acima (track, psola, tune…) continua igual para Partituras/MIDI. A tela do estúdio agora usa
// o editor de notas com arraste (aps-elastic-tune-ui.js), que preserva vibrato e formantes.
function loadOnce(src){return new Promise((res,rej)=>{if(document.querySelector('script[data-aps-src="'+src+'"]')){const t=setInterval(()=>{if(root.APSElasticTuneUI&&root.APSElastic&&root.APSElasticCore){clearInterval(t);res();}},30);setTimeout(()=>{clearInterval(t);res();},8000);return;}const s=document.createElement('script');s.src='./'+src;s.dataset.apsSrc=src;s.onload=res;s.onerror=()=>rej(Error('Falha ao carregar '+src));document.head.appendChild(s);});}
async function ui(){const host=document.getElementById('apsVocalTune'),B=root.APSMixBridge;if(!host||!B)return;
 if(!root.APSElasticCore)await loadOnce('aps-elastic-core.js?v=2');if(!root.APSElastic)await loadOnce('aps-elastic.js?v=2');if(!root.APSElasticTuneUI)await loadOnce('aps-elastic-tune-ui.js?v=1');
 const originals=root.__apsVtOriginals||(root.__apsVtOriginals=new Map());
 root.APSElasticTuneUI.mount(host,{idPrefix:'apsVt',
  getSource:()=>{const t=B.current&&B.current();return t?{id:t.id,buffer:t.buf}:null;},
  originalOf:id=>originals.get(id)||null,
  apply:(buf,info)=>{if(!originals.has(info.id))originals.set(info.id,info.original);B.setBuffer(info.id,buf);},
  restore:(buf,info)=>{B.setBuffer(info.id,buf);if(info.undo)originals.delete(info.id);}
 });}
function start(){ui().catch(e=>{const h=document.getElementById('apsVocalTune');if(h)h.textContent='Afinação indisponível: '+(e&&e.message||e);});}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
})(typeof window!=='undefined'?window:globalThis);
