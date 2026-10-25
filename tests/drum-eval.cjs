// Mede a detecção por peça (aps-drum-pieces.js) contra o gabarito da bateria sintética.
const fs=require('fs'),zlib=require('zlib'),D=require('../aps-drum-pieces.js');
const [wav,truthPath]=process.argv.slice(2);const b=fs.readFileSync(wav);const n=(b.length-44)/2,x=new Float32Array(n);for(let i=0;i<n;i++)x[i]=b.readInt16LE(44+i*2)/32768;
const truth=JSON.parse(fs.readFileSync(truthPath));const t0=Date.now();const ev=D.analyze(x,44100,{sensitivity:60});const ms=Date.now()-t0;
const tol=0.02;const used=new Set();let tp=0,pieceOk=0,errs=[];const per={};
for(const t of truth){per[t.piece]=per[t.piece]||{n:0,found:0,ok:0};per[t.piece].n++;
 let best=-1,bd=1e9;ev.forEach((e,i)=>{if(used.has(i))return;const d=Math.abs(e.time-t.time);if(d<=tol&&(d<bd||(e.piece===t.piece&&ev[best]?.piece!==t.piece))){best=i;bd=d;}});
 const same=ev.findIndex((e,i)=>!used.has(i)&&Math.abs(e.time-t.time)<=tol&&e.piece===t.piece);if(same>=0)best=same;
 if(best>=0){used.add(best);tp++;per[t.piece].found++;errs.push(Math.abs(ev[best].time-t.time)*1000);if(ev[best].piece===t.piece){pieceOk++;per[t.piece].ok++;}}}
// correlação de intensidade (velocidade detectada × gabarito), por peça bem classificada
const ghostTruth=truth.filter(t=>t.ghost).length,ghostFound=ev.filter(e=>e.ghost).length;
errs.sort((a,b)=>a-b);
const midi=D.toMidi(ev,100,0);fs.writeFileSync('/tmp/aps-drum-test.mid',midi);
console.log(JSON.stringify({duration:n/44100,analyzeMs:ms,truth:truth.length,detected:ev.length,recall:+(tp/truth.length).toFixed(3),precision:+(tp/ev.length).toFixed(3),pieceAccuracyOfMatched:+(pieceOk/Math.max(1,tp)).toFixed(3),timingErrMs:{median:+errs[errs.length>>1].toFixed(2),p95:+errs[Math.floor(errs.length*.95)].toFixed(2)},ghostTruth,ghostFlagged:ghostFound,perPiece:per,midiBytes:midi.length},null,1));
// ZIP de kit: store e deflate
(async()=>{const {execSync}=require('child_process');execSync(`python3 -c "import zipfile;z=zipfile.ZipFile('/tmp/k.zip','w');z.writestr('kit/kick.wav','RIFFkick',zipfile.ZIP_DEFLATED);z.writestr('kit/snare.wav','RIFFsnare',zipfile.ZIP_STORED);z.close()"`);
 const files=await D.unzip(new Uint8Array(fs.readFileSync('/tmp/k.zip')),d=>zlib.inflateRawSync(d));console.log('unzip',files.map(f=>f.name+':'+Buffer.from(f.data).toString()).join(' '));})();
if(process.env.CONF){const c={};for(const t of truth){const e=D.analyze?null:null;}
 const conf={};for(const t of truth){const m=ev.filter(e=>Math.abs(e.time-t.time)<=tol).map(e=>e.piece).join('+')||'-';conf[t.piece+'→'+m]=(conf[t.piece+'→'+m]||0)+1;}console.log(conf);
 const fp={};ev.forEach(e=>{if(!truth.some(t=>Math.abs(e.time-t.time)<=tol&&t.piece===e.piece))fp[e.piece]=(fp[e.piece]||0)+1;});console.log('fp',fp);}
