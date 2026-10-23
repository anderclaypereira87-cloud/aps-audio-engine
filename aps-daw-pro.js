/* APS 3.2.0 — Estúdio Pro: DAW em tela cheia (estilo Logic/Cubase) sobre o motor do APS.
 * Cada região é uma "pista do motor" (mesmo áudio compartilhado, recorte/posição/fades próprios) agrupada em
 * faixas (lane). Edição não destrutiva: mover, dividir, aparar, fades, duplicar, copiar/colar, desfazer/refazer.
 * Exportação, mixagem IA, master e projetos usam exatamente as mesmas regiões. */
(function(root){'use strict';
const B=root.APSMixBridge,$=id=>document.getElementById(id);if(!B)return;
const PAL=['#d9af5b','#66c7b8','#e07a6a','#8fa8ff','#b58ee8','#7fd6a4','#f0a35e','#5fb7e0','#e58fb8','#c9d36a'];
const st={pps:60,sx:0,sy:0,lh:76,snap:'beat',tool:'pointer',multi:false,sel:new Set(),undo:[],redo:[],extra:[],armed:null,dock:'mixer',dockOpen:true,clip:null};
const isTouch=matchMedia('(pointer:coarse)').matches;
let cv,g,dpr=1,W=0,H=0,RH=26,HW=0,raf=0,dirtyDraw=true,headEl;
// ---------- lanes ----------
function regions(){return B.all();}
function ensureLanes(){const ts=regions();let maxOrd=Math.max(-1,...ts.map(t=>Number.isFinite(t.laneOrd)?t.laneOrd:-1),...st.extra.map(e=>e.ord));
 for(const t of ts){if(!t.lane){if(st.armed&&pendingArm(t)){const r0=ts.find(u=>u.lane===st.armed)||st.extra.find(e=>e.id===st.armed),L=r0?{ord:r0.laneOrd??r0.ord,color:r0.color,name:r0.laneName||r0.name}:null;t.lane=st.armed;t.laneOrd=L?L.ord:++maxOrd;t.color=L?.color;t.laneName=L?.name;}else{t.lane=t.id;t.laneOrd=++maxOrd;}}if(!Number.isFinite(t.laneOrd))t.laneOrd=++maxOrd;if(!t.color)t.color=PAL[t.laneOrd%PAL.length];}}
let knownIds=new Set();function pendingArm(t){return !knownIds.has(t.id)&&/tomada/i.test(t.name||'');}
function lanes(){ensureLanes();const m=new Map();for(const t of regions()){if(!m.has(t.lane))m.set(t.lane,{id:t.lane,ord:t.laneOrd,name:t.laneName||t.name,color:t.color,regs:[]});m.get(t.lane).regs.push(t);}
 for(const e of st.extra)if(!m.has(e.id))m.set(e.id,{...e,regs:[]});return [...m.values()].sort((a,b)=>a.ord-b.ord);}
function laneById(id){return lanes().find(l=>l.id===id);}
// ---------- tempo / grade ----------
const bpm=()=>B.bpm()||100,beats=()=>Math.max(1,Number($('apsTimeSig')?.value.split('/')[0])||4),beatSec=()=>60/bpm(),barSec=()=>beatSec()*beats();
function grid(){return{off:0,bar:barSec(),beat:beatSec(),'8':beatSec()/2,'16':beatSec()/4}[st.snap]||0;}
const snap=t=>{const q=grid();return q?Math.round(t/q)*q:t;};
const fmtPos=t=>{const b=Math.floor(t/barSec()),r=t-b*barSec(),bt=Math.floor(r/beatSec()),tk=Math.floor((r-bt*beatSec())/beatSec()*4);const m=Math.floor(t/60),s=(t%60).toFixed(1).padStart(4,'0');return (b+1)+'.'+(bt+1)+'.'+(tk+1)+'  ·  '+m+':'+s;};
// ---------- picos (cache) ----------
const PK=new WeakMap();
function peaks(buf){let p=PK.get(buf);if(p)return p;const n=buf.length,C=buf.numberOfChannels,ch=[...Array(C)].map((_,c)=>buf.getChannelData(c));const mk=bin=>{const m=Math.ceil(n/bin),mn=new Float32Array(m),mx=new Float32Array(m);for(let k=0;k<m;k++){let a=1,b=-1;const e=Math.min(n,(k+1)*bin);for(const x of ch)for(let i=k*bin;i<e;i++){const v=x[i];if(v<a)a=v;if(v>b)b=v;}mn[k]=a;mx[k]=b;}return{bin,mn,mx};};
 const l1=mk(128),l2={bin:4096,mn:new Float32Array(Math.ceil(n/4096)),mx:new Float32Array(Math.ceil(n/4096))};for(let k=0;k<l2.mn.length;k++){let a=1,b=-1;for(let j=k*32;j<Math.min(l1.mn.length,(k+1)*32);j++){if(l1.mn[j]<a)a=l1.mn[j];if(l1.mx[j]>b)b=l1.mx[j];}l2.mn[k]=a;l2.mx[k]=b;}
 p={l1,l2,ch};PK.set(buf,p);return p;}
function colRange(buf,s0,s1){const p=peaks(buf),span=s1-s0;let L=span>=4096*2?p.l2:span>=256?p.l1:null;let a=1,b=-1;
 if(!L){for(const x of p.ch)for(let i=Math.max(0,s0|0);i<Math.min(buf.length,Math.ceil(s1));i++){const v=x[i];if(v<a)a=v;if(v>b)b=v;}return[a,b];}
 for(let k=Math.floor(s0/L.bin);k<=Math.min(L.mn.length-1,Math.floor(s1/L.bin));k++){if(L.mn[k]<a)a=L.mn[k];if(L.mx[k]>b)b=L.mx[k];}return[a,b];}
// ---------- geometria ----------
const tx=t=>(t-st.sx)*st.pps,xt=x=>x/st.pps+st.sx;
function rectOf(t,li){const len=t.trimOut-t.trimIn;return{x:tx(t.start),y:RH+li*st.lh-st.sy+3,w:Math.max(2,len*st.pps),h:st.lh-6};}
function laneIndexMap(){const m=new Map();lanes().forEach((l,i)=>m.set(l.id,i));return m;}
function hit(x,y){const lm=laneIndexMap(),ts=regions();for(let i=ts.length-1;i>=0;i--){const t=ts[i],r=rectOf(t,lm.get(t.lane));if(x>=r.x&&x<=r.x+r.w&&y>=r.y&&y<=r.y+r.h){const E=isTouch?14:8,fi=r.x+(t.fadeIn||0)*st.pps,fo=r.x+r.w-(t.fadeOut||0)*st.pps;let zone='body';
  if(y<r.y+16&&Math.abs(x-fi)<E+2)zone='fadeIn';else if(y<r.y+16&&Math.abs(x-fo)<E+2)zone='fadeOut';else if(x-r.x<E&&r.w>E*3)zone='left';else if(r.x+r.w-x<E&&r.w>E*3)zone='right';return{t,zone,r};}}return null;}
// ---------- desenho ----------
function resize(){const box=cv.parentElement.getBoundingClientRect();dpr=Math.min(3,root.devicePixelRatio||1);W=Math.max(100,box.width);H=Math.max(60,box.height);cv.width=Math.round(W*dpr);cv.height=Math.round(H*dpr);cv.style.width=W+'px';cv.style.height=H+'px';dirtyDraw=true;}
function rr(x,y,w,h,r){g.beginPath();g.moveTo(x+r,y);g.arcTo(x+w,y,x+w,y+h,r);g.arcTo(x+w,y+h,x,y+h,r);g.arcTo(x,y+h,x,y,r);g.arcTo(x,y,x+w,y,r);g.closePath();}
function draw(){g.setTransform(dpr,0,0,dpr,0,0);g.fillStyle='#0c0e15';g.fillRect(0,0,W,H);const L=lanes();
 for(let i=0;i<L.length;i++){const y=RH+i*st.lh-st.sy;if(y>H||y+st.lh<RH)continue;g.fillStyle=i%2?'#10131c':'#0e111a';if(L[i].id===st.armed)g.fillStyle='#2a1416';g.fillRect(0,y,W,st.lh);g.fillStyle='#1b2030';g.fillRect(0,y+st.lh-1,W,1);}
 // grade
 const bs=barSec(),be=beatSec(),t0=st.sx,t1=xt(W);const showBeats=be*st.pps>14,show16=be/4*st.pps>10;
 for(let b=Math.floor(t0/bs);b*bs<=t1;b++){for(let k=0;k<beats()*(show16?4:1);k++){const t=b*bs+k*be/(show16?4:1),x=Math.round(tx(t))+.5;if(x<0||x>W)continue;const isBar=k===0,isBeat=show16?k%4===0:true;if(!isBar&&!(isBeat&&showBeats)&&!show16)continue;g.fillStyle=isBar?'#2b3246':isBeat?'#1d2333':'#161b28';g.fillRect(x,RH,1,H-RH);}}
 // regiões
 const lm=new Map();L.forEach((l,i)=>lm.set(l.id,i));
 for(const t of regions()){const li=lm.get(t.lane);if(li==null)continue;const r=rectOf(t,li);if(r.x>W||r.x+r.w<0||r.y>H||r.y+r.h<RH)continue;const sel=st.sel.has(t.id),c=t.color||'#d9af5b';
  g.save();rr(r.x,r.y,r.w,r.h,6);g.fillStyle=c+(t.mute?'22':'38');g.fill();g.clip();g.fillStyle=c+(sel?'cc':'88');g.fillRect(r.x,r.y,r.w,15);
  // forma de onda
  const sr=t.buf.sampleRate,mid=r.y+15+(r.h-15)/2,amp=(r.h-19)/2*Math.min(1.6,Math.max(.3,(t.gain||100)/100)),xa=Math.max(0,Math.floor(r.x)),xb=Math.min(W,Math.ceil(r.x+r.w));
  g.fillStyle=t.mute?'#ffffff40':'#f5ead0dd';g.beginPath();const pts=[];for(let x=xa;x<xb;x+=1/dpr*(dpr>1?1:1)){const ta=t.trimIn+(x-r.x)/st.pps,tb=ta+1/st.pps;const[mn,mx]=colRange(t.buf,ta*sr,tb*sr);pts.push([x,mn,mx]);}
  if(pts.length){g.moveTo(pts[0][0],mid-pts[0][2]*amp);for(const p of pts)g.lineTo(p[0],mid-p[2]*amp);for(let k=pts.length-1;k>=0;k--)g.lineTo(pts[k][0],mid-pts[k][1]*amp);g.closePath();g.fill();}
  // fades
  g.fillStyle='#00000070';const fi=(t.fadeIn||0)*st.pps,fo=(t.fadeOut||0)*st.pps;if(fi>1){g.beginPath();g.moveTo(r.x,r.y+15);g.lineTo(r.x+fi,r.y+15);g.lineTo(r.x,r.y+r.h);g.closePath();g.fill();}if(fo>1){g.beginPath();g.moveTo(r.x+r.w,r.y+15);g.lineTo(r.x+r.w-fo,r.y+15);g.lineTo(r.x+r.w,r.y+r.h);g.closePath();g.fill();}
  g.fillStyle='#111';g.font='600 11px system-ui';g.fillText(String(t.name||'').slice(0,60),r.x+6,r.y+11);g.restore();
  g.lineWidth=sel?2:1;g.strokeStyle=sel?'#ffd77a':c+'aa';rr(r.x+.5,r.y+.5,r.w-1,r.h-1,6);g.stroke();
  if(sel||r.w>40){g.fillStyle='#fff';for(const hx of[r.x+fi,r.x+r.w-fo]){g.fillRect(Math.min(r.x+r.w-6,Math.max(r.x,hx-3)),r.y+1,6,6);}}
  if(sel&&r.w>24){g.fillStyle='#ffd77a';g.fillRect(r.x,r.y+r.h/2-10,3,20);g.fillRect(r.x+r.w-3,r.y+r.h/2-10,3,20);}}
 // marquee
 if(drag?.kind==='marquee'){g.strokeStyle='#ffd77a';g.setLineDash([4,3]);g.strokeRect(Math.min(drag.x0,drag.x),Math.min(drag.y0,drag.y),Math.abs(drag.x-drag.x0),Math.abs(drag.y-drag.y0));g.setLineDash([]);}
 // régua
 g.fillStyle='#151925';g.fillRect(0,0,W,RH);g.fillStyle='#2b3246';g.fillRect(0,RH-1,W,1);g.font='11px system-ui';const step=Math.max(1,Math.ceil(44/(bs*st.pps)));
 for(let b=Math.floor(t0/bs);b*bs<=t1;b++){const x=tx(b*bs);if(b%step)continue;g.fillStyle='#d9af5b';g.fillRect(Math.round(x),RH-9,1,9);g.fillStyle='#cfc3a6';g.fillText(String(b+1),x+3,RH-11);}
 // agulha
 const px=tx(B.position());if(px>=-2&&px<=W+2){g.fillStyle='#ffd77a';g.fillRect(Math.round(px)-1,0,2,H);g.beginPath();g.moveTo(px-6,0);g.lineTo(px+6,0);g.lineTo(px,9);g.fill();}
 // barra de rolagem horizontal
 const tot=Math.max(B.total(),xt(W)-st.sx,1)+barSec()*4,vw=(W/st.pps)/tot;g.fillStyle='#ffffff10';g.fillRect(0,H-5,W,5);g.fillStyle='#d9af5b66';g.fillRect(st.sx/tot*W,H-5,Math.max(20,vw*W),5);}
function loop(){raf=requestAnimationFrame(loop);if(!document.body.classList.contains('aps-pro-on'))return;const playing=B.isPlaying();if(playing&&$('proFollow')?.checked){const px=tx(B.position());if(px>W*.85||px<0){st.sx=Math.max(0,B.position()-W*.1/st.pps);dirtyDraw=true;}}
 if(playing||dirtyDraw||drag){draw();dirtyDraw=false;}const pos=$('proPos');if(pos)pos.textContent=fmtPos(B.position());const pb=$('proPlay');if(pb)pb.textContent=playing?'❚❚':'▶';const rb=$('proRec');if(rb)rb.classList.toggle('on',B.isRecording());if(st.dock==='mixer'&&st.dockOpen)meters();}
// ---------- desfazer ----------
function snapshot(){return{tracks:B.snapshot(),extra:st.extra.map(e=>({...e}))};}
function pushUndo(s){st.undo.push(s||snapshot());if(st.undo.length>80)st.undo.shift();st.redo=[];ub();}
function undo(){if(!st.undo.length)return;st.redo.push(snapshot());const s=st.undo.pop();st.extra=s.extra;B.restore(s.tracks);pruneSel();ub();info('↩ Desfeito');}
function redo(){if(!st.redo.length)return;st.undo.push(snapshot());const s=st.redo.pop();st.extra=s.extra;B.restore(s.tracks);pruneSel();ub();info('↪ Refeito');}
function ub(){if($('proUndo'))$('proUndo').disabled=!st.undo.length;if($('proRedo'))$('proRedo').disabled=!st.redo.length;}
function pruneSel(){const ids=new Set(regions().map(t=>t.id));for(const i of[...st.sel])if(!ids.has(i))st.sel.delete(i);dirtyDraw=true;renderHeads();renderDock();}
function commit(){B.commit();dirtyDraw=true;renderHeads();renderDock();}
// ---------- edição ----------
const selected=()=>regions().filter(t=>st.sel.has(t.id));
function splitAt(t,T){const end=t.start+(t.trimOut-t.trimIn);if(T<=t.start+.01||T>=end-.01)return null;const local=T-t.start;const n=B.clone(t.id,{start:T,trimIn:t.trimIn+local,trimOut:t.trimOut,fadeIn:.005,fadeOut:t.fadeOut,lane:t.lane,laneOrd:t.laneOrd,color:t.color,laneName:t.laneName,name:t.name});t.trimOut=t.trimIn+local;t.fadeOut=.005;if(t.fadeIn>local)t.fadeIn=local/2;return n;}
function split(T){const p=B.position();T=T??p;let list=selected();if(!list.length)list=regions().filter(t=>T>t.start&&T<t.start+t.trimOut-t.trimIn);if(!list.length){info('Nada para dividir na posição do cursor.');return;}const s=snapshot();let k=0;for(const t of list){const n=splitAt(t,T);if(n){k++;st.sel.add(n.id);}}if(k){pushUndo(s);commit();info('✂ '+k+' região(ões) dividida(s) em '+fmtPos(T));}}
function del(){const list=selected();if(!list.length)return;pushUndo();for(const t of list)B.remove(t.id);st.sel.clear();commit();info('🗑 '+list.length+' região(ões) apagada(s)');}
function dup(){const list=selected();if(!list.length)return;pushUndo();const a=Math.min(...list.map(t=>t.start)),b=Math.max(...list.map(t=>t.start+t.trimOut-t.trimIn)),span=snap(b-a)||b-a;st.sel.clear();for(const t of list){const n=B.clone(t.id,{start:t.start+span,lane:t.lane,laneOrd:t.laneOrd,color:t.color,laneName:t.laneName});st.sel.add(n.id);}commit();info('⧉ Duplicado');}
function copy(){const list=selected();if(!list.length)return;const a=Math.min(...list.map(t=>t.start));st.clip=list.map(t=>({...B.settings(t),buf:t.buf,rel:t.start-a}));info('Copiado: '+list.length+' região(ões)');}
function paste(){if(!st.clip)return;pushUndo();const T=snap(B.position()),target=selected()[0]?.lane;st.sel.clear();for(const c of st.clip){const lane=target&&st.clip.length===1?target:c.lane,L=laneById(lane);const n=B.cloneFrom({...c,start:T+c.rel,lane,laneOrd:L?.ord??c.laneOrd,color:L?.color||c.color});st.sel.add(n.id);}commit();info('Colado em '+fmtPos(T));}
function newLane(){const L=lanes(),ord=Math.max(-1,...L.map(l=>l.ord))+1,id='lane-'+Date.now().toString(36)+Math.random().toString(36).slice(2,5);const e={id,ord,name:'Pista '+(L.length+1),color:PAL[ord%PAL.length]};st.extra.push(e);return e;}
// ---------- ponteiro ----------
let drag=null;const pts=new Map();
function local(e){const r=cv.getBoundingClientRect();return{x:e.clientX-r.left,y:e.clientY-r.top};}
function onDown(e){try{cv.setPointerCapture(e.pointerId);}catch{}const p=local(e);pts.set(e.pointerId,p);
 if(pts.size===2){const[a,b]=[...pts.values()];drag={kind:'pinch',d0:Math.hypot(a.x-b.x,a.y-b.y),pps0:st.pps,cx:(a.x+b.x)/2,t:xt((a.x+b.x)/2),pre:drag?.pre};if(drag.pre)drag.pre=null;return;}
 if(p.y<RH){drag={kind:'seek'};B.seek(Math.max(0,xt(p.x)));dirtyDraw=true;return;}
 const h=hit(p.x,p.y);const add=e.shiftKey||e.ctrlKey||e.metaKey||st.multi;
 if(h&&st.tool==='scissors'){const s=snapshot(),n=splitAt(h.t,snap(xt(p.x)));if(n){pushUndo(s);st.sel=new Set([n.id]);commit();info('✂ Dividido');}return;}
 if(h){const prevSel=new Set(st.sel);if(add){st.sel.has(h.t.id)?st.sel.delete(h.t.id):st.sel.add(h.t.id);}else if(!st.sel.has(h.t.id))st.sel=new Set([h.t.id]);B.focus(h.t.id);
  const list=h.zone==='body'?selected():[h.t];drag={kind:h.zone,x0:p.x,y0:p.y,moved:false,pre:snapshot(),orig:list.map(t=>({t,start:t.start,trimIn:t.trimIn,trimOut:t.trimOut,fadeIn:t.fadeIn||0,fadeOut:t.fadeOut||0,lane:t.lane})),prim:h.t,add,li:laneIndexMap().get(h.t.lane)};
  if(e.pointerType==='touch'){drag.lp=setTimeout(()=>{if(drag&&!drag.moved){st.sel=prevSel;st.sel.has(h.t.id)&&st.sel.size>1?st.sel.delete(h.t.id):st.sel.add(h.t.id);navigator.vibrate?.(20);info('Seleção múltipla: '+st.sel.size);drag=null;dirtyDraw=true;renderDock();}},480);}
  dirtyDraw=true;renderDock();return;}
 if(!add&&e.pointerType!=='touch'){st.sel.clear();renderDock();}
 drag=e.pointerType==='touch'?{kind:'pan',x0:p.x,y0:p.y,sx:st.sx,sy:st.sy,moved:false}:{kind:'marquee',x0:p.x,y0:p.y,x:p.x,y:p.y,base:add?new Set(st.sel):new Set()};dirtyDraw=true;}
function onMove(e){if(!pts.has(e.pointerId)){hover(e);return;}const p=local(e);pts.set(e.pointerId,p);if(!drag)return;
 if(drag.kind==='pinch'&&pts.size===2){const[a,b]=[...pts.values()],d=Math.hypot(a.x-b.x,a.y-b.y);setZoom(drag.pps0*d/Math.max(10,drag.d0),drag.cx,drag.t);return;}
 if(drag.kind==='seek'){B.seek(Math.max(0,xt(p.x)));dirtyDraw=true;return;}
 if(drag.kind==='pan'){st.sx=Math.max(0,drag.sx-(p.x-drag.x0)/st.pps);st.sy=clampY(drag.sy-(p.y-drag.y0));if(Math.abs(p.x-drag.x0)+Math.abs(p.y-drag.y0)>6)drag.moved=true;dirtyDraw=true;syncHeads();return;}
 if(drag.kind==='marquee'){drag.x=p.x;drag.y=p.y;const x0=Math.min(drag.x0,p.x),x1=Math.max(drag.x0,p.x),y0=Math.min(drag.y0,p.y),y1=Math.max(drag.y0,p.y),lm=laneIndexMap();st.sel=new Set(drag.base);for(const t of regions()){const r=rectOf(t,lm.get(t.lane));if(r.x<x1&&r.x+r.w>x0&&r.y<y1&&r.y+r.h>y0)st.sel.add(t.id);}dirtyDraw=true;return;}
 const dx=p.x-drag.x0,dy=p.y-drag.y0;if(!drag.moved&&Math.abs(dx)<4&&Math.abs(dy)<4)return;if(!drag.moved){drag.moved=true;clearTimeout(drag.lp);}const d=dx/st.pps;
 if(drag.kind==='body'){const P=drag.orig.find(o=>o.t===drag.prim)||drag.orig[0];let ns=e.altKey?P.start+d:snap(P.start+d);const delta=Math.max(-Math.min(...drag.orig.map(o=>o.start)),ns-P.start);const L=lanes(),dl=Math.round(dy/st.lh);
  for(const o of drag.orig){o.t.start=Math.max(0,o.start+delta);const li0=L.findIndex(l=>l.id===o.lane);let li=Math.max(0,li0+dl);if(li>=L.length){const e2=newLane();li=L.length;L.push({...e2,regs:[]});}const tl=L[li];o.t.lane=tl.id;o.t.laneOrd=tl.ord;o.t.color=tl.color;if(tl.name&&!tl.regs.length)o.t.laneName=tl.name;}}
 else if(drag.kind==='left'){for(const o of drag.orig){const dur=o.t.buf.duration;let nin=o.trimIn+d;const ns=snap(o.start+(nin-o.trimIn));nin=o.trimIn+(ns-o.start);nin=Math.max(0,Math.min(o.trimOut-.02,nin));if(o.start+(nin-o.trimIn)<0)nin=o.trimIn-o.start;o.t.trimIn=nin;o.t.start=o.start+(nin-o.trimIn);o.t.fadeIn=Math.min(o.fadeIn,o.t.trimOut-o.t.trimIn);void dur;}}
 else if(drag.kind==='right'){for(const o of drag.orig){const endT=snap(o.start+(o.trimOut-o.trimIn)+d);let nout=o.trimIn+(endT-o.start);nout=Math.max(o.trimIn+.02,Math.min(o.t.buf.duration,nout));o.t.trimOut=nout;o.t.fadeOut=Math.min(o.fadeOut,nout-o.trimIn);}}
 else if(drag.kind==='fadeIn'){const o=drag.orig[0],len=o.trimOut-o.trimIn;o.t.fadeIn=Math.max(0,Math.min(Math.min(10,len-(o.t.fadeOut||0)),o.fadeIn+d));}
 else if(drag.kind==='fadeOut'){const o=drag.orig[0],len=o.trimOut-o.trimIn;o.t.fadeOut=Math.max(0,Math.min(Math.min(10,len-(o.t.fadeIn||0)),o.fadeOut-d));}
 dirtyDraw=true;}
function onUp(e){pts.delete(e.pointerId);if(!drag)return;clearTimeout(drag.lp);
 if(drag.kind==='pinch'){if(pts.size===0)drag=null;return;}
 if(drag.kind==='pan'&&!drag.moved){st.sel.clear();renderDock();}
 if(drag.kind==='body'&&!drag.moved&&!drag.add&&drag.prim){st.sel=new Set([drag.prim.id]);}
 if(drag.pre&&drag.moved){pushUndo(drag.pre);const L=lanes();st.extra=st.extra.filter(x=>!L.find(l=>l.id===x.id&&l.regs.length));commit();info(({body:'Região movida',left:'Início aparado',right:'Fim aparado',fadeIn:'Fade de entrada',fadeOut:'Fade de saída'})[drag.kind]+' · '+fmtPos(drag.orig[0].t.start));}
 drag=null;dirtyDraw=true;renderHeads();renderDock();}
function hover(e){if(isTouch)return;const p=local(e),h=p.y>RH&&hit(p.x,p.y);cv.style.cursor=st.tool==='scissors'&&h?'crosshair':!h?(p.y<RH?'col-resize':'default'):h.zone==='left'||h.zone==='right'?'ew-resize':h.zone.startsWith('fade')?'nwse-resize':'grab';}
const clampY=y=>Math.max(0,Math.min(y,Math.max(0,RH+lanes().length*st.lh+st.lh-H)));
function setZoom(p,cx=W/2,t=xt(W/2)){st.pps=Math.max(4,Math.min(1200,p));st.sx=Math.max(0,t-cx/st.pps);dirtyDraw=true;const z=$('proZoomV');if(z)z.textContent=Math.round(st.pps)+' px/s';}
function fit(){const tot=Math.max(B.total(),barSec()*4);setZoom((W-20)/tot,0,0);st.sx=0;}
function onWheel(e){e.preventDefault();if(e.ctrlKey||e.metaKey){const p=local(e);setZoom(st.pps*Math.exp(-e.deltaY*.0025),p.x,xt(p.x));return;}const dx=e.shiftKey?e.deltaY:e.deltaX,dy=e.shiftKey?0:e.deltaY;st.sx=Math.max(0,st.sx+dx/st.pps);st.sy=clampY(st.sy+dy);dirtyDraw=true;syncHeads();}
// ---------- cabeçalhos ----------
function setLane(L,k,v){const s=snapshot();for(const t of L.regs)t[k]=v;pushUndo(s);commit();}
function renderHeads(){if(!headEl)return;const L=lanes();headEl.innerHTML='<div class="pro-hcorner"><button type="button" id="proAddLane" title="Nova pista vazia">＋ Pista</button></div><div class="pro-hlist" id="proHList">'+L.map((l,i)=>{const r0=l.regs[0]||{};const sel=l.regs.some(t=>st.sel.has(t.id));return '<div class="pro-head'+(sel?' sel':'')+(st.armed===l.id?' armed':'')+'" data-lane="'+l.id+'" style="height:'+st.lh+'px;--c:'+l.color+'"><div class="pro-hrow"><i></i><input class="pro-hname" value="'+esc(l.name||'Pista')+'" aria-label="Nome da pista"></div><div class="pro-hrow"><button type="button" data-k="mute" class="'+(r0.mute?'on m':'')+'" title="Mudo">M</button><button type="button" data-k="solo" class="'+(r0.solo?'on s':'')+'" title="Solo">S</button><button type="button" data-k="arm" class="'+(st.armed===l.id?'on r':'')+'" title="Armar gravação nesta pista">●</button><input type="range" data-k="gain" min="0" max="150" value="'+(r0.gain??100)+'" title="Volume" aria-label="Volume da pista"></div>'+(st.lh>=70?'<div class="pro-hrow"><small>Pan</small><input type="range" data-k="pan" min="-100" max="100" value="'+(r0.pan??0)+'" aria-label="Pan"></div>':'')+'</div>';}).join('')+'</div>';syncHeads();}
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
function syncHeads(){const l=$('proHList');if(l)l.style.transform='translateY('+(-st.sy)+'px)';}
// ---------- dock ----------
const MOVED=[];function adopt(el,host){if(!el||!host)return;if(!el.__apsPh){el.__apsPh=document.createComment('aps-ph');el.parentNode.insertBefore(el.__apsPh,el);MOVED.push(el);}el.classList.add('aps-visible');el.hidden=false;host.appendChild(el);}
function giveBack(){for(const el of MOVED){el.__apsPh.parentNode.insertBefore(el,el.__apsPh);}}
const side=i=>document.querySelectorAll('.layout > aside > section.panel')[i],mainP=i=>document.querySelectorAll('.layout > main > section.panel')[i];
const PANELS={editor:()=>[side(0)],ia:()=>[$('apsMixAI'),$('apsBandMixer')],master:()=>[$('apsMasterPanel')],gravar:()=>[side(1)],loops:()=>[$('apsLoopsPanel')],trocar:()=>[$('apsSwapPanel')],projeto:()=>[mainP(2),mainP(3)]};
let panelRefs=null;
function renderDock(){const body=$('proDockBody');if(!body)return;document.querySelectorAll('.pro-tabs button').forEach(b=>b.classList.toggle('on',b.dataset.tab===st.dock));$('proDock').classList.toggle('closed',!st.dockOpen);
 for(const k of Object.keys(PANELS)){const h=$('proPanel-'+k);if(h)h.hidden=k!==st.dock;}
 $('proMixer').hidden=st.dock!=='mixer';$('proInspector').hidden=st.dock!=='editor';
 if(st.dock==='mixer')renderMixer();if(st.dock==='editor')renderInspector();}
function renderMixer(){const L=lanes(),m=$('proMixerStrips');if(!m)return;const sig=L.map(l=>l.id+(l.regs[0]?.gain)+(l.regs[0]?.pan)+(l.regs[0]?.mute)+(l.regs[0]?.solo)+l.name).join('|')+$('masterGain')?.value;if(m.dataset.sig===sig)return;m.dataset.sig=sig;
 m.innerHTML=L.map(l=>{const r=l.regs[0]||{},fx=[r.comp?'Comp':'',(r.bass||r.mid||r.treble)?'EQ':'',r.hpf>40?'HPF':'',r.drive?'Drive':'',r.reverb?'Reverb':'',r.delay?'Delay':'',r.ai?'IA':''].filter(Boolean);return '<div class="pro-strip" data-lane="'+l.id+'" style="--c:'+l.color+'"><b title="'+esc(l.name)+'">'+esc(l.name||'Pista')+'</b><div class="pro-ins">'+(fx.length?fx.map(f=>'<span>'+f+'</span>').join(''):'<span class="e">sem inserts</span>')+'<button type="button" data-a="fx">FX…</button></div><input type="range" data-k="pan" min="-100" max="100" value="'+(r.pan??0)+'" class="pro-pan" aria-label="Pan"><div class="pro-fadwrap"><canvas class="pro-meter" width="10" height="120"></canvas><input type="range" data-k="gain" min="0" max="150" value="'+(r.gain??100)+'" class="pro-fader" aria-label="Volume"></div><small>'+(r.gain??100)+'%</small><div class="pro-ms"><button type="button" data-k="mute" class="'+(r.mute?'on m':'')+'">M</button><button type="button" data-k="solo" class="'+(r.solo?'on s':'')+'">S</button></div></div>';}).join('')+
 '<div class="pro-strip master"><b>MASTER</b><div class="pro-ins"><span>'+($('masterComp')?.checked?'Comp':'')+'</span><span>Limiter</span></div><div style="height:22px"></div><div class="pro-fadwrap"><canvas class="pro-meter" id="proMasterMeter" width="10" height="120"></canvas><input type="range" id="proMasterFader" min="0" max="125" value="'+($('masterGain')?.value||85)+'" class="pro-fader" aria-label="Volume master"></div><small>'+($('masterGain')?.value||85)+'%</small></div>';}
let tap=null,tapBuf=null;
function meters(){const ms=document.querySelectorAll('#proMixerStrips .pro-strip:not(.master)');if(!ms.length)return;const pos=B.isPlaying()?B.position():-1,L=lanes();
 ms.forEach(el=>{const l=L.find(x=>x.id===el.dataset.lane),c=el.querySelector('canvas');if(!l||!c)return;let pk=0;if(pos>=0)for(const t of l.regs){if(t.mute)continue;const lp=pos-t.start;if(lp<0||lp>t.trimOut-t.trimIn)continue;const s=(t.trimIn+lp)*t.buf.sampleRate;const[a,b]=colRange(t.buf,s,s+t.buf.sampleRate*.05);pk=Math.max(pk,Math.max(-a,b)*(t.gain||100)/100);}meterDraw(c,pk);});
 const mc=$('proMasterMeter');if(mc){let pk=0;if(B.isPlaying()){try{tap=tap||B.tapMaster();tapBuf=tapBuf||new Float32Array(tap.fftSize);tap.getFloatTimeDomainData(tapBuf);for(const v of tapBuf)pk=Math.max(pk,Math.abs(v));}catch{}}meterDraw(mc,pk);}}
function meterDraw(c,pk){const x=c.getContext('2d'),h=c.height,dbv=20*Math.log10(Math.max(pk,1e-5)),f=Math.max(0,Math.min(1,(dbv+48)/48));const prev=c.__p||0,v=Math.max(f,prev-.03);c.__p=v;x.fillStyle='#0a0c12';x.fillRect(0,0,10,h);const gr=x.createLinearGradient(0,h,0,0);gr.addColorStop(0,'#66c7b8');gr.addColorStop(.75,'#d9af5b');gr.addColorStop(1,'#ef7777');x.fillStyle=gr;x.fillRect(1,h-v*h,8,v*h);}
function renderInspector(){const el=$('proInspector');if(!el)return;const list=selected();if(!list.length){el.innerHTML='<p class="sub">Selecione uma região na linha do tempo para editar. Atalhos: S dividir · Del apagar · Ctrl+D duplicar · Ctrl+C/V · Ctrl+Z/Y.</p>';return;}
 const t=list[0],len=t.trimOut-t.trimIn;el.innerHTML='<div class="pro-insp"><b>'+(list.length>1?list.length+' regiões selecionadas · editando a 1ª':'Região')+'</b><label>Nome<input id="piName" value="'+esc(t.name)+'"></label><label>Início (s)<input id="piStart" type="number" step="0.01" min="0" value="'+t.start.toFixed(3)+'"></label><label>Entrada na fonte (s)<input id="piIn" type="number" step="0.01" min="0" value="'+t.trimIn.toFixed(3)+'"></label><label>Duração (s)<input id="piLen" type="number" step="0.01" min="0.02" value="'+len.toFixed(3)+'"></label><label>Fade in (s)<input id="piFi" type="number" step="0.01" min="0" value="'+(t.fadeIn||0).toFixed(3)+'"></label><label>Fade out (s)<input id="piFo" type="number" step="0.01" min="0" value="'+(t.fadeOut||0).toFixed(3)+'"></label><label>Ganho (%)<input id="piGain" type="number" min="0" max="150" value="'+(t.gain??100)+'"></label><div class="pro-insp-b"><button type="button" data-a="split">✂ Dividir no cursor</button><button type="button" data-a="dup">⧉ Duplicar</button><button type="button" data-a="copy">Copiar</button><button type="button" data-a="paste">Colar</button><button type="button" data-a="del" class="warn">🗑 Apagar</button></div></div>';
 el.querySelectorAll('input').forEach(i=>i.onchange=()=>{const s=snapshot(),v=+i.value;if(i.id==='piName')t.name=i.value.slice(0,80)||'Região';else if(i.id==='piStart')t.start=Math.max(0,v);else if(i.id==='piIn'){const L0=t.trimOut-t.trimIn;t.trimIn=Math.max(0,Math.min(t.buf.duration-.02,v));t.trimOut=Math.min(t.buf.duration,t.trimIn+L0);}else if(i.id==='piLen')t.trimOut=Math.min(t.buf.duration,t.trimIn+Math.max(.02,v));else if(i.id==='piFi')t.fadeIn=Math.max(0,Math.min(10,v));else if(i.id==='piFo')t.fadeOut=Math.max(0,Math.min(10,v));else if(i.id==='piGain')t.gain=Math.max(0,Math.min(150,v));pushUndo(s);commit();});}
let infoT=0;function info(t){const e=$('proInfo');if(!e)return;e.textContent=t;e.classList.add('flash');clearTimeout(infoT);infoT=setTimeout(()=>e.classList.remove('flash'),1500);}
// ---------- montagem ----------
function build(){if($('apsPro'))return;const d=document.createElement('div');d.id='apsPro';d.setAttribute('role','application');d.setAttribute('aria-label','Estúdio Pro');
 d.innerHTML='<header class="pro-top"><a class="pro-logo" href="./index.html" title="Início">APS</a><div class="pro-grp"><button type="button" id="proHome" title="Voltar ao início (Home)">⏮</button><button type="button" id="proPlay" class="pro-play" title="Tocar/pausar (Espaço)">▶</button><button type="button" id="proStop" title="Parar">■</button><button type="button" id="proRec" class="pro-rec" title="Gravar (R)">●</button><button type="button" id="proLoop" title="Repetir">⟲</button></div><div class="pro-lcd"><span id="proPos">1.1.1</span><small><input id="proBpm" type="number" min="40" max="240" aria-label="BPM"> BPM · <select id="proSig" aria-label="Compasso"><option>4/4</option><option>3/4</option><option>2/4</option><option>6/8</option><option>5/4</option><option>7/8</option></select></small></div><div class="pro-grp"><button type="button" id="proMetro" title="Metrônomo (K)">♩ Clique</button><label class="pro-sel">Grade<select id="proSnap"><option value="off">livre</option><option value="bar">compasso</option><option value="beat" selected>tempo</option><option value="8">1/8</option><option value="16">1/16</option></select></label></div><div class="pro-grp"><button type="button" id="proTool" title="Ferramenta: ponteiro / tesoura (T)">↖</button><button type="button" id="proMulti" title="Seleção múltipla (toque)">☑</button><button type="button" id="proSplit" title="Dividir no cursor (S)">✂</button><button type="button" id="proDup" title="Duplicar (Ctrl+D)">2×</button><button type="button" id="proDel" title="Apagar (Del)">🗑</button><button type="button" id="proUndo" title="Desfazer (Ctrl+Z)" disabled>↩</button><button type="button" id="proRedo" title="Refazer (Ctrl+Shift+Z)" disabled>↪</button></div><div class="pro-grp"><button type="button" id="proZOut" title="Afastar">－</button><button type="button" id="proFit" title="Ver tudo">⤢</button><button type="button" id="proZIn" title="Aproximar">＋</button><button type="button" id="proVZ" title="Altura das pistas">↕</button><label class="pro-chk" title="Seguir a agulha"><input type="checkbox" id="proFollow" checked>seguir</label></div><div class="pro-grp pro-right"><button type="button" id="proImport" title="Importar áudio">⤓ Importar</button><button type="button" id="proFull" title="Tela cheia">⛶</button><button type="button" id="proMenu" title="Menu">☰</button></div><div class="pro-menu" id="proMenuBox" hidden><a href="./projetos.html">📁 Meus Projetos</a><button type="button" id="proSave">💾 Salvar em Meus Projetos</button><button type="button" id="proTour">❔ Rever o tour</button><button type="button" id="proClassic">🗂 Modo clássico (todas as ferramentas)</button><a href="./index.html">⌂ Início</a></div></header>'+
 '<div class="pro-main"><div class="pro-heads" id="proHeads"></div><div class="pro-cv"><canvas id="proCanvas" tabindex="0" aria-label="Linha do tempo"></canvas></div></div>'+
 '<section class="pro-dock" id="proDock"><nav class="pro-tabs"><button type="button" data-tab="mixer">🎚 Mixer</button><button type="button" data-tab="editor">✏️ Editor</button><button type="button" data-tab="ia">🤖 Mixagem IA</button><button type="button" data-tab="master">🏆 Master</button><button type="button" data-tab="gravar">🎙 Gravar</button><button type="button" data-tab="loops">🇧🇷 Loops</button><button type="button" data-tab="trocar">🎻 Trocar instrumento</button><button type="button" data-tab="projeto">⤓ Exportar</button><span id="proInfo" class="pro-info" role="status" aria-live="polite"></span><button type="button" id="proDockT" class="pro-dockt" title="Mostrar/ocultar painel">▾</button></nav><div class="pro-dock-body" id="proDockBody"><div id="proMixer"><div class="pro-strips" id="proMixerStrips"></div></div><div id="proInspector"></div>'+Object.keys(PANELS).map(k=>'<div class="pro-panel" id="proPanel-'+k+'" hidden></div>').join('')+'</div></section>';
 document.body.appendChild(d);cv=$('proCanvas');g=cv.getContext('2d');headEl=$('proHeads');
 // transporte → controles originais
 const click=id=>$(id)?.click();
 $('proPlay').onclick=()=>click('play');$('proStop').onclick=()=>click('stop');$('proRec').onclick=()=>click('record');$('proHome').onclick=()=>{B.seek(0);st.sx=0;dirtyDraw=true;};
 $('proLoop').onclick=()=>{const c=$('loop');if(c){c.checked=!c.checked;c.dispatchEvent(new Event('change',{bubbles:true}));}$('proLoop').classList.toggle('on',!!$('loop')?.checked);};
 $('proMetro').onclick=()=>{const c=$('metro');if(c){c.checked=!c.checked;c.dispatchEvent(new Event('change',{bubbles:true}));}$('proMetro').classList.toggle('on',!!$('metro')?.checked);};
 $('proBpm').value=bpm();$('proBpm').onchange=e=>{const v=Math.max(40,Math.min(240,+e.target.value||100));$('bpm').value=v;$('bpm').dispatchEvent(new Event('change',{bubbles:true}));e.target.value=v;dirtyDraw=true;};
 $('proSig').value=$('apsTimeSig')?.value||'4/4';$('proSig').onchange=e=>{$('apsTimeSig').value=e.target.value;$('apsTimeSig').dispatchEvent(new Event('change',{bubbles:true}));dirtyDraw=true;};
 $('proSnap').onchange=e=>{st.snap=e.target.value;};
 $('proTool').onclick=()=>{st.tool=st.tool==='pointer'?'scissors':'pointer';$('proTool').textContent=st.tool==='pointer'?'↖':'✂';$('proTool').classList.toggle('on',st.tool==='scissors');info(st.tool==='scissors'?'Tesoura: toque numa região para dividir':'Ponteiro');};
 $('proMulti').onclick=()=>{st.multi=!st.multi;$('proMulti').classList.toggle('on',st.multi);info(st.multi?'Seleção múltipla ligada':'Seleção simples');};
 $('proSplit').onclick=()=>split();$('proDup').onclick=dup;$('proDel').onclick=del;$('proUndo').onclick=undo;$('proRedo').onclick=redo;
 $('proZIn').onclick=()=>setZoom(st.pps*1.5);$('proZOut').onclick=()=>setZoom(st.pps/1.5);$('proFit').onclick=fit;$('proVZ').onclick=()=>{st.lh=st.lh>=110?52:st.lh<70?76:118;renderHeads();dirtyDraw=true;};
 $('proImport').onclick=()=>click('importBtn');$('proFull').onclick=fullscreen;
 $('proMenu').onclick=()=>{$('proMenuBox').hidden=!$('proMenuBox').hidden;};$('proClassic').onclick=()=>setMode('classic');$('proTour').onclick=()=>{$('proMenuBox').hidden=true;root.APSTour?.start();};
 $('proSave').onclick=async()=>{$('proMenuBox').hidden=true;try{await root.APSProject.save();info('💾 Salvo em Meus Projetos');}catch(e){info(e.message);}};
 document.querySelectorAll('.pro-tabs [data-tab]').forEach(b=>b.onclick=()=>{if(st.dock===b.dataset.tab&&st.dockOpen){st.dockOpen=false;}else{st.dock=b.dataset.tab;st.dockOpen=true;}renderDock();setTimeout(resize,0);});
 $('proDockT').onclick=()=>{st.dockOpen=!st.dockOpen;$('proDockT').textContent=st.dockOpen?'▾':'▴';renderDock();setTimeout(resize,0);};
 for(const[k,f]of Object.entries(PANELS))for(const el of f())adopt(el,$('proPanel-'+k));
 // cabeçalhos
 headEl.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;if(b.id==='proAddLane'){pushUndo();newLane();renderHeads();dirtyDraw=true;return;}const l=laneById(b.closest('[data-lane]')?.dataset.lane);if(!l)return;const k=b.dataset.k;
  if(k==='arm'){st.armed=st.armed===l.id?null:l.id;knownIds=new Set(regions().map(t=>t.id));if(st.armed&&l.regs[0])B.focus(l.regs[0].id);info(st.armed?'● Pista "'+l.name+'" armada: a próxima gravação entra nela':'Pista desarmada');renderHeads();dirtyDraw=true;return;}
  if(k==='mute'||k==='solo'){setLane(l,k,!(l.regs[0]?.[k]));}});
 headEl.addEventListener('change',e=>{const i=e.target,l=laneById(i.closest('[data-lane]')?.dataset.lane);if(!l)return;if(i.classList.contains('pro-hname')){const s=snapshot();const nm=i.value.trim().slice(0,80)||'Pista';for(const t of l.regs)t.laneName=nm;const ex=st.extra.find(x=>x.id===l.id);if(ex)ex.name=nm;pushUndo(s);commit();return;}if(i.dataset.k)setLane(l,i.dataset.k,+i.value);});
 headEl.addEventListener('click',e=>{const h=e.target.closest('.pro-head');if(h&&!e.target.closest('button,input')){const l=laneById(h.dataset.lane);if(l?.regs.length){st.sel=new Set(l.regs.map(t=>t.id));B.focus(l.regs[0].id);dirtyDraw=true;renderHeads();renderDock();}}});
 // mixer
 const mx=$('proMixerStrips');mx.addEventListener('input',e=>{const i=e.target;if(i.id==='proMasterFader'){$('masterGain').value=i.value;$('masterGain').dispatchEvent(new Event('input',{bubbles:true}));i.nextElementSibling&&(i.parentElement.nextElementSibling.textContent=i.value+'%');return;}const l=laneById(i.closest('[data-lane]')?.dataset.lane);if(!l||!i.dataset.k)return;for(const t of l.regs)t[i.dataset.k]=+i.value;B.refresh();if(i.dataset.k==='gain')i.parentElement.nextElementSibling.textContent=i.value+'%';});
 mx.addEventListener('change',e=>{const i=e.target;if(i.dataset.k){mx.dataset.sig='';commit();}});
 mx.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;const l=laneById(b.closest('[data-lane]')?.dataset.lane);if(!l)return;if(b.dataset.a==='fx'){if(l.regs[0])B.focus(l.regs[0].id);st.sel=new Set(l.regs.map(t=>t.id));st.dock='editor';renderDock();return;}if(b.dataset.k){setLane(l,b.dataset.k,!(l.regs[0]?.[b.dataset.k]));mx.dataset.sig='';renderMixer();}});
 $('proInspector').addEventListener('click',e=>{const a=e.target.closest('[data-a]')?.dataset.a;({split:()=>split(),dup,copy,paste,del})[a]?.();});
 // canvas
 cv.addEventListener('pointerdown',onDown);cv.addEventListener('pointermove',onMove);cv.addEventListener('pointerup',onUp);cv.addEventListener('pointercancel',onUp);cv.addEventListener('wheel',onWheel,{passive:false});cv.addEventListener('contextmenu',e=>e.preventDefault());
 cv.addEventListener('dblclick',e=>{const p=local(e),h=hit(p.x,p.y);if(h){st.dock='editor';st.dockOpen=true;renderDock();}});
 new ResizeObserver(resize).observe(cv.parentElement);
 // status do motor → barra
 const so=$('status');if(so)new MutationObserver(()=>info(so.textContent)).observe(so,{childList:true,characterData:true,subtree:true});
 root.addEventListener('aps:redraw',()=>{dirtyDraw=true;if(document.body.classList.contains('aps-pro-on')){renderHeads();if(st.dock==='mixer')renderMixer();if(!drag&&st.dock==='editor')renderInspector();}});
 root.addEventListener('aps:change',()=>{dirtyDraw=true;});
 document.addEventListener('keydown',key);
 loop();}
function key(e){if(!document.body.classList.contains('aps-pro-on'))return;const tg=e.target;if(tg&&(/INPUT|SELECT|TEXTAREA/.test(tg.tagName)||tg.isContentEditable)&&tg.id!=='proCanvas')return;const c=e.ctrlKey||e.metaKey,k=e.key.toLowerCase();
 if(c&&k==='z'&&!e.shiftKey){e.preventDefault();undo();}else if(c&&(k==='y'||(k==='z'&&e.shiftKey))){e.preventDefault();redo();}else if(c&&k==='d'){e.preventDefault();dup();}else if(c&&k==='c'){copy();}else if(c&&k==='v'){e.preventDefault();paste();}else if(c&&k==='a'){e.preventDefault();st.sel=new Set(regions().map(t=>t.id));dirtyDraw=true;renderDock();}
 else if(!c&&k==='s'){e.preventDefault();split();}else if(k==='delete'||k==='backspace'){e.preventDefault();del();}else if(k===' '){e.preventDefault();$('play')?.click();}else if(!c&&k==='r'){$('record')?.click();}else if(!c&&k==='t'){$('proTool').click();}else if(!c&&k==='k'){$('proMetro').click();}else if(k==='home'||k==='enter'){B.seek(0);st.sx=0;dirtyDraw=true;}else if(k==='+'||k==='='){setZoom(st.pps*1.4);}else if(k==='-'){setZoom(st.pps/1.4);}else if(k==='escape'){st.sel.clear();dirtyDraw=true;renderDock();}}
async function fullscreen(){try{if(!document.fullscreenElement){await document.documentElement.requestFullscreen({navigationUI:'hide'});try{await screen.orientation?.lock?.('landscape');}catch{}}else await document.exitFullscreen();}catch{info('Tela cheia indisponível neste navegador. No celular, gire para horizontal.');}}
function setMode(m){try{localStorage.setItem('aps-daw-mode',m);}catch{}if(m==='pro'){build();for(const[k,f]of Object.entries(PANELS))for(const el of f())adopt(el,$('proPanel-'+k));document.body.classList.add('aps-pro-on');$('proBpm').value=bpm();resize();renderHeads();renderDock();if(st.pps===60&&B.total())fit();}else{document.body.classList.remove('aps-pro-on');giveBack();const q=new URLSearchParams(location.search).get('modulo')||'gravacao';document.querySelector('[data-aps-tab="'+q+'"]')?.click();if(!$('apsProBack')){const b=document.createElement('button');b.id='apsProBack';b.type='button';b.className='aps-pro-back';b.textContent='🎛 Estúdio Pro';b.onclick=()=>setMode('pro');document.body.appendChild(b);}}}
root.APSPro={setMode,split,undo,redo,del,dup,copy,paste,state:st,lanes,fit,setZoom,select:ids=>{st.sel=new Set(ids);dirtyDraw=true;renderDock();},xOf:t=>tx(t),yOfLane:i=>RH+i*st.lh-st.sy+st.lh/2,canvas:()=>cv};
function init(){const q=new URLSearchParams(location.search);let m='pro';try{m=localStorage.getItem('aps-daw-mode')||'pro';}catch{}if(q.has('classico'))m='classic';if(q.has('pro'))m='pro';setMode(m);}
if(document.readyState==='complete')init();else root.addEventListener('load',init);
})(window);
