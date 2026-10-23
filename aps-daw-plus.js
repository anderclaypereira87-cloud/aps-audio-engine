/* APS 3.8.0 — Estúdio Pro+: Piano Roll MIDI com sampler (kits MMSTUDIO do Anderclay) e sintetizador,
 * automação de volume por pista e crossfade automático. Tudo roda no aparelho (Web Audio). */
(function(root){'use strict';
const $=id=>document.getElementById(id),B=root.APSMixBridge;if(!B)return;
const NAMES=['Dó','Dó#','Ré','Ré#','Mi','Fá','Fá#','Sol','Sol#','Lá','Lá#','Si'];
const nn=m=>NAMES[m%12]+(Math.floor(m/12)-1);
const INST={
 'kit:aps-studio':{n:'🥁 Bateria APS Studio (MMSTUDIO)',drum:'aps-studio'},
 'kit:aps-acustico':{n:'🥁 Bateria APS Acústico',drum:'aps-acustico'},
 piano:{n:'🎹 Piano elétrico (sintetizado)'},baixo:{n:'🎸 Baixo (sintetizado)'},pad:{n:'🌫 Pad / teclado (sintetizado)'},lead:{n:'🎺 Lead / sanfona (sintetizado)'},
 'lib:baixo':{n:'🎸 Baixo real (Biblioteca APS)',lib:'baixo',syn:'baixo'},'lib:teclado':{n:'🎹 Teclado real (Biblioteca APS)',lib:'teclado',syn:'piano'},'lib:violao-guitarra':{n:'🎸 Violão/guitarra real (Biblioteca APS)',lib:'violao-guitarra',syn:'piano'},'lib:outros':{n:'🎼 Timbres APS diversos (Biblioteca)',lib:'outros',syn:'pad'}};
const PR={inst:'kit:aps-studio',bars:2,vel:100,notes:[],rows:[],editId:null,len:1,scrollY:0,cw:22,rh:22,hw:74};
let kits=null,cache=new Map(),pctx=null,pvSrc=null;
async function loadKits(){if(kits)return kits;try{kits=await (await fetch('./kits/kits.json')).json();}catch{kits={};}try{if(root.APSLib)Object.assign(kits,await root.APSLib.drumKits());}catch{}return kits;}
async function sample(ac,file){const k=file;if(!cache.has(k))cache.set(k,fetch('./'+file).then(r=>{if(!r.ok)throw Error('Falha ao carregar '+file);return r.arrayBuffer();}));const ab=await cache.get(k);return ac.decodeAudioData(ab.slice(0));}
async function rows(){const I=INST[PR.inst];if(I.drum){const K=(await loadKits())[I.drum];const out=[];if(K)for(const[p,arr]of Object.entries(K.pieces||{}))arr.forEach((a,i)=>out.push({id:p+':'+i,label:a.label||p,file:a.file}));return out.reverse();}
 const isB=(I.syn||PR.inst)==='baixo',lo=isB?28:48,hi=isB?60:84,out=[];for(let m=hi;m>=lo;m--)out.push({id:'m'+m,midi:m,label:nn(m),black:[1,3,6,8,10].includes(m%12)});return out;}
const bpm=()=>B.bpm()||100,step=()=>60/bpm()/4,beatsPerBar=()=>Math.max(1,Number($('apsTimeSig')?.value.split('/')[0])||4),steps=()=>PR.bars*beatsPerBar()*4;
function voice(ac,out,m,t0,dur,vel){const K=INST[PR.inst]?.syn||PR.inst;const f=440*Math.pow(2,(m-69)/12),g=ac.createGain(),v=vel/127;out=out||ac.destination;
 const o=ac.createOscillator(),flt=ac.createBiquadFilter();flt.type='lowpass';let rel=.15;
 if(K==='piano'){o.type='triangle';const o2=ac.createOscillator();o2.type='sine';o2.frequency.value=f*2;const g2=ac.createGain();g2.gain.value=.3;o2.connect(g2).connect(g);o2.start(t0);o2.stop(t0+dur+.6);flt.frequency.value=Math.min(9000,f*8);g.gain.setValueAtTime(0,t0);g.gain.linearRampToValueAtTime(.5*v,t0+.005);g.gain.exponentialRampToValueAtTime(.12*v+.001,t0+Math.min(dur,1.2));rel=.35;}
 else if(K==='baixo'){o.type='sawtooth';flt.frequency.setValueAtTime(f*6,t0);flt.frequency.exponentialRampToValueAtTime(f*2,t0+.25);g.gain.setValueAtTime(0,t0);g.gain.linearRampToValueAtTime(.6*v,t0+.008);g.gain.setTargetAtTime(.4*v,t0+.05,.2);rel=.08;}
 else if(K==='pad'){o.type='sawtooth';o.detune.value=-7;const o2=ac.createOscillator();o2.type='sawtooth';o2.detune.value=7;o2.frequency.value=f;o2.connect(flt);o2.start(t0);o2.stop(t0+dur+1);flt.frequency.value=1800;g.gain.setValueAtTime(0,t0);g.gain.linearRampToValueAtTime(.22*v,t0+.25);rel=.6;}
 else{o.type='square';flt.frequency.value=3200;const lfo=ac.createOscillator(),lg=ac.createGain();lfo.frequency.value=5.5;lg.gain.value=4;lfo.connect(lg).connect(o.detune);lfo.start(t0);lfo.stop(t0+dur+.3);g.gain.setValueAtTime(0,t0);g.gain.linearRampToValueAtTime(.25*v,t0+.03);rel=.12;}
 o.frequency.value=f;o.connect(flt);flt.connect(g);g.connect(out);const e=t0+dur;g.gain.setValueAtTime(g.gain.value,e);g.gain.cancelScheduledValues(e);g.gain.setTargetAtTime(0,e,rel/3);o.start(t0);o.stop(e+rel*2+.05);}
async function render(){if(!PR.notes.length)throw Error('Toque na grade para colocar notas primeiro.');const len=steps()*step()+1.5,sr=44100;const ac=new OfflineAudioContext(2,Math.ceil(len*sr),sr);const bus=ac.createGain();bus.gain.value=.9;bus.connect(ac.destination);
 const I=INST[PR.inst];if(I.drum){const R=PR.rows,bufs={};for(const n of PR.notes){const r=R.find(x=>x.id===n.row);if(!r)continue;if(!bufs[r.id])bufs[r.id]=await sample(ac,r.file);const s=ac.createBufferSource(),g=ac.createGain();s.buffer=bufs[r.id];g.gain.value=n.vel/127;s.connect(g).connect(bus);s.start(n.s*step());}}
 else{let S=null;if(I.lib&&root.APSLib){try{S=await root.APSLib.sampler(ac,I.lib);}catch{}}for(const n of PR.notes){const r=PR.rows.find(x=>x.id===n.row);if(r&&!(S&&root.APSLib.note(ac,S,n.s*step(),n.l*step(),r.midi,bus,n.vel/127)))voice(ac,bus,r.midi,n.s*step(),n.l*step(),n.vel);}}
 return ac.startRendering();}
async function preview(){stopPreview();const buf=await render();pctx=pctx||new (root.AudioContext||root.webkitAudioContext)();await pctx.resume();pvSrc=pctx.createBufferSource();pvSrc.buffer=buf;pvSrc.connect(pctx.destination);pvSrc.start();$('prPlay').textContent='■ Parar';pvSrc.onended=()=>{$('prPlay')&&($('prPlay').textContent='▶ Ouvir');pvSrc=null;};}
function stopPreview(){if(pvSrc){try{pvSrc.stop();}catch{}pvSrc=null;}}
function pushUndo(){const P=root.APSPro;if(!P?.state)return;P.state.undo.push({tracks:B.snapshot(),extra:P.state.extra.map(e=>({...e}))});if(P.state.undo.length>80)P.state.undo.shift();P.state.redo=[];const u=$('proUndo');if(u)u.disabled=false;}
async function insert(){const buf=await render();pushUndo();const data={inst:PR.inst,bars:PR.bars,notes:PR.notes.map(n=>({...n})),bpm:bpm()};
 const ed=PR.editId&&B.raw(PR.editId);if(ed){B.setBuffer(ed.id,buf);ed.trimIn=0;ed.trimOut=buf.duration;ed.midi=data;B.commit();say('Região MIDI atualizada.');}
 else{const id=B.addTrack('MIDI · '+INST[PR.inst].n.replace(/^\S+\s/,''),buf,'flat',B.position());const t=B.raw(id);if(t){t.midi=data;PR.editId=id;}B.commit();say('Região MIDI inserida na posição da agulha. Use Ctrl+Z para desfazer.');}
 root.dispatchEvent(new Event('aps:redraw'));}
function midiFile(){const tpq=96,ev=[];for(const n of PR.notes){const r=PR.rows.find(x=>x.id===n.row);if(!r)continue;const key=r.midi??(36+PR.rows.length-1-PR.rows.indexOf(r)),ch=INST[PR.inst].drum?9:0;ev.push([n.s*24,0x90|ch,key,n.vel],[(n.s+n.l)*24,0x80|ch,key,0]);}
 ev.sort((a,b)=>a[0]-b[0]||(a[1]&0xf0)-(b[1]&0xf0));const vl=v=>{const o=[v&127];while(v>>=7)o.unshift((v&127)|128);return o;};const us=Math.round(6e7/bpm());let d=[0,0xff,0x51,3,us>>16&255,us>>8&255,us&255],last=0;for(const e of ev){d.push(...vl(e[0]-last),e[1],e[2],e[3]);last=e[0];}d.push(0,0xff,0x2f,0);
 const h=[77,84,104,100,0,0,0,6,0,0,0,1,0,tpq],trk=[77,84,114,107,d.length>>>24&255,d.length>>16&255,d.length>>8&255,d.length&255,...d];return new Blob([new Uint8Array([...h,...trk])],{type:'audio/midi'});}
function say(t){const e=$('prInfo');if(e)e.textContent=t;}
// ---------- grade ----------
let cv,g,drag=null;
function size(){if(!cv)return;const w=PR.hw+steps()*PR.cw,h=PR.rows.length*PR.rh;const d=Math.min(2,root.devicePixelRatio||1);cv.width=w*d;cv.height=h*d;cv.style.width=w+'px';cv.style.height=h+'px';g.setTransform(d,0,0,d,0,0);draw();}
function draw(){if(!g)return;const S=steps(),bb=beatsPerBar()*4;g.fillStyle='#0c0e15';g.fillRect(0,0,cv.width,cv.height);PR.rows.forEach((r,i)=>{const y=i*PR.rh;g.fillStyle=r.black?'#0a0c12':'#11141d';g.fillRect(PR.hw,y,S*PR.cw,PR.rh);g.fillStyle=r.black?'#20242f':'#e9e1cc';g.fillRect(0,y,PR.hw,PR.rh-1);g.fillStyle=r.black?'#e9e1cc':'#151821';g.font='11px system-ui';g.fillText(String(r.label).slice(0,11),4,y+PR.rh-7);g.fillStyle='#1b2030';g.fillRect(PR.hw,y+PR.rh-1,S*PR.cw,1);});
 for(let s=0;s<=S;s++){g.fillStyle=s%bb===0?'#d9af5b88':s%4===0?'#2b3246':'#181c28';g.fillRect(PR.hw+s*PR.cw,0,1,cv.height);}
 for(const n of PR.notes){const i=PR.rows.findIndex(r=>r.id===n.row);if(i<0)continue;const x=PR.hw+n.s*PR.cw,y=i*PR.rh;g.fillStyle='rgba(217,175,91,'+(.45+.55*n.vel/127)+')';g.fillRect(x+1,y+2,n.l*PR.cw-2,PR.rh-4);g.strokeStyle='#ffd77a';g.strokeRect(x+1.5,y+2.5,n.l*PR.cw-3,PR.rh-5);}}
function cell(e){const r=cv.getBoundingClientRect();const x=e.clientX-r.left-PR.hw,y=e.clientY-r.top;return{s:Math.floor(x/PR.cw),i:Math.floor(y/PR.rh),x};}
function down(e){const c=cell(e);if(c.x<0){const r=PR.rows[c.i];if(r)audition(r);return;}if(c.s<0||c.s>=steps()||!PR.rows[c.i])return;const row=PR.rows[c.i].id;const hitN=PR.notes.find(n=>n.row===row&&c.s>=n.s&&c.s<n.s+n.l);cv.setPointerCapture(e.pointerId);
 if(hitN){drag={n:hitN,s0:c.s,moved:false,t:Date.now()};}else{const drum=!!INST[PR.inst].drum;const n={row,s:c.s,l:drum?1:PR.len,vel:PR.vel};PR.notes.push(n);drag={n,s0:c.s,moved:true,fresh:true};audition(PR.rows[c.i]);}draw();}
function move(e){if(!drag)return;const c=cell(e);if(INST[PR.inst].drum)return;const l=Math.max(1,Math.min(steps()-drag.n.s,c.s-drag.n.s+1));if(l!==drag.n.l){drag.n.l=l;drag.moved=true;draw();}}
function up(){if(drag&&!drag.moved&&!drag.fresh){PR.notes.splice(PR.notes.indexOf(drag.n),1);}else if(drag&&!INST[PR.inst].drum)PR.len=drag.n.l;drag=null;draw();}
async function audition(r){try{pctx=pctx||new (root.AudioContext||root.webkitAudioContext)();await pctx.resume();if(r.file){const b=await sample(pctx,r.file);const s=pctx.createBufferSource();s.buffer=b;s.connect(pctx.destination);s.start();}else{const I=INST[PR.inst];let S=null;if(I.lib&&root.APSLib){try{S=await root.APSLib.sampler(pctx,I.lib);}catch{}}if(!(S&&root.APSLib.note(pctx,S,pctx.currentTime+.01,.5,r.midi,pctx.destination,PR.vel/127)))voice(pctx,null,r.midi,pctx.currentTime+.01,.35,PR.vel);}}catch(err){say(err.message);}}
async function setInst(v,keep){PR.inst=v;PR.rows=await rows();if(!keep)PR.notes=[];size();if(!INST[v].drum){const i=PR.rows.findIndex(r=>r.midi===60);const box=$('prGridBox');if(box&&i>0)box.scrollTop=i*PR.rh-80;}}
function pattern(kind){const R=PR.rows,find=re=>R.find(r=>re.test(r.id))?.id;const S=steps(),k=find(/^kick/),sn=find(/^snare/),h=find(/^hat/),out=[];if(!INST[PR.inst].drum){say('Padrões prontos são para bateria. Escolha um kit.');return;}
 for(let s=0;s<S;s++){const b=s%16;if(kind==='forro'){if(k&&(b===0||b===6||b===8||b===14))out.push({row:k,s,l:1,vel:110});if(sn&&(b===4||b===12))out.push({row:sn,s,l:1,vel:100});if(h&&b%2===0)out.push({row:h,s,l:1,vel:b%4?70:95});}
  else if(kind==='pop'){if(k&&(b===0||b===8||b===10))out.push({row:k,s,l:1,vel:110});if(sn&&(b===4||b===12))out.push({row:sn,s,l:1,vel:105});if(h&&b%2===0)out.push({row:h,s,l:1,vel:80});}
  else{if(k&&(b===0||b===3||b===8||b===11))out.push({row:k,s,l:1,vel:110});if(sn&&(b===4||b===12))out.push({row:sn,s,l:1,vel:100});if(h)out.push({row:h,s,l:1,vel:b%2?60:85});}}
 PR.notes=out;draw();}
function loadSelected(){const P=root.APSPro,id=[...(P?.state.sel||[])][0],t=id&&B.raw(id);if(!t?.midi){say('Selecione na linha do tempo uma região MIDI criada aqui.');return;}PR.editId=id;PR.bars=t.midi.bars;$('prBars').value=PR.bars;$('prInst').value=t.midi.inst;setInst(t.midi.inst,true).then(()=>{PR.notes=t.midi.notes.map(n=>({...n}));draw();say('Editando "'+t.name+'". Toque em Inserir para atualizar.');});}
// ---------- automação ----------
const AU={lane:null};let ac2,ag;
function laneRegs(){const P=root.APSPro;if(!P)return[];const L=P.lanes();const sel=[...P.state.sel][0];let l=L.find(x=>x.regs.some(t=>t.id===sel))||L.find(x=>x.id===AU.lane)||L[0];if(!l)return[];AU.lane=l.id;return l.regs;}
function autoPts(){return laneRegs()[0]?.auto||[];}
function drawAuto(){if(!ag)return;const regs=laneRegs(),tot=Math.max(B.total(),4),w=ac2.clientWidth||600,h=140;const d=Math.min(2,root.devicePixelRatio||1);ac2.width=w*d;ac2.height=h*d;ag.setTransform(d,0,0,d,0,0);ag.fillStyle='#0c0e15';ag.fillRect(0,0,w,h);
 const X=t=>t/tot*w,Y=v=>h-8-v/1.5*(h-16);ag.fillStyle='#d9af5b22';for(const t of regs)ag.fillRect(X(t.start),0,X(t.trimOut-t.trimIn),h);ag.fillStyle='#2b3246';ag.fillRect(0,Y(1),w,1);ag.fillStyle='#8a8070';ag.font='10px system-ui';ag.fillText('100%',4,Y(1)-3);
 const P=autoPts();ag.strokeStyle='#ffd77a';ag.lineWidth=2;ag.beginPath();if(P.length){ag.moveTo(0,Y(P[0][1]));for(const p of P)ag.lineTo(X(p[0]),Y(p[1]));ag.lineTo(w,Y(P[P.length-1][1]));}else{ag.moveTo(0,Y(1));ag.lineTo(w,Y(1));}ag.stroke();ag.fillStyle='#ffd77a';for(const p of P){ag.beginPath();ag.arc(X(p[0]),Y(p[1]),5,0,7);ag.fill();}
 const px=X(B.position());ag.fillStyle='#fff8';ag.fillRect(px,0,1,h);const nm=$('auLane');if(nm){const L=root.APSPro.lanes().find(l=>l.id===AU.lane);nm.textContent=L?L.name:'(nenhuma pista)';}}
function setAuto(P){const regs=laneRegs();for(const t of regs)t.auto=P.length?P.map(p=>[p[0],p[1]]):null;B.commit();drawAuto();}
let adrag=null;
function aDown(e){const regs=laneRegs();if(!regs.length)return;const r=ac2.getBoundingClientRect(),tot=Math.max(B.total(),4),t=(e.clientX-r.left)/r.width*tot,v=Math.max(0,Math.min(1.5,(r.height-8-(e.clientY-r.top))/(r.height-16)*1.5));pushUndo();let P=autoPts().map(p=>[...p]);
 const near=P.findIndex(p=>Math.abs(p[0]/tot*r.width-(e.clientX-r.left))<12&&Math.abs((r.height-8-p[1]/1.5*(r.height-16))-(e.clientY-r.top))<14);
 if(near>=0&&e.detail>=2){P.splice(near,1);setAuto(P.length>1?P:[]);return;}let idx=near;if(idx<0){if(!P.length)P=[[0,1],[tot,1]];P.push([t,v]);P.sort((a,b)=>a[0]-b[0]);idx=P.findIndex(p=>p[0]===t);}
 adrag={P,idx};ac2.setPointerCapture(e.pointerId);setAuto(P);}
function aMove(e){if(!adrag)return;const r=ac2.getBoundingClientRect(),tot=Math.max(B.total(),4),P=adrag.P,i=adrag.idx;const lo=i>0?P[i-1][0]+.01:0,hi=i<P.length-1?P[i+1][0]-.01:tot;P[i]=[Math.max(lo,Math.min(hi,(e.clientX-r.left)/r.width*tot)),Math.max(0,Math.min(1.5,(r.height-8-(e.clientY-r.top))/(r.height-16)*1.5))];for(const t of laneRegs())t.auto=P.map(p=>[...p]);drawAuto();}
function aUp(){if(adrag){adrag=null;B.commit();}}
// ---------- crossfade ----------
function crossfade(){const P=root.APSPro;if(!P)return;pushUndo();let n=0;for(const l of P.lanes()){const rs=[...l.regs].sort((a,b)=>a.start-b.start);for(let i=0;i+1<rs.length;i++){const a=rs[i],b=rs[i+1],end=a.start+(a.trimOut-a.trimIn),ov=end-b.start;if(ov>.005){const f=Math.min(10,ov);a.fadeOut=Math.max(a.fadeOut||0,f);b.fadeIn=Math.max(b.fadeIn||0,f);n++;}}}
 B.commit();root.dispatchEvent(new Event('aps:redraw'));const e=$('proInfo');if(e)e.textContent=n?'✕ '+n+' crossfade(s) criado(s) nas sobreposições':'Nenhuma sobreposição: arraste uma região por cima de outra na mesma pista';}

// ---------- Biblioteca APS (timbres do Anderclay, carregados sob demanda) ----------
let libSrc=null;
async function libList(){const box=$('libList');if(!box||!root.APSLib)return;box.textContent='Carregando…';try{const f=$('libInst').value,t=$('libTipo').value;const L=await root.APSLib.items(i=>(!f||i.inst===f)&&(!t||i.tipo===t)&&/\.mp3$/.test(i.file));box.replaceChildren();
 L.forEach((it,n)=>{const r=document.createElement('div');r.className='lib-row';const nm=(root.APSLib.NOMES[it.inst]||it.inst)+(it.sub?' · '+({kick:'bumbo',snare:'caixa',hat:'chimbal'}[it.sub]||it.sub):'')+' '+(n+1);
  r.innerHTML='<span>'+nm+'<small>'+(it.tipo==='loop'?' loop '+Math.round(it.bpm||0)+' BPM'+(it.tom?' · '+it.tom:''):' one-shot')+'</small></span><button type="button" class="lib-play">▶</button><button type="button" class="lib-add gold">＋</button>';
  r.querySelector('.lib-play').onclick=async()=>{try{pctx=pctx||new (root.AudioContext||root.webkitAudioContext)();await pctx.resume();try{libSrc?.stop();}catch{}const b=await root.APSLib.buffer(pctx,it.file);libSrc=pctx.createBufferSource();libSrc.buffer=b;libSrc.connect(pctx.destination);libSrc.start();}catch(e){$('libInfo').textContent=e.message;}};
  r.querySelector('.lib-add').onclick=async()=>{try{pctx=pctx||new (root.AudioContext||root.webkitAudioContext)();const b=await root.APSLib.buffer(pctx,it.file);pushUndo();B.addTrack('APS · '+nm,b,'flat',B.position());B.commit();$('libInfo').textContent='"'+nm+'" inserido na posição da agulha.';}catch(e){$('libInfo').textContent=e.message;}};
  box.append(r);});if(!L.length)box.textContent='Nada nesse filtro.';}catch(e){box.textContent='Não consegui abrir a biblioteca: '+e.message;}}
// ---------- montagem ----------
function show(tab){const P=root.APSPro,st=P.state;st.dock=tab;st.dockOpen=true;$('proDock').classList.remove('closed');document.querySelectorAll('.pro-tabs button').forEach(b=>b.classList.toggle('on',b.dataset.tab===tab||b.dataset.plus===tab));
 for(const el of $('proDockBody').children)el.hidden=el.id!=='proPlus-'+tab;if(tab==='lib'&&!$('libList').childElementCount)libList();$('proDockBody').scrollTop=0;if(tab==='piano')size();if(tab==='auto')drawAuto();}
function mount(){if($('proPlus-piano'))return;const tabs=document.querySelector('.pro-tabs'),body=$('proDockBody');if(!tabs||!body)return;
 const mk=(k,l)=>{const b=document.createElement('button');b.type='button';b.dataset.plus=k;b.textContent=l;tabs.insertBefore(b,tabs.children[1]);b.onclick=()=>show(k);};mk('lib','📚 Biblioteca');mk('auto','📈 Automação');mk('piano','🎹 Piano Roll');
 tabs.addEventListener('click',e=>{const b=e.target.closest('button[data-tab]');if(b){$('proPlus-piano').hidden=true;$('proPlus-auto').hidden=true;$('proPlus-lib').hidden=true;try{libSrc?.stop();}catch{}tabs.querySelectorAll('[data-plus]').forEach(x=>x.classList.remove('on'));stopPreview();}},true);
 const pp=document.createElement('div');pp.id='proPlus-piano';pp.className='pro-plus';pp.hidden=true;
 pp.innerHTML='<div class="pr-bar"><select id="prInst" aria-label="Instrumento">'+Object.entries(INST).map(([k,v])=>'<option value="'+k+'">'+v.n+'</option>').join('')+'</select><label>Compassos <select id="prBars">'+[1,2,4,8].map(n=>'<option'+(n===2?' selected':'')+'>'+n+'</option>').join('')+'</select></label><label>Força <input id="prVel" type="range" min="20" max="127" value="100"></label><select id="prPat" aria-label="Padrão pronto"><option value="">Ritmo pronto…</option><option value="forro">Forró / xote</option><option value="pop">Pop / gospel</option><option value="sert">Sertanejo / piseiro</option></select><button type="button" id="prPlay">▶ Ouvir</button><button type="button" id="prIns" class="gold">⤵ Inserir na linha do tempo</button><button type="button" id="prEdit">✏️ Editar região MIDI</button><button type="button" id="prNew">＋ Nova</button><button type="button" id="prClear">Limpar</button><button type="button" id="prMid">⬇ .mid</button></div><div class="pr-grid" id="prGridBox"><canvas id="prGrid" aria-label="Grade do piano roll"></canvas></div><p class="sub" id="prInfo">Toque na grade para pôr uma nota, arraste para a direita para alongar, toque de novo para apagar. Toque no nome da nota para ouvir.</p>';
 const pa=document.createElement('div');pa.id='proPlus-auto';pa.className='pro-plus';pa.hidden=true;
 pa.innerHTML='<div class="pr-bar"><b>Volume da pista: <span id="auLane"></span></b><button type="button" id="auFadeIn">Subida no início</button><button type="button" id="auFadeOut">Descida no fim</button><button type="button" id="auClear">Limpar automação</button><button type="button" id="auXf" class="gold">✕ Crossfade automático</button></div><canvas id="auCv" class="au-cv" aria-label="Curva de automação"></canvas><p class="sub">Selecione uma região na linha do tempo para escolher a pista. Toque para criar um ponto, arraste para mover, toque duas vezes num ponto para apagar. A automação vale para tocar e para exportar.</p>';
 const pl=document.createElement('div');pl.id='proPlus-lib';pl.className='pro-plus';pl.hidden=true;
 pl.innerHTML='<div class="pr-bar"><select id="libInst" aria-label="Instrumento"><option value="">Todos</option><option value="bateria">🥁 Bateria</option><option value="baixo">🎸 Baixo</option><option value="teclado">🎹 Teclado</option><option value="violao-guitarra">🎸 Violão/guitarra</option><option value="outros">🎼 Diversos</option></select><select id="libTipo" aria-label="Tipo"><option value="">Loops e one-shots</option><option value="loop">Loops</option><option value="one-shot">One-shots</option></select></div><p class="sub" id="libInfo">Timbres próprios de Anderclay Pereira Silva. ▶ ouve, ＋ coloca na agulha.</p><div id="libList" class="lib-list"></div>';
 body.append(pp,pa,pl);$('libInst').onchange=libList;$('libTipo').onchange=libList;cv=$('prGrid');g=cv.getContext('2d');ac2=$('auCv');ag=ac2.getContext('2d');
 cv.addEventListener('pointerdown',down);cv.addEventListener('pointermove',move);cv.addEventListener('pointerup',up);cv.addEventListener('pointercancel',up);
 ac2.addEventListener('pointerdown',aDown);ac2.addEventListener('pointermove',aMove);ac2.addEventListener('pointerup',aUp);ac2.addEventListener('pointercancel',aUp);
 const run=f=>async()=>{try{await f();}catch(e){say(e.message);}};
 if(root.APSLib)root.APSLib.drumKits().then(K=>{const sel=$('prInst');for(const[id,k]of Object.entries(K)){INST['kit:'+id]={n:k.name,drum:id};sel.add(new Option(k.name,'kit:'+id),sel.options[2]);}}).catch(()=>{});
 $('prInst').onchange=e=>{PR.editId=null;setInst(e.target.value);};$('prBars').onchange=e=>{PR.bars=+e.target.value;PR.notes=PR.notes.filter(n=>n.s<steps());size();};$('prVel').oninput=e=>PR.vel=+e.target.value;
 $('prPat').onchange=e=>{if(e.target.value)pattern(e.target.value);e.target.value='';};$('prPlay').onclick=run(()=>pvSrc?stopPreview():preview());$('prIns').onclick=run(insert);$('prEdit').onclick=loadSelected;
 $('prNew').onclick=()=>{PR.editId=null;PR.notes=[];draw();say('Nova região MIDI.');};$('prClear').onclick=()=>{PR.notes=[];draw();};$('prMid').onclick=()=>{if(!PR.notes.length)return say('Sem notas para exportar.');const a=document.createElement('a');a.href=URL.createObjectURL(midiFile());a.download='aps-midi.mid';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),4000);};
 $('auClear').onclick=()=>{pushUndo();setAuto([]);};$('auXf').onclick=crossfade;
 $('auFadeIn').onclick=()=>{const r=laneRegs();if(!r.length)return;pushUndo();const s=Math.min(...r.map(t=>t.start));setAuto([[s,0],[s+4,1]]);};
 $('auFadeOut').onclick=()=>{const r=laneRegs();if(!r.length)return;pushUndo();const e=Math.max(...r.map(t=>t.start+t.trimOut-t.trimIn));setAuto([[Math.max(0,e-4),1],[e,0]]);};
 const top=$('proDup');if(top){const x=document.createElement('button');x.type='button';x.id='proXfade';x.title='Crossfade automático nas sobreposições';x.textContent='✕';x.onclick=crossfade;top.after(x);}
 root.addEventListener('aps:redraw',()=>{if(!$('proPlus-auto').hidden)drawAuto();});
 setInterval(()=>{if(!$('proPlus-auto')?.hidden&&B.isPlaying())drawAuto();},200);
 setInst(PR.inst);}
root.APSPlus={render,insert,crossfade,state:PR,setAuto,show,midiFile};
const t=setInterval(()=>{if($('proDockBody')&&root.APSPro){clearInterval(t);mount();}},300);setTimeout(()=>clearInterval(t),60000);
})(window);
