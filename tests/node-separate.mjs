// Roda o MESMO núcleo de blocos/overlap-add do navegador (aps-sep-core.js) com o motor ONNX nativo
// (onnxruntime-node), para medir sincronismo, duração, soma das pistas e memória em músicas longas.
// Uso: NODE_PATH=... node tests/node-separate.mjs modelo.onnx entrada.wav saida_dir [studio|mobile]
import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
import {SEG,StreamOLA,PcmWriter,wavHeader,SOURCES} from '../aps-sep-core.js';
const require=createRequire(process.env.ORT_DIR+'/');const ort=require('onnxruntime-node');
const [model,input,outDir,quality='studio']=process.argv.slice(2);fs.mkdirSync(outDir,{recursive:true});
function readWav(p){const b=fs.readFileSync(p);let o=12,fmt,data;while(o<b.length){const id=b.toString('ascii',o,o+4),sz=b.readUInt32LE(o+4);if(id==='fmt ')fmt={ch:b.readUInt16LE(o+10),sr:b.readUInt32LE(o+12)};if(id==='data')data=b.subarray(o+8,o+8+sz);o+=8+sz;}
 const n=data.length/2/fmt.ch,L=new Float32Array(n),R=new Float32Array(n);for(let i=0;i<n;i++){L[i]=data.readInt16LE(i*2*fmt.ch)/32768;R[i]=data.readInt16LE((i*fmt.ch+fmt.ch-1)*2)/32768;}return {L,R,sr:fmt.sr};}
const {L,R,sr}=readWav(input);if(sr!==44100)throw Error('fixture deve ser 44,1 kHz');
const opts={graphOptimizationLevel:'disabled',enableMemPattern:false,enableCpuMemArena:false,intraOpNumThreads:Number(process.env.THREADS||4)};
const t0=Date.now();const s=await ort.InferenceSession.create(model,opts);const tLoad=(Date.now()-t0)/1000;
const ola=new StreamOLA(L.length,process.env.OVERLAP?{overlap:Number(process.env.OVERLAP)}:{}),buf=new Float32Array(2*SEG),writers=SOURCES.map(()=>new PcmWriter(quality!=='studio'));
const fds=SOURCES.map(x=>{const f=path.join(outDir,x.id+'.wav');const fd=fs.openSync(f,'w');fs.writeSync(fd,Buffer.alloc(44));return fd;});
let peakRss=0,sigE=0,resE=0;const t1=Date.now();
for(let n=0;n<ola.steps;n++){ola.input(L,R,buf);const r=await s.run({mix:new ort.Tensor('float32',buf,[1,2,SEG])});const out=ola.push(r.stems.data);
 for(let j=0;j<out.frames;j++){const i=out.start+j;for(let c=0;c<2;c++){const x=c?R[i]:L[i];let sum=0;for(let k=0;k<6;k++)sum+=out.data[k][c][j];sigE+=x*x;resE+=(x-sum)**2;}}
 out.data.forEach(([l,rr],k)=>{fs.writeSync(fds[k],Buffer.from(writers[k].write(l,rr)));if(out.done)fs.writeSync(fds[k],Buffer.from(writers[k].flush()));});
 peakRss=Math.max(peakRss,process.memoryUsage().rss);process.stderr.write(`bloco ${n+1}/${ola.steps}\r`);}
fds.forEach((fd,k)=>{fs.writeSync(fd,Buffer.from(wavHeader(writers[k].frames,writers[k].rate,writers[k].channels)),0,44,0);fs.closeSync(fd);});
const res={input,seconds:L.length/sr,blocks:ola.steps,loadSec:tLoad,runSec:(Date.now()-t1)/1000,rtf:((Date.now()-t1)/1000)/(L.length/sr),peakRssMB:Math.round(peakRss/1048576),sumSnrDb:+(10*Math.log10(sigE/resE)).toFixed(2),outFrames:writers[0].frames,outRate:writers[0].rate,quality};
console.log(JSON.stringify(res));fs.writeFileSync(path.join(outDir,'result.json'),JSON.stringify(res,null,1));
