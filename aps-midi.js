/* APS MIDI Sampler — núcleo: quantização, arquivo MIDI (ler/gravar), detector de altura em tempo real (monofônico),
 * reverbs por convolução (IRs embutidos + IR do usuário), importação SFZ e motor de sampler (GM, bateria, amostras do usuário,
 * camadas de velocidade). Tudo no aparelho (Web Audio). Criado para o APS Audio Engine. */
(function(root){'use strict';
const NOTE_PT=['Dó','Dó#','Ré','Ré#','Mi','Fá','Fá#','Sol','Sol#','Lá','Lá#','Si'],NOTE_EN=['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const noteName=m=>NOTE_PT[((m%12)+12)%12]+(Math.floor(m/12)-1);
// "C4", "c#3", "Db2", "Dó4", "Sol#3", "60" -> midi (C4 = 60)
function parseNote(s){s=String(s).trim();if(/^-?\d+$/.test(s))return +s;const pt={'do':0,'dó':0,'re':2,'ré':2,'mi':4,'fa':5,'fá':5,'sol':7,'la':9,'lá':9,'si':11};
 let m=s.match(/^(do|dó|re|ré|mi|fa|fá|sol|la|lá|si)([#b]?)(-?\d)$/i);if(m)return pt[m[1].toLowerCase()]+(m[2]==='#'?1:m[2]==='b'?-1:0)+12*(+m[3]+1);
 m=s.match(/^([A-Ga-g])([#b]?)(-?\d)$/);if(m){const b={c:0,d:2,e:4,f:5,g:7,a:9,b:11}[m[1].toLowerCase()];return b+(m[2]==='#'?1:m[2]==='b'?-1:0)+12*(+m[3]+1);}return NaN;}
function noteFromFilename(name){const base=String(name).replace(/\.[^.]+$/,'');const m=base.match(/(?:^|[^A-Za-z])((?:[A-Ga-g][#b]?|do|dó|re|ré|mi|fa|fá|sol|la|lá|si)[#b]?-?\d)(?:[^0-9]|$)/i);return m?parseNote(m[1]):NaN;}
// ---------- quantização ----------
const GRIDS={'1/4':1,'1/8':2,'1/16':4,'1/32':8,'1/4T':1.5,'1/8T':3,'1/16T':6};// divisões por semínima
function quantize(notes,{bpm=120,offset=0,grid='1/16',strength=100,quantizeEnd=true,minSteps=1}={}){
 const div=GRIDS[grid]||4,q=60/bpm/div,k=Math.max(0,Math.min(100,strength))/100;
 const snap=t=>Math.round((t-offset)/q)*q+offset;
 const out=notes.map(n=>{const s0=n.start,e0=n.end,s1=snap(s0),s=s0+(s1-s0)*k;let e=e0;if(quantizeEnd){let e1=snap(e0);if(e1<=s1+q*(minSteps-.5))e1=s1+q*minSteps;e=e0+(e1-e0)*k;}else e=e0+(s-s0);
  if(e<=s)e=s+Math.min(q,.05);return{...n,start:Math.max(0,s),end:Math.max(s+.01,e)};});
 out.sort((a,b)=>a.start-b.start||a.midi-b.midi);return out;}
// ---------- arquivo MIDI ----------
const vlq=n=>{const b=[n&127];while(n>>=7)b.unshift((n&127)|128);return b;};
function toMidiFile(notes,{bpm=120,ppq=480,drums=false,program=0,name='APS MIDI'}={}){const ch=drums?9:0,tps=ppq*bpm/60,ev=[];
 for(const n of notes){const v=Math.max(1,Math.min(127,Math.round((n.vel??.8)*127))),a=Math.round(n.start*tps),b=Math.max(a+1,Math.round(n.end*tps));ev.push([a,1,n.midi,v],[b,0,n.midi,0]);}
 ev.sort((x,y)=>x[0]-y[0]||x[1]-y[1]);const us=Math.round(6e7/bpm),nm=[...new TextEncoder().encode(name)];
 const d=[0,255,3,...vlq(nm.length),...nm,0,255,81,3,us>>16&255,us>>8&255,us&255,0,255,88,4,4,2,24,8];if(!drums)d.push(0,0xC0|ch,program);let last=0;
 for(const e of ev){d.push(...vlq(e[0]-last),(e[1]?0x90:0x80)|ch,e[2],e[3]);last=e[0];}d.push(0,255,47,0);
 return new Uint8Array([77,84,104,100,0,0,0,6,0,0,0,1,ppq>>8,ppq&255,77,84,114,107,d.length>>>24&255,d.length>>16&255,d.length>>8&255,d.length&255,...d]);}
function parseMidi(u8){let p=0;const r32=()=>(u8[p++]<<24|u8[p++]<<16|u8[p++]<<8|u8[p++])>>>0,r16=()=>u8[p++]<<8|u8[p++];
 if(String.fromCharCode(...u8.slice(0,4))!=='MThd')throw Error('Não é um arquivo MIDI.');p=4;r32();r16();const nt=r16(),div=r16();if(div&0x8000)throw Error('MIDI com tempo SMPTE não é suportado.');
 const tempos=[[0,500000]],raw=[];
 for(let t=0;t<nt;t++){if(String.fromCharCode(...u8.slice(p,p+4))!=='MTrk')break;p+=4;const len=r32(),end=p+len;let tick=0,run=0;const on=new Map();
  const rv=()=>{let v=0,b;do{b=u8[p++];v=(v<<7)|(b&127);}while(b&128);return v;};
  while(p<end){tick+=rv();let st=u8[p];if(st&128){p++;run=st;}else st=run;if(st===0xFF){const ty=u8[p++],l=rv();if(ty===0x51)tempos.push([tick,u8[p]<<16|u8[p+1]<<8|u8[p+2]]);p+=l;}else if(st===0xF0||st===0xF7){p+=rv();}
   else{const c=st&15,k=st&0xF0,a=u8[p++],b=(k===0xC0||k===0xD0)?0:u8[p++];
    if(k===0x90&&b>0)on.set(c+':'+a,[tick,b]);else if(k===0x80||(k===0x90&&b===0)){const o=on.get(c+':'+a);if(o){raw.push({a:o[0],b:Math.max(tick,o[0]+1),midi:a,vel:o[1]/127,ch:c});on.delete(c+':'+a);}}}}p=end;}
 tempos.sort((x,y)=>x[0]-y[0]);const toSec=tk=>{let s=0,lt=0,us=500000;for(const[tt,u]of tempos){if(tt>=tk)break;s+=(tt-lt)*us/1e6/div;lt=tt;us=u;}return s+(tk-lt)*us/1e6/div;};
 const notes=raw.map(n=>({start:toSec(n.a),end:toSec(n.b),midi:n.midi,vel:n.vel,drum:n.ch===9})).sort((x,y)=>x.start-y.start||x.midi-y.midi);
 return{bpm:Math.round(6e7/tempos[0][1]*100)/100,notes,drums:notes.length>0&&notes.filter(n=>n.drum).length>notes.length/2};}
// ---------- detector de altura em tempo real (YIN) ----------
function yin(x,sr,{fmin=60,fmax=1400,thr=.15}={}){const W=x.length>>1,tmax=Math.min(W-1,Math.floor(sr/fmin)),tmin=Math.max(2,Math.floor(sr/fmax)),d=new Float32Array(tmax+1);
 for(let t=1;t<=tmax;t++){let s=0;for(let i=0;i<W;i++){const v=x[i]-x[i+t];s+=v*v;}d[t]=s;}
 let run=0;const cm=new Float32Array(tmax+1);cm[0]=1;for(let t=1;t<=tmax;t++){run+=d[t];cm[t]=run>0?d[t]*t/run:1;}
 let t=tmin;while(t<=tmax){if(cm[t]<thr){while(t+1<=tmax&&cm[t+1]<cm[t])t++;break;}t++;}if(t>tmax)return null;
 const a=cm[t-1]??cm[t],b=cm[t],c=cm[t+1]??cm[t],den=a+c-2*b,sh=den?(a-c)/(2*den):0,tau=t+sh;return{f:sr/tau,clarity:1-cm[t]};}
class LiveMidi{// alimente com blocos de áudio (Float32Array) e o tempo (s) do início do bloco; recebe notas por callback
 constructor(sr,{onNote,onEvent,gateDb=-46,hop=null}={}){this.sr=sr;this.onNote=onNote;this.onEvent=onEvent;this.gate=Math.pow(10,gateDb/20);this.cur=null;this.hist=[];this.silent=0;this.prevRms=0;this.peak=.05;this.notes=[];this.frames=0;}
 process(x,t0){const sr=this.sr,rms=Math.sqrt(x.reduce((s,v)=>s+v*v,0)/x.length);this.peak=Math.max(this.peak*.9995,rms);const p=rms>this.gate?yin(x,sr):null;let midi=null;
  if(p&&p.clarity>.55){midi=69+12*Math.log2(p.f/440);}
  const tm=t0+x.length/sr*.25;// instante representativo do começo do quadro
  if(midi==null){this.silent++;if(this.cur&&this.silent>=2)this.end(tm);this.prevRms=rms;this.hist=[];return;}
  this.silent=0;this.hist.push(midi);if(this.hist.length>5)this.hist.shift();const med=[...this.hist].sort((a,b)=>a-b)[this.hist.length>>1],r=Math.round(med);
  const attack=rms>this.prevRms*2.3&&rms>this.gate*2.5;
  if(!this.cur){if(this.hist.length>=2)this.begin(r,tm-x.length/sr*.25,rms);}
  else if(Math.abs(r-this.cur.midi)>=1&&this.hist.length>=3&&this.hist.slice(-3).every(h=>Math.round(h)===r)){this.end(tm);this.begin(r,tm,rms);}
  else if(attack&&this.cur&&tm-this.cur.start>.09){this.end(tm);this.begin(r,tm,rms);}
  else if(this.cur)this.cur.rmsMax=Math.max(this.cur.rmsMax,rms);
  this.prevRms=rms;}
 begin(midi,t,rms){this.cur={midi,start:Math.max(0,t),rmsMax:rms};this.onEvent?.({type:'on',midi,t:this.cur.start});}
 end(t){const c=this.cur;this.cur=null;if(!c)return;if(t-c.start<.05)return;const db=20*Math.log10(Math.max(c.rmsMax,1e-5)/Math.max(this.peak,1e-5)),vel=Math.max(.2,Math.min(1,(db+30)/30*.7+.3));const n={start:c.start,end:t,midi:c.midi,vel};this.notes.push(n);this.onNote?.(n);this.onEvent?.({type:'off',midi:c.midi,t});}
 finish(t){if(this.cur)this.end(t);return this.notes;}}
// ---------- reverb por convolução ----------
function makeIR(ac,kind='sala'){const P={sala:{rt:.55,pre:.004,damp:.55,wid:1},estudio:{rt:.3,pre:.002,damp:.4,wid:.8},igreja:{rt:2.8,pre:.02,damp:.75,wid:1},hall:{rt:1.8,pre:.015,damp:.65,wid:1},placa:{rt:1.4,pre:.001,damp:.25,wid:1}}[kind]||{rt:.8,pre:.005,damp:.5,wid:1};
 const sr=ac.sampleRate,N=Math.floor((P.rt*1.3+P.pre)*sr),buf=ac.createBuffer(2,N,sr);let seed=kind.length*7919+13;const rnd=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296*2-1;};
 for(let c=0;c<2;c++){const d=buf.getChannelData(c);let lp=0;const pre=Math.floor(P.pre*sr);for(let i=pre;i<N;i++){const t=(i-pre)/sr,env=Math.exp(-6.9*t/P.rt),a=Math.min(1,P.damp+t*.3);lp+=(rnd()-lp)*(1-a*.92);d[i]=lp*env*(i<pre+sr*.003?(i-pre)/(sr*.003):1)*3;}}
 return buf;}
const IR_KINDS={sala:'Sala média',estudio:'Estúdio (curto)',placa:'Placa (brilhante)',hall:'Hall',igreja:'Igreja (longo)'};
// ---------- SFZ ----------
function parseSfz(text,fileNames=[]){const regs=[];let grp={},def='';const nm=s=>{const v=parseNote(s);return isNaN(v)?+s:v;};
 const toks=text.replace(/\/\/.*$/gm,'').split(/(<\w+>)/);let cur=null,kind='';
 for(const t of toks){if(/^<\w+>$/.test(t)){kind=t.slice(1,-1);if(kind==='group')grp={};if(kind==='region')cur={...grp,_g:true};if(kind==='control')cur=null;continue;}
  const target=kind==='region'?cur:kind==='group'?grp:kind==='control'?{}:null;if(!target&&kind!=='control')continue;
  const re=/(\w+)=((?:(?!\s\w+=).)+)/g;let m;const src=target||{};while((m=re.exec(t.trim()))){const k=m[1],v=m[2].trim();if(kind==='control'&&k==='default_path')def=v;else src[k]=v;}
  if(kind==='region'&&cur&&!regs.includes(cur))regs.push(cur);}
 return regs.filter(r=>r.sample).map(r=>{const key=r.key!=null?nm(r.key):null,lo=key!=null?key:(r.lokey!=null?nm(r.lokey):0),hi=key!=null?key:(r.hikey!=null?nm(r.hikey):127),root=r.pitch_keycenter!=null?nm(r.pitch_keycenter):(key!=null?key:60);
  const file=(def+r.sample).replace(/\\/g,'/').split('/').pop();return{file,lokey:lo,hikey:hi,root,lovel:r.lovel!=null?+r.lovel:0,hivel:r.hivel!=null?+r.hivel:127,volume:r.volume!=null?+r.volume:0,tune:r.tune!=null?+r.tune:0,oneshot:r.loop_mode==='one_shot'||key!=null};});}
// ---------- sampler ----------
const GM=[['acoustic_grand_piano','Piano de cauda','pluck'],['electric_piano_1','Piano elétrico','pluck'],['accordion','Sanfona','sustain'],['tango_accordion','Acordeão (tango)','sustain'],['harmonica','Gaita (harmônica)','sustain'],
 ['string_ensemble_1','Cordas (orquestra)','sustain'],['violin','Violino','sustain'],['cello','Violoncelo','sustain'],['acoustic_guitar_nylon','Violão nylon','pluck'],['acoustic_guitar_steel','Violão aço','pluck'],['electric_guitar_clean','Guitarra limpa','pluck'],
 ['electric_bass_finger','Baixo elétrico','pluck'],['acoustic_bass','Contrabaixo acústico','pluck'],['drawbar_organ','Órgão (drawbar)','sustain'],['church_organ','Órgão de igreja','sustain'],['alto_sax','Sax alto','sustain'],['tenor_sax','Sax tenor','sustain'],['clarinet','Clarinete','sustain'],
 ['flute','Flauta','sustain'],['trumpet','Trompete','sustain'],['trombone','Trombone','sustain'],['brass_section','Metais','sustain'],['marimba','Marimba','pluck'],['vibraphone','Vibrafone','pluck'],['choir_aahs','Coro','sustain'],['lead_2_sawtooth','Synth lead','sustain']];
const FONTS=new Map();
async function loadFont(id,ac,base='./vendor/soundfonts/FluidR3_GM/'){let f=FONTS.get(id);if(!f){const r=await fetch(base+id+'.json');if(!r.ok)throw Error('Timbre não encontrado: '+id);f={json:await r.json(),raw:new Map(),dec:new Map()};FONTS.set(id,f);}
 const roots=Object.keys(f.json.notes).map(Number);return{roots,get:async(root)=>{if(!f.dec.has(root)){const bin=atob(f.json.notes[root]),u=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)u[i]=bin.charCodeAt(i);f.dec.set(root,u.buffer);}return f.dec.get(root);}};}
const DRUMMAP={36:['kick'],35:['kick'],37:['rim'],38:['snare'],40:['snare'],42:['hat'],44:['pedal','hat'],46:['open','hat'],49:['crash'],57:['crash'],51:['ride'],53:['ride'],59:['ride'],55:['splash'],41:['floor'],43:['floor'],45:['tom2'],47:['tom2'],48:['tom1'],50:['tom1']};
const PIECE_NOTE={kick:36,rim:37,snare:38,hat:42,pedal:44,open:46,crash:49,ride:51,splash:55,floor:43,tom2:47,tom1:50};
const dec=async(ac,ab)=>ac.decodeAudioData(ab.slice(0));
function kitPieces(kits,id){let K=kits[id];if(id==='combo'&&kits['aps-acustico']&&kits['aps-studio'])K={pieces:{...kits['aps-studio'].pieces,...kits['aps-acustico'].pieces}};if(!K)return null;const pieces={};for(const[p0,arr0]of Object.entries(K.pieces)){if(p0==='hat'){const pd=arr0.filter(a=>/p[ée]\b/i.test(a.label||'')),cl=arr0.filter(a=>!pd.includes(a));if(pd.length)pieces.pedal=pd;pieces.hat=cl.length?cl:arr0;}else pieces[p0]=arr0;}return pieces;}
class Sampler{// um instrumento carregado para um AudioContext (real ou offline)
 constructor(ac,dest){this.ac=ac;this.dest=dest;this.inst=null;this.bufs=new Map();}
 async load(inst,needed=null){const ac=this.ac;this.inst=inst;this.bufs=new Map();
  if(inst.kind==='gm'){const f=await loadFont(inst.id,ac);this.font=f;const want=new Set((needed||f.roots).map(m=>f.roots.reduce((a,b)=>Math.abs(b-m)<Math.abs(a-m)?b:a)));for(const r of want){const db=await dec(ac,await f.get(r)),x=db.getChannelData(0);let pk=0;for(let i=0;i<Math.min(x.length,8000);i++)pk=Math.max(pk,Math.abs(x[i]));let k=0;while(k<x.length&&Math.abs(x[k])<pk*.02)k++;db.__lead=Math.max(0,(k-8)/db.sampleRate);this.bufs.set(r,db);}}
  else if(inst.kind==='drums'){const kits=await (await fetch('./kits/kits.json')).json();const pieces=kitPieces(kits,inst.kit);if(!pieces)throw Error('Kit não encontrado.');this.kit={};this.labels={};for(const[p,arr]of Object.entries(pieces)){if(inst.piece&&inst.piece!==p)continue;this.kit[p]=[];this.labels[p]=[];arr.forEach((a,ai)=>{if(inst.sampleIdx!=null&&inst.sampleIdx>=0&&inst.piece===p&&ai!==inst.sampleIdx)return;this.labels[p].push(a.label||a.file);});for(const[ai,a]of arr.entries()){if(inst.sampleIdx!=null&&inst.sampleIdx>=0&&inst.piece===p&&ai!==inst.sampleIdx)continue;try{const r=await fetch('./'+a.file);const db=await dec(ac,await r.arrayBuffer());const x=db.getChannelData(0);let pk=0;for(let i=0;i<Math.min(x.length,20000);i++)pk=Math.max(pk,Math.abs(x[i]));let k=0;while(k<x.length&&Math.abs(x[k])<pk*.03)k++;db.__lead=Math.max(0,(k-4)/db.sampleRate);this.kit[p].push(db);}catch{}}}}
  else if(inst.kind==='regions'){for(const r of inst.regions){if(r.audio&&!r.buf)r.buf=await dec(ac,r.audio);this.bufs.set(r,r.buf);}}
  return this;}
 // toca uma nota: n={midi,vel(0..1),start,dur}
 play(n,at=n.start){const ac=this.ac,inst=this.inst,v=Math.max(.05,Math.min(1,n.vel??.8)),g=ac.createGain(),dest=this.dest;g.connect(dest);
  const shape=(s,len,rel,kind,base,vel)=>{};void shape;
  if(inst.kind==='gm'){const f=this.font,m=n.midi+(inst.transpose||0),r=f.roots.reduce((a,b)=>Math.abs(b-m)<Math.abs(a-m)?b:a),b=this.bufs.get(r)||[...this.bufs.values()][0],s=ac.createBufferSource(),rate=Math.pow(2,(m-r)/12+(n.fine||0)/1200),d=Math.max(.05,n.dur),pluck=inst.style==='pluck',rel=pluck?.35:.12;
   s.buffer=b;s.playbackRate.value=rate;if(!pluck&&d>b.duration*.7){s.loop=true;s.loopStart=b.duration*.35;s.loopEnd=b.duration*.85;}
   // camadas de velocidade (emuladas): ganho em curva + filtro mais aberto quando toca forte
   const lp=ac.createBiquadFilter();lp.type='lowpass';lp.frequency.value=1800+Math.pow(v,1.3)*16000;lp.Q.value=.3;s.connect(lp).connect(g);
   const gain=Math.pow(v,1.25)*(pluck?.95:.8);g.gain.setValueAtTime(0,at);g.gain.linearRampToValueAtTime(gain,at+.004);g.gain.setValueAtTime(gain,at+d);g.gain.linearRampToValueAtTime(0,at+d+rel);s.start(at,b.__lead||0);s.stop(at+d+rel+.05);return;}
  if(inst.kind==='drums'){const lst=DRUMMAP[n.midi]||['snare'];if(inst.piece&&!lst.includes(inst.piece))return;const piece=lst.find(p=>this.kit[p]?.length);if(!piece)return;const arr=this.kit[piece];if(!arr?.length)return;
   // camadas de velocidade (golpes mais fortes usam as amostras mais fortes) + round-robin dentro de cada faixa
   const sorted=arr.length>1?[...arr].sort((a,b)=>energy(a)-energy(b)):arr,T=Math.max(1,Math.min(3,Math.ceil(sorted.length/2))),per=sorted.length/T,tier=Math.min(T-1,Math.floor(Math.pow(v,.9)*T)),lo=Math.floor(tier*per),hi=Math.max(lo+1,Math.floor((tier+1)*per)),rr=(this.rr=this.rr||{}),c=rr[piece]=((rr[piece]||0)+1),b=sorted[Math.min(sorted.length-1,lo+(c%(hi-lo)))],s=ac.createBufferSource();s.buffer=b;if(n.fine)s.playbackRate.value=Math.pow(2,n.fine/1200);g.gain.value=.35+v*.75;s.connect(g);s.start(at,b.__lead||0);return;}
  if(inst.kind==='regions'){const vel=Math.round(v*127),rs=inst.regions.filter(r=>n.midi>=r.lokey&&n.midi<=r.hikey&&vel>=r.lovel&&vel<=r.hivel);const r=rs[0]||inst.regions.reduce((a,b)=>Math.abs(b.root-n.midi)<Math.abs(a.root-n.midi)?b:a,inst.regions[0]);if(!r?.buf)return;
   const s=ac.createBufferSource();s.buffer=r.buf;s.playbackRate.value=Math.pow(2,((n.midi-r.root)*(r.fixed?0:1)+((r.tune||0)+(n.fine||0))/100)/12);g.gain.value=Math.pow(10,(r.volume||0)/20)*(.4+v*.7);s.connect(g);const d=Math.max(.05,n.dur);
   if(!r.oneshot){g.gain.setValueAtTime(g.gain.value,at+d);g.gain.linearRampToValueAtTime(0,at+d+.15);s.start(at);s.stop(at+d+.2);}else s.start(at);return;}}
}
// camadas: vários instrumentos/conjuntos de amostras numa mesma trilha MIDI. Cada camada: volume, pan, transposição, ajuste fino,
// faixa de teclas (split) e faixa de velocidade. inst={kind:'layers',layers:[{inst,vol,pan,trans,fine,lokey,hikey,lovel,hivel,mute}]}
class LayerSampler{
 constructor(ac,dest){this.ac=ac;this.dest=dest;this.subs=[];this.inst=null;}
 async load(inst,needed=null){const ac=this.ac;this.inst=inst;this.subs=[];
  for(const L of inst.layers||[]){if(L.mute||!L.inst)continue;const g=ac.createGain();g.gain.value=Math.max(0,L.vol??1);let out=g;if(ac.createStereoPanner){const p=ac.createStereoPanner();p.pan.value=Math.max(-1,Math.min(1,L.pan||0));g.connect(p);out=p;}out.connect(this.dest);
   const sp=new Sampler(ac,g),sub=L.inst,sh=(L.trans||0)+(sub.transpose||0);await sp.load(sub,sub.kind==='gm'&&needed?[...new Set(needed.map(m=>m+sh))]:null);this.subs.push({L,sp,sh});}
  return this;}
 play(n,at=n.start){const vel=Math.round((n.vel??.8)*127);for(const{L,sp}of this.subs){if(n.midi<(L.lokey??0)||n.midi>(L.hikey??127)||vel<(L.lovel??0)||vel>(L.hivel??127))continue;const isDr=L.inst.kind==='drums',sub=L.inst;sp.play({...n,midi:isDr?n.midi:n.midi+(L.trans||0),fine:L.fine||0},at);}}
 get kit(){return null;}
}
const ENERGY=new WeakMap();function energy(b){let e=ENERGY.get(b);if(e==null){const x=b.getChannelData(0);e=0;for(let i=0;i<Math.min(x.length,6000);i++)e+=x[i]*x[i];ENERGY.set(b,e);}return e;}
// cadeia: instrumento -> (seco + reverb) -> master
function fitBuf(ac,b){if(!b||b.sampleRate===ac.sampleRate)return b;const r=ac.sampleRate/b.sampleRate,n=Math.max(1,Math.round(b.length*r)),o=ac.createBuffer(Math.min(2,b.numberOfChannels),n,ac.sampleRate);for(let c=0;c<o.numberOfChannels;c++){const s=b.getChannelData(c),d=o.getChannelData(c);for(let i=0;i<n;i++){const p=i/r,k=Math.floor(p),f=p-k;d[i]=(s[k]||0)*(1-f)+(s[Math.min(k+1,s.length-1)]||0)*f;}}return o;}
function makeBus(ac,{reverb={kind:'off',wet:.25,ir:null},volume=.9}={}){const master=ac.createGain();master.gain.value=volume;master.connect(ac.destination);const inp=ac.createGain();
 const dry=ac.createGain();inp.connect(dry).connect(master);let wet=null,conv=null;
 if(reverb&&reverb.kind&&reverb.kind!=='off'){conv=ac.createConvolver();conv.buffer=reverb.kind==='user'&&reverb.ir?fitBuf(ac,reverb.ir):makeIR(ac,reverb.kind);wet=ac.createGain();wet.gain.value=reverb.wet??.25;inp.connect(conv).connect(wet).connect(master);dry.gain.value=1-.35*(reverb.wet??.25);}
 return{input:inp,master,conv,wet};}
async function renderOffline(notes,inst,{reverb,volume,sr=44100,tail=2.5}={}){const AC=root.OfflineAudioContext||root.webkitOfflineAudioContext,end=Math.max(1,...notes.map(n=>n.end))+tail,ac=new AC(2,Math.ceil(end*sr),sr),bus=makeBus(ac,{reverb,volume}),S=inst.kind==='layers'?new LayerSampler(ac,bus.input):new Sampler(ac,bus.input);
 await S.load(inst,inst.kind==='layers'?[...new Set(notes.map(n=>n.midi))]:inst.kind==='gm'?[...new Set(notes.map(n=>n.midi+(inst.transpose||0)))]:null);for(const n of notes)S.play({midi:n.midi,vel:n.vel,start:n.start,dur:n.end-n.start});return ac.startRendering();}
function wav(buf){const ch=Math.min(2,buf.numberOfChannels),n=buf.length,sr=buf.sampleRate,ab=new ArrayBuffer(44+n*ch*2),v=new DataView(ab),w=(o,s)=>{for(let i=0;i<s.length;i++)v.setUint8(o+i,s.charCodeAt(i));};let pk=0;const C=[...Array(ch)].map((_,c)=>buf.getChannelData(c));for(const x of C)for(let i=0;i<n;i++)pk=Math.max(pk,Math.abs(x[i]));const g=pk>.98?.98/pk:1;
 w(0,'RIFF');v.setUint32(4,36+n*ch*2,true);w(8,'WAVE');w(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,ch,true);v.setUint32(24,sr,true);v.setUint32(28,sr*ch*2,true);v.setUint16(32,ch*2,true);v.setUint16(34,16,true);w(36,'data');v.setUint32(40,n*ch*2,true);
 let o=44;for(let i=0;i<n;i++)for(let c=0;c<ch;c++){const s=Math.max(-1,Math.min(1,C[c][i]*g));v.setInt16(o,s*32767,true);o+=2;}return new Blob([ab],{type:'audio/wav'});}
root.APSMidi={noteName,parseNote,noteFromFilename,GRIDS,quantize,toMidiFile,parseMidi,yin,LiveMidi,makeIR,IR_KINDS,parseSfz,GM,kitPieces,Sampler,LayerSampler,makeBus,renderOffline,wav,PIECE_NOTE,DRUMMAP};
})(typeof window!=='undefined'?window:globalThis);
