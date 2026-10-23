/* APS Audio Engine 3.7.0 — pós-processamento de transcrição (Partituras). Criado por Anderclay Pereira Silva. */
(function(root){'use strict';
const PROF={maior:[6.35,2.23,3.48,2.33,4.38,4.09,2.52,5.19,2.39,3.66,2.29,2.88],menor:[6.33,2.68,3.52,5.38,2.6,3.53,2.54,4.75,3.98,2.69,3.34,3.17]};
const FIFTHS_MAJ={0:0,7:1,2:2,9:3,4:4,11:5,6:6,1:-5,8:-4,3:-3,10:-2,5:-1};
const SH=['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'],FL=['C','Db','D','Eb','E','F','Gb','G','Ab','A','Bb','B'];
const PTN={C:'Dó',D:'Ré',E:'Mi',F:'Fá',G:'Sol',A:'Lá',B:'Si'};
const INSTR={
 voz:{n:'Voz',clef:'treble',mode:'mono',lo:45,hi:84,prog:53,wr:0},
 baixo:{n:'Contrabaixo',clef:'bass',mode:'mono',lo:23,hi:67,prog:33,wr:12,tab:[28,33,38,43]},
 guitarra:{n:'Guitarra/Violão',clef:'treble',oct8vb:true,mode:'poly',lo:40,hi:88,prog:25,wr:12,harm:[12,19,24],tab:[40,45,50,55,59,64]},
 teclado:{n:'Piano/Teclado',clef:'treble',mode:'poly',lo:21,hi:108,prog:0,wr:0,split:true},
 sopro:{n:'Sopro (sax/trompete/flauta)',clef:'treble',mode:'mono',lo:46,hi:96,prog:65,wr:0},
 cordas:{n:'Cordas',clef:'treble',mode:'poly',lo:36,hi:100,prog:48,wr:0},
 bateria:{n:'Bateria',clef:'percussion',mode:'drums',lo:0,hi:127,prog:0,wr:0}
};
function median(a){if(!a.length)return 0;const s=[...a].sort((x,y)=>x-y);return s[s.length>>1];}
// ---------- andamento: autocorrelação do fluxo de energia + fase ----------
function onsetEnv(x,sr){const hop=Math.round(sr*.01),w=hop*2,n=Math.floor((x.length-w)/hop);const e=new Float32Array(Math.max(0,n)),o=new Float32Array(Math.max(0,n));let prev=0;
 for(let k=0;k<n;k++){let s=0;for(let i=k*hop;i<k*hop+w;i++)s+=x[i]*x[i];const v=Math.log(1e-6+Math.sqrt(s/w));e[k]=v;o[k]=k?Math.max(0,v-prev):0;prev=v;}
 // remove média local
 const m=new Float32Array(n);let acc=0;for(let k=0;k<n;k++){acc+=o[k];if(k>=50)acc-=o[k-50];m[k]=Math.max(0,o[k]-acc/Math.min(k+1,50));}return{o:m,hop:hop/sr};}
function onsetEnvFromNotes(notes,dur){const hop=.01,n=Math.ceil(dur/hop)+2,o=new Float32Array(n);for(const t of notes){const k=Math.round(t.start/hop);if(k<n)o[k]+=(t.vel||.7);}return{o,hop};}
function tempo(env,{min=60,max=180}={}){const{o,hop}=env,n=o.length;if(n<100)return{bpm:120,offset:0,conf:0};
 // suaviza
 const g=new Float32Array(n);for(let k=0;k<n;k++){if(!o[k])continue;for(let j=-3;j<=3;j++){const i=k+j;if(i>=0&&i<n)g[i]+=o[k]*Math.exp(-j*j/4);}}
 let tot=0;for(const v of g)tot+=v;const sc=[];
 for(let bpm=min;bpm<=max;bpm+=.25){const per=60/bpm/hop;let best=0,bph=0;const steps=Math.max(8,Math.round(per/2));for(let s=0;s<steps;s++){const ph=s*per/steps;let a=0,c=0;for(let t=ph;t<n;t+=per){a+=g[Math.round(t)]||0;a+=.5*(g[Math.round(t+per/2)]||0);c++;}const v=a/Math.max(1,c);if(v>best){best=v;bph=ph;}}
  const pri=Math.exp(-.5*Math.pow(Math.log2(bpm/105)/1.2,2));sc.push({bpm,s:best*pri,ph:bph});}
 const raw=sc.slice();sc.sort((a,b)=>b.s-a.s);let b=sc[0];const near=v=>raw.reduce((x,y)=>Math.abs(y.bpm-v)<Math.abs(x.bpm-v)?y:x);if(b.bpm*2<=max){const d=near(b.bpm*2);if(d.s>=b.s*.7)b=d;}return{bpm:b.bpm,offset:b.ph*hop,conf:b.s/((sc.find(x=>Math.abs(x.bpm-b.bpm)>8)||{s:1e-9}).s+1e-9)};}
// arredonda BPM para inteiro se perto
function niceBpm(b){return Math.round(b);}
// ---------- tom ----------
function key(notes){const h=new Float32Array(12);for(const n of notes){if(n.drum)continue;h[((n.midi%12)+12)%12]+=Math.max(.05,n.end-n.start)*(n.vel||.7);}
 let best={r:-2};for(const mode of ['maior','menor'])for(let t=0;t<12;t++){const p=PROF[mode];let mx=0,my=0;for(let i=0;i<12;i++){mx+=h[i];my+=p[i];}mx/=12;my/=12;let a=0,b=0,c=0;for(let i=0;i<12;i++){const dx=h[(i+t)%12]-mx,dy=p[i]-my;a+=dx*dy;b+=dx*dx;c+=dy*dy;}const r=a/Math.sqrt(b*c+1e-12);if(r>best.r)best={r,tonic:t,mode};}
 const rel=best.mode==='maior'?best.tonic:(best.tonic+3)%12;best.fifths=FIFTHS_MAJ[rel];best.name=keyName(best);return best;}
function keyName(k){const flats=k.fifths<0;const nm=(flats?FL:SH)[k.tonic];return PTN[nm[0]]+(nm[1]==='#'?'♯':nm[1]==='b'?'♭':'')+' '+k.mode;}
function fifthsFor(tonic,mode){return FIFTHS_MAJ[mode==='maior'?tonic:(tonic+3)%12];}
// ---------- limpeza ----------
function cleanup(notes,{mode='poly',lo=0,hi=127,minDur=.06,ghost=.3,harm=[12]}={}){
 let a=notes.filter(n=>n.end-n.start>=minDur).map(n=>({...n}));if(!a.length)return a;
 const mv=median(a.map(n=>n.vel||.7));a=a.filter(n=>(n.vel||.7)>=mv*ghost);
 a.sort((x,y)=>x.start-y.start||x.midi-y.midi);
 if(mode==='poly'){ // harmônicos fantasmas: oitava/12ª acima de nota mais forte que começa junto
  a=a.filter(n=>!a.some(m=>m!==n&&harm.includes(n.midi-m.midi)&&Math.abs(m.start-n.start)<.05&&(m.vel||.7)>(n.vel||.7)*1.5&&m.end>=n.end-.05));
  // sub-harmônico fantasma (oitava abaixo, mais fraco, no grave)
  a=a.filter(n=>!(n.midi<52&&a.some(m=>m!==n&&m.midi-n.midi===12&&Math.abs(m.start-n.start)<.05&&(m.vel||.7)>(n.vel||.7)*1.3)));
  // re-ataque falso dentro de nota igual ainda soando
  a=a.filter(n=>!a.some(m=>m!==n&&m.midi===n.midi&&m.start<n.start-.05&&m.end>n.start+.08&&(n.vel||.7)<(m.vel||.7)*1.1));}
 // traz para a extensão do instrumento
 for(const n of a){while(n.midi<lo)n.midi+=12;while(n.midi>hi)n.midi-=12;}
 if(mode==='mono'){ // uma nota por vez: mantém a mais forte em ataques simultâneos, corta sobreposição
  const out=[];for(const n of a){const p=out.at(-1);if(p&&n.start-p.start<.04){if((n.vel||.7)>(p.vel||.7))out[out.length-1]=n;continue;}if(p&&p.end>n.start)p.end=n.start;out.push(n);}a=out.filter(n=>n.end-n.start>=minDur*.7);
  // erro de oitava: nota isolada 12 semitons longe dos vizinhos
  for(let i=1;i<a.length-1;i++){if(a[i].end-a[i].start>.15)continue;const p=a[i-1].midi,q=a[i+1].midi,m=a[i].midi;if(Math.abs(p-q)<=7){const c=(p+q)/2;if(Math.abs(m-12-c)<Math.abs(m-c)-6&&Math.abs(m-12-c)<=7)a[i].midi-=12;else if(Math.abs(m+12-c)<Math.abs(m-c)-6&&Math.abs(m+12-c)<=7)a[i].midi+=12;}}}
 // une notas iguais separadas por fresta curta (re-ataque falso)
 const out=[];for(const n of a){const p=[...out].reverse().find(m=>m.midi===n.midi&&n.start-m.end<.035&&n.start>=m.start&&n.start-m.start>0);if(p&&(n.vel||.7)<(p.vel||.7)*1.25&&n.start-p.end>=-.01&&n.start-p.end<.035){p.end=Math.max(p.end,n.end);continue;}out.push(n);}
 return out;}
// ---------- quantização ----------
// grid = divisões por semínima (2=colcheia, 4=semicolcheia, 1=semínima)
function quantize(notes,{bpm,offset=0,grid=4,mode='poly'}){const q=60/bpm/grid,res=[];
 for(const n of notes){const s=Math.round((n.start-offset)/q);if(s<0)continue;let e=Math.round((n.end-offset)/q);if(e<=s)e=s+1;res.push({id:n.id,qs:s,qe:e,midi:n.midi,vel:n.vel||.7,piece:n.piece,err:Math.abs((n.start-offset)/q-s)});}
 res.sort((a,b)=>a.qs-b.qs||a.midi-b.midi);
 const seen=new Set(),out=[];for(const r of res){const k=r.qs+':'+(r.piece||r.midi);if(seen.has(k))continue;seen.add(k);out.push(r);}
 if(mode==='mono'){for(let i=0;i<out.length-1;i++){if(out[i+1].qs===out[i].qs){out.splice(i+1,1);i--;continue;}if(out[i].qe>out[i+1].qs)out[i].qe=out[i+1].qs;}}
 if(mode==='drums'){for(const r of out)r.qe=r.qs+1;}
 return out;}
// ---------- notas por compasso (acordes em voz única, ligaduras, pausas) ----------
const DUR=[[16,'w',0],[12,'h',1],[8,'h',0],[6,'q',1],[4,'q',0],[3,'8',1],[2,'8',0],[1,'16',0]];// em semicolcheias
function splitDur(pos,len,unit,beatU){// pos/len em ticks (1 tick = 1/grid semínima); unit=quantos ticks por semicolcheia... usamos semicolcheia-base
 const out=[];while(len>0){let ok=null;for(const d of DUR){const L=d[0]*unit;if(L>len)continue;// não cruza o tempo para figuras curtas com ponto
   if(L<4*unit*beatU&&(pos%(4*unit*beatU))+L>4*unit*beatU&&d[2])continue;ok=d;break;}if(!ok){ok=[1,'16',0];}
  const L=Math.max(1,ok[0]*unit);out.push({d:ok[1],dots:ok[2],len:L,pos});pos+=L;len-=L;}return out;}
function layout(qn,{grid=4,num=4,den=4,mode='poly'}){// devolve compassos com eventos {pos,len,notes:[ids],midis,rest,tieNext}
 const unit=grid/4;// ticks por semicolcheia (grid=4 -> 1, grid=2 -> .5)
 const T=Math.round(num*(4/den)*grid);
 // agrupa acordes: notas com mesmo início; duração do grupo = mediana, sem sobrepor próximo grupo
 const groups=[];for(const n of qn){let g=groups.at(-1);if(g&&g.qs===n.qs)g.ns.push(n);else groups.push({qs:n.qs,ns:[n]});}
 for(let i=0;i<groups.length;i++){const g=groups[i],nx=groups[i+1];let e=Math.max(...g.ns.map(n=>n.qe));if(mode==='drums')e=g.qs+Math.max(1,Math.round(grid/2));if(nx&&e>nx.qs)e=nx.qs;g.qe=Math.max(g.qs+1,e);}
 const last=groups.length?Math.max(...groups.map(g=>g.qe)):T,nm=Math.max(1,Math.ceil(last/T)),meas=[];
 for(let m=0;m<nm;m++)meas.push([]);
 const push=(a,b,g)=>{// [a,b) possivelmente cruzando compassos
  while(a<b){const m=Math.floor(a/T),end=Math.min(b,(m+1)*T),pos=a-m*T;const segs=unit>=1?splitDur(pos,end-a,unit,1):splitDurG(pos,end-a,grid);for(const s of segs)meas[m].push({pos:s.pos,len:s.len,d:s.d,dots:s.dots,g,rest:!g});if(g){const evs=meas[m];}a=end;}};
 let cur=0;for(const g of groups){if(g.qs>cur)push(cur,g.qs,null);push(g.qs,g.qe,g);cur=g.qe;}
 if(cur<nm*T)push(cur,nm*T,null);
 // ligaduras: eventos consecutivos do mesmo grupo
 const flat=meas.flat();for(let i=0;i<flat.length-1;i++)if(flat[i].g&&flat[i].g===flat[i+1].g)flat[i].tie=true;
 for(let i=1;i<flat.length;i++)if(flat[i].g&&flat[i].g===flat[i-1].g)flat[i].tied=true;
 return{measures:meas,T};}
function splitDurG(pos,len,grid){// grid 1 ou 2 (semínima/colcheia): ticks maiores
 const per16=4/grid;const out=[];let p=pos*per16,l=len*per16;for(const s of splitDur(p,l,1,1))out.push({pos:s.pos/per16,len:s.len/per16,d:s.d,dots:s.dots});return out;}
// ---------- grafia ----------
function spell(midi,fifths){const flats=fifths<0,nm=(flats?FL:SH)[((midi%12)+12)%12],oct=Math.floor(midi/12)-1;return{step:nm[0],alter:nm[1]==='#'?1:nm[1]==='b'?-1:0,oct,vf:nm[0].toLowerCase()+(nm[1]||'')+'/'+oct,acc:nm[1]||''};}
function keySigAlter(step,fifths){const sh='FCGDAEB',fl='BEADGCF';if(fifths>0)return sh.slice(0,fifths).includes(step)?1:0;if(fifths<0)return fl.slice(0,-fifths).includes(step)?-1:0;return 0;}
// ---------- tablatura ----------
function tabPositions(midis,tuning,prev=3){// devolve [{str,fret}] (str 1 = mais aguda)
 const S=tuning.length,res=[],used=new Set();const ms=[...midis].sort((a,b)=>b-a);
 for(const m of ms){let best=null;for(let s=0;s<S;s++){if(used.has(s))continue;const f=m-tuning[s];if(f<0||f>19)continue;const c=Math.abs(f-prev)+(f===0?-.5:0)+(f>12?3:0);if(!best||c<best.c)best={s,f,c};}
  if(best){used.add(best.s);res.push({str:S-best.s,fret:best.f,midi:m});}}return res;}
// ---------- bateria ----------
const DRUM={kick:{vf:'f/4',x:false,midi:36,step:'F',oct:4},snare:{vf:'c/5',x:false,midi:38,step:'C',oct:5},hat:{vf:'g/5/x2',x:true,midi:42,step:'G',oct:5}};
function drumClassify(x,sr,onsets){const N=1024,out=[];const bandE=(t,f0,f1)=>{const a=Math.max(0,Math.floor(t*sr)),L=Math.min(N,x.length-a);if(L<64)return 0;// Goertzel aproximado por bandas via DFT esparsa
  let e=0,c=0;for(let f=f0;f<f1;f*=1.25){let re=0,im=0;const w=2*Math.PI*f/sr;for(let i=0;i<L;i++){const v=x[a+i]*(.5-.5*Math.cos(2*Math.PI*i/L));re+=v*Math.cos(w*i);im-=v*Math.sin(w*i);}e+=re*re+im*im;c++;}return e/c;};
 const feats=onsets.map(t=>({t,lo:bandE(t,40,130),mid:bandE(t,160,1200),hi:bandE(t,5000,11000)}));
 const pk=k=>{const v=feats.map(f=>f[k]).sort((a,b)=>a-b);return v[Math.floor(v.length*.9)]||1e-12;};const L=pk('lo'),M=pk('mid'),H=pk('hi');
 for(const f of feats){const pcs=[];if(f.lo>L*.25&&f.lo/L>f.mid/M*.8)pcs.push('kick');if(f.mid>M*.3&&f.mid/M>f.lo/L*.6)pcs.push('snare');if(f.hi>H*.15&&!pcs.includes('snare'))pcs.push('hat');if(!pcs.length)pcs.push(f.hi/H>f.mid/M?'hat':'snare');for(const pc of pcs)out.push({start:f.t,end:f.t+.1,piece:pc,vel:.8,drum:true});}return out;}
// ---------- MusicXML ----------
function esc(s){return String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));}
const TYPE={w:'whole',h:'half',q:'quarter','8':'eighth','16':'16th'};
function musicXML(score){// score:{title,bpm,num,den,grid,fifths,parts:[{name,ins,lay,chordsAt}]}
 const div=score.grid;let x='<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">\n<score-partwise version="3.1"><work><work-title>'+esc(score.title)+'</work-title></work><identification><creator type="composer">'+esc(score.composer||'')+'</creator><encoding><software>APS Audio Engine — criado por Anderclay Pereira Silva</software></encoding></identification><part-list>';
 score.parts.forEach((p,i)=>{x+='<score-part id="P'+(i+1)+'"><part-name>'+esc(p.name)+'</part-name>'+(p.ins.mode==='drums'?'':'<midi-instrument id="P'+(i+1)+'-I1"><midi-program>'+(p.ins.prog+1)+'</midi-program></midi-instrument>')+'</score-part>';});x+='</part-list>';
 score.parts.forEach((p,i)=>{x+='<part id="P'+(i+1)+'">';const dr=p.ins.mode==='drums';
  p.lay.measures.forEach((evs,m)=>{x+='<measure number="'+(m+1)+'">';if(!m){x+='<attributes><divisions>'+div+'</divisions><key><fifths>'+(dr?0:score.fifths)+'</fifths></key><time><beats>'+score.num+'</beats><beat-type>'+score.den+'</beat-type></time><clef>'+(dr?'<sign>percussion</sign>':p.ins.clef==='bass'?'<sign>F</sign><line>4</line>':'<sign>G</sign><line>2</line>'+(p.ins.oct8vb?'<clef-octave-change>-1</clef-octave-change>':''))+'</clef>'+(p.ins.wr?'<transpose><diatonic>-7</diatonic><chromatic>-12</chromatic><octave-change>-1</octave-change></transpose>':'')+'</attributes><direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>'+score.bpm+'</per-minute></metronome></direction-type><sound tempo="'+score.bpm+'"/></direction>';}
   for(const c of (p.chordsAt?.[m]||[]))x+='<harmony><root><root-step>'+c.step+'</root-step>'+(c.alter?'<root-alter>'+c.alter+'</root-alter>':'')+'</root><kind text="'+esc(c.text)+'">'+c.kind+'</kind><offset>'+c.pos+'</offset></harmony>';
   for(const e of evs){const tie=(e.tied?'<tie type="stop"/>':'')+(e.tie?'<tie type="start"/>':''),ntie=(e.tied?'<tied type="stop"/>':'')+(e.tie?'<tied type="start"/>':''),ty='<type>'+TYPE[e.d]+'</type>'+(e.dots?'<dot/>':'');
    if(e.rest){x+='<note><rest/><duration>'+e.len+'</duration>'+ty+'</note>';continue;}
    const ns=dr?[...new Set(e.g.ns.map(n=>n.piece||'snare'))].map(pc=>({dp:DRUM[pc]})):e.g.ns.map(n=>({sp:spell(n.midi+score.semi+p.ins.wr,score.fifths)}));
    ns.forEach((n,k)=>{x+='<note>'+(k?'<chord/>':'');if(n.dp)x+='<unpitched><display-step>'+n.dp.step+'</display-step><display-octave>'+n.dp.oct+'</display-octave></unpitched>';else x+='<pitch><step>'+n.sp.step+'</step>'+(n.sp.alter?'<alter>'+n.sp.alter+'</alter>':'')+'<octave>'+n.sp.oct+'</octave></pitch>';x+='<duration>'+e.len+'</duration>'+tie+ty+(n.dp?.x?'<notehead>x</notehead>':'')+(ntie?'<notations>'+ntie+'</notations>':'')+'</note>';});}
   x+='</measure>';});x+='</part>';});return x+'</score-partwise>';}
// ---------- MIDI (SMF tipo 1) ----------
function vlq(n){const b=[n&127];while(n>>=7)b.unshift((n&127)|128);return b;}
function midiFile(score){const PPQ=480,tpq=PPQ/score.grid,trk=[];const str=s=>[...new TextEncoder().encode(s)];
 const t0=[0,255,81,3,...(v=>[v>>16&255,v>>8&255,v&255])(Math.round(6e7/score.bpm)),0,255,88,4,score.num,Math.log2(score.den),24,8,0,255,3,...vlq(str(score.title).length),...str(score.title),0,255,47,0];trk.push(t0);
 score.parts.forEach((p,i)=>{const ch=p.ins.mode==='drums'?9:Math.min(8,i)+(i>=9?1:0);const ev=[];for(const n of p.notes){const m=p.ins.mode==='drums'?(DRUM[n.piece]||DRUM.snare).midi:n.midi+score.semi;ev.push([n.qs*tpq,0x90|ch,m,Math.round(30+n.vel*97)]);ev.push([(p.ins.mode==='drums'?n.qs+1:n.qe)*tpq-1,0x80|ch,m,0]);}
  ev.sort((a,b)=>a[0]-b[0]||(a[1]&0xf0)-(b[1]&0xf0));const d=[0,255,3,...vlq(str(p.name).length),...str(p.name)];if(ch!==9)d.push(0,0xC0|ch,p.ins.prog);let t=0;for(const e of ev){d.push(...vlq(Math.max(0,e[0]-t)),e[1],e[2],e[3]);t=Math.max(t,e[0]);}d.push(0,255,47,0);trk.push(d);});
 const out=[77,84,104,100,0,0,0,6,0,1,0,trk.length,PPQ>>8,PPQ&255];for(const t of trk)out.push(77,84,114,107,t.length>>>24&255,t.length>>16&255,t.length>>8&255,t.length&255,...t);return new Uint8Array(out);}
// ---------- métricas (para testes) ----------
function f1(ref,est,{tol=.05}={}){const used=new Set();let tp=0;for(const r of ref){let bi=-1,bd=1e9;est.forEach((e,i)=>{if(used.has(i)||e.midi!==r.midi)return;const d=Math.abs(e.start-r.start);if(d<=tol&&d<bd){bd=d;bi=i;}});if(bi>=0){used.add(bi);tp++;}}const p=tp/Math.max(1,est.length),r=tp/Math.max(1,ref.length);return{p,r,f:2*p*r/Math.max(1e-9,p+r),tp,nRef:ref.length,nEst:est.length};}
root.APSTranscribe={INSTR,onsetEnv,onsetEnvFromNotes,tempo,niceBpm,key,keyName,fifthsFor,cleanup,drumClassify,quantize,layout,spell,keySigAlter,tabPositions,DRUM,musicXML,midiFile,f1,median,SH,FL};
})(typeof window!=='undefined'?window:globalThis);
