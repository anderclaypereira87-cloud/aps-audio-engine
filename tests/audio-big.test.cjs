// node tests/audio-big.test.cjs — leitura em blocos de WAV/AIFF (24 bits, 48 kHz) e redução para mono 22,05 kHz
const assert=require('assert');require('../aps-audio-big.js');const B=globalThis.APSBigAudio;
function wav24(sr,sec,f,ch=2){const n=Math.floor(sr*sec),a=Buffer.alloc(44+n*ch*3);a.write('RIFF',0);a.writeUInt32LE(36+n*ch*3,4);a.write('WAVEfmt ',8);a.writeUInt32LE(16,16);a.writeUInt16LE(1,20);a.writeUInt16LE(ch,22);a.writeUInt32LE(sr,24);a.writeUInt32LE(sr*ch*3,28);a.writeUInt16LE(ch*3,32);a.writeUInt16LE(24,34);a.write('data',36);a.writeUInt32LE(n*ch*3,40);
 for(let i=0;i<n;i++){const v=Math.round(Math.sin(2*Math.PI*f*i/sr)*0.5*8388607);for(let c=0;c<ch;c++){const o=44+(i*ch+c)*3;a[o]=v&255;a[o+1]=(v>>8)&255;a[o+2]=(v>>16)&255;}}return a;}
(async()=>{
 const f=new File([wav24(48000,3,440)],'t.wav');const p=await B.probe(f);assert.equal(p.kind,'wav');assert.equal(p.sr,48000);assert.equal(p.bits,24);assert(Math.abs(p.duration-3)<1e-3);
 const r=await B.monoForAnalysis(f,{targetSr:22050});const x=r.buffer.getChannelData(0);assert.equal(r.buffer.sampleRate,22050);assert(Math.abs(x.length/22050-3)<0.01);
 let pk=0,zc=0;for(let i=1;i<x.length;i++){pk=Math.max(pk,Math.abs(x[i]));if(x[i-1]<0&&x[i]>=0)zc++;}assert(pk>0.35&&pk<0.55);assert(Math.abs(zc/3-440)<8,'freq '+zc/3);
 const r2=await B.monoForAnalysis(f,{targetSr:22050,startSec:1,maxSec:1});assert(Math.abs(r2.buffer.length/22050-1)<0.01);
 // formato não-PCM cai em "other"
 const bad=new File([Buffer.from('ID3\u0003\u0000\u0000\u0000\u0000\u0000\u0000')],'x.mp3');assert.equal((await B.probe(bad)).kind,'other');
 console.log('ok - audio-big: WAV 24 bits/48 kHz lido em blocos, mono 22,05 kHz, recorte e detecção de formato');})().catch(e=>{console.error(e);process.exit(1);});
