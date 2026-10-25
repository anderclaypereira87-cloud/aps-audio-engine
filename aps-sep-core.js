// APS Audio Engine · núcleo da separação (sem DOM). Usado pelo separador-worker.js,
// pelo separador.js e pelos testes em node (tests/). Nenhuma função aqui cria áudio:
// apenas recorta, junta (overlap-add), converte e empacota o que o modelo devolveu.
export const SAMPLE_RATE=44100;
export const SEG=343980;                 // janela fixa do HTDemucs-6s exportado (~7,8 s a 44,1 kHz)
export const OVERLAP=Math.floor(SEG/4);  // 25% de sobreposição entre blocos
export const STRIDE=SEG-OVERLAP;
// Ordem das saídas do htdemucs_6s: drums, bass, other, vocals, guitar, piano.
export const SOURCES=[
 {name:'Bateria',id:'bateria',head:'🥁',key:'drums'},
 {name:'Baixo',id:'baixo',head:'🎸',key:'bass'},
 {name:'Outros',id:'outros',head:'🎼',key:'other'},
 {name:'Voz',id:'voz',head:'🎤',key:'vocals'},
 {name:'Guitarra',id:'guitarra',head:'🎸',key:'guitar'},
 {name:'Teclado / Piano',id:'piano',head:'🎹',key:'piano'}];

export function blockCount(total){return total<=SEG?1:1+Math.ceil((total-SEG)/STRIDE);}
export function windowWeights(seg=SEG,overlap=OVERLAP){const a=new Float32Array(seg).fill(1);for(let i=0;i<overlap;i++){const w=Math.max(1e-3,(i+1)/(overlap+1));a[i]=w;a[seg-1-i]=w;}return a;}

// Overlap-add em fluxo: guarda só um bloco de acumulação (6×2×SEG floats ≈ 16 MB),
// e devolve, a cada bloco, o trecho que já não será mais tocado por blocos futuros.
// Assim a memória não cresce com a duração da música e não há "emenda" a cada 7,8 s.
export class StreamOLA{
 constructor(total,{seg=SEG,overlap=OVERLAP,sources=6,channels=2}={}){
  this.total=total;this.seg=seg;this.overlap=overlap;this.stride=seg-overlap;this.S=sources;this.C=channels;
  this.win=windowWeights(seg,overlap);this.acc=Array.from({length:sources*channels},()=>new Float32Array(seg));this.w=new Float32Array(seg);
  this.n=0;this.emitted=0;this.steps=total<=seg?1:1+Math.ceil((total-seg)/this.stride);
 }
 // Copia o bloco n da mistura (com zeros depois do fim) para buf [2*seg].
 input(left,right,buf){const start=this.n*this.stride,len=Math.max(0,Math.min(this.seg,this.total-start));buf.fill(0);buf.set(left.subarray(start,start+len),0);buf.set(right.subarray(start,start+len),this.seg);return len;}
 // stems: Float32Array [S][C][seg] achatado. Retorna {frames, data:[S][C] Float32Array} finalizados.
 push(stems){
  const {seg,stride,S,C}=this,start=this.n*stride,len=Math.min(seg,this.total-start),first=this.n===0,last=this.n===this.steps-1;
  for(let j=0;j<len;j++){const w=(first&&j<this.overlap)||(last&&j>=seg-this.overlap)?1:this.win[j];this.w[j]+=w;
   for(let k=0;k<S*C;k++)this.acc[k][j]+=stems[k*seg+j]*w;}
  const ready=last?len:Math.min(stride,len);
  const data=[];for(let s=0;s<S;s++){const pair=[];for(let c=0;c<C;c++){const a=this.acc[s*C+c],o=new Float32Array(ready);for(let j=0;j<ready;j++)o[j]=a[j]/Math.max(this.w[j],1e-7);pair.push(o);}data.push(pair);}
  // desloca o acumulador
  for(const a of this.acc){a.copyWithin(0,stride);a.fill(0,seg-stride);}this.w.copyWithin(0,stride);this.w.fill(0,seg-stride);
  this.n++;this.emitted+=ready;return {frames:ready,start,data,done:last};
 }
}

// Conversão para PCM 16 bits. Modo "mobile": mono 22,05 kHz (média de pares de amostras,
// com 1 amostra guardada entre blocos para não perder sincronismo).
export class PcmWriter{
 constructor(mobile){this.mobile=mobile;this.carry=null;this.rate=mobile?22050:SAMPLE_RATE;this.channels=mobile?1:2;this.frames=0;}
 write(l,r){
  if(!this.mobile){const n=l.length,b=new ArrayBuffer(n*4),v=new DataView(b);for(let i=0;i<n;i++){v.setInt16(i*4,q(l[i]),true);v.setInt16(i*4+2,q(r[i]),true);}this.frames+=n;return b;}
  let m=new Float32Array(l.length+(this.carry===null?0:1)),o=0;if(this.carry!==null){m[0]=this.carry;o=1;}
  for(let i=0;i<l.length;i++)m[o+i]=(l[i]+r[i])*.5;
  const pairs=Math.floor(m.length/2),b=new ArrayBuffer(pairs*2),v=new DataView(b);
  for(let i=0;i<pairs;i++)v.setInt16(i*2,q((m[2*i]+m[2*i+1])*.5),true);
  this.carry=m.length%2?m[m.length-1]:null;this.frames+=pairs;return b;
 }
 flush(){if(this.carry===null)return new ArrayBuffer(0);const b=new ArrayBuffer(2);new DataView(b).setInt16(0,q(this.carry),true);this.carry=null;this.frames++;return b;}
}
function q(x){x=Math.max(-1,Math.min(1,x));return Math.round(x<0?x*32768:x*32767);}

export function wavHeader(frames,rate,channels){
 const length=frames*channels*2,b=new ArrayBuffer(44),v=new DataView(b);
 const str=(o,t)=>{for(let i=0;i<t.length;i++)v.setUint8(o+i,t.charCodeAt(i));};
 str(0,'RIFF');v.setUint32(4,36+length,true);str(8,'WAVE');str(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,channels,true);
 v.setUint32(24,rate,true);v.setUint32(28,rate*channels*2,true);v.setUint16(32,channels*2,true);v.setUint16(34,16,true);str(36,'data');v.setUint32(40,length,true);return b;
}
export function pcmToWav(left,right,rate=SAMPLE_RATE){const w=new PcmWriter(false);w.rate=rate;const body=w.write(left,right);return new Blob([wavHeader(left.length,rate,2),body],{type:'audio/wav'});}

// ZIP sem compressão (método "store"), montado a partir de Blobs, sem copiar tudo para a memória.
const CRC=(()=>{const t=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xEDB88320^(c>>>1):c>>>1;t[n]=c>>>0;}return t;})();
export function crc32(bytes,crc=0){crc=~crc>>>0;for(let i=0;i<bytes.length;i++)crc=CRC[(crc^bytes[i])&255]^(crc>>>8);return (~crc)>>>0;}
async function blobCrc(blob){let c=0;const step=8<<20;for(let o=0;o<blob.size;o+=step)c=crc32(new Uint8Array(await blob.slice(o,o+step).arrayBuffer()),c);return c;}
export async function zipBlobs(files,onProgress){
 const enc=new TextEncoder(),parts=[],central=[];let offset=0;const now=new Date();
 const dosT=(now.getHours()<<11)|(now.getMinutes()<<5)|(now.getSeconds()>>1),dosD=((now.getFullYear()-1980)<<9)|((now.getMonth()+1)<<5)|now.getDate();
 for(let i=0;i<files.length;i++){const {name,blob}=files[i];onProgress?.(i,files.length);
  const crc=await blobCrc(blob),nm=enc.encode(name),size=blob.size;if(offset+size>0xFFFFFFF0)throw Error('ZIP passaria de 4 GB; baixe as pistas separadamente.');
  const h=new DataView(new ArrayBuffer(30));h.setUint32(0,0x04034b50,true);h.setUint16(4,20,true);h.setUint16(6,0x0800,true);h.setUint16(8,0,true);h.setUint16(10,dosT,true);h.setUint16(12,dosD,true);h.setUint32(14,crc,true);h.setUint32(18,size,true);h.setUint32(22,size,true);h.setUint16(26,nm.length,true);h.setUint16(28,0,true);
  parts.push(h.buffer,nm,blob);
  const c=new DataView(new ArrayBuffer(46));c.setUint32(0,0x02014b50,true);c.setUint16(4,20,true);c.setUint16(6,20,true);c.setUint16(8,0x0800,true);c.setUint16(10,0,true);c.setUint16(12,dosT,true);c.setUint16(14,dosD,true);c.setUint32(16,crc,true);c.setUint32(20,size,true);c.setUint32(24,size,true);c.setUint16(28,nm.length,true);c.setUint32(42,offset,true);
  central.push(c.buffer,nm);offset+=30+nm.length+size;}
 const cdSize=central.reduce((s,p)=>s+(p.byteLength??p.length),0),e=new DataView(new ArrayBuffer(22));
 e.setUint32(0,0x06054b50,true);e.setUint16(8,files.length,true);e.setUint16(10,files.length,true);e.setUint32(12,cdSize,true);e.setUint32(16,offset,true);
 return new Blob([...parts,...central,e.buffer],{type:'application/zip'});
}

// Limites por aparelho. Valores medidos/estimados documentados em docs/separacao.md.
// Retorna {local, engines, maxSeconds, reason}. "local:false" = o aparelho não deve rodar o modelo.
export function deviceLimits({deviceMemory=null,cores=null,mobile=false,wasmThreads=false,webgpu=false}={}){
 const mem=deviceMemory;let maxSeconds,engines,local=true,reason;
 if(mem!==null&&mem<2){local=false;engines=[];maxSeconds=0;reason='Memória informada abaixo de 2 GB: o modelo (~1,2 GB em uso) não cabe com segurança neste aparelho.';}
 else if(mem!==null&&mem<4||(mobile&&mem===null)){engines=['leve'];maxSeconds=mobile?30:60;reason='Pouca memória (ou memória não informada no celular): só modo leve, até '+(mobile?30:60)+' s.';}
 else if(mem!==null&&mem<8||mobile){engines=['leve'];maxSeconds=mobile?60:180;reason='Memória intermediária: modo leve, até '+(mobile?'1 min':'3 min')+'.';}
 else {engines=['leve','completo'];maxSeconds=600;reason='Aparelho com 8 GB ou mais (ou desktop sem informação): até 10 min; pode demorar muito.';}
 return {local,engines,maxSeconds,reason,threads:wasmThreads?Math.min(4,cores||1):1,webgpu};
}

// Métricas para testes e para a tela (não alteram áudio).
export function rms(x){let s=0;for(let i=0;i<x.length;i++)s+=x[i]*x[i];return Math.sqrt(s/Math.max(1,x.length));}
export function bestLag(a,b,maxLag=2048,len=Math.min(a.length,b.length,441000)){let best=0,bv=-Infinity;for(let L=-maxLag;L<=maxLag;L+=1){let s=0;for(let i=Math.max(0,-L);i<len&&i+L<len;i+=4)s+=a[i]*b[i+L];if(s>bv){bv=s;best=L;}}return best;}
export function snrDb(ref,est){let n=0,e=0;const m=Math.min(ref.length,est.length);for(let i=0;i<m;i++){n+=ref[i]*ref[i];const d=ref[i]-est[i];e+=d*d;}return 10*Math.log10((n+1e-12)/(e+1e-12));}
