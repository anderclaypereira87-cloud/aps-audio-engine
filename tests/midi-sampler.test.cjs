// Testes do núcleo APS MIDI/Sampler (sem navegador): node tests/midi-sampler.test.cjs
const assert=require('assert');require('../aps-midi.js');const M=globalThis.APSMidi;let n=0;const t=(nm,f)=>{f();n++;console.log('ok -',nm);};
t('notas por nome',()=>{assert.equal(M.parseNote('C4'),60);assert.equal(M.parseNote('Sol#3'),56);assert.equal(M.parseNote('Db2'),37);assert.equal(M.noteFromFilename('Piano_A4_soft.wav'),69);assert.equal(M.noteName(60),'Dó4');});
const raw=[{start:.03,end:.28,midi:60,vel:.8},{start:.34,end:.6,midi:62,vel:.8},{start:.9,end:1.1,midi:64,vel:.8}];
t('quantização 1/8, 100%',()=>{const q=M.quantize(raw,{bpm:100,offset:0,grid:'1/8',strength:100,quantizeEnd:true});q.forEach(x=>assert(Math.abs(x.start/.3-Math.round(x.start/.3))<1e-6));});
t('quantização força 50% fica no meio',()=>{const q=M.quantize(raw,{bpm:100,offset:0,grid:'1/8',strength:50,quantizeEnd:false});assert(Math.abs(q[0].start-.015)<1e-6);});
t('tercinas',()=>{const q=M.quantize(raw,{bpm:120,offset:0,grid:'1/8T',strength:100,quantizeEnd:true});const st=.5/3;q.forEach(x=>assert(Math.abs(x.start/st-Math.round(x.start/st))<1e-6));});
t('MIDI ida e volta',()=>{const f=M.toMidiFile(raw,{bpm:100,name:'x'});const p=M.parseMidi(f);assert.equal(p.notes.length,3);assert.deepEqual(p.notes.map(x=>x.midi),[60,62,64]);p.notes.forEach((x,i)=>assert(Math.abs(x.start-raw[i].start)<.01));});
t('SFZ com camadas de velocidade',()=>{const r=M.parseSfz('<group> pitch_keycenter=60 lokey=0 hikey=127\n<region> sample=a.wav lovel=0 hivel=80\n<region> sample=samples/b.wav lovel=81 hivel=127 volume=-3');assert.equal(r.length,2);assert.equal(r[1].file,'b.wav');assert.equal(r[1].lovel,81);assert.equal(r[1].volume,-3);assert.equal(r[0].root,60);});
t('LiveMidi lê melodia monofônica',()=>{const sr=44100,seq=[60,64,67,72],L=new M.LiveMidi(sr,{});const ns=[];L.onNote=x=>ns.push(x);const dur=.4;const x=new Float32Array(Math.floor(sr*dur*seq.length));seq.forEach((m,k)=>{const f=440*2**((m-69)/12);for(let i=0;i<sr*dur*.9;i++){const tt=i/sr;x[Math.floor(k*dur*sr)+i]=.5*Math.sin(2*Math.PI*f*tt)*Math.min(1,tt*100);}});
 for(let a=0;a+4096<=x.length;a+=1024)L.process(x.slice(a,a+4096),a/sr);L.finish(x.length/sr);assert.deepEqual(ns.map(q=>q.midi),seq);});
console.log(n+' testes passaram');
