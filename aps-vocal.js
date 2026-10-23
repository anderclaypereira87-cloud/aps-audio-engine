/* APS 2.4.0 — Afinação de voz no aparelho (estilo auto-tune).
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
function ui(){const host=document.getElementById('apsVocalTune'),B=root.APSMixBridge;if(!host||!B)return;const $=id=>document.getElementById(id);
 host.innerHTML=`<div class="aps-vt"><h3>🎤 Afinação de voz (no aparelho)</h3><p class="aps-vt-sub">Estilo auto-tune: escolha o tom e a escala, a velocidade da correção e ouça. A gravação original fica guardada para desfazer.</p>
 <div class="aps-vt-grid"><label>Tom<select id="apsVtKey">${NOTE.map((n,i)=>`<option value="${i}">${n}</option>`).join('')}</select></label><label>Escala<select id="apsVtScale">${Object.entries(SCALE_NAMES).map(([k,v])=>`<option value="${k}">${v}</option>`).join('')}</select></label>
 <label>Velocidade <span id="apsVtSpeedV">40 ms</span><input id="apsVtSpeed" type="range" min="0" max="400" step="5" value="40"></label><label>Intensidade <span id="apsVtAmtV">100%</span><input id="apsVtAmt" type="range" min="0" max="100" value="100"></label></div>
 <p class="aps-vt-hint">Velocidade 0 = efeito robótico (T-Pain). 20–60 ms = natural pop/sertanejo. 100+ ms = correção suave.</p>
 <div class="aps-vt-acts"><button id="apsVtAnalyze" type="button">🔍 Analisar voz</button><button id="apsVtKeyGuess" type="button" disabled>🎯 Descobrir o tom</button><button id="apsVtApply" type="button" class="gold" disabled>✨ Afinar pista</button><button id="apsVtUndo" type="button" disabled>↩ Voltar original</button></div>
 <p id="apsVtStatus" class="aps-vt-status" role="status">Selecione a pista de voz (uma voz por vez) e toque em 🔍 Analisar voz.</p>
 <canvas id="apsVtCanvas" width="680" height="200" hidden aria-label="Notas da voz"></canvas>
 <div id="apsVtNoteBar" class="aps-vt-acts" hidden><span id="apsVtNoteInfo">Toque numa nota no gráfico para editar.</span><button id="apsVtUp" type="button">▲ +1</button><button id="apsVtDown" type="button">▼ −1</button><button id="apsVtOff" type="button">⊘ Não corrigir</button></div></div>`;
 let trk=null,segs=null,trackId=null,sel=-1;const originals=root.__apsVtOriginals||(root.__apsVtOriginals=new Map());
 const say=(t,k)=>{const e=$('apsVtStatus');e.textContent=t;e.dataset.kind=k||'';};
 const opts=()=>({key:Number($('apsVtKey').value),scale:$('apsVtScale').value,speed:Number($('apsVtSpeed').value),amount:Number($('apsVtAmt').value),segs});
 $('apsVtSpeed').oninput=()=>{$('apsVtSpeedV').textContent=$('apsVtSpeed').value+' ms';draw();};$('apsVtAmt').oninput=()=>{$('apsVtAmtV').textContent=$('apsVtAmt').value+'%';draw();};
 $('apsVtKey').onchange=$('apsVtScale').onchange=()=>{if(trk){segs=notes(trk,Number($('apsVtKey').value),$('apsVtScale').value);sel=-1;draw();}};
 function cur(){const t=B.current?.();if(!t)throw Error('Selecione uma pista de voz no estúdio.');return t;}
 function draw(){if(!trk)return;const c=$('apsVtCanvas');c.hidden=false;$('apsVtNoteBar').hidden=false;const g=c.getContext('2d'),W=c.width,H=c.height,{tgt}=ratios(trk,opts());
  const ms=[...trk.f0].filter(f=>f).map(midiOf);if(!ms.length)return;const lo=Math.floor(Math.min(...ms))-2,hi=Math.ceil(Math.max(...ms))+2,yOf=m=>H-14-(m-lo)/(hi-lo)*(H-24),xOf=i=>i/trk.f0.length*W;
  g.fillStyle='#0f141d';g.fillRect(0,0,W,H);const key=Number($('apsVtKey').value),sc=SCALES[$('apsVtScale').value];
  for(let m=lo;m<=hi;m++){const inS=sc.includes(((m-key)%12+12)%12);g.fillStyle=inS?'rgba(229,189,114,.10)':'rgba(255,255,255,.02)';g.fillRect(0,yOf(m+.5),W,yOf(m-.5)-yOf(m+.5));if(inS&&m%1===0){g.fillStyle='#7d6a49';g.font='10px system-ui';g.fillText(NOTE[((m%12)+12)%12]+(Math.floor(m/12)-1),2,yOf(m)+3);}}
  (segs||[]).forEach((s,k)=>{g.fillStyle=s.off?'rgba(140,140,140,.35)':k===sel?'rgba(97,220,196,.55)':'rgba(229,189,114,.35)';const y=yOf(s.note+s.shift);g.fillRect(xOf(s.start),y-4,Math.max(2,xOf(s.end)-xOf(s.start)),8);});
  g.lineWidth=1.5;g.strokeStyle='#8fb4ff';g.beginPath();let on=false;for(let i=0;i<trk.f0.length;i++){if(!trk.f0[i]){on=false;continue;}const p=[xOf(i),yOf(midiOf(trk.f0[i]))];on?g.lineTo(...p):g.moveTo(...p);on=true;}g.stroke();
  g.strokeStyle='#e5bd72';g.beginPath();on=false;for(let i=0;i<tgt.length;i++){if(!tgt[i]){on=false;continue;}const p=[xOf(i),yOf(tgt[i])];on?g.lineTo(...p):g.moveTo(...p);on=true;}g.stroke();
  g.fillStyle='#8fb4ff';g.fillText('— voz original',W-200,12);g.fillStyle='#e5bd72';g.fillText('— depois da afinação',W-110,12);}
 $('apsVtCanvas').addEventListener('click',e=>{if(!segs)return;const c=e.target,r=c.getBoundingClientRect(),i=(e.clientX-r.left)/r.width*trk.f0.length;sel=segs.findIndex(s=>i>=s.start-2&&i<=s.end+2);info();draw();});
 function info(){const s=segs?.[sel];$('apsVtNoteInfo').textContent=s?'Nota selecionada: '+NOTE[(((s.note+s.shift)%12)+12)%12]+(s.shift?' ('+(s.shift>0?'+':'')+s.shift+' semitom)':'')+(s.off?' · sem correção':''):'Toque numa nota no gráfico para editar.';}
 const edit=fn=>()=>{const s=segs?.[sel];if(!s)return say('Toque numa nota no gráfico primeiro.');fn(s);info();draw();};
 $('apsVtUp').onclick=edit(s=>{s.shift++;s.off=false;});$('apsVtDown').onclick=edit(s=>{s.shift--;s.off=false;});$('apsVtOff').onclick=edit(s=>{s.off=!s.off;});
 const guard=fn=>async()=>{try{await fn();}catch(e){say(e.message,'error');}};
 $('apsVtAnalyze').onclick=guard(async()=>{const t=cur();const buf=originals.get(t.id)||t.buf;if(buf.duration>600)throw Error('Máximo 10 minutos.');say('Ouvindo a voz de '+t.name+'…');const mono=buf.getChannelData(0);trk=await track(mono,buf.sampleRate,{onProgress:p=>say('Ouvindo a voz… '+Math.round(p*100)+'%')});trackId=t.id;
  const voiced=trk.f0.filter(f=>f).length;if(voiced<10)throw Error('Não encontrei uma voz afinável. Use uma pista só de voz (ou instrumento solo).');const k=guessKey(trk);$('apsVtKey').value=k.key;$('apsVtScale').value=k.scale;segs=notes(trk,k.key,k.scale);sel=-1;draw();
  $('apsVtApply').disabled=false;$('apsVtKeyGuess').disabled=false;say('Voz analisada: '+segs.length+' notas. Tom provável: '+NOTE[k.key]+' '+SCALE_NAMES[k.scale]+'. Ajuste e toque em ✨ Afinar pista.','ok');});
 $('apsVtKeyGuess').onclick=()=>{if(!trk)return;const k=guessKey(trk);$('apsVtKey').value=k.key;$('apsVtScale').value=k.scale;segs=notes(trk,k.key,k.scale);draw();say('Tom provável: '+NOTE[k.key]+' '+SCALE_NAMES[k.scale]+'.','ok');};
 $('apsVtApply').onclick=guard(async()=>{const t=cur();if(t.id!==trackId||!trk)throw Error('Analise esta pista primeiro.');const src=originals.get(t.id)||t.buf;$('apsVtApply').disabled=true;try{const ctx=new (root.OfflineAudioContext||root.webkitOfflineAudioContext)(1,1,src.sampleRate);const r=await APSVocal.tune(src,ctx,{...opts(),trk},p=>say('Afinando… '+Math.round(p*100)+'%'));if(!originals.has(t.id))originals.set(t.id,src);B.setBuffer(t.id,r.buffer);$('apsVtUndo').disabled=false;say('✨ Voz afinada em '+NOTE[opts().key]+' '+SCALE_NAMES[opts().scale]+' (velocidade '+opts().speed+' ms). Toque ▶ para ouvir; ↩ volta o original.','ok');}finally{$('apsVtApply').disabled=false;}});
 $('apsVtUndo').onclick=guard(async()=>{const t=cur();const o=originals.get(t.id);if(!o)throw Error('Esta pista ainda não foi afinada.');B.setBuffer(t.id,o);originals.delete(t.id);$('apsVtUndo').disabled=true;say('Gravação original de volta.','ok');});
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',ui);else ui();
})(typeof window!=='undefined'?window:globalThis);
