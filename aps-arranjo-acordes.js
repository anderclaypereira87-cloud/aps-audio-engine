/* APS Arranjo pelos acordes — detecta tom, andamento (grade de tempos) e acordes do áudio original e
 * gera uma pista de instrumento (piano, cordas, baixo, violão/guitarra, órgão) que SEGUE esses acordes,
 * no mesmo andamento e alinhada ao áudio. Roda inteiro no aparelho: sem IA externa, sem custo.
 * Depende de aps-clean.js (FFT), aps-chords.js (cromagrama) e aps-transcribe.js (andamento). */
(function(root){'use strict';
const SH=['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'],FL=['C','Db','D','Eb','E','F','Gb','G','Ab','A','Bb','B'];
const IV={'':[0,4,7],m:[0,3,7]};
const MAJ_SC=[0,2,4,5,7,9,11],MIN_SC=[0,2,3,5,7,8,10];
const idle=()=>new Promise(r=>setTimeout(r,0));
const mono=buf=>{const n=buf.length,c=buf.numberOfChannels,y=new Float32Array(n);for(let k=0;k<c;k++){const x=buf.getChannelData(k);for(let i=0;i<n;i++)y[i]+=x[i]/c;}return y;};
const nm=(root_,q,flats)=>root_<0?'N.C.':(flats?FL:SH)[((root_%12)+12)%12]+q;
// ---------- análise ----------
async function analyze(buf,{bpm:bpmHint=0,onProgress}={}){
 const C=root.APSChords,T=root.APSTranscribe;if(!C||!T)throw Error('Módulos de análise não carregados.');
 onProgress?.('Lendo notas e acordes do áudio…',.05);
 const ch=await C.chroma(buf,{hopSec:.05,onProgress:p=>onProgress?.('Lendo notas e acordes do áudio…',.05+p*.55)});
 const key=C.key(ch.frames);
 // andamento e grade de tempos (primeiros 150 s bastam)
 onProgress?.('Descobrindo o andamento…',.65);await idle();
 const sr=buf.sampleRate,x=mono(buf).subarray(0,Math.floor(Math.min(buf.duration,150)*sr));
 let tp={bpm:120,offset:0,conf:0};try{tp=T.tempo(T.onsetEnv(x,sr),{min:60,max:180});}catch(e){}
 const bpm=bpmHint>=40?bpmHint:Math.round(tp.bpm),beat=60/bpm;let off=tp.offset%beat;if(bpmHint>=40&&tp.offset)off=tp.offset%beat;
 // acorde por tempo: soma do cromagrama dentro de cada tempo
 const nB=Math.max(1,Math.floor((buf.duration-off)/beat)),bf=[],be=[];
 const maxE=Math.max(...ch.energy,1e-9);
 for(let b=0;b<nB;b++){const a=off+b*beat,z=a+beat,v=new Float32Array(12);let e=0;
  for(let f=0;f<ch.frames.length;f++){const t=ch.offset+f*ch.hop;if(t<a)continue;if(t>=z)break;const g=ch.frames[f];let s=0;for(let i=0;i<12;i++){v[i]+=g[i];s+=g[i];}e+=ch.energy[f];}
  bf.push(v);be.push(e);}
 // modelos de tríade (raiz levemente reforçada) + preferência diatonica
 const scale=(key.mode==='menor'?MIN_SC:MAJ_SC).map(d=>(d+key.tonic)%12),diat=new Set(scale);
 const states=[];for(let r=0;r<12;r++)for(const q of ['','m']){const v=new Float32Array(12);IV[q].forEach((d,j)=>v[(r+d)%12]=j===0?1.25:1);let n=0;for(const a of v)n+=a*a;n=Math.sqrt(n);for(let i=0;i<12;i++)v[i]/=n;
  const third=(r+(q==='m'?3:4))%12,fifth=(r+7)%12;const dia=(diat.has(r)&&diat.has(third)&&diat.has(fifth))?.04:0;states.push({r,q,v,dia});}
 const S=states.length,emis=bf.map((v,b)=>{let n=0;for(const a of v)n+=a*a;n=Math.sqrt(n);const e=new Float32Array(S+1);if(n<1e-9||be[b]/(beat/ch.hop)<maxE*.03){e.fill(-9);e[S]=0;return e;}
  for(let i=0;i<S;i++){let s=0;for(let j=0;j<12;j++)s+=v[j]*states[i].v[j];e[i]=s/n+states[i].dia;}e[S]=.35;return e;});
 const viterbi=(pen)=>{const N=bf.length,dp=[],bk=[];dp.push(Float32Array.from(emis[0]));bk.push(new Int16Array(S+1));
  for(let b=1;b<N;b++){const cur=new Float32Array(S+1),back=new Int16Array(S+1),pv=dp[b-1];let bi=0;for(let i=1;i<=S;i++)if(pv[i]>pv[bi])bi=i;const p=pen(b);
   for(let i=0;i<=S;i++){const stay=pv[i],sw=pv[bi]-p;if(stay>=sw){cur[i]=stay+emis[b][i];back[i]=i;}else{cur[i]=sw+emis[b][i];back[i]=bi;}}dp.push(cur);bk.push(back);}
  let s=0;for(let i=1;i<=S;i++)if(dp[N-1][i]>dp[N-1][s])s=i;const lab=new Int16Array(N);for(let b=N-1;b>=0;b--){lab[b]=s;s=bk[b][s];}return lab;};
 let lab=viterbi(()=>.6);
 // tempo forte (1º tempo do compasso): fase com mais trocas de acorde
 const ph=[0,0,0,0];for(let b=1;b<lab.length;b++)if(lab[b]!==lab[b-1])ph[b%4]++;let down=ph.indexOf(Math.max(...ph));
 lab=viterbi(b=>(b%4===down)?.45:.9);
 const segs=[];for(let b=0;b<lab.length;b++){const l=lab[b],last=segs[segs.length-1];if(last&&last.i===l)last.n++;else segs.push({i:l,b0:b,n:1});}
 // remove trocas de 1 tempo (ruído) fora do tempo forte
 for(let p=0;p<2;p++)for(let k=1;k<segs.length;k++){if(segs[k].n<2&&segs[k].b0%4!==down&&segs[k].i!==segs[k-1].i){segs[k-1].n+=segs[k].n;segs.splice(k,1);k--;}else if(segs[k].i===segs[k-1].i){segs[k-1].n+=segs[k].n;segs.splice(k,1);k--;}}
 const flats=key.mode==='maior'?[5,10,3,8,1].includes(key.tonic):[2,7,0,5,10].includes(key.tonic);
 const chords=segs.map(s=>{const st=s.i<S?states[s.i]:null;return{b0:s.b0,beats:s.n,start:off+s.b0*beat,end:off+(s.b0+s.n)*beat,root:st?st.r:-1,q:st?st.q:'',name:st?nm(st.r,st.q,flats):'N.C.'};});
 onProgress?.('Pronto.',1);
 return{bpm,beat,offset:off,downbeat:down,tempoConf:tp.conf,key,flats,keyName:nm(key.tonic,key.mode==='menor'?'m':'',flats),chords,duration:buf.duration};}
// ---------- síntese ----------
const mtof=m=>440*Math.pow(2,(m-69)/12);
function note(inst,midi,dur,sr){// devolve Float32Array (amostra única, cacheável)
 const f=mtof(midi),N=Math.max(1,Math.floor((dur+(inst==='cordas'||inst==='orgao'?.35:.1))*sr)),y=new Float32Array(N);
 const nyq=sr/2.2;
 if(inst==='piano'){const H=Math.min(14,Math.floor(nyq/f));for(let h=1;h<=H;h++){const a=Math.pow(h,-1.15)*(h===1?1:.9),dec=1.2+h*.9+(midi>72?1.2:0),ph=(h*1.7)%6.28,fr=f*h*(1+.00012*h*h);for(let i=0;i<N;i++){const t=i/sr;y[i]+=a*Math.sin(2*Math.PI*fr*t+ph)*Math.exp(-t*dec);}}
  for(let i=0;i<Math.min(N,Math.floor(.004*sr));i++)y[i]*=i/(.004*sr);const rel=Math.floor(.08*sr);for(let i=0;i<Math.min(rel,N);i++)y[N-1-i]*=i/rel;}
 else if(inst==='cordas'){const H=Math.min(18,Math.floor(nyq/f)),att=.28,rel=.35;for(const dt of [-.004,.004]){const ff=f*(1+dt);for(let h=1;h<=H;h++){const a=Math.pow(h,-1.25)*.55;for(let i=0;i<N;i++){const t=i/sr;y[i]+=a*Math.sin(2*Math.PI*ff*h*t+.3*h*Math.sin(2*Math.PI*5.2*t)*Math.min(1,t*2));}}}
  for(let i=0;i<N;i++){const t=i/sr,e=Math.min(1,t/att)*Math.min(1,(N/sr-t)/rel);y[i]*=Math.max(0,e);}}
 else if(inst==='orgao'){const hs=[[1,1],[2,.8],[3,.5],[4,.55],[6,.25],[8,.2]];for(const[h,a]of hs){if(f*h>nyq)continue;for(let i=0;i<N;i++)y[i]+=a*Math.sin(2*Math.PI*f*h*i/sr);}for(let i=0;i<N;i++){const t=i/sr;y[i]*=Math.min(1,t/.015)*Math.max(0,Math.min(1,(N/sr-t)/.3));}}
 else if(inst==='baixo'){for(let h=1;h<=4;h++){const a=[1,.6,.25,.12][h-1];for(let i=0;i<N;i++){const t=i/sr;y[i]+=a*Math.sin(2*Math.PI*f*h*t)*Math.exp(-t*(2.4+h*2));}}for(let i=0;i<Math.min(N,.003*sr);i++)y[i]*=i/(.003*sr);const rel=Math.floor(.05*sr);for(let i=0;i<Math.min(rel,N);i++)y[N-1-i]*=i/rel;}
 else{// violão/guitarra: Karplus-Strong
  const L=Math.max(2,Math.round(sr/f-.5)),d=new Float32Array(L);let s=1234567;for(let i=0;i<L;i++){s=(s*1103515245+12345)&0x7fffffff;d[i]=(s/0x7fffffff)*2-1;}let p=0;for(let i=0;i<N;i++){const a=d[p],b=d[(p+1)%L];y[i]=a;d[p]=(a+b)*.4985;p=(p+1)%L;}const rel=Math.floor(.06*sr);for(let i=0;i<Math.min(rel,N);i++)y[N-1-i]*=i/rel;}
 return y;}
const rootNear=(r,target)=>{let m=r+12*Math.round((target-r)/12);return m;};
function voice(root_,q,prev,lo,hi){// inversão de tríade mais próxima da anterior (condução de vozes suave)
 const iv=IV[q]||IV[''],cands=[];for(let inv=0;inv<3;inv++){const pcs=iv.map(d=>(root_+d)%12),rot=[...pcs.slice(inv),...pcs.slice(0,inv)];let m=[],last=lo-1;for(const pc of rot){let n=pc+12*Math.ceil((last+1-pc)/12);if(n<=last)n+=12;m.push(n);last=n;}cands.push(m);}
 const center=(lo+hi)/2;let best=null,bs=1e9;for(let sh=-12;sh<=12;sh+=12)for(const c of cands){const m=c.map(n=>n+sh);if(m[0]<lo||m[m.length-1]>hi)continue;const avg=m.reduce((a,b)=>a+b)/m.length,s=prev?Math.abs(avg-(prev.reduce((a,b)=>a+b)/prev.length)):Math.abs(avg-center);if(s<bs){bs=s;best=m;}}
 return best||cands[0];}
function events(an,inst){const ev=[],b=an.beat;let prev=null;
 for(const c of an.chords){if(c.root<0){prev=null;continue;}const t0=c.start,len=c.beats*b;
  if(inst==='piano'){const v=voice(c.root,c.q,prev,55,76);prev=v;const bass=rootNear(c.root,41-(c.root>5?12:0)+12);const bm=bass<36?bass+12:bass;
   for(let k=0;k<c.beats;k++){const t=t0+k*b,pos=(c.b0+k)%4;if(pos%2===0)ev.push({t,d:Math.min(len-k*b,2*b),m:bm-12<28?bm:bm-12,v:.8});
    ev.push({t:t+.004*(k%3),d:b*.95,m:null,ms:v,v:pos===0?.7:.5});}}
  else if(inst==='cordas'){const v=voice(c.root,c.q,prev,52,72);prev=v;for(const m of v)ev.push({t:t0,d:len,m,v:.55});ev.push({t:t0,d:len,m:rootNear(c.root,40),v:.5});}
  else if(inst==='orgao'){const v=voice(c.root,c.q,prev,52,72);prev=v;for(const m of v)ev.push({t:t0,d:len,m,v:.45});}
  else if(inst==='baixo'){const r=rootNear(c.root,38),f5=r+7;for(let k=0;k<c.beats;k++){const pos=(c.b0+k)%4;const m=pos===2?f5:r;if(pos===0||pos===2||k===0)ev.push({t:t0+k*b,d:b*1.6,m,v:pos===0?.9:.7});else if(pos===3)ev.push({t:t0+k*b+b*.5,d:b*.45,m:r,v:.5});}}
  else{// guitarra/violão: acorde batido (baixo-baixo-alto-alto-alto), padrão D-DU-UDU
   const v=voice(c.root,c.q,prev,48,67);prev=v;const rt=rootNear(c.root,45),all=[rt,...v.slice().sort((a,b)=>a-b)];if(!v.includes(rt+12))all.splice(1,0,rt+12);
   for(let k=0;k<c.beats;k+=1){const pos=(c.b0+k)%4;if(pos===1||pos===3)continue;
    for(let j=0;j<2;j++){const base=t0+k*b+(j?b*.75:0);all.forEach((m,i)=>ev.push({t:base+i*.012,d:b*(j?1.2:.85),m,v:(j?.5:.75)*(.9-i*.04)}));}}}
 }
 return ev;}
function render(an,inst='piano',{sr=44100,gain=1}={}){
 const N=Math.ceil(an.duration*sr),out=new Float32Array(N),cache=new Map();
 const add=(t,y,v)=>{const s=Math.round(t*sr);if(s>=N)return;const L=Math.min(y.length,N-s);for(let i=0;i<L;i++)out[s+i]+=y[i]*v;};
 for(const e of events(an,inst)){const ms=e.ms||[e.m];for(const m of ms){const d=Math.round(e.d*20)/20,k=inst+'|'+m+'|'+d;let y=cache.get(k);if(!y){y=note(inst,m,d,sr);cache.set(k,y);}add(e.t,y,e.v*(e.ms?1/Math.sqrt(ms.length)*1.2:1)*.28*gain);}}
 let pk=0;for(let i=0;i<N;i++)pk=Math.max(pk,Math.abs(out[i]));const g=pk>0?.8/pk:1;for(let i=0;i<N;i++)out[i]*=g;return out;}
function toBuffer(data,sr=44100){if(typeof AudioBuffer!=='undefined'){const b=new AudioBuffer({length:data.length,sampleRate:sr,numberOfChannels:1});b.copyToChannel(data,0);return b;}return{length:data.length,sampleRate:sr,numberOfChannels:1,duration:data.length/sr,getChannelData:()=>data};}
function wav(data,sr=44100,second){const n=data.length,ch=second?2:1,ab=new ArrayBuffer(44+n*ch*2),v=new DataView(ab),w=(o,s)=>{for(let i=0;i<s.length;i++)v.setUint8(o+i,s.charCodeAt(i));};
 w(0,'RIFF');v.setUint32(4,36+n*ch*2,true);w(8,'WAVE');w(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,ch,true);v.setUint32(24,sr,true);v.setUint32(28,sr*ch*2,true);v.setUint16(32,ch*2,true);v.setUint16(34,16,true);w(36,'data');v.setUint32(40,n*ch*2,true);
 let o=44;for(let i=0;i<n;i++){for(const x of ch===2?[data,second]:[data]){const s=Math.max(-1,Math.min(1,x[i]));v.setInt16(o,s*32767,true);o+=2;}}return new Blob([ab],{type:'audio/wav'});}
function mixWithOriginal(buf,arr,{origGain=.8,arrGain=1,arrSr=null}={}){let o=mono(buf);const rs=arrSr||buf.sampleRate;if(rs!==buf.sampleRate){const r=buf.sampleRate/rs,N=Math.floor(o.length/r),y=new Float32Array(N);for(let i=0;i<N;i++){const p=i*r,k=Math.floor(p),f=p-k;y[i]=o[k]*(1-f)+(o[Math.min(o.length-1,k+1)])*f;}o=y;}const n=Math.min(o.length,arr.length),m=new Float32Array(n);let pk=0;for(let i=0;i<n;i++){m[i]=o[i]*origGain+arr[i]*arrGain;pk=Math.max(pk,Math.abs(m[i]));}const g=pk>.95?.95/pk:1;for(let i=0;i<n;i++)m[i]*=g;return m;}
function describe(an){return 'Tom '+an.keyName+' · '+an.bpm+' BPM'+(an.tempoConf&&an.tempoConf<1.15?' (andamento incerto: digite o BPM certo se precisar)':'')+' · '+an.chords.filter(c=>c.root>=0).length+' trocas de acorde';}
function chordLine(an,max=64){return an.chords.slice(0,max).map(c=>c.name).join(' – ')+(an.chords.length>max?' …':'');}
root.APSArranjoAcordes={analyze,render,events,toBuffer,wav,mixWithOriginal,describe,chordLine,INSTR:{piano:'Piano',cordas:'Cordas (orquestra)',baixo:'Baixo',violao:'Violão / guitarra',orgao:'Órgão / pad'}};
})(typeof window!=='undefined'?window:globalThis);
