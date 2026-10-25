/* APS Audio Engine · Bateria por peça v1.0 (sem DOM; navegador e node).
 * OPERAÇÃO B — SUBSTITUIÇÃO DE TIMBRES: detecta ataques numa pista de bateria e estima a peça.
 * Isto NÃO é isolamento neural: nenhum áudio original de peça é extraído aqui. As estimativas
 * servem para MIDI e para recriar a bateria com samples, preservando tempo, intensidade,
 * notas fantasmas e variações. Heurística de bandas de frequência, revisável pelo usuário.
 */
(function(root){
'use strict';
const PIECES=['kick','snare','rim','hat','open','tom1','tom2','floor','ride','crash','splash'];
const NAMES={kick:'Bumbo',snare:'Caixa',rim:'Rimshot',hat:'Chimbal fechado',open:'Chimbal aberto',tom1:'Tom 1',tom2:'Tom 2',floor:'Surdo',ride:'Ride',crash:'Crash',splash:'Splash'};
const GM={kick:36,snare:38,rim:37,hat:42,open:46,tom1:50,tom2:47,floor:43,ride:51,crash:49,splash:55};
function onePole(x,sr,fc){const a=1-Math.exp(-2*Math.PI*fc/sr),y=new Float32Array(x.length);let s=0;for(let i=0;i<x.length;i++){s+=a*(x[i]-s);y[i]=s;}return y;}
function lp2(x,sr,fc){return onePole(onePole(x,sr,fc),sr,fc);}
function bands(x,sr){const low=lp2(x,sr,150),l2k=lp2(x,sr,2000),l6k=lp2(x,sr,6000),mid=new Float32Array(x.length),high=new Float32Array(x.length);
 for(let i=0;i<x.length;i++){mid[i]=l2k[i]-low[i];high[i]=x[i]-l6k[i];}return {low,mid,high,l2k};}
function envelope(x,hop){const n=Math.floor(x.length/hop),e=new Float32Array(n);for(let f=0;f<n;f++){let s=0;const b=f*hop;for(let j=0;j<hop;j++){const v=x[b+j];s+=v*v;}e[f]=Math.sqrt(s/hop);}return e;}
function median(a){if(!a.length)return 0;const s=Float32Array.from(a).sort();return s[s.length>>1];}
// onset por banda: aumento de energia em log, limiar adaptativo (mediana local + delta)
function onsets(env,{delta,minGap,floor}){
 const n=env.length,odf=new Float32Array(n);for(let f=1;f<n;f++){const d=Math.log1p(env[f]*1000)-Math.log1p(Math.max(env[f-1],env[f-2]||0)*1000);odf[f]=d>0?d:0;}
 const out=[],W=40;
 for(let f=2;f<n-1;f++){if(odf[f]<=odf[f-1]||odf[f]<odf[f+1])continue;if(env[f+1]<floor&&env[f]<floor)continue;
  const lo=Math.max(0,f-W),hi=Math.min(n,f+W),loc=[];for(let k=lo;k<hi;k+=2)loc.push(odf[k]);const th=median(loc)+delta;if(odf[f]<th)continue;
  if(out.length&&f-out[out.length-1].f<minGap){if(odf[f]>out[out.length-1].v)out[out.length-1]={f,v:odf[f]};continue;}out.push({f,v:odf[f]});}
 return out;
}
function peakAfter(env,f,frames){let p=0;for(let k=f;k<Math.min(env.length,f+frames);k++)p=Math.max(p,env[k]);return p;}
function decayFrames(env,f,ratio){const p=peakAfter(env,f,4);let k=f;while(k<env.length&&env[k]>p*ratio)k++;return k-f;}
function zcr(x,from,len){let z=0,prev=x[from]||0;const end=Math.min(x.length,from+len);for(let i=from+1;i<end;i++){const v=x[i];if((v>=0)!==(prev>=0))z++;prev=v;}return z/Math.max(1,end-from);}
/** Analisa uma pista mono de bateria. Retorna eventos {time,piece,velocity,amplitude,ghost,confidence}. */
function analyze(x,sr,opt={}){
 const sens=Math.max(0,Math.min(100,opt.sensitivity??60)),hop=Math.max(64,Math.round(sr*0.0058)),fps=sr/hop;
 const B=bands(x,sr),E={low:envelope(B.low,hop),mid:envelope(B.mid,hop),high:envelope(B.high,hop)};
 let gmax=0;for(const k in E)for(const v of E[k])gmax=Math.max(gmax,v);if(gmax<1e-4)throw Error('Áudio silencioso: nenhum ataque detectado.');
 const delta=0.55-0.4*sens/100,minGap=Math.round(0.03*fps),floor=gmax*0.004;
 const hits=[];
 for(const band of ['low','mid','high'])for(const o of onsets(E[band],{delta,minGap,floor}))hits.push({f:o.f,band,odf:o.v});
 hits.sort((a,b)=>a.f-b.f);
 // agrupa ataques de bandas diferentes que ocorrem juntos (até 25 ms): ex. bumbo + chimbal
 const groups=[];const tol=Math.round(0.025*fps);
 for(const h of hits){const g=groups[groups.length-1];if(g&&h.f-g.f<=tol){g.bands[h.band]=Math.max(g.bands[h.band]||0,h.odf);}else groups.push({f:h.f,bands:{[h.band]:h.odf}});}
 const events=[];
 for(const g of groups){
  const f=g.f,pk={low:peakAfter(E.low,f,6),mid:peakAfter(E.mid,f,6),high:peakAfter(E.high,f,6)},tot=pk.low+pk.mid+pk.high+1e-9;
  const share={low:pk.low/tot,mid:pk.mid/tot,high:pk.high/tot},start=Math.max(0,f*hop-hop);
  // ataque preciso: primeiro ponto, na janela do quadro, onde |x| passa de 30% do pico local
  let t=start,pmax=0;for(let i=start;i<Math.min(x.length,start+3*hop);i++)pmax=Math.max(pmax,Math.abs(x[i]));for(let i=start;i<Math.min(x.length,start+3*hop);i++)if(Math.abs(x[i])>=pmax*.3){t=i;break;}
  const out=[];
  if(g.bands.low&&share.low>0.22){
   const z=zcr(B.l2k,t,Math.round(0.05*sr))*sr/2,dec=decayFrames(E.low,f,0.25)/fps;
   out.push({piece:(z>75&&dec>0.18&&share.mid>0.25)?'floor':'kick',amp:pk.low,conf:share.low});}
  if(g.bands.mid&&share.mid>0.2&&(!g.bands.low||pk.mid>pk.low*0.6)){
   const noisy=pk.high/(pk.mid+1e-9),dec=decayFrames(E.mid,f,0.25)/fps,z=zcr(B.mid,t,Math.round(0.04*sr))*sr/2;
   let piece;if(noisy>0.35)piece=dec<0.035?'rim':'snare';else piece=z<130?'floor':z<200?'tom2':'tom1';
   if(!(piece==='floor'&&out.some(o=>o.piece==='floor')))out.push({piece,amp:pk.mid,conf:share.mid});}
  if(g.bands.high&&(share.high>0.12||!out.length)){
   const dec=decayFrames(E.high,f,0.1)/fps,withSnare=out.some(o=>o.piece==='snare'||o.piece==='rim');let piece;
   // com caixa no mesmo instante, o ruído da caixa alonga a banda aguda: limiar maior para chimbal
   if(dec<(withSnare?0.2:0.09))piece='hat';else if(dec<0.35)piece='open';else{const midS=pk.mid/(pk.high+1e-9);piece=dec<0.8?'splash':(midS>0.6?'crash':'ride');}
   out.push({piece,amp:pk.high,conf:share.high});}
  for(const o of out)events.push({time:t/sr,original:t/sr,piece:o.piece,amplitude:o.amp,confidence:+o.conf.toFixed(2)});
 }
 // prato longo repetido (2+ vizinhos a menos de 0,7 s) = condução (ride); isolado = crash/splash
 const longC=events.filter(e=>e.piece==='crash'||e.piece==='ride'||e.piece==='splash');
 for(let i=0;i<longC.length;i++){const e=longC[i],near=longC.filter((o,j)=>j!==i&&Math.abs(o.time-e.time)<0.7&&Math.abs(o.time-e.time)>0.05).length;if(near>=2)e.piece='ride';else if(e.piece==='ride')e.piece='crash';}
 // intensidade relativa por peça (sem compressão): 127 no percentil 96 da própria peça
 for(const p of PIECES){const ev=events.filter(e=>e.piece===p);if(!ev.length)continue;const a=ev.map(e=>e.amplitude).sort((x,y)=>x-y),ref=a[Math.min(a.length-1,Math.floor(a.length*.96))]||1,med=a[a.length>>1];
  for(const e of ev){e.velocity=Math.max(1,Math.min(127,Math.round(127*Math.pow(Math.min(1,e.amplitude/ref),.75))));e.ghost=(p==='snare'||p==='rim'||p==='hat')&&e.amplitude<med*0.4;}}
 events.sort((a,b)=>a.time-b.time||PIECES.indexOf(a.piece)-PIECES.indexOf(b.piece));
 return events;
}
/** MIDI padrão (formato 0, canal 10). grid=0 mantém o tempo original exato (sem quantizar). */
function toMidi(events,bpm=120,grid=0){
 const PPQ=480,micro=Math.round(60000000/bpm),sub=grid?60/bpm*4/grid:0,ev=[];
 for(const e of events){const at=sub?Math.max(0,Math.round(e.time/sub)*sub):e.time,tick=Math.round(at*bpm/60*PPQ),note=GM[e.piece]||36;ev.push({tick,d:[0x99,note,Math.max(1,Math.min(127,e.velocity|0))]},{tick:tick+60,d:[0x89,note,0]});}
 ev.sort((a,b)=>a.tick-b.tick||a.d[0]-b.d[0]);
 const vl=n=>{n=Math.max(0,n|0);const l=[n&127];while(n>>=7)l.unshift((n&127)|128);return l;};
 const tr=[0,0xff,0x51,3,(micro>>16)&255,(micro>>8)&255,micro&255];let last=0;for(const e of ev){tr.push(...vl(e.tick-last),...e.d);last=e.tick;}tr.push(0,0xff,0x2f,0);
 const u32=v=>[(v>>>24)&255,(v>>>16)&255,(v>>>8)&255,v&255];
 return Uint8Array.from([0x4d,0x54,0x68,0x64,...u32(6),0,0,0,1,(PPQ>>8)&255,PPQ&255,0x4d,0x54,0x72,0x6b,...u32(tr.length),...tr]);
}
/** Recria a bateria com samples (OPERAÇÃO B). samples: {piece:[Float32Array,...]} (camadas/variações).
 * Mantém o tempo exato de cada ataque; ganho segue a intensidade; alterna variações (round-robin). */
function render(events,samples,sr,length,{only=null}={}){
 const out=new Float32Array(length),rr={};
 for(const e of events){if(only&&e.piece!==only)continue;const list=samples[e.piece];if(!list||!list.length)continue;
  const s=list[(rr[e.piece]=(rr[e.piece]||0)+1)%list.length],g=Math.pow(e.velocity/127,1.6),at=Math.round(e.time*sr);
  for(let i=0;i<s.length&&at+i<length;i++)out[at+i]+=s[i]*g;}
 return out;
}
/** Lê ZIP (store/deflate). inflateRaw: async (Uint8Array)=>Uint8Array (navegador: DecompressionStream). */
async function unzip(bytes,inflateRaw){
 const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let e=bytes.length-22;while(e>=0&&v.getUint32(e,true)!==0x06054b50)e--;if(e<0)throw Error('ZIP inválido.');
 const count=v.getUint16(e+10,true);let p=v.getUint32(e+16,true);const files=[],dec=new TextDecoder();
 for(let i=0;i<count;i++){if(v.getUint32(p,true)!==0x02014b50)throw Error('ZIP corrompido.');const method=v.getUint16(p+10,true),csize=v.getUint32(p+20,true),nl=v.getUint16(p+28,true),xl=v.getUint16(p+30,true),cl=v.getUint16(p+32,true),off=v.getUint32(p+42,true);
  const name=dec.decode(bytes.subarray(p+46,p+46+nl));p+=46+nl+xl+cl;if(name.endsWith('/'))continue;
  const lnl=v.getUint16(off+26,true),lxl=v.getUint16(off+28,true),data=bytes.subarray(off+30+lnl+lxl,off+30+lnl+lxl+csize);
  if(method===0)files.push({name,data});else if(method===8)files.push({name,data:await inflateRaw(data)});else files.push({name,error:'método '+method+' não suportado'});}
 return files;
}
async function browserInflate(d){const s=new Blob([d]).stream().pipeThrough(new DecompressionStream('deflate-raw'));return new Uint8Array(await new Response(s).arrayBuffer());}
const api={PIECES,NAMES,GM,analyze,toMidi,render,unzip,browserInflate,
 OPERATIONS:{A:'Isolamento neural: o modelo HTDemucs-6s só entrega a BATERIA INTEIRA como uma pista. Não existe, hoje, modelo de licença comercial no APS que isole bumbo, caixa, pratos etc. com o sinal original.',B:'Substituição de timbres: ataques detectados e reconstruídos com samples. É áudio RECRIADO, não o microfone original.'}};
if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.APSDrumPieces=api;
})(typeof self!=='undefined'?self:this);
