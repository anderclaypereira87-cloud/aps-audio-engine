// Teste: o arranjo gerado segue os acordes e a grade de tempos do áudio original (verdade conhecida).
// uso: node tests/arranjo-acordes.test.cjs <wav16> <truth.json> <chave> [bpm]
global.window=globalThis;global.document=undefined;
require('../aps-clean.js');require('../aps-chords.js');require('../aps-transcribe.js');require('../aps-arranjo-acordes.js');
const fs=require('fs');const A=globalThis.APSArranjoAcordes;
const [,,wavp,truthp,key]=process.argv;const truth=JSON.parse(fs.readFileSync(truthp))[key];
const b=fs.readFileSync(wavp);const d=new Int16Array(b.buffer,b.byteOffset+44,(b.length-44)/2);const x=Float32Array.from(d,v=>v/32768);
const buf={length:x.length,sampleRate:44100,numberOfChannels:1,duration:x.length/44100,getChannelData:()=>x};
const PC={C:[0,4,7],Am:[9,0,4],F:[5,9,0],G:[7,11,2],Dm:[2,5,9],Bb:[10,2,5]};
(async()=>{const an=await A.analyze(buf);let allOk=true;const rows=[];
 console.log(`${key}: ${an.bpm} BPM, grade em ${an.offset.toFixed(3)} s, tom ${an.keyName}; acordes: ${A.chordLine(an)}`);
 for(const inst of Object.keys(A.INSTR)){const ev=A.events(an,inst);let ok=0,tot=0,maxErr=0;
  for(const e of ev){const notes=e.ms||[e.m];const ch=truth.find(t=>e.t>=t[1]-0.02&&e.t<t[2]-0.02);if(!ch)continue;
   for(const m of notes){tot++;const pcs=PC[ch[0]];const inChord=pcs.includes(((m%12)+12)%12);if(inst==='baixo'?pcs[0]===((m%12)+12)%12||pcs[0]+7===((m%12)+12)%12+(((m%12)+12)%12<pcs[0]?12:0)||pcs.includes(((m%12)+12)%12):inChord)ok++;}
   const beatPos=(e.t-an.offset)/an.beat;if(inst!=='violao')maxErr=Math.max(maxErr,Math.abs(beatPos-Math.round(beatPos))*an.beat);}
  // troca de acorde: 1º evento depois de cada fronteira da verdade deve começar dentro de 40 ms da fronteira
  let bOk=0,bTot=0;for(const t of truth){const first=ev.filter(e=>e.t>=t[1]-0.05).sort((a,b)=>a.t-b.t)[0];bTot++;if(first&&Math.abs(first.t-t[1])<=0.04)bOk++;}
  const pass=ok===tot&&bOk===bTot;allOk=allOk&&pass;rows.push(`${A.INSTR[inst].padEnd(20)} notas no acorde certo: ${ok}/${tot} · começa na troca de acorde: ${bOk}/${bTot} · desvio máx. da grade de tempos: ${(maxErr*1000).toFixed(0)} ms · ${pass?'OK':'FALHOU'}`);}
 console.log(rows.join('\n'));process.exit(allOk?0:1);})();
