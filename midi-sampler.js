/* APS · MIDI e Sampler — interface. Criado para o APS Audio Engine. */
(()=>{'use strict';const $=id=>document.getElementById(id),M=window.APSMidi,I=window.APSInstrument,T=window.APSTranscribe;
const S={src:null,raw:[],notes:[],bpm:100,off:0,sel:-1,drumsMode:false,inst:null,userIR:null,samples:[],live:null,playing:null};
const status=t=>{$('status').textContent=t;};
const idle=()=>new Promise(r=>setTimeout(r,0));
let pctx=null;const ac=()=>pctx||(pctx=new (window.AudioContext||window.webkitAudioContext)());
const mono=buf=>{const n=buf.length,c=buf.numberOfChannels,y=new Float32Array(n);for(let k=0;k<c;k++){const x=buf.getChannelData(k);for(let i=0;i<n;i++)y[i]+=x[i]/c;}return y;};
const PIECE_MIDI={kick:36,snare:38,hat:42};
// ---------- instrumentos ----------
function fillInst(){const s=$('inst');s.innerHTML='';const g1=document.createElement('optgroup');g1.label='Timbres sampleados (FluidR3_GM)';for(const[id,n,style]of M.GM){const o=document.createElement('option');o.value='gm:'+id+':'+style;o.textContent=n;g1.append(o);}s.append(g1);
 const g2=document.createElement('optgroup');g2.label='Bateria';for(const[k,n]of [['aps-studio','Bateria APS Studio (MMSTUDIO)'],['aps-acustico','Bateria APS Acústico']]){const o=document.createElement('option');o.value='drums:'+k;o.textContent='🥁 '+n;g2.append(o);}s.append(g2);
 const g3=document.createElement('optgroup');g3.label='Minhas amostras';const o=document.createElement('option');o.value='user';o.textContent='📦 Minhas amostras / SFZ (carregue abaixo)';o.disabled=true;o.id='optUser';g3.append(o);s.append(g3);s.value='gm:acoustic_grand_piano:pluck';}
function curInst(){const v=$('inst').value,tr=+$('trans').value||0;if(v==='user'&&S.userInst)return{...S.userInst,transpose:tr};if(v.startsWith('drums:'))return{kind:'drums',kit:v.slice(6),name:v};const[,id,style]=v.split(':');return{kind:'gm',id,style,transpose:tr,name:id};}
// ---------- quantização / notas ----------
function applyQuant(){S.bpm=+$('bpm').value||100;S.off=+$('off').value||0;S.notes=M.quantize(S.raw,{bpm:S.bpm,offset:S.off,grid:$('grid').value,strength:+$('strength').value,quantizeEnd:$('qEnd').checked});S.sel=-1;draw();info();}
function info(){const n=S.notes.length,d=n?Math.max(...S.notes.map(x=>x.end)):0;$('rollInfo').textContent=n?n+' notas · '+d.toFixed(1)+' s · '+S.bpm+' BPM · grade '+$('grid').value+' a '+$('strength').value+'% (toque numa nota para selecionar; num espaço vazio para criar)':'Sem notas ainda.';
 for(const id of['play','dlMidi','dlWav','toDaw'])$(id).disabled=!n;$('del').disabled=S.sel<0;}
['grid','strength','qEnd','bpm','off'].forEach(id=>$(id).addEventListener('input',()=>{$('strV').textContent=$('strength').value+'%';if(S.raw.length)applyQuant();}));
// ---------- piano roll ----------
const cv=$('roll'),g=cv.getContext('2d');let pps=120;
function bounds(){const ms=S.notes.map(n=>n.midi),lo=ms.length?Math.min(...ms)-3:48,hi=ms.length?Math.max(...ms)+3:84;return{lo:Math.min(lo,hi-18),hi};}
function draw(){const W=$('rollBox').clientWidth||1100,H=340,d=Math.min(2,window.devicePixelRatio||1);const dur=Math.max(8,S.notes.length?Math.max(...S.notes.map(n=>n.end))+1:8);pps=+$('zoom').value;cv.width=Math.max(W,dur*pps+60)*d;cv.height=H*d;
 // canvas rolável: usamos largura própria e deixamos o contêiner rolar
 cv.style.width=Math.max(W,dur*pps+60)+'px';g.setTransform(d,0,0,d,0,0);const{lo,hi}=bounds(),rh=H/(hi-lo+1),Wd=Math.max(W,dur*pps+60);
 g.fillStyle='#0c0e15';g.fillRect(0,0,Wd,H);for(let m=lo;m<=hi;m++){const y=(hi-m)*rh,blk=[1,3,6,8,10].includes(m%12);g.fillStyle=blk?'#0a0c12':'#11141d';g.fillRect(0,y,Wd,rh);g.fillStyle='#1b2030';g.fillRect(0,y+rh-1,Wd,1);if(m%12===0){g.fillStyle='#6f7d90';g.font='10px system-ui';g.fillText(M.noteName(m),2,y+rh-3);}}
 const beat=60/S.bpm;for(let t=S.off,k=0;t<dur;t+=beat,k++){g.fillStyle=k%4===0?'#d9af5b88':'#2b3246';g.fillRect(t*pps,0,1,H);}
 const q=beat/(M.GRIDS[$('grid').value]||4);g.fillStyle='#161b27';for(let t=S.off;t<dur;t+=q)g.fillRect(t*pps,0,1,H);
 S.notes.forEach((n,i)=>{const y=(hi-n.midi)*rh,x=n.start*pps,w=Math.max(3,(n.end-n.start)*pps);g.fillStyle='rgba(217,175,91,'+(.4+.6*(n.vel??.8))+')';g.fillRect(x,y+1,w,rh-2);g.strokeStyle=i===S.sel?'#fff':'#ffd77a';g.lineWidth=i===S.sel?2:1;g.strokeRect(x+.5,y+1.5,w-1,rh-3);});
 if(S.head!=null){g.fillStyle='#4fd';g.fillRect(S.head*pps,0,2,H);}
 S.geo={lo,hi,rh,H};}
cv.addEventListener('pointerdown',e=>{if(!S.geo)return;const r=cv.getBoundingClientRect(),x=e.clientX-r.left,y=e.clientY-r.top,t=x/pps,m=S.geo.hi-Math.floor(y/S.geo.rh);
 const hit=S.notes.findIndex(n=>n.midi===m&&t>=n.start&&t<=n.end);if(hit>=0){S.sel=hit;draw();info();audition(S.notes[hit].midi);return;}
 const q=60/S.bpm/(M.GRIDS[$('grid').value]||4),s=Math.max(0,Math.round((t-S.off)/q)*q+S.off);S.notes.push({start:s,end:s+q,midi:m,vel:.8});S.notes.sort((a,b)=>a.start-b.start||a.midi-b.midi);S.sel=S.notes.findIndex(n=>n.start===s&&n.midi===m);bake();audition(m);});
function bake(){S.raw=S.notes.map(n=>({...n}));draw();info();}
$('del').onclick=()=>{if(S.sel>=0){S.notes.splice(S.sel,1);S.sel=-1;bake();}};
const shift=d=>{if(!S.notes.length)return;if(S.sel>=0)S.notes[S.sel].midi+=d;else S.notes.forEach(n=>n.midi+=d);bake();};
$('tm12').onclick=()=>shift(-12);$('tm1').onclick=()=>shift(-1);$('tp1').onclick=()=>shift(1);$('tp12').onclick=()=>shift(12);$('zoom').oninput=draw;
// ---------- reprodução ----------
async function buildEngine(c,notes){const bus=M.makeBus(c,{reverb:{kind:$('rv').value==='user'&&!S.userIR?'off':$('rv').value,wet:+$('wet').value/100,ir:S.userIR},volume:+$('vol').value/100*1.1});const sp=new M.Sampler(c,bus.input);const inst=curInst();await sp.load(inst,inst.kind==='gm'?[...new Set(notes.map(n=>n.midi+(inst.transpose||0)))]:null);return{bus,sp};}
async function audition(midi){try{const c=ac();await c.resume();if(!S.aud||S.audKey!==$('inst').value+'|'+$('trans').value){const b=await buildEngine(c,[{midi}]);S.aud=b;S.audKey=$('inst').value+'|'+$('trans').value;if(S.aud.sp.inst.kind==='gm')await S.aud.sp.load(S.aud.sp.inst,null);}S.aud.sp.play({midi,vel:.8,start:c.currentTime+.01,dur:.5});}catch(e){status('Não foi possível tocar: '+(e.message||e));}}
$('inst').addEventListener('change',()=>{S.aud=null;});$('trans').addEventListener('change',()=>{S.aud=null;});
async function play(){if(!S.notes.length)return;stop();try{status('Preparando o timbre…');const c=ac();await c.resume();const eng=await buildEngine(c,S.notes);const t0=c.currentTime+.15;for(const n of S.notes)eng.sp.play({midi:n.midi,vel:n.vel,start:t0+n.start,dur:n.end-n.start});
 const end=Math.max(...S.notes.map(n=>n.end));S.playing={eng,t0,end};$('stop').disabled=false;status('Tocando…');const tick=()=>{if(!S.playing)return;S.head=c.currentTime-t0;if(S.head>end+1.5){stop();return;}draw();requestAnimationFrame(tick);};tick();}catch(e){status('Erro: '+(e.message||e));}}
function stop(){if(S.playing){try{S.playing.eng.bus.master.disconnect();}catch{}S.playing=null;}S.head=null;$('stop').disabled=true;draw();}
$('play').onclick=play;$('stop').onclick=stop;
$('vol').oninput=()=>{if(S.playing)S.playing.eng.bus.master.gain.value=+$('vol').value/100*1.1;};
$('wet').oninput=()=>{$('wetV').textContent=$('wet').value+'%';if(S.playing?.eng.bus.wet)S.playing.eng.bus.wet.gain.value=+$('wet').value/100;};
$('rv').onchange=()=>{$('irWrap').hidden=$('rv').value!=='user';};
$('fIR').onchange=async e=>{const f=e.target.files[0];if(!f)return;try{const c=new (window.AudioContext||window.webkitAudioContext)();S.userIR=await c.decodeAudioData(await f.arrayBuffer());c.close();status('IR carregado: '+f.name+' ('+S.userIR.duration.toFixed(1)+' s).');}catch(err){S.userIR=null;status('Não consegui ler o IR: use um WAV ou MP3.');}};
// ---------- exportar ----------
const fname=()=>(S.src?.name||'midi').replace(/\.[^.]+$/,'').replace(/[^\wÀ-ú -]+/g,'')||'midi';
function dl(blob,name){const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;document.body.append(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove();},2000);}
$('dlMidi').onclick=()=>{const inst=curInst();dl(new Blob([M.toMidiFile(S.notes,{bpm:S.bpm,drums:S.drumsMode||inst.kind==='drums',name:fname()})],{type:'audio/midi'}),fname()+'.mid');};
async function renderWav(){const buf=await M.renderOffline(S.notes,curInst(),{reverb:{kind:$('rv').value==='user'&&!S.userIR?'off':$('rv').value,wet:+$('wet').value/100,ir:S.userIR},volume:+$('vol').value/100*1.1});let pk=0;for(let c=0;c<buf.numberOfChannels;c++){const d=buf.getChannelData(c);for(let i=0;i<d.length;i++){const a=Math.abs(d[i]);if(a>pk)pk=a;}}if(pk>0.001&&pk<0.85){const g=0.89/pk;for(let c=0;c<buf.numberOfChannels;c++){const d=buf.getChannelData(c);for(let i=0;i<d.length;i++)d[i]*=g;}}return M.wav(buf);}
$('dlWav').onclick=async()=>{try{status('Gerando o áudio…');const b=await renderWav();dl(b,fname()+' - '+($('inst').selectedOptions[0].textContent.replace(/[^\wÀ-ú ]+/g,'').trim())+'.wav');status('Áudio gerado.');}catch(e){status('Erro ao gerar: '+(e.message||e));}};
$('toDaw').onclick=async()=>{try{status('Gerando o áudio para o Estúdio…');const blob=await renderWav();const db=await new Promise((ok,no)=>{const r=indexedDB.open('aps-stems-transfer-v1',1);r.onupgradeneeded=()=>{if(!r.result.objectStoreNames.contains('sessions'))r.result.createObjectStore('sessions');};r.onsuccess=()=>ok(r.result);r.onerror=()=>no(r.error);});
 await new Promise((ok,no)=>{const tx=db.transaction('sessions','readwrite');tx.objectStore('sessions').put({id:Date.now()+'',name:'APS MIDI',stems:[{id:'other',name:'MIDI · '+fname()+'.wav',type:'audio/wav',blob}],createdAt:Date.now()},'latest');tx.oncomplete=ok;tx.onerror=()=>no(tx.error);});db.close();location.href='./daw.html?modulo=gravacao&importStems=1';}catch(e){status('Não foi possível abrir no Estúdio: '+(e.message||e));}};
// ---------- importar áudio / MIDI ----------
async function setSource(name,buf){S.src={name,buf};$('srcInfo').textContent='Fonte: '+name+' · '+buf.duration.toFixed(1)+' s';$('go').disabled=false;$('detBpm').disabled=false;}
$('fAudio').onchange=async e=>{const f=e.target.files[0];e.target.value='';if(!f)return;try{status('Lendo '+f.name+'…');const buf=await ac().decodeAudioData(await f.arrayBuffer());await setSource(f.name,buf);status('Áudio carregado. Escolha o tipo de instrumento e toque em "Transformar em MIDI".');}catch(err){status('Não consegui ler '+f.name+(/\.m4p$/i.test(f.name)?': arquivos .m4p são protegidos (DRM).':': formato não suportado pelo navegador.'));}};
$('fMidi').onchange=async e=>{const f=e.target.files[0];e.target.value='';if(!f)return;try{const m=M.parseMidi(new Uint8Array(await f.arrayBuffer()));S.raw=m.notes.map(n=>({start:n.start,end:n.end,midi:n.midi,vel:n.vel}));S.drumsMode=m.drums;$('bpm').value=Math.round(m.bpm);S.src={name:f.name};$('srcInfo').textContent='MIDI: '+f.name+' · '+m.notes.length+' notas'+(m.drums?' (bateria)':'');$('strength').value=0;$('strV').textContent='0%';applyQuant();if(m.drums)$('inst').value='drums:aps-studio';status('MIDI carregado. Escolha o timbre e toque ▶ Ouvir.');}catch(err){status('Não consegui ler o MIDI: '+(err.message||err));}};
$('detBpm').onclick=()=>{if(!S.src?.buf)return;const x=mono(S.src.buf),sr=S.src.buf.sampleRate,tp=T.tempo(T.onsetEnv(x.subarray(0,Math.floor(Math.min(x.length,sr*150))),sr),{min:60,max:180});$('bpm').value=Math.round(tp.bpm);$('off').value=(tp.offset%(60/tp.bpm)).toFixed(3);status('Andamento estimado: '+Math.round(tp.bpm)+' BPM'+(tp.conf<1.15?' (incerto: confira de ouvido e ajuste)':'')+'.');if(S.raw.length)applyQuant();};
// ---------- áudio -> MIDI ----------
$('go').onclick=async()=>{if(!S.src?.buf)return;const btn=$('go');btn.disabled=true;try{const kind=$('kind').value,buf=S.src.buf,sr=buf.sampleRate,x=mono(buf);const t0=performance.now();S.drumsMode=kind==='drums';
  status(kind==='poly'?'Carregando a IA polifônica (só na primeira vez)…':'Lendo as notas…');let res;
  if(kind==='mono')res=await I.transcribeMono(x,sr,p=>status('Lendo as notas… '+Math.round((p>1?p/100:p)*100)+'%'));else if(kind==='poly')res=await I.transcribePoly(x,sr,p=>status('IA lendo as notas… '+Math.round((p>1?p/100:p)*100)+'%'));else res=await I.transcribeDrums(x,sr);
  S.raw=res.notes.map(n=>({start:n.start,end:kind==='drums'?n.start+.1:n.end,midi:kind==='drums'?(PIECE_MIDI[n.piece]||n.midi||38):n.midi,vel:n.vel??.8}));
  // andamento
  if(!$('bpm').dataset.user){try{const tp=T.tempo(T.onsetEnvFromNotes(S.raw.map(n=>({start:n.start,vel:n.vel})),buf.duration));$('bpm').value=Math.round(tp.bpm);$('off').value=(tp.offset%(60/Math.round(tp.bpm))).toFixed(3);}catch{}}
  if(kind==='drums')$('inst').value='drums:aps-studio';else if($('inst').value.startsWith('drums:'))$('inst').value='gm:acoustic_grand_piano:pluck';
  applyQuant();status('✅ '+S.raw.length+' notas em '+((performance.now()-t0)/1000).toFixed(1)+' s. Ajuste a quantização, edite no piano roll e escolha o timbre.');}catch(e){status('Não foi possível transformar em MIDI: '+(e.message||e));}finally{btn.disabled=false;}};
$('bpm').addEventListener('change',()=>{$('bpm').dataset.user='1';});
// ---------- gravar ao vivo ----------
let rec=null;
$('rec').onclick=async()=>{if(rec)return;try{const st=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false}});const c=ac();await c.resume();const src=c.createMediaStreamSource(st),an=c.createAnalyser();an.fftSize=4096;an.smoothingTimeConstant=0;src.connect(an);
  const bpm=+$('bpm').value||100,beat=60/bpm,metro=$('metro').checked,count=metro?4*beat:0,startAt=c.currentTime+.2,zero=startAt+count;
  const chunks=[],mr=new MediaRecorder(st);mr.ondataavailable=e=>chunks.push(e.data);mr.start();
  const live=new M.LiveMidi(c.sampleRate,{onEvent:ev=>{if(ev.type==='on'&&$('monitor').checked&&rec?.mon)rec.mon.sp.play({midi:ev.midi,vel:.8,start:c.currentTime+.005,dur:.4});}});
  let mon=null;if($('monitor').checked){mon=await buildEngine(c,[]);if(mon.sp.inst.kind==='gm')await mon.sp.load(mon.sp.inst,null);}
  const buf=new Float32Array(2048);let nextT=0;const t0=c.currentTime;
  const timer=setInterval(()=>{an.getFloatTimeDomainData(buf);const now=c.currentTime-zero-(buf.length/c.sampleRate);if(now<0&&!metro)return;let pk=0;for(const v of buf)pk=Math.max(pk,Math.abs(v));$('lvl').style.width=Math.min(100,pk*140)+'%';if(now<-0.05)return;live.process(Float32Array.from(buf),Math.max(0,now));},23);
  let mt=null;if(metro){let k=0;const tick=()=>{const t=startAt+k*beat;const o=c.createOscillator(),gg=c.createGain();o.frequency.value=k%4===0?1500:1000;gg.gain.setValueAtTime(.15,t);gg.gain.exponentialRampToValueAtTime(.001,t+.05);o.connect(gg).connect(c.destination);o.start(t);o.stop(t+.06);k++;};for(let i=0;i<64;i++)tick();}
  rec={st,mr,chunks,live,timer,zero,c,mon,t0,startAt};$('rec').disabled=true;$('recStop').disabled=false;status(metro?'Contagem… depois toque. Notas aparecem ao vivo.':'Gravando… toque. As notas são lidas em tempo real (uma de cada vez).');
  S.raw=[];S.notes=[];S.drumsMode=false;const upd=setInterval(()=>{if(!rec){clearInterval(upd);return;}S.raw=rec.live.notes.map(n=>({...n}));if(rec.live.cur)S.raw.push({start:rec.live.cur.start,end:c.currentTime-rec.zero,midi:rec.live.cur.midi,vel:.8});S.notes=S.raw;draw();info();},250);
 }catch(e){rec=null;status('Sem acesso ao microfone/entrada de áudio: '+(e.message||e));}};
$('recStop').onclick=async()=>{if(!rec)return;const r=rec;rec=null;clearInterval(r.timer);const end=r.c.currentTime-r.zero;const notes=r.live.finish(end);r.mr.onstop=async()=>{r.st.getTracks().forEach(t=>t.stop());try{const b=await ac().decodeAudioData(await new Blob(r.chunks).arrayBuffer());await setSource('Gravação ao vivo',b);}catch{}};r.mr.stop();
 $('rec').disabled=false;$('recStop').disabled=true;$('lvl').style.width='0';S.raw=notes.map(n=>({...n}));S.live=true;applyQuant();status('Gravação encerrada: '+notes.length+' notas lidas ao vivo (monofônico). Ajuste a quantização; para várias notas juntas, use "Transformar em MIDI" no modo polifônico com este áudio.');};
// ---------- amostras do usuário / SFZ ----------
const DRUMNAMES=[[/kick|bumbo|bombo|bd\b/i,36],[/snare|caixa|sd\b/i,38],[/rim/i,37],[/open|aberto|ohat|oh\b/i,46],[/hat|chimbal|hh\b/i,42],[/crash|ataque/i,49],[/ride|conduc/i,51],[/splash/i,55],[/floor|surdo/i,43],[/tom ?2|tom_?m|mid/i,47],[/tom/i,50]];
async function detectRoot(ab){try{const c=new (window.AudioContext||window.webkitAudioContext)();const b=await c.decodeAudioData(ab.slice(0));c.close();const x=b.getChannelData(0),a=Math.min(x.length-4096,Math.floor(b.sampleRate*.15)),seg=x.slice(Math.max(0,a),Math.max(0,a)+4096);const r=M.yin(seg,b.sampleRate,{fmin:40,fmax:2000});return r?Math.round(69+12*Math.log2(r.f/440)):60;}catch{return 60;}}
async function loadSamples(files){const sfz=files.find(f=>/\.sfz$/i.test(f.name)),audio=files.filter(f=>!/\.sfz$/i.test(f.name));const byName=new Map();for(const f of audio)byName.set(f.name.toLowerCase(),f);const rows=[];
 if(sfz){const regs=M.parseSfz(await sfz.text());for(const r of regs){const f=byName.get(r.file.toLowerCase());if(!f)continue;rows.push({name:f.name,audio:await f.arrayBuffer(),lokey:r.lokey,hikey:r.hikey,root:r.root,lovel:r.lovel,hivel:r.hivel,volume:r.volume,tune:r.tune,oneshot:r.oneshot,fixed:r.oneshot&&r.lokey===r.hikey});}status('SFZ lido: '+rows.length+' regiões ('+(regs.length-rows.length)+' sem arquivo de áudio correspondente).');}
 else{for(const f of audio){const ab=await f.arrayBuffer(),dn=DRUMNAMES.find(([re])=>re.test(f.name));if(dn){rows.push({name:f.name,audio:ab,lokey:dn[1],hikey:dn[1],root:dn[1],lovel:0,hivel:127,volume:0,tune:0,oneshot:true,fixed:true});continue;}
   let root=M.noteFromFilename(f.name);if(isNaN(root))root=await detectRoot(ab);rows.push({name:f.name,audio:ab,lokey:0,hikey:127,root,lovel:0,hivel:127,volume:0,tune:0,oneshot:false,fixed:false});}
  autoRanges(rows);status(rows.length+' amostras carregadas. Confira as notas e toque em "Usar estas amostras".');}
 S.samples=rows;drawSamples();}
function autoRanges(rows){const tuned=rows.filter(r=>!r.fixed),roots=[...new Set(tuned.map(r=>r.root))].sort((a,b)=>a-b);roots.forEach((rt,i)=>{const lo=i===0?0:Math.floor((roots[i-1]+rt)/2)+1,hi=i===roots.length-1?127:Math.floor((rt+roots[i+1])/2);for(const r of tuned.filter(x=>x.root===rt)){r.lokey=lo;r.hikey=hi;}});}
function drawSamples(){const t=$('samples');t.innerHTML='<tr><th>Arquivo</th><th>Nota raiz</th><th>Teclas</th><th>Velocidade</th><th>Pad</th></tr>';S.samples.forEach((r,i)=>{const tr=document.createElement('tr');tr.innerHTML='<td></td><td><input size="5"></td><td><input size="4"> – <input size="4"></td><td><input size="3"> – <input size="3"></td><td><input type="checkbox"></td>';tr.cells[0].textContent=r.name;const ins=tr.querySelectorAll('input');
  ins[0].value=M.noteName(r.root);ins[0].onchange=()=>{const v=M.parseNote(ins[0].value);if(!isNaN(v)){r.root=v;if(r.fixed){r.lokey=r.hikey=v;}else autoRanges(S.samples);drawSamples();}};
  ins[1].value=r.lokey;ins[2].value=r.hikey;ins[1].onchange=()=>r.lokey=+ins[1].value;ins[2].onchange=()=>r.hikey=+ins[2].value;ins[3].value=r.lovel;ins[4].value=r.hivel;ins[3].onchange=()=>r.lovel=+ins[3].value;ins[4].onchange=()=>r.hivel=+ins[4].value;
  ins[5].checked=!!r.fixed;ins[5].onchange=()=>{r.fixed=ins[5].checked;r.oneshot=r.fixed;if(r.fixed){r.lokey=r.hikey=r.root;}else autoRanges(S.samples);drawSamples();};t.append(tr);});
 $('useSamples').disabled=!S.samples.length;$('autoVel').disabled=!S.samples.length;}
$('fSamples').onchange=async e=>{const fs=[...e.target.files];e.target.value='';if(fs.length)try{await loadSamples(fs);}catch(err){status('Erro ao ler as amostras: '+(err.message||err));}};
$('autoVel').onclick=()=>{const groups=new Map();for(const r of S.samples){const k=r.fixed?'p'+r.root:'n'+r.root;(groups.get(k)||groups.set(k,[]).get(k)).push(r);}let n=0;for(const arr of groups.values()){if(arr.length<2)continue;n++;arr.forEach((r,i)=>{r.lovel=Math.round(i*128/arr.length);r.hivel=Math.round((i+1)*128/arr.length)-1;});}drawSamples();status(n?'Camadas de velocidade distribuídas em '+n+' grupo(s): a 1ª amostra = toque suave, a última = forte.':'Nenhuma nota tem mais de uma amostra para dividir em camadas.');};
$('useSamples').onclick=()=>{S.userInst={kind:'regions',name:'Minhas amostras',regions:S.samples.map(r=>({...r,audio:r.audio.slice(0),buf:null}))};const o=$('optUser');o.disabled=false;$('inst').value='user';S.aud=null;status('Usando as suas amostras ('+S.samples.length+'). Toque numa nota do piano roll ou ▶ Ouvir.');};
// ---------- partida ----------
fillInst();draw();info();
window.APSMidiApp={S,applyQuant,play,stop,draw,curInst,loadSamples,renderWav};
// vindo da DAW: pista enviada para virar MIDI
(async()=>{if(!/[?&]import=1/.test(location.search)||!window.indexedDB)return;try{const db=await new Promise((ok,no)=>{const r=indexedDB.open('aps-midi-handoff-v1',1);r.onupgradeneeded=()=>r.result.createObjectStore('sessions');r.onsuccess=()=>ok(r.result);r.onerror=()=>no(r.error);});const v=await new Promise((ok,no)=>{const q=db.transaction('sessions').objectStore('sessions').get('latest');q.onsuccess=()=>ok(q.result);q.onerror=()=>no(q.error);});db.close();if(v?.blob){const buf=await ac().decodeAudioData(await v.blob.arrayBuffer());await setSource(v.name||'Pista do Estúdio',buf);if(v.bpm){$('bpm').value=Math.round(v.bpm);$('bpm').dataset.user='1';}status('Pista recebida do Estúdio. Escolha o tipo de instrumento e toque em "Transformar em MIDI".');if(v.kind&&['mono','poly','drums'].includes(v.kind)){$('kind').value=v.kind;$('go').click();}}}catch(e){status('Não consegui receber a pista do Estúdio.');}})();
})();
