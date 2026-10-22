// APS Audio Engine v1.8.0: inferência ONNX em Web Worker.
// Sem envio do áudio ao servidor. Compatibilidade depende de memória e recursos do aparelho.
const modelUrl='https://huggingface.co/StemSplitio/htdemucs-6s-onnx/resolve/main/htdemucs_6s_fp16weights.onnx';
const ortUrl='https://cdn.jsdelivr.net/npm/onnxruntime-web@1.21.0/dist/ort.min.mjs';
const WASM_URL='https://cdn.jsdelivr.net/npm/onnxruntime-web@1.21.0/dist/';
const SEG=343980, OVERLAP=Math.floor(SEG/4), STRIDE=SEG-OVERLAP;
function phase(message,percent){self.postMessage({type:'phase',message,percent});}
function windowWeights(){const a=new Float32Array(SEG);a.fill(1);for(let i=0;i<OVERLAP;i++){a[i]=Math.max(1e-5,i/OVERLAP);a[SEG-1-i]=Math.max(1e-5,i/OVERLAP);}return a;}
async function separate(left,right){
 phase('Baixando biblioteca de separação…',7);
 const ort=await import(ortUrl);
 ort.env.wasm.wasmPaths=WASM_URL;
 ort.env.wasm.numThreads=1;
 ort.env.wasm.proxy=false;
 phase('Carregando modelo de seis pistas (136 MB). A primeira vez pode demorar alguns minutos…',12);
 const session=await ort.InferenceSession.create(modelUrl,{executionProviders:['wasm'],graphOptimizationLevel:'all'});
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
async function separateStream(left,right,quality){
 phase('Preparando motor de separação dentro do APS…',5);
 const ort=await import(ortUrl);
 ort.env.wasm.wasmPaths=WASM_URL;
 ort.env.wasm.numThreads=1;
 ort.env.wasm.proxy=false;
 phase('Carregando modelo local (136 MB). Mantenha esta tela aberta…',10);
 const session=await ort.InferenceSession.create(modelUrl,{executionProviders:['wasm'],graphOptimizationLevel:'all'});
 const total=left.length,nchunks=Math.ceil(total/SEG);
 const mobile=quality!=='studio',buf=new Float32Array(2*SEG);
 const targetRate=mobile?22050:44100,channels=mobile?1:2;
 phase('Separando sem alterar a duração e o andamento…',20);
 for(let n=0;n<nchunks;n++){
  const start=n*SEG,length=Math.min(SEG,total-start);
  buf.fill(0);
  buf.set(left.subarray(start,start+length),0);
  buf.set(right.subarray(start,start+length),SEG);
  const pred=await session.run({mix:new ort.Tensor('float32',buf,[1,2,SEG])});
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
  self.postMessage({type:'chunk',parts:chunks,frames:count,index:n,total:nchunks,rate:targetRate,channels},chunks);
  phase('Bloco '+(n+1)+' de '+nchunks+' processado · continue no APS',20+Math.round(78*(n+1)/nchunks));
 }
 try{await session.release();}catch{}
 self.postMessage({type:'done',rate:targetRate,channels,frames:mobile?Math.ceil(total/2):total});
}
self.onmessage=async event=>{
 if(event.data?.type!=='separate')return;
 try{if(event.data.mode==='stream')await separateStream(event.data.left,event.data.right,event.data.quality);else await separate(event.data.left,event.data.right);}
 catch(error){self.postMessage({type:'error',message:error?.message||String(error)});}
};
