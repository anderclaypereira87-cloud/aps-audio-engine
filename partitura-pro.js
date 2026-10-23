/* APS Audio Engine 3.7.0 — Partituras. Criado por Anderclay Pereira Silva. */
(()=>{'use strict';const $=id=>document.getElementById(id),T=window.APSTranscribe,I=window.APSInstrument;
const tracks=[];let busy=false,cancel=false,S=null,sel=null,undo=[],audioCtx=null,playing=[];
const status=(t,p)=>{$('status').textContent=t;if(p!=null)$('prog').style.width=Math.round(p)+'%';};
const idle=()=>new Promise(r=>setTimeout(r,0));
const guess=n=>{n=(n||'').toLowerCase();return /voc|voz|voice|cant/.test(n)?'voz':/bass|baixo/.test(n)?'baixo':/drum|bater|perc/.test(n)?'bateria':/guit|violao|violão/.test(n)?'guitarra':/piano|tecl|key/.test(n)?'teclado':/sax|trump|tromp|flaut|sopro|metai/.test(n)?'sopro':/string|corda|violin/.test(n)?'cordas':'teclado';};
function ac(){if(!audioCtx){const A=window.AudioContext||window.webkitAudioContext;audioCtx=new A();}return audioCtx;}
async function decode(blob){const b=await blob.arrayBuffer();return await ac().decodeAudioData(b);}
function mono(buf,t0=0,len=1e9){const sr=buf.sampleRate,a=Math.min(buf.length,Math.floor(t0*sr)),b=Math.min(buf.length,a+Math.floor(len*sr)),y=new Float32Array(Math.max(0,b-a)),c=buf.numberOfChannels;for(let k=0;k<c;k++){const x=buf.getChannelData(k);for(let i=a;i<b;i++)y[i-a]+=x[i]/c;}return y;}
function addTrack(name,buf,ins){const t={name,buf,ins:ins||guess(name),on:true};tracks.push(t);drawTracks();}
function drawTracks(){$('tracks').innerHTML='';tracks.forEach((t,i)=>{const d=document.createElement('div');d.className='track';d.innerHTML='<div><b></b> <small></small><label>Instrumento<select>'+Object.entries(T.INSTR).map(([k,v])=>'<option value="'+k+'">'+v.n+'</option>').join('')+'</select></label></div><div class="row"><label style="display:flex;gap:4px;align-items:center"><input type="checkbox" style="width:auto;margin:0"> usar</label><button>×</button></div>';d.querySelector('b').textContent=t.name;d.querySelector('small').textContent=t.buf.duration.toFixed(1)+' s';const s=d.querySelector('select');s.value=t.ins;s.onchange=()=>{t.ins=s.value;if(S)rebuild();};const c=d.querySelector('input');c.checked=t.on;c.onchange=()=>t.on=c.checked;d.querySelector('button').onclick=()=>{tracks.splice(i,1);drawTracks();};$('tracks').append(d);});$('go').disabled=!tracks.length||busy;}
$('file').onchange=async e=>{for(const f of e.target.files){try{status('Lendo '+f.name+'…');addTrack(f.name.replace(/\.[^.]+$/,''),await decode(f));status('Pista adicionada. Confira o instrumento e toque em Gerar partitura.');}catch(err){status('Não consegui ler '+f.name+': formato não suportado.');}}e.target.value='';};
$('fromSep').onclick=()=>{if(!window.indexedDB)return status('Navegador sem armazenamento local.');const r=indexedDB.open('aps-stems-transfer-v1',1);r.onupgradeneeded=()=>r.result.createObjectStore('sessions');r.onsuccess=()=>{const db=r.result;const g=db.transaction('sessions').objectStore('sessions').get('latest');g.onsuccess=async()=>{const v=g.result;db.close();if(!v||!v.stems?.length)return status('Nenhuma separação encontrada. Separe uma música no Separador primeiro.');status('Carregando pistas separadas…');const map={vocals:'voz',bass:'baixo',drums:'bateria',guitar:'guitarra',piano:'teclado',other:'teclado'};for(const s of v.stems){try{addTrack(s.name.replace(/\.wav$/,''),await decode(s.blob),map[s.type]||guess(s.name));}catch(e){}}tracks.forEach(t=>t.on=t.ins!=='teclado'||/piano/i.test(t.name));drawTracks();status('Pistas carregadas. Marque as que quer transcrever.');};};r.onerror=()=>status('Não consegui abrir as pistas separadas.');};
let rec=null;$('rec').onclick=async()=>{if(rec){rec.stop();return;}try{const st=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false}});const ch=[];rec=new MediaRecorder(st);rec.ondataavailable=e=>ch.push(e.data);rec.onstop=async()=>{st.getTracks().forEach(t=>t.stop());rec=null;$('rec').textContent='🎙 Gravar um take';try{addTrack('Take '+(tracks.length+1),await decode(new Blob(ch)),'voz');status('Take gravado. Escolha o instrumento.');}catch(e){status('Não consegui ler a gravação.');}};rec.start();$('rec').textContent='⏹ Parar gravação';status('Gravando… toque de novo para parar.');}catch(e){status('Sem acesso ao microfone.');}};
$('cancel').onclick=()=>{cancel=true;status('Cancelando…');};
const chk=()=>{if(cancel)throw Error('Cancelado');};
// ---------- transcrição ----------
async function transcribe(t,t0,len,pa,pb){const ins=T.INSTR[t.ins],sr=t.buf.sampleRate,x=mono(t.buf,t0,len);const pr=p=>{chk();status('Transcrevendo '+t.name+'… '+Math.round(p*100)+'%',pa+(pb-pa)*p);};let raw;
 if(ins.mode==='drums'){const h=(await I.transcribeDrums(x,sr)).notes;raw=T.drumClassify(x,sr,h.map(n=>n.start));}
 else if(ins.mode==='mono')raw=(await I.transcribeMono(x,sr,p=>pr(typeof p==='number'?(p>1?p/100:p):0))).notes;
 else raw=(await I.transcribePoly(x,sr,p=>pr(typeof p==='number'?(p>1?p/100:p):0))).notes;
 chk();raw.forEach((n,i)=>n.id=i);return{x,sr,raw,clean:ins.mode==='drums'?raw:T.cleanup(raw,{mode:ins.mode,lo:ins.lo,hi:ins.hi,harm:ins.harm})};}
$('go').onclick=async()=>{const use=tracks.filter(t=>t.on);if(!use.length)return status('Marque ao menos uma pista.');busy=true;cancel=false;$('go').disabled=true;$('cancel').disabled=false;
 const t0=Math.max(0,+$('t0').value||0),len=Math.max(5,+$('tlen').value||60);
 try{const res=[];for(let i=0;i<use.length;i++){res.push({t:use[i],...await transcribe(use[i],t0,len,i/use.length*80,(i+1)/use.length*80)});await idle();}
  status('Detectando andamento, tom e acordes…',85);await idle();
  // andamento: soma dos envelopes de ataque
  let env=null;for(const r of res){const e=T.INSTR[r.t.ins].mode==='drums'?T.onsetEnv(r.x,r.sr):T.onsetEnvFromNotes(r.clean,r.x.length/r.sr);if(!env)env=e;else for(let k=0;k<Math.min(env.o.length,e.o.length);k++)env.o[k]+=e.o[k];}
  const tp=T.tempo(env);const ub=+$('bpm').value;const bpm=ub>=40?ub:T.niceBpm(tp.bpm),per=60/bpm;let off=tp.offset;
  const first=Math.min(...res.flatMap(r=>r.clean.map(n=>n.start)).concat([1e9]));if(first<1e9){const k=Math.round((first-off)/per);off=off+k*per;if(off<0)off+=per*Math.ceil(-off/per);if(first<off-per*.25)off-=per;}
  if(off<0)off=0;
  const pitched=res.filter(r=>T.INSTR[r.t.ins].mode!=='drums');const k=T.key(pitched.flatMap(r=>r.clean));
  let chords=[];const hr=pitched[0];
  if(hr&&window.APSChords){try{const mix=new Float32Array(hr.x.length);for(const r of pitched)if(r.sr===hr.sr)for(let i=0;i<Math.min(mix.length,r.x.length);i++)mix[i]+=r.x[i];const b=ac().createBuffer(1,mix.length,hr.sr);b.copyToChannel(mix,0);const a=await window.APSChords.analyze(b,{onProgress:p=>{chk();}});chords=a.chords||[];}catch(e){if(cancel)throw e;}}
  S={title:$('title').value||'Minha música',bpm,off,t0,len,key:k,chords,res,tp};undo=[];fillKey();$('shift').value='0';rebuild();
  status('Pronto. Revise a partitura abaixo: toque numa nota para corrigir.',100);$('tools').hidden=false;$('paperWrap').hidden=false;$('paperWrap').scrollIntoView({behavior:'smooth'});
 }catch(e){status(cancel?'Cancelado.':'Erro: '+(e.message||e),0);console.error(e);}finally{busy=false;$('go').disabled=!tracks.length;$('cancel').disabled=true;}};
function fillKey(){const s=$('key');s.innerHTML='';for(const mode of ['maior','menor'])for(let t=0;t<12;t++){const o=document.createElement('option');o.value=t+'|'+mode;o.textContent=T.keyName({tonic:t,mode,fifths:T.fifthsFor(t,mode)});s.append(o);}s.value=S.key.tonic+'|'+S.key.mode;}
// ---------- monta partitura ----------
function rebuild(){if(!S)return;const grid=+$('grid').value,[num,den]=$('meter').value.split('/').map(Number),shift=+$('shift').value,semi=+$('semi').value||0;const[kt,km]=$('key').value.split('|');const tonic=(+kt+semi+120)%12,fifths=T.fifthsFor(tonic,km);
 const off=S.off+shift*60/S.bpm/grid,ticks=num*(4/den)*grid;
 const parts=S.res.map((r,i)=>{const ins=T.INSTR[r.t.ins];if(!r.q||r.qKey!==grid+'|'+shift){r.q=T.quantize(r.clean,{bpm:S.bpm,offset:off,grid,mode:ins.mode});r.qKey=grid+'|'+shift;}return{name:r.t.name+' · '+ins.n,ins,notes:r.q,lay:T.layout(r.q,{grid,num,den,mode:ins.mode})};});
 // cifras por tempo
 const per=60/S.bpm,beatsPerMeas=num*(4/den),chAt=[];let prev='';const nb=Math.max(...parts.map(p=>p.lay.measures.length))*beatsPerMeas;
 const step=beatsPerMeas%2===0?2:beatsPerMeas;for(let b=0;b<nb;b+=step){const votes={};for(let j=0;j<step;j++){const t=off+(b+j+.5)*per,cc=S.chords.find(c=>t>=c.start&&t<c.end);if(cc&&cc.root>=0){const kk=cc.root+'|'+cc.q;votes[kk]=votes[kk]||{c:cc,n:0};votes[kk].n++;}}const c=Object.values(votes).sort((a,b)=>b.n-a.n)[0]?.c;const nm=c&&c.root>=0?chName(c.root,c.q,semi,fifths):'';if(nm&&nm!==prev){const m=Math.floor(b/beatsPerMeas);(chAt[m]=chAt[m]||[]).push({pos:Math.round((b%beatsPerMeas)*grid),text:nm,...chXml(c.root+semi,c.q,fifths)});}prev=nm||prev;}
 S.score={title:S.title=$('title').value||S.title,composer:'',bpm:S.bpm,num,den,grid,fifths,semi,parts:parts.map(p=>({...p,chordsAt:$('showCh').value==='1'?chAt:[]})),chAt};
 $('info').textContent='Andamento '+S.bpm+' BPM · Tom '+T.keyName({tonic,mode:km,fifths})+' · '+parts.reduce((a,p)=>a+p.notes.length,0)+' notas · '+S.chords.length+' trechos de acorde'+(S.tp.conf<1.15&&!(+$('bpm').value)?' · ⚠️ andamento incerto: confira o BPM e digite o certo se precisar':'');
 render();}
function chName(root,q,semi,fifths){const r=((root+semi)%12+12)%12;return (fifths<0?T.FL:T.SH)[r]+q;}
function chXml(root,q,fifths){const r=((root%12)+12)%12,nm=(fifths<0?T.FL:T.SH)[r];return{step:nm[0],alter:nm[1]==='#'?1:nm[1]==='b'?-1:0,kind:{'':'major',m:'minor','7':'dominant',m7:'minor-seventh',maj7:'major-seventh'}[q]||'major'};}
// ---------- desenho (VexFlow) ----------
let vfReady=null;function loadVF(){return vfReady||(vfReady=new Promise((ok,no)=>{if(window.Vex)return ok();const s=document.createElement('script');s.src='./vendor/vexflow/vexflow.js?v=425';s.onload=ok;s.onerror=()=>{vfReady=null;no(Error('Falha ao carregar o motor de notação.'));};document.head.append(s);}));}
const KEYS={0:'C',1:'G',2:'D',3:'A',4:'E',5:'B',6:'F#',[-1]:'F',[-2]:'Bb',[-3]:'Eb',[-4]:'Ab',[-5]:'Db',[-6]:'Gb'};
async function render(){await loadVF();const VF=Vex.Flow,sc=S.score,paper=$('paper');paper.innerHTML='';
 const tb=document.createElement('div');tb.className='titleblk';tb.innerHTML='<h2></h2><p></p>';tb.querySelector('h2').textContent=sc.title;tb.querySelector('p').textContent='♩ = '+sc.bpm+' · Transcrição APS Audio Engine · Criado por Anderclay Pereira Silva';paper.append(tb);
 const W=Math.max(340,paper.clientWidth-20),perLine=W<500?2:W<900?3:4,mw=Math.floor((W-10)/perLine);
 for(const p of sc.parts){const h=document.createElement('h3');h.textContent=p.name;paper.append(h);const isDr=p.ins.mode==='drums',tab=!isDr&&p.ins.tab&&$('tab').value==='1';const clef=isDr?'percussion':p.ins.clef;
  const ms=p.lay.measures,lines=Math.ceil(ms.length/perLine),lh=(tab?250:130);const div=document.createElement('div');paper.append(div);
  const R=new VF.Renderer(div,VF.Renderer.Backends.SVG);R.resize(W,lines*lh+20);const ctx=R.getContext();let tabPos=3;const hits=[];const svg=div.querySelector('svg');svg.addEventListener('click',ev=>{const r=svg.getBoundingClientRect(),x=ev.clientX-r.left,y=ev.clientY-r.top;let best=null,bd=40;for(const h of hits){const bb=h.bb,dx=Math.max(bb.x-x,0,x-(bb.x+bb.w)),dy=Math.max(bb.y-y,0,y-(bb.y+bb.h)),d=Math.hypot(dx*1.5,dy);if(d<bd){bd=d;best=h;}}if(best)select(best.e.g,p,best.el);});
  for(let L=0;L<lines;L++){for(let j=0;j<perLine;j++){const m=L*perLine+j;if(m>=ms.length)break;const first=j===0,x=5+j*mw,y=10+L*lh+10;
    const st=new VF.Stave(x,y+18,mw);if(first){st.addClef(clef,'default',p.ins.oct8vb?'8vb':undefined);if(!isDr)st.addKeySignature(KEYS[sc.fifths]);}if(m===0)st.addTimeSignature(sc.num+'/'+sc.den);if(first)st.setMeasure(m+1);st.setContext(ctx).draw();
    let ts=null;if(tab){ts=new VF.TabStave(x,y+18+80,mw,{num_lines:p.ins.tab.length});if(first)ts.addClef('tab');ts.setContext(ctx).draw();}
    const notes=[],tnotes=[];for(const e of ms[m]){const dur=e.d+(e.dots?'d':'');let n;
     if(e.rest){n=new VF.StaveNote({keys:[clef==='bass'?'d/3':'b/4'],duration:dur+'r',clef:isDr?'treble':clef});}
     else if(isDr){const pcs=[...new Set(e.g.ns.map(q=>q.piece||'snare'))];n=new VF.StaveNote({keys:pcs.map(pc=>T.DRUM[pc].vf),duration:dur,clef:'percussion',stem_direction:1});}
     else{const ks=e.g.ns.map(q=>T.spell(q.midi+sc.semi+p.ins.wr,sc.fifths)).sort((a,b)=>(a.oct*12+'CDEFGAB'.indexOf(a.step))-(b.oct*12+'CDEFGAB'.indexOf(b.step)));n=new VF.StaveNote({keys:ks.map(k=>k.vf),duration:dur,clef,auto_stem:true});}
     if(e.dots)VF.Dot.buildAndAttach([n],{all:true});n.__e=e;notes.push(n);
     if(ts){let tn;if(e.rest)tn=new VF.GhostNote({duration:dur});else{const pos=T.tabPositions(e.g.ns.map(q=>q.midi+sc.semi),p.ins.tab,tabPos);if(pos.length)tabPos=pos[0].fret||tabPos;tn=pos.length?new VF.TabNote({positions:pos.map(q=>({str:q.str,fret:e.tied?'('+q.fret+')':q.fret})),duration:dur}):new VF.GhostNote({duration:dur});}tnotes.push(tn);}}
    const v=new VF.Voice({num_beats:sc.num,beat_value:sc.den}).setMode(VF.Voice.Mode.SOFT);v.addTickables(notes);
    if(!isDr)try{VF.Accidental.applyAccidentals([v],KEYS[sc.fifths]);}catch(e){}
    const vs=[v];let tv=null;if(ts){tv=new VF.Voice({num_beats:sc.num,beat_value:sc.den}).setMode(VF.Voice.Mode.SOFT);tv.addTickables(tnotes);}
    if(ts){const nx=Math.max(st.getNoteStartX(),ts.getNoteStartX());st.setNoteStartX(nx);ts.setNoteStartX(nx);}const fm=new VF.Formatter();fm.joinVoices([v]);if(tv){fm.joinVoices([tv]);fm.format([v,tv],mw-(first?(isDr?50:70+Math.abs(sc.fifths)*10):0)-(m===0?30:0)-20);}else fm.format([v],mw-(first?(isDr?50:70+Math.abs(sc.fifths)*10):0)-(m===0?30:0)-20);
    let beams=[];try{beams=VF.Beam.generateBeams(notes.filter(n=>!n.isRest()),{groups:[new VF.Fraction(sc.den===8?3:1,sc.den===8?8:4)]});}catch(e){}
    v.draw(ctx,st);if(tv)tv.draw(ctx,ts);beams.forEach(b=>b.setContext(ctx).draw());
    // ligaduras
    for(let i=0;i<notes.length;i++){const e=notes[i].__e;if(e.tie&&!e.rest){const nx=notes[i+1];const idx=e.g.ns.map((_,k)=>k);new VF.StaveTie({first_note:notes[i],last_note:nx&&nx.__e.g===e.g?nx:null,first_indices:idx,last_indices:idx}).setContext(ctx).draw();}}
    // cifras
    const ch=p.chordsAt[m]||[];if(ch.length&&p===sc.parts.find(q=>q.chordsAt.length)){ctx.save();ctx.setFont('Arial',13,'bold');let lastCx=-1;for(const c of ch){const nt=notes.find(n=>n.__e.pos>=c.pos)||notes[0];const cx=nt?nt.getAbsoluteX():st.getNoteStartX();if(cx<lastCx)continue;ctx.fillText(c.text,cx-2,y+14);lastCx=cx+c.text.length*9+6;}ctx.restore();}
    // seleção e confiança
    for(const n of notes){const e=n.__e,el=n.getSVGElement&&n.getSVGElement();if(!el||e.rest)continue;el.dataset.idx='1';const low=e.g.ns.some(q=>q.vel<.3||q.err>.35);if(low&&!e.tied)el.querySelectorAll('path').forEach(pp=>pp.setAttribute('fill','#d9822b'));{const b=n.getBoundingBox();hits.push({e,el,bb:{x:b.getX(),y:b.getY(),w:b.getW(),h:b.getH()}});}if(sel&&sel.g===e.g)el.classList.add('sel');}
   }await idle();}}}
// ---------- edição ----------
function select(g,p,el){document.querySelectorAll('.paper .sel').forEach(x=>x.classList.remove('sel'));el.classList.add('sel');sel={g,p,k:g.ns.length-1};showEd();}
function showEd(){const q=sel.g.ns[sel.k],sp=T.spell(q.midi+S.score.semi,S.score.fifths);$('edName').textContent=sel.p.ins.mode==='drums'?'Bateria: '+({kick:'bumbo',snare:'caixa',hat:'chimbal'}[q.piece]||q.piece):'Nota '+sp.step+(sp.acc==='#'?'♯':sp.acc==='b'?'♭':'')+sp.oct+(sel.g.ns.length>1?' (acorde '+(sel.k+1)+'/'+sel.g.ns.length+')':'');const beats=(q.qe-q.qs)/S.score.grid;const o=[...$('edDur').options].find(o=>+o.value===beats);$('edDur').value=o?o.value:'';$('editor').classList.add('on');}
$('edClose').onclick=()=>{$('editor').classList.remove('on');sel=null;document.querySelectorAll('.paper .sel').forEach(x=>x.classList.remove('sel'));};
function snap(){undo.push(S.res.map(r=>r.q.map(n=>({...n}))));if(undo.length>40)undo.shift();}
function findRes(q){return S.res.find(r=>r.q.includes(q));}
document.querySelectorAll('[data-ed]').forEach(b=>b.onclick=()=>{const a=b.dataset.ed;if(a==='undo'){const u=undo.pop();if(!u)return;S.res.forEach((r,i)=>r.q=u[i]);$('editor').classList.remove('on');sel=null;rebuild();return;}if(!sel)return;const q=sel.g.ns[sel.k],r=findRes(q);if(!r)return;
 if(a==='nextc'){sel.k=(sel.k+1)%sel.g.ns.length;showEd();return;}snap();
 if(a==='del'){r.q.splice(r.q.indexOf(q),1);$('editor').classList.remove('on');sel=null;}
 else if(sel.p.ins.mode==='drums'){const order=['kick','snare','hat'];q.piece=order[(order.indexOf(q.piece)+(+a>0?1:2))%3];}
 else q.midi=Math.max(0,Math.min(127,q.midi+(+a)));
 rebuild();if(sel)showEd();});
$('edDur').onchange=()=>{if(!sel)return;snap();const len=Math.max(1,Math.round(+$('edDur').value*S.score.grid));for(const q of sel.g.ns)q.qe=q.qs+len;const r=findRes(sel.g.ns[0]);r.q.sort((a,b)=>a.qs-b.qs||a.midi-b.midi);rebuild();showEd();};
['grid','meter','key','semi','tab','showCh','shift','title'].forEach(id=>$(id).addEventListener('change',()=>{if(!S)return;if(['grid','shift'].includes(id)){undo=[];S.res.forEach(r=>r.q=null);}rebuild();}));
// ---------- ouvir ----------
function stop(){playing.forEach(n=>{try{n.stop();}catch(e){}});playing=[];}
$('stop').onclick=stop;
$('play').onclick=()=>{if(!S)return;stop();const c=ac();c.resume();const sc=S.score,q=60/sc.bpm/sc.grid,now=c.currentTime+.15;
 for(const p of sc.parts)for(const n of p.notes){const t=now+n.qs*q;if(p.ins.mode==='drums'){const len=n.piece==='hat'?.05:.15,b=c.createBuffer(1,c.sampleRate*len,c.sampleRate),d=b.getChannelData(0);for(let i=0;i<d.length;i++){const k=i/c.sampleRate;d[i]=(n.piece==='kick'?Math.sin(2*Math.PI*(50+80*Math.exp(-k*30))*k):Math.random()*2-1)*Math.exp(-k*(n.piece==='hat'?60:20))*.5;}const s=c.createBufferSource();s.buffer=b;s.connect(c.destination);s.start(t);playing.push(s);continue;}
  const o=c.createOscillator(),g=c.createGain(),d=Math.max(.08,(n.qe-n.qs)*q);o.type='triangle';o.frequency.value=440*Math.pow(2,(n.midi+sc.semi-69)/12);g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(.18*n.vel,t+.01);g.gain.exponentialRampToValueAtTime(.001,t+d);o.connect(g).connect(c.destination);o.start(t);o.stop(t+d+.05);playing.push(o);}
 // clique de metrônomo leve
 const beats=Math.max(...sc.parts.map(p=>p.lay.measures.length))*sc.num*(4/sc.den);for(let b=0;b<beats;b++){const o=c.createOscillator(),g=c.createGain(),t=now+b*60/sc.bpm;o.frequency.value=b%(sc.num*(4/sc.den))?1000:1500;g.gain.setValueAtTime(.05,t);g.gain.exponentialRampToValueAtTime(.001,t+.03);o.connect(g).connect(c.destination);o.start(t);o.stop(t+.04);playing.push(o);}};
$('playOrig').onclick=()=>{if(!S)return;stop();const c=ac();c.resume();for(const r of S.res){const b=c.createBuffer(1,r.x.length,r.sr);b.copyToChannel(r.x,0);const s=c.createBufferSource();s.buffer=b;s.connect(c.destination);s.start();playing.push(s);}};
// ---------- exportar ----------
function dl(data,name,type){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([data],{type}));a.download=name;document.body.append(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove();},2000);}
const fname=()=>(S.score.title||'partitura').replace(/[^\wÀ-ú -]+/g,'').trim()||'partitura';
$('xml').onclick=()=>S&&dl(T.musicXML(S.score),fname()+'.musicxml','application/vnd.recordare.musicxml+xml');
$('midi').onclick=()=>S&&dl(T.midiFile(S.score),fname()+'.mid','audio/midi');
$('pdf').onclick=()=>{if(!S)return;$('editor').classList.remove('on');status('Na janela de impressão, escolha "Salvar como PDF".');setTimeout(()=>window.print(),100);};
window.APSPartitura={get state(){return S;},tracks,addTrack,decode,rebuild};
})();
