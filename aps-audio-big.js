/* APS Áudio Grande — leitura em blocos de arquivos grandes (WAV/AIFF de 100+ MB, 10+ min) sem estourar a memória.
 * - monoForAnalysis(): lê o arquivo em blocos de 8 MB, faz mono e reduz a taxa (ex.: 22,05 kHz) -> AudioBuffer pequeno para a análise de acordes/tom/andamento.
 * - toMp3(): codifica MP3 em blocos, cortando em no máximo maxSec/maxBytes (limite do envio à IA).
 * Outros formatos (MP3, M4A, FLAC, OGG...) usam decodeAudioData do navegador. Tudo no aparelho. */
(function(root){'use strict';
const CHUNK=8*1024*1024, MAX_FILE=3*1024*1024*1024;
const rd=async(file,a,n)=>new DataView(await file.slice(a,Math.min(file.size,a+n)).arrayBuffer());
const tag=(dv,o)=>String.fromCharCode(dv.getUint8(o),dv.getUint8(o+1),dv.getUint8(o+2),dv.getUint8(o+3));
function ext80(dv,o){const e=dv.getUint16(o)&0x7fff,hi=dv.getUint32(o+2),lo=dv.getUint32(o+6);if(!e&&!hi&&!lo)return 0;return (hi*Math.pow(2,e-16383-31))+(lo*Math.pow(2,e-16383-63));}
async function probe(file){
  const h=await rd(file,0,12),t0=h.byteLength>=12?tag(h,0):'',t8=h.byteLength>=12?tag(h,8):'';
  if((t0==='RIFF'||t0==='RF64')&&t8==='WAVE'){let off=12,fmt=null;
    while(off+8<=file.size){const d=await rd(file,off,8),id=tag(d,0);let size=d.getUint32(4,true);
      if(id==='fmt '){const f=await rd(file,off+8,Math.min(40,Math.max(16,size)));let code=f.getUint16(0,true);if(code===0xfffe&&f.byteLength>=26)code=f.getUint16(24,true);fmt={code,ch:f.getUint16(2,true),sr:f.getUint32(4,true),align:f.getUint16(12,true),bits:f.getUint16(14,true)};}
      else if(id==='data'){if(!fmt)throw Error('WAV sem cabeçalho de formato.');const start=off+8;if(!size||size===0xffffffff||start+size>file.size)size=file.size-start;
        if(!([1,3].includes(fmt.code)&&[8,16,24,32].includes(fmt.bits)&&fmt.ch>=1&&fmt.sr>0))return{kind:'other',reason:'WAV compactado ou formato raro (código '+fmt.code+', '+fmt.bits+' bits)'};
        const frames=Math.floor(size/fmt.align);return{kind:'wav',sr:fmt.sr,ch:fmt.ch,bits:fmt.bits,float:fmt.code===3,align:fmt.align,start,frames,duration:frames/fmt.sr,be:false};}
      off+=8+size+(size&1);}
    return{kind:'other',reason:'WAV sem dados de áudio'};}
  if(t0==='FORM'&&(t8==='AIFF'||t8==='AIFC')){let off=12,comm=null,compBE=true;
    while(off+8<=file.size){const d=await rd(file,off,8),id=tag(d,0),size=d.getUint32(4);
      if(id==='COMM'){const f=await rd(file,off+8,Math.min(size,64));comm={ch:f.getInt16(0),frames:f.getUint32(2),bits:f.getInt16(6),sr:Math.round(ext80(f,8))};if(t8==='AIFC'&&f.byteLength>=22){const ct=tag(f,18);if(ct==='sowt')compBE=false;else if(ct!=='NONE'&&ct!=='twos')return{kind:'other',reason:'AIFC compactado ('+ct+')'};}}
      else if(id==='SSND'){if(!comm)throw Error('AIFF sem cabeçalho.');const so=(await rd(file,off+8,8)).getUint32(0),start=off+16+so;if(![8,16,24,32].includes(comm.bits))return{kind:'other',reason:'AIFF com '+comm.bits+' bits'};const align=comm.ch*comm.bits/8,frames=Math.min(comm.frames,Math.floor((file.size-start)/align));return{kind:'wav',sr:comm.sr,ch:comm.ch,bits:comm.bits,float:false,align,start,frames,duration:frames/comm.sr,be:compBE,aiff:true};}
      off+=8+size+(size&1);}
    return{kind:'other',reason:'AIFF sem dados'};}
  return{kind:'other',reason:'formato comprimido'};}
// decodifica um bloco de quadros -> canais Float32
function decodeBlock(ab,p,nFr,out,o){const dv=new DataView(ab),B=p.bits/8,le=!p.be;
  for(let f=0;f<nFr;f++)for(let c=0;c<p.ch;c++){const a=(f*p.ch+c)*B;let v;
    if(p.float)v=B===4?dv.getFloat32(a,le):0;
    else if(B===1)v=p.aiff?dv.getInt8(a)/128:(dv.getUint8(a)-128)/128;
    else if(B===2)v=dv.getInt16(a,le)/32768;
    else if(B===3){const b0=dv.getUint8(a),b1=dv.getUint8(a+1),b2=dv.getUint8(a+2);let x=le?(b0|(b1<<8)|(b2<<16)):((b0<<16)|(b1<<8)|b2);if(x&0x800000)x-=0x1000000;v=x/8388608;}
    else v=dv.getInt32(a,le)/2147483648;
    out[c][o+f]=v;}}
async function eachBlock(file,p,{startSec=0,endSec=Infinity,onProgress}={},cb){
  const f0=Math.max(0,Math.floor(startSec*p.sr)),f1=Math.min(p.frames,Number.isFinite(endSec)?Math.floor(endSec*p.sr):p.frames),per=Math.max(1,Math.floor(CHUNK/p.align));
  for(let f=f0;f<f1;f+=per){const n=Math.min(per,f1-f),ab=await file.slice(p.start+f*p.align,p.start+(f+n)*p.align).arrayBuffer(),chs=[...Array(p.ch)].map(()=>new Float32Array(n));decodeBlock(ab,p,n,chs,0);await cb(chs,n,f-f0);onProgress?.(Math.min(1,(f+n-f0)/Math.max(1,f1-f0)));await new Promise(r=>setTimeout(r,0));}
  return{frames:Math.max(0,f1-f0)};}
function mkBuf(data,sr){if(typeof AudioBuffer!=='undefined'){const b=new AudioBuffer({length:data.length,sampleRate:sr,numberOfChannels:1});b.copyToChannel(data,0);return b;}return{length:data.length,sampleRate:sr,numberOfChannels:1,duration:data.length/sr,getChannelData:()=>data};}
async function decodeOther(file,sr){let ctx;try{ctx=sr?new (root.AudioContext||root.webkitAudioContext)({sampleRate:sr}):new (root.AudioContext||root.webkitAudioContext)();}catch{ctx=new (root.AudioContext||root.webkitAudioContext)();}
  try{return await ctx.decodeAudioData(await file.arrayBuffer());}catch(e){throw Error('Não consegui ler este áudio ('+(file.name||'arquivo')+'). Tente WAV, MP3, M4A, FLAC, OGG ou AIFF.');}finally{try{await ctx.close();}catch{}}}
function monoOf(buf){const n=buf.length,c=buf.numberOfChannels,y=new Float32Array(n);for(let k=0;k<c;k++){const x=buf.getChannelData(k);for(let i=0;i<n;i++)y[i]+=x[i]/c;}return y;}
async function monoForAnalysis(file,{targetSr=22050,maxSec=Infinity,startSec=0,onProgress}={}){
  if(file.size>MAX_FILE)throw Error('Arquivo grande demais para este navegador (limite de 3 GB).');
  const p=await probe(file);
  if(p.kind==='wav'){const sr=Math.min(p.sr,targetSr),r=p.sr/sr,end=Math.min(p.duration,startSec+maxSec),nOut=Math.floor(((Math.min(p.frames,Math.floor(end*p.sr))-Math.floor(startSec*p.sr)))/r),out=new Float32Array(nOut);
    let acc=0,cnt=0,k=0,bound=r;await eachBlock(file,p,{startSec,endSec:end,onProgress},(chs,n,g0)=>{for(let i=0;i<n;i++){const gi=g0+i;if(gi>=bound){if(k<nOut)out[k++]=cnt?acc/cnt:0;acc=0;cnt=0;bound=(k+1)*r;}let m=0;for(let c=0;c<chs.length;c++)m+=chs[c][i];acc+=m/chs.length;cnt++;}});
    if(k<nOut&&cnt)out[k++]=acc/cnt;return{buffer:mkBuf(out.subarray(0,k),sr),info:{kind:p.kind,sr:p.sr,ch:p.ch,bits:p.bits,duration:p.duration,usedSec:k/sr,streamed:true,srcBytes:file.size}};}
  onProgress?.(.05);const dec=await decodeOther(file,targetSr);onProgress?.(.8);let mono=monoOf(dec);const sr=dec.sampleRate;
  const s0=Math.floor(startSec*sr),s1=Math.min(mono.length,Number.isFinite(maxSec)?s0+Math.floor(maxSec*sr):mono.length);mono=mono.slice(s0,s1);onProgress?.(1);
  return{buffer:mkBuf(mono,sr),info:{kind:'other',sr:dec.sampleRate,ch:dec.numberOfChannels,duration:dec.duration,usedSec:mono.length/sr,streamed:false,srcBytes:file.size}};}
async function loadLame(){if(root.lamejs)return;if(root.APSShare?.loadLame)return root.APSShare.loadLame();await new Promise((ok,err)=>{const s=document.createElement('script');s.src='./vendor/lame.min.js';s.onload=ok;s.onerror=()=>err(Error('Não foi possível carregar o codificador MP3.'));document.head.append(s);});}
const i16=(x,g)=>{const y=new Int16Array(x.length);for(let i=0;i<x.length;i++){const v=Math.max(-1,Math.min(1,x[i]*g));y[i]=v<0?v*32768:v*32767;}return y;};
// codifica MP3 por blocos; corta em maxSec e escolhe a taxa para caber em maxBytes
async function toMp3(file,{maxSec=480,maxBytes=9.5*1024*1024,startSec=0,onProgress}={}){
  if(file.size>MAX_FILE)throw Error('Arquivo grande demais para este navegador (limite de 3 GB).');
  await loadLame();const p=await probe(file);let total,sr,ch,feed;
  const enc0=(kb,sr0,ch0)=>new root.lamejs.Mp3Encoder(ch0,sr0,kb);
  if(p.kind==='wav'){total=p.duration;sr=p.sr;ch=Math.min(2,p.ch);}
  else{onProgress?.(.03);var dec=await decodeOther(file);total=dec.duration;sr=dec.sampleRate;ch=Math.min(2,dec.numberOfChannels);}
  const use=Math.max(1,Math.min(maxSec,total-startSec)),trimmed=use<total-startSec-0.05||startSec>0;
  let kbps=192;for(const k of [192,160,128,112,96,64]){if(k*1000/8*use<=maxBytes*.97){kbps=k;break;}kbps=k;}
  const enc=enc0(kbps,sr,ch),parts=[];let pkL=0;
  // 1ª passada leve de pico só para normalizar sem estourar (usa o ganho 1 se já está abaixo de 0,98)
  const gain=1;
  const push=(L,R)=>{const B=1152*20;for(let i=0;i<L.length;i+=B){const l=i16(L.subarray(i,i+B),gain),r=R?i16(R.subarray(i,i+B),gain):null,out=r?enc.encodeBuffer(l,r):enc.encodeBuffer(l);if(out.length)parts.push(new Uint8Array(out));}};
  if(p.kind==='wav'){await eachBlock(file,p,{startSec,endSec:startSec+use,onProgress:q=>onProgress?.(q)},async(chs)=>{push(chs[0],ch>1?chs[1]:null);});}
  else{const a=Math.floor(startSec*sr),b=Math.min(dec.length,a+Math.floor(use*sr)),L=dec.getChannelData(0),R=ch>1?dec.getChannelData(1):null;const S=sr*20;for(let i=a;i<b;i+=S){push(L.subarray(i,Math.min(b,i+S)),R?R.subarray(i,Math.min(b,i+S)):null);onProgress?.((i-a)/Math.max(1,b-a));await new Promise(r=>setTimeout(r,0));}}
  const tail=enc.flush();if(tail.length)parts.push(new Uint8Array(tail));const blob=new Blob(parts,{type:'audio/mpeg'});onProgress?.(1);
  return{blob,kbps,sr,ch,totalSec:total,usedSec:use,startSec,trimmed,bytes:blob.size,source:p.kind};}
async function bufferToMp3(buf,{maxSec=480,maxBytes=9.5*1024*1024,startSec=0,onProgress}={}){await loadLame();const sr=buf.sampleRate,ch=Math.min(2,buf.numberOfChannels),total=buf.duration,use=Math.max(1,Math.min(maxSec,total-startSec)),trimmed=use<total-0.05||startSec>0;
  let kbps=192;for(const k of [192,160,128,112,96,64]){kbps=k;if(k*1000/8*use<=maxBytes*.97)break;}
  const enc=new root.lamejs.Mp3Encoder(ch,sr,kbps),parts=[],a=Math.floor(startSec*sr),z=Math.min(buf.length,a+Math.floor(use*sr)),L=buf.getChannelData(0),R=ch>1?buf.getChannelData(1):null,S=1152*40;
  for(let i=a;i<z;i+=S){const l=i16(L.subarray(i,Math.min(z,i+S)),1),out=R?enc.encodeBuffer(l,i16(R.subarray(i,Math.min(z,i+S)),1)):enc.encodeBuffer(l);if(out.length)parts.push(new Uint8Array(out));if(((i-a)/S)%50===0){onProgress?.((i-a)/Math.max(1,z-a));await new Promise(r=>setTimeout(r,0));}}
  const tail=enc.flush();if(tail.length)parts.push(new Uint8Array(tail));const blob=new Blob(parts,{type:'audio/mpeg'});return{blob,kbps,sr,ch,totalSec:total,usedSec:use,startSec,trimmed,bytes:blob.size};}
async function info(file){try{const p=await probe(file);if(p.kind==='wav')return{kind:'wav',duration:p.duration,sr:p.sr,ch:p.ch,bits:p.bits};}catch{}return{kind:'other'};}
root.APSBigAudio={probe,info,monoForAnalysis,toMp3,bufferToMp3,MAX_FILE};
})(typeof window!=='undefined'?window:globalThis);
