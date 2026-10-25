// Testes do núcleo sem modelo: overlap-add, contagem de quadros, WAV e ZIP. node tests/core.test.mjs
import assert from 'node:assert/strict';import fs from 'node:fs';import {execSync} from 'node:child_process';
import {SEG,StreamOLA,PcmWriter,wavHeader,zipBlobs,blockCount,deviceLimits,crc32} from '../aps-sep-core.js';
let ok=0;const t=(n,f)=>{f();ok++;console.log('ok',n);};
for(const total of [1000,SEG,SEG+1,3*SEG+12345,44100*61+7]){
 t('OLA identidade '+total,()=>{const L=new Float32Array(total).map((_,i)=>Math.sin(i*.01)),R=L.map(x=>-x);const ola=new StreamOLA(total),buf=new Float32Array(2*SEG);let got=0;const outL=new Float32Array(total);
  assert.equal(ola.steps,blockCount(total));
  for(let n=0;n<ola.steps;n++){ola.input(L,R,buf);const st=new Float32Array(12*SEG);for(let s=0;s<6;s++){st.set(buf.subarray(0,SEG),(s*2)*SEG);st.set(buf.subarray(SEG),(s*2+1)*SEG);}
   for(let i=0;i<st.length;i++)st[i]/=6;const o=ola.push(st);assert.equal(o.start,got);for(let j=0;j<o.frames;j++){let s=0;for(let k=0;k<6;k++)s+=o.data[k][0][j];outL[got+j]=s;}got+=o.frames;}
  assert.equal(got,total);let err=0;for(let i=0;i<total;i++)err=Math.max(err,Math.abs(outL[i]-L[i]));assert.ok(err<1e-5,'erro '+err);});
}
t('PcmWriter mono 22k mantém duração (ímpar)',()=>{const w=new PcmWriter(true);let bytes=0;for(const n of [257985,257985,1001])bytes+=w.write(new Float32Array(n),new Float32Array(n)).byteLength;bytes+=w.flush().byteLength;assert.equal(w.frames,Math.ceil((257985*2+1001)/2));assert.equal(bytes,w.frames*2);});
t('crc32',()=>assert.equal(crc32(new TextEncoder().encode('123456789')),0xCBF43926));
t('limites',()=>{assert.equal(deviceLimits({deviceMemory:1}).local,false);assert.equal(deviceLimits({deviceMemory:2,mobile:true}).maxSeconds,30);assert.deepEqual(deviceLimits({deviceMemory:8}).engines,['leve','completo']);});
const files=[{name:'a.wav',blob:new Blob([wavHeader(0,44100,2)])},{name:'b.wav',blob:new Blob([new Uint8Array(100000).fill(7)])}];
const z=await zipBlobs(files);fs.writeFileSync('/tmp/aps-core-test.zip',Buffer.from(await z.arrayBuffer()));
t('zip válido (python zipfile.testzip)',()=>assert.match(execSync(`python3 -c "import zipfile;z=zipfile.ZipFile('/tmp/aps-core-test.zip');print(z.testzip(),z.namelist())"`).toString(),/None \['a.wav', 'b.wav'\]/));
console.log(ok,'testes ok');
