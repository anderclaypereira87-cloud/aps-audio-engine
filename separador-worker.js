// APS Audio Engine v2.1.0: inferência ONNX em Web Worker.
// Sem envio do áudio ao servidor. Compatibilidade depende de memória e recursos do aparelho.
const MODELS={
 completo:{url:'https://huggingface.co/StemSplitio/htdemucs-6s-onnx/resolve/main/htdemucs_6s_fp16weights.onnx',mb:136,label:'Completo'},
 leve:{url:new URL('./models/htdemucs_6s_leve.onnx',self.location).href,mb:42,label:'Leve'}
};
const MODEL_CACHE='aps-models-v1';
// Baixa o modelo uma única vez e guarda no Cache Storage do aparelho.
async function modelBytes(engine){
 const m=MODELS[engine]||MODELS.completo;let cache=null;
 try{cache=await caches.open(MODEL_CACHE);const hit=await cache.match(m.url);if(hit){phase('Modelo '+m.label+' já está no aparelho (sem novo download). Carregando…',14);return new Uint8Array(await hit.arrayBuffer());}}catch{cache=null;}
 const res=await fetch(m.url);if(!res.ok)throw Error('Falha ao baixar o modelo ('+res.status+').');
 const total=Number(res.headers.get('content-length'))||m.mb*1048576;const reader=res.body.getReader();const parts=[];let got=0,last=0;
 for(;;){const {done,value}=await reader.read();if(done)break;parts.push(value);got+=value.length;if(got-last>2097152){last=got;phase('Baixando modelo '+m.label+': '+Math.round(got/1048576)+' de ~'+Math.round(total/1048576)+' MB (só na primeira vez)…',8+Math.round(6*got/total));}}
 const bytes=new Uint8Array(got);let at=0;for(const p of parts){bytes.set(p,at);at+=p.length;}parts.length=0;
 if(cache){try{await cache.put(m.url,new Response(bytes,{headers:{'content-type':'application/octet-stream'}}));}catch{}}
 return bytes;
}
async function makeSession(ort,engine){
 ort.env.wasm.wasmPaths=WASM_URL;ort.env.wasm.numThreads=1;ort.env.wasm.proxy=false;
 let bytes=await modelBytes(engine);
 phase('Preparando o modelo '+(MODELS[engine]||MODELS.completo).label+'…',16);
 // 'disabled': a otimização do ORT dobra constantes enormes deste modelo e estoura a memória (>4 GB).
 const opts={executionProviders:['wasm'],graphOptimizationLevel:'disabled',enableMemPattern:false,enableCpuMemArena:false};
 try{return await ort.InferenceSession.create(bytes,opts);}
 catch(e){phase('Tentando de novo em modo de compatibilidade…',17);ort.env.wasm.simd=false;return await ort.InferenceSession.create(bytes,opts);}
 finally{bytes=null;}
}
const ortUrl='https://cdn.jsdelivr.net/npm/onnxruntime-web@1.21.0/dist/ort.min.mjs';
const WASM_URL='https://cdn.jsdelivr.net/npm/onnxruntime-web@1.21.0/dist/';
const SEG=343980, OVERLAP=Math.floor(SEG/4), STRIDE=SEG-OVERLAP;
function phase(message,percent){self.postMessage({type:'phase',message,percent});}
function windowWeights(){const a=new Float32Array(SEG);a.fill(1);for(let i=0;i<OVERLAP;i++){a[i]=Math.max(1e-5,i/OVERLAP);a[SEG-1-i]=Math.max(1e-5,i/OVERLAP);}return a;}
async function separate(left,right,engine){
 phase('Baixando biblioteca de separação…',7);
 const ort=await import(ortUrl);
 const session=await makeSession(ort,engine);
 phase('Modelo carregado. Separando as pistas…',30);
 const total=left.length,steps=Math.ceil(total/STRIDE);
 const out=Array.from({length:6},()=>[new Float32Array(total),new Float32Array(total)]);
 const weights=new Float32Array(total),win=windowWeights(),buf=new Float32Array(2*SEG);
 for(let n=0;n<steps;n++){
  const start=n*STRIDE, len=Math.min(SEG,total-start);
  buf.fill(0);buf.set(left.subarray(start,start+len));buf.set(right.subarray(start,start+len),SEG);
  self.postMessage({type:'phase',message:`Processando bloco ${n+1} de ${steps} (~7,8 s de música cada)…`,percent:30+Math.round(65*n/steps),block:n+1,steps});
  const input=new ort.Tensor('float32',buf,[1,2,SEG]);
  const prediction=await session.run({mix:input});
  const stems=prediction.stems?.data;
  try{input.dispose?.();}catch{}
  if(!stems||stems.length!==6*2*SEG)throw Error('O motor retornou formato inválido; separação não concluída.');
  for(let j=0;j<len;j++){
   const index=start+j,w=win[j];weights[index]+=w;
   for(let track=0;track<6;track++){
    out[track][0][index]+=stems[(track*2)*SEG+j]*w;
    out[track][1][index]+=stems[(track*2+1)*SEG+j]*w;
   }
  }
  // libera a memória do bloco antes do próximo
  try{prediction.stems?.dispose?.();}catch{}
 }
 for(const pair of out){for(const channel of pair){for(let j=0;j<total;j++)channel[j]/=Math.max(weights[j],1e-7);}}
 left=null;right=null;
 phase('Seis pistas processadas. Transferindo resultados…',98);
 const buffers=out.map(pair=>[pair[0].buffer,pair[1].buffer]);
 self.postMessage({type:'result',stems:buffers},buffers.flat());
 try{await session.release();}catch{}
}
// Saída segmentada: evita guardar seis músicas completas como Float32Array.
// Qualidade compacta 22,05kHz/mono ou estéreo 44,1kHz. Sem quantização temporal.
async function separateStream(left,right,quality,engine){
 phase('Preparando motor de separação dentro do APS…',5);
 const ort=await import(ortUrl);
 const session=await makeSession(ort,engine);
 const total=left.length,nchunks=Math.ceil(total/SEG);
 const mobile=quality!=='studio',buf=new Float32Array(2*SEG);
 const targetRate=mobile?22050:44100,channels=mobile?1:2;
 phase('Separando sem alterar a duração e o andamento…',20);
 for(let n=0;n<nchunks;n++){
  const start=n*SEG,length=Math.min(SEG,total-start);
  buf.fill(0);
  buf.set(left.subarray(start,start+length),0);
  buf.set(right.subarray(start,start+length),SEG);
  self.postMessage({type:'phase',message:'Separando bloco '+(n+1)+' de '+nchunks+' (~7,8 s cada)…',percent:20+Math.round(78*n/nchunks),block:n+1,steps:nchunks});
  const tin=new ort.Tensor('float32',buf,[1,2,SEG]);const pred=await session.run({mix:tin});try{tin.dispose?.();}catch{}
  const data=pred.stems?.data;
  if(!data||data.length!==6*2*SEG)throw Error('Resposta do motor incompatível. Nenhuma pista sintética foi criada.');
  const count=mobile?Math.ceil(length/2):length;
  const chunks=[];
  for(let track=0;track<6;track++){
   const pcm=new ArrayBuffer(count*channels*2),view=new DataView(pcm);
   const offset=track*2*SEG;
   for(let i=0;i<count;i++){
    const j=mobile?i*2:i;
    const l=mobile?(data[offset+j]+data[offset+Math.min(length-1,j+1)])*.5:data[offset+j];
    const r=mobile?(data[offset+SEG+j]+data[offset+SEG+Math.min(length-1,j+1)])*.5:data[offset+SEG+j];
    const put=(position,x)=>view.setInt16(position,Math.round(Math.max(-1,Math.min(1,x))*32767),true);
    if(mobile)put(i*2,(l+r)*.5);else{put(i*4,l);put(i*4+2,r);}
   }
   chunks.push(pcm);
  }
  try{pred.stems?.dispose?.();}catch{}
  self.postMessage({type:'chunk',parts:chunks,frames:count,index:n,total:nchunks,rate:targetRate,channels},chunks);
  
 }
 try{await session.release();}catch{}
 self.postMessage({type:'done',rate:targetRate,channels,frames:mobile?Math.ceil(total/2):total});
}
self.onmessage=async event=>{
 if(event.data?.type!=='separate')return;
 try{if(event.data.mode==='stream')await separateStream(event.data.left,event.data.right,event.data.quality,event.data.engine);else await separate(event.data.left,event.data.right,event.data.engine);}
 catch(error){self.postMessage({type:'error',message:error?.message||String(error)});}
};
