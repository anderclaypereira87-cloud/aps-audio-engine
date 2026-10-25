// node tests/daw-io.test.mjs — testes das funções puras de aps-daw-io.js
import {createRequire} from 'module';import assert from 'assert';
const IO=createRequire(import.meta.url)('../aps-daw-io.js');let n=0;const t=(name,f)=>{f();n++;console.log('ok',name);};
function wav(frames,rate=48000,ch=1){const b=new ArrayBuffer(44+frames*ch*2),v=new DataView(b),w=(o,s)=>[...s].forEach((c,i)=>v.setUint8(o+i,c.charCodeAt(0)));w(0,'RIFF');v.setUint32(4,36+frames*ch*2,true);w(8,'WAVE');w(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,ch,true);v.setUint32(24,rate,true);v.setUint32(28,rate*ch*2,true);v.setUint16(32,ch*2,true);v.setUint16(34,16,true);w(36,'data');v.setUint32(40,frames*ch*2,true);return b;}
t('wavInfo lê duração',()=>{const i=IO.wavInfo(wav(48000*3,48000,2));assert.equal(i.rate,48000);assert.equal(i.channels,2);assert.equal(i.duration,3);});
t('wavInfo rejeita não-WAV',()=>assert.equal(IO.wavInfo(new ArrayBuffer(64)),null));
t('classify',()=>{assert.equal(IO.classify({name:'a.webm',type:'video/webm'}),'video');assert.equal(IO.classify({name:'a.wav',type:''}),'wav');assert.equal(IO.classify({name:'a.m4a',type:'audio/mp4'}),'audio');});
t('codecMessage cita codec e WAV',()=>assert.match(IO.codecMessage({name:'x.mp4',type:'video/mp4'},Error('EncodingError')),/vídeo.*WAV/s));
function sim(delay,{noise=0.002,rate=48000,jitter=0,miss=0}={}){const clicks=[],rec=new Float32Array(rate*4);let seed=1;const rnd=()=>((seed=seed*16807%2147483647)/2147483647-.5);for(let i=0;i<rec.length;i++)rec[i]=rnd()*noise;for(let k=0;k<6;k++){const c=Math.round(rate*(.3+k*.5));clicks.push(c);if(k<miss)continue;const d=c+delay+(jitter?Math.round(rnd()*jitter):0);for(let j=0;j<200;j++)rec[d+j]+=.5*Math.sin(j/3)*Math.exp(-j/60);}return {rec,clicks,rate};}
t('estima 23 ms com ruído',()=>{const {rec,clicks,rate}=sim(1104);const r=IO.estimateLatency(rec,rate,clicks);assert.ok(Math.abs(r.ms-23)<0.5,r.ms);assert.ok(r.reliable);});
t('estima 180 ms (Bluetooth/celular)',()=>{const {rec,clicks,rate}=sim(8640);const r=IO.estimateLatency(rec,rate,clicks);assert.ok(Math.abs(r.ms-180)<0.5,r.ms);});
t('silêncio = nada encontrado, não salva',()=>{const r=IO.estimateLatency(new Float32Array(48000*4),48000,[14400,38400]);assert.equal(r.found,0);assert.equal(r.reliable,false);});
t('variação grande = não confiável',()=>{const {rec,clicks,rate}=sim(4800,{jitter:2000});const r=IO.estimateLatency(rec,rate,clicks);assert.equal(r.reliable,false);});
t('compensationSamples respeita desligado/limites',()=>{const st=v=>({getItem:()=>JSON.stringify(v)});assert.equal(IO.compensationSamples(48000,st({enabled:false,ms:20})),0);assert.equal(IO.compensationSamples(48000,st({enabled:true,ms:20})),960);assert.equal(IO.compensationSamples(48000,st({enabled:true,ms:5000})),0);});
console.log(`${n} testes ok`);
