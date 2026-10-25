// APS Audio Engine v4.0: inferência HTDemucs-6s (ONNX) em Web Worker, 100% no aparelho.
// Nada é enviado a servidor. Se o modelo falhar, o worker devolve erro: nenhuma pista é inventada.
import {SEG,StreamOLA,PcmWriter} from './aps-sep-core.js?v=400';
const ORT_VER='1.21.0';
const ORT_URL=`https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VER}/dist/ort.min.mjs`;
const WASM_URL=`https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VER}/dist/`;
export const MODELS={
 // Pesos completos fp16 hospedados no Hugging Face (StemSplitio/htdemucs-6s-onnx, licença MIT).
 completo:{url:'https://huggingface.co/StemSplitio/htdemucs-6s-onnx/resolve/main/htdemucs_6s_fp16weights.onnx',mb:136,label:'Completo'},
 // Pesos int8 por canal, gerados pelo APS (models/quantizar_pesos_int8.py), servidos pelo próprio site.
 leve:{url:new URL('./models/htdemucs_6s_leve_v2.onnx',self.location).href,mb:42,label:'Leve'}
};
const MODEL_CACHE='aps-models-v1';
let cancelled=false;
const phase=(message,percent,extra={})=>self.postMessage({type:'phase',message,percent,...extra});
const mem=()=>{try{return performance.memory?Math.round(performance.memory.usedJSHeapSize/1048576):null;}catch{return null;}};

async function modelBytes(engine){
 const m=MODELS[engine];if(!m)throw Error('Motor desconhecido: '+engine);let cache=null;
 try{cache=await caches.open(MODEL_CACHE);const hit=await cache.match(m.url);if(hit){phase('Modelo '+m.label+' já está no aparelho. Carregando…',14);return new Uint8Array(await hit.arrayBuffer());}}catch{cache=null;}
 let res;try{res=await fetch(m.url);}catch(e){throw Error('Sem conexão para baixar o modelo '+m.label+' ('+e.message+').');}
 if(!res.ok)throw Error('Falha ao baixar o modelo '+m.label+' (HTTP '+res.status+').');
 const total=Number(res.headers.get('content-length'))||m.mb*1048576,reader=res.body.getReader(),parts=[];let got=0,last=0;
 for(;;){if(cancelled)throw Error('Cancelado');const {done,value}=await reader.read();if(done)break;parts.push(value);got+=value.length;
  if(got-last>2097152){last=got;phase('Baixando modelo '+m.label+': '+Math.round(got/1048576)+' de ~'+Math.round(total/1048576)+' MB (só na primeira vez)…',4+Math.round(10*got/total));}}
 const bytes=new Uint8Array(got);let at=0;for(const p of parts){bytes.set(p,at);at+=p.length;}parts.length=0;
 if(got<1e6)throw Error('Arquivo do modelo incompleto ('+got+' bytes).');
 if(cache){try{await cache.put(m.url,new Response(bytes,{headers:{'content-type':'application/octet-stream'}}));}catch{}}
 return bytes;
}
async function makeSession(ort,engine,threads){
 ort.env.wasm.wasmPaths=WASM_URL;ort.env.wasm.numThreads=Math.max(1,threads|0);ort.env.wasm.proxy=false;
 let bytes=await modelBytes(engine);
 phase('Preparando o modelo '+MODELS[engine].label+' na memória…',16);
 // 'disabled': a otimização do ORT dobra constantes enormes deste modelo e estoura a memória (>4 GB).
 const opts={executionProviders:['wasm'],graphOptimizationLevel:'disabled',enableMemPattern:false,enableCpuMemArena:false};
 try{return await ort.InferenceSession.create(bytes,opts);}
 catch(e){
  if(/memory|alloc|OOM|RangeError/i.test(String(e)))throw Error('Memória insuficiente para carregar o modelo neste aparelho ('+e.message+').');
  phase('Tentando de novo em modo de compatibilidade (sem SIMD)…',17);ort.env.wasm.simd=false;return await ort.InferenceSession.create(bytes,opts);
 }finally{bytes=null;}
}
async function separate({left,right,quality,engine,threads}){
 const total=left.length;if(!total)throw Error('Áudio vazio.');
 phase('Baixando a biblioteca ONNX Runtime Web '+ORT_VER+'…',3);
 let ort;try{ort=await import(ORT_URL);}catch(e){throw Error('Não consegui carregar o ONNX Runtime ('+e.message+').');}
 const session=await makeSession(ort,engine,threads);
 const ola=new StreamOLA(total),steps=ola.steps,buf=new Float32Array(2*SEG);
 const writers=Array.from({length:6},()=>new PcmWriter(quality!=='studio'));
 const t0=performance.now();let sigE=0,resE=0;
 phase('Modelo pronto. Separando '+steps+' bloco(s) de ~7,8 s com 25% de sobreposição…',20,{steps});
 for(let n=0;n<steps;n++){
  if(cancelled)throw Error('Cancelado');
  ola.input(left,right,buf);
  const tin=new ort.Tensor('float32',buf,[1,2,SEG]);let pred;
  try{pred=await session.run({mix:tin});}
  catch(e){throw Error(/memory|alloc|OOM|RangeError/i.test(String(e))?'Memória insuficiente durante o bloco '+(n+1)+'. Tente um trecho menor ou o modo leve.':'Falha do modelo no bloco '+(n+1)+': '+e.message);}
  finally{try{tin.dispose?.();}catch{}}
  const data=pred.stems?.data;
  if(!data||data.length!==6*2*SEG){try{pred.stems?.dispose?.();}catch{}throw Error('Resposta do modelo com formato inesperado. Nenhuma pista foi criada.');}
  for(let i=0;i<data.length;i+=4099)if(!Number.isFinite(data[i]))throw Error('O modelo devolveu valores inválidos (NaN) no bloco '+(n+1)+'.');
  const out=ola.push(data);try{pred.stems?.dispose?.();}catch{}
  // Verificação honesta: a soma das 6 pistas deve se aproximar da mistura original.
  for(let j=0;j<out.frames;j++){const i=out.start+j;for(let c=0;c<2;c++){const x=c?right[i]:left[i];let sum=0;for(let s=0;s<6;s++)sum+=out.data[s][c][j];sigE+=x*x;resE+=(x-sum)*(x-sum);}}
  const parts=out.data.map(([l,r],s)=>writers[s].write(l,r));
  if(out.done)parts.forEach((p,s)=>{const tail=writers[s].flush();if(tail.byteLength){const m=new Uint8Array(p.byteLength+tail.byteLength);m.set(new Uint8Array(p));m.set(new Uint8Array(tail),p.byteLength);parts[s]=m.buffer;}});
  const elapsed=(performance.now()-t0)/1000;
  self.postMessage({type:'chunk',parts,index:n,total:steps},parts);
  phase('Bloco '+(n+1)+' de '+steps+' concluído ('+elapsed.toFixed(0)+' s).',20+Math.round(78*(n+1)/steps),{block:n+1,steps,blockSeconds:elapsed/(n+1),heapMB:mem()});
 }
 try{await session.release();}catch{}
 const w=writers[0];
 self.postMessage({type:'done',rate:w.rate,channels:w.channels,frames:w.frames,inputFrames:total,sumSnrDb:10*Math.log10((sigE+1e-12)/(resE+1e-12)),seconds:(performance.now()-t0)/1000});
}
self.onmessage=async event=>{
 const d=event.data;
 if(d?.type==='cancel'){cancelled=true;return;}
 if(d?.type!=='separate')return;
 try{await separate(d);}catch(error){self.postMessage({type:'error',message:error?.message||String(error),cancelled});}
};
