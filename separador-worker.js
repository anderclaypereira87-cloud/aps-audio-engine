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
self.onmessage=async event=>{
 if(event.data?.type!=='separate')return;
 try{await separate(event.data.left,event.data.right);}
 catch(error){self.postMessage({type:'error',message:error?.message||String(error)});}
};
