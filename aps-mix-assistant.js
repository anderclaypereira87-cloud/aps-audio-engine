/* APS Audio Engine 1.6 — assistente LOCAL de mixagem.
 * Sem LLM ou API conectada: regras transparentes e DSP de EQ/volume/pan reais.
 * A execução/timing dos músicos jamais é reescrita por este módulo.
 */
(()=>{'use strict';
const $=id=>document.getElementById(id);const bridge=window.APSMixBridge;if(!bridge||!$('apsBandMixer'))return;
const groups=[
 {name:'🥁 Bateria completa',keys:[['Bumbo','kick',/bumbo|kick/i],['Caixa','snare',/caixa|snare/i],['Aro / rimshot','rim',/aro|rim/i],['Chimbal fechado','hat',/chimbal|hi.?hat|hat/i],['Chimbal aberto','open',/hat aberto|open hat/i],['Tom 1','tom1',/tom 1|tom1/i],['Tom 2','tom2',/tom 2|tom2/i],['Surdo','floor',/surdo|floor/i],['Ride','ride',/ride/i],['Crash','crash',/crash/i],['Splash','splash',/splash/i],['Bateria estéreo','drums',/bateria|drum/i]]},
 {name:'🎶 Banda completa',keys:[['Contrabaixo','bass',/bass|baixo|fretless/i],['Voz principal','voz',/voz|vocal|cantor/i],['Guitarra','guitar',/guitarra|guitar/i],['Violão','violao',/viol[aã]o/i],['Piano e teclados','piano',/piano|teclado|keyboard|synth/i],['Metais e sopros','horn',/sax|tromp|metal|flauta/i],['Cordas','strings',/violino|viola|cello|cordas/i],['Percussão','perc',/percuss[aã]o|conga|pandeiro/i],['Outros','other',/outros|other/i]]}
];
let pending=null,undo=null,lastPrompt='';const draftByTrack=new Map();
const clean=s=>String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
const clip=(x,a,b)=>Math.min(b,Math.max(a,x));
const say=(s,kind='info')=>{const box=$('apsMixResponse');box.textContent=s;box.style.borderColor=kind==='error'?'#c5706c':kind==='ok'?'#5fbd8f':'#58748c';};
const infer=(t,re)=>re.test(clean(t.name+' '+t.type));
function isDrum(t){return /kick|snare|hat|conga|tom|shaker|rim|floor|ride|crash|splash|drum|bateria|bumbo|caixa|surdo|chimbal|prato|aro/.test(clean(t.type+' '+t.name));}
function all(){return bridge.list();}
function render(){const tracks=all(),container=$('apsBandGroups'),target=$('apsMixTarget'),value=target.value;
 const old=Array.from(target.options).slice(1);old.forEach(o=>o.remove());
 tracks.forEach(t=>target.add(new Option((isDrum(t)?'🥁 ':'♫ ')+t.name,t.id)));
 target.value=tracks.some(t=>t.id===value)?value:'all';
 container.replaceChildren();
 for(const group of groups){const box=document.createElement('section');box.className='aps-band-group';const h=document.createElement('h3');h.textContent=group.name;box.append(h);const row=document.createElement('div');row.className='aps-band-items';
  for(const [name,type,re]of group.keys){const match=tracks.find(t=>infer(t,re));const b=document.createElement('button');b.type='button';b.className='aps-band-item';b.dataset.status=match?'live':'empty';b.textContent=(match?'● ':'○ ')+name;
   b.title=match?'Selecionar pista '+match.name:'Canal preparado. Importe ou recrie esta peça para mixar separadamente.';
   b.onclick=()=>{if(match){target.value=match.id;bridge.focus(match.id);say('Pista '+match.name+' selecionada. Escreva o som desejado e toque em Analisar pedido.');}else{say(name+' ainda não tem áudio nesta sessão. Importe um WAV dessa peça ou abra o Drum Sampler para recriá-la. Não geramos áudio fingindo isolamento.');}};
   row.append(b);
  }box.append(row);
  const activeUnique=tracks.filter(t=>group.keys.some(([name,type,re])=>infer(t,re)));
  const once=new Set();
  for(const t of activeUnique){if(once.has(t.id))continue;once.add(t.id);
   const detail=document.createElement('details');detail.className='aps-instrument-prompt';detail.dataset.id=t.id;
   const label=document.createElement('summary');label.textContent='✦ Pedir timbre para '+t.name;detail.append(label);
   const field=document.createElement('textarea');field.rows=2;field.maxLength=500;field.placeholder='Ex.: mais aveludado e definido, sem mudar as notas';field.value=draftByTrack.get(t.id)||'';
   field.addEventListener('input',()=>draftByTrack.set(t.id,field.value));
   const go=document.createElement('button');go.type='button';go.textContent='Analisar meu pedido para '+t.name;
   go.addEventListener('click',()=>{if(field.value.trim().length<5){say('Descreva o timbre desejado para '+t.name+'.','error');return;}
     $('apsMixTarget').value=t.id;$('apsMixRequest').value=field.value;preview();$('apsMixResponse').scrollIntoView({block:'nearest'});
   });detail.append(field,go);box.append(detail);
  }
  container.append(box);
 }
 const active=tracks.length;
 $('apsMixLevels').textContent=active?tracks.map(t=>t.name+': pico '+(20*Math.log10(Math.max(0.00001,t.peak))).toFixed(1)+' dBFS / RMS '+(20*Math.log10(Math.max(.00001,t.rms))).toFixed(1)+' dBFS').join(' · '):'Nenhuma pista carregada. Importe áudio WAV/MP3 ou inicie a demonstração.';
}
function classify(sentence,track){const s=clean(sentence);const name=clean(track.name+' '+track.type);const bass=/bass|baixo|fretless/.test(name),kick=/bumbo|kick/.test(name),drum=isDrum(track),voice=/voz|vocal|canto/.test(name);
 let vals={},tags=[];const set=(key,val)=>{vals[key]=val;};
 // Volume, EQ, ambiência, compressão e panorama são controles de mixagem reais.
 if(/aveludad|quente|macio|redond|encorpado/.test(s)){set('bass',clip(track.bass+2,-12,12));set('treble',clip(track.treble-2,-12,12));tags.push('grave quente e agudos suaves');}
 if(/brilh|clar|nitid|cristalin/.test(s)){set('treble',clip(track.treble+3,-12,12));set('mid',clip(track.mid+1,-12,12));tags.push('clareza e definição');}
 if(/presen|destac|frente|aparec|mais alto|mais volume|aument/.test(s)){set('gain',clip(track.gain+12,0,150));tags.push('presença: volume +12 pontos');}
 if(/baixar volume|menos volume|mais baixo|reduz|diminu/.test(s)){set('gain',clip(track.gain-12,0,150));tags.push('redução de volume');}
 if(/menos grave|grave menor|sem embol|tirar grave|limp.*grave/.test(s)){set('bass',clip(track.bass-3,-12,12));tags.push('graves controlados');}
 if(/grave forte|mais grave|grave present|peso|punch/.test(s)){set('bass',clip(track.bass+3,-12,12));tags.push('reforço de graves');}
 if(/menos agudo|menos brilh|prato suave|pratos suaves|sem asperez|menos estriden/.test(s)){set('treble',clip(track.treble-3,-12,12));tags.push('redução de agudos');}
 if(/mais med|m[eé]dios present|definic.*m[eé]di/.test(s)){set('mid',clip(track.mid+3,-12,12));tags.push('definição de médios');}
 if(/seco|sem reverb|tirar reverb|remover reverb|sem ambi/.test(s)){set('reverb',0);set('delay',0);tags.push('som seco');}
 if(!/sem reverb|tirar reverb|remover reverb|sem ambi/.test(s)&&/reverb|ambi[eê]ncia|espac|sala/.test(s)){set('reverb',clip(track.reverb+8,0,40));tags.push('ambiência discreta');}
 if(/compress|control.*din[aâ]mic/.test(s)){set('comp',true);tags.push('compressão dinâmica');}
 if(/sem compres|tirar compres/.test(s)){set('comp',false);tags.push('compressor desligado');}
 if(/esquerd/.test(s)){set('pan',-38);tags.push('pan à esquerda');}
 if(/direit/.test(s)){set('pan',38);tags.push('pan à direita');}
 if(/centro|centraliz/.test(s)){set('pan',0);tags.push('pan central');}
 // Entender alvos por frase: voz, baixo, bateria etc. Evita aplicar descrição de baixo a todos.
 if(!tags.length){vals={};tags=['nenhum ajuste reconhecido nesta pista'];}
 return {vals,tags};
}
function sentencesForTrack(text,t,global){
 if(!global)return text;
 const rejoin=String(text||'').replace(/\s+(?:e|mas)\s+(?=(?:o |a |os |as )?(?:baixo|contrabaixo|fretless|voz|vocal|bateria|bumbo|caixa|chimbal|pratos|guitarra|violao|violão|piano|teclado)\b)/gi,'; ');
 const pieces=rejoin.split(/[;\n]|,(?=\s*(?:o |a |os |as )?(?:voz|baixo|bateria|guitarra|piano|teclado|pratos|chimbal))/i).map(x=>x.trim()).filter(Boolean);
 const kinds={bass:/\b(?:baixo|contrabaixo|fretless|bass)\b/,drum:/\bbateria\b/,kick:/\b(?:bumbo|kick)\b/,snare:/\b(?:caixa|snare)\b/,cymbal:/\b(?:pratos?|chimbal|crash|ride|splash|hi.hat)\b/,voice:/\b(?:voz|vocal|canto)\b/,guitar:/\b(?:guitarra|violao)\b/,piano:/\b(?:piano|teclado)\b/};
 const n=clean(t.name+' '+t.type);
 const target=/bass|baixo|fretless/.test(n)?'bass':isDrum(t)?(/bumbo|kick/.test(n)?'kick':/caixa|snare/.test(n)?'snare':/chimbal|prato|crash|ride|splash|hat/.test(n)?'cymbal':'drum'):/voz|vocal/.test(n)?'voice':/guitarra|violao/.test(n)?'guitar':/piano|teclado/.test(n)?'piano':null;
 return pieces.filter(p=>{const normalized=clean(p),matches=Object.entries(kinds).filter(([,re])=>re.test(normalized)).map(([key])=>key);return !matches.length||matches.includes(target)||(matches.includes('drum')&&isDrum(t))}).join('. ');
}
function preview(){
 const text=$('apsMixRequest').value.trim();
 if(text.length<5){say('Escreva como deseja o som. Exemplo: "baixo aveludado e presente, voz clara, pratos suaves".','error');return;}
 const tracks=all(),isGlobal=$('apsMixTarget').value==='all',chosen=isGlobal?tracks:tracks.filter(t=>t.id===$('apsMixTarget').value);
 if(!chosen.length){say('Ainda não há pistas disponíveis. Importe áudio primeiro.','error');return;}
 const advanced=[
  ['quantização ou correção do tempo',/quantiz|corrig.*tempo|alinhar notas/],
  ['afinação das notas',/afina|autotune|melodyne/],
  ['separação neural de instrumentos',/separar|isol(ar|amento)|stems/],
  ['criação de pads, harmonia ou MIDI',/criar.*pad|adicionar.*pad|gerar.*midi|criar.*acord|harmoni.*novo/],
  ['partitura ou transcrição',/partitura|transcri/],
  ['sincronização audiovisual',/sincroniz.*video|video.*sincroniz/]
 ].filter(([,rx])=>rx.test(clean(text))).map(([name])=>name);
 const target=chosen.map(t=>{const scoped=sentencesForTrack(text,t,isGlobal);if(!scoped.trim())return null;
  const {vals,tags}=classify(scoped,t);if(!Object.keys(vals).length)return null;
  if($('apsMixFlavor').value==='strong'&&vals.gain!==undefined){vals.gain=clip(vals.gain+5,0,150);tags.push('presença reforçada');}
  return {id:t.id,name:t.name,values:vals,tags};
 }).filter(Boolean);
 pending=target.length?target:null;lastPrompt=text;$('apsMixApply').disabled=!pending;
 const warning=advanced.length?'Este assistente ainda não executa: '+advanced.join(', ')+'. Use os módulos específicos quando disponíveis.\n\n':'';
 if(!target.length){say('Nenhum ajuste de mixagem executável foi reconhecido; nada será alterado.\n\n'+warning+'Experimente: "baixo aveludado", "voz mais clara", "pratos suaves" ou "menos reverb".','error');return;}
 say('Prévia de mixagem local — nada foi alterado ainda:\n'+target.map(t=>'• '+t.name+': '+t.tags.join(', ')).join('\n')+'\n\n'+warning+'Esta versão interpreta comandos por regras de engenharia de áudio, não por um modelo de linguagem. Confirme em “Aplicar ao áudio”. As notas e a execução originais permanecem intactas.');
}
function apply(){if(!pending?.length){say('Analise um pedido antes de aplicar.');return;}try{undo=bridge.update(pending.map(({id,values})=>({id,values})));pending=null;$('apsMixApply').disabled=true;$('apsMixUndo').disabled=!undo?.length;render();say('Ajustes aplicados ao motor da DAW. Agora reproduza ou exporte a mixagem WAV. Você pode desfazer.\nPedido: '+lastPrompt,'ok');}catch(e){say('Não foi possível aplicar: '+e.message,'error');}}
function revert(){if(!undo?.length)return;try{bridge.update(undo);undo=null;$('apsMixUndo').disabled=true;render();say('Ajustes desfeitos. Os valores dos canais voltaram ao estado anterior.','ok');}catch(e){say(e.message,'error');}}
$('apsMixPreview').addEventListener('click',preview);
$('apsMixApply').addEventListener('click',apply);
$('apsMixUndo').addEventListener('click',revert);
$('apsMixImport').addEventListener('click',()=>{bridge.import();});
$('apsMixDemo').addEventListener('click',()=>{bridge.demo();setTimeout(render,400)});
document.querySelectorAll('[data-aps-tab="mixagem"]').forEach(b=>b.addEventListener('click',()=>{setTimeout(render,80)}));
window.addEventListener('pageshow',render);
// Atualiza lista somente quando o mixer está visível.
setInterval(()=>{if(document.querySelector('[data-aps-tab="mixagem"][aria-current="page"]'))render();},6000);
render();

// ---- 1.8.0: sugestão automática por instrumento (RMS, pico e espectro medidos localmente) ----
const PROFILES=[
 {re:/voz|vocal|cantor|voice/,label:'Voz',rms:-18,pan:0,hpf:90,bass:-1,mid:0,treble:2},
 {re:/baixo|bass|fretless/,label:'Baixo',rms:-20,pan:0,hpf:35,bass:1,mid:0,treble:0},
 {re:/bumbo|kick/,label:'Bumbo',rms:-20,pan:0,hpf:30,bass:2,mid:-2,treble:0},
 {re:/caixa|snare/,label:'Caixa',rms:-22,pan:0,hpf:80,bass:0,mid:0,treble:1},
 {re:/chimbal|hat|ride|crash|splash|prato/,label:'Pratos',rms:-27,pan:20,hpf:250,bass:-3,mid:0,treble:0},
 {re:/bateria|drum|tom|surdo/,label:'Bateria',rms:-19,pan:0,hpf:30,bass:0,mid:-1,treble:1},
 {re:/guitarra|guitar/,label:'Guitarra',rms:-22,pan:-25,hpf:90,bass:-2,mid:1,treble:0},
 {re:/violao/,label:'Violão',rms:-22,pan:-15,hpf:80,bass:-2,mid:0,treble:1},
 {re:/piano|teclado|keyboard|synth/,label:'Teclado/Piano',rms:-23,pan:25,hpf:60,bass:-1,mid:0,treble:0},
 {re:/outros|other/,label:'Outros',rms:-24,pan:15,hpf:80,bass:-1,mid:0,treble:0}];
const DEFAULT_PROFILE={label:'Instrumento',rms:-22,pan:0,hpf:60,bass:0,mid:0,treble:0};
function bandEnergy(buf){// energia relativa grave(<250)/médio/agudo(>4k) por filtros de 1ª ordem
 if(!buf)return null;const x=buf.getChannelData(0),fs=buf.sampleRate,skip=Math.max(1,Math.floor(x.length/400000));
 const aL=Math.exp(-2*Math.PI*250/fs*skip),aH=Math.exp(-2*Math.PI*4000/fs*skip);let lp=0,lp2=0,eL=0,eM=0,eH=0;
 for(let i=0;i<x.length;i+=skip){const v=x[i];lp=v+(lp-v)*aL;lp2=v+(lp2-v)*aH;const hi=v-lp2,mid=lp2-lp;eL+=lp*lp;eM+=mid*mid;eH+=hi*hi;}
 const t=eL+eM+eH||1;return{low:eL/t,mid:eM/t,high:eH/t};}
function autoSuggest(){const tracks=all();if(!tracks.length){say('Importe pistas (ou envie as 6 do separador) para receber sugestões.','error');return;}
 const ups=[],lines=[];
 for(const t of tracks){const p=PROFILES.find(p=>p.re.test(clean(t.name+' '+t.type)))||DEFAULT_PROFILE;
  if(!(t.rms>1e-5)){lines.push('• '+t.name+': pista silenciosa, sem ajuste.');continue;}
  const rmsDb=20*Math.log10(t.rms),peakDb=20*Math.log10(Math.max(t.peak,1e-6));
  const perc=/Bumbo|Caixa|Pratos|Bateria/.test(p.label),pkTarget={Bumbo:-6,Caixa:-6,Pratos:-14,Bateria:-6}[p.label];// percussão: guiada pelo pico (RMS engana em pistas com silêncio)
  const delta=clip(perc?pkTarget-peakDb:p.rms-rmsDb,-12,6);let gain=clip(Math.round(t.gain*Math.pow(10,delta/20)),10,150);
  if(peakDb+20*Math.log10(gain/Math.max(1,t.gain))>-1)gain=clip(Math.round(t.gain*Math.pow(10,(-1-peakDb)/20)),10,150);
  const v={gain,pan:p.pan,hpf:p.hpf,bass:p.bass,mid:p.mid,treble:p.treble};const e=bandEnergy(bridge.buffer?.(t.id));
  if(e){if(p.label!=='Baixo'&&p.label!=='Bumbo'&&e.low>.55)v.bass-=2;if(/Voz|Violão|Pratos/.test(p.label)&&e.high<.03)v.treble+=2;if(e.mid>.75)v.mid-=1;}
  for(const k of['bass','mid','treble'])v[k]=clip(v[k],-6,6);
  ups.push({id:t.id,values:v});
  lines.push('• '+t.name+' ('+p.label+'): RMS '+rmsDb.toFixed(1)+' dB, pico '+peakDb.toFixed(1)+' dB → volume '+t.gain+'→'+gain+'%, pan '+(v.pan>0?'D'+v.pan:v.pan<0?'E'+(-v.pan):'centro')+', corte de graves '+v.hpf+' Hz, EQ grave/médio/agudo '+v.bass+'/'+v.mid+'/'+v.treble+' dB'+(e?' · espectro G/M/A '+Math.round(e.low*100)+'/'+Math.round(e.mid*100)+'/'+Math.round(e.high*100)+'%':''));}
 pending=ups;lastPrompt='Sugestão automática por instrumento';$('apsMixApply').disabled=!ups.length;
 say('Sugestão automática (nada foi aplicado ainda):\n'+lines.join('\n')+'\n\nToque em “Aplicar ao áudio”. Depois pode desfazer.');}
$('apsMixAuto')?.addEventListener('click',autoSuggest);
if(new URLSearchParams(location.search).has('importStems')){let tries=0;const iv=setInterval(()=>{tries++;if(all().length>=2){clearInterval(iv);autoSuggest();}else if(tries>40)clearInterval(iv);},1500);}
window.APSMixAssistant={autoSuggest,preview:()=>$('apsMixPreview').click(),render};
})();

/* ===================== APS 2.2.0 — Mixagem IA (100% no aparelho) =====================
 * Análise por pista (espectro, LUFS, fator de crista, picos), detecção do instrumento,
 * mixagem automática por gênero, mascaramento, sidechain bumbo→baixo, de-esser,
 * envios de reverb/delay, igualar a uma referência, A/B e desfazer.
 * Sem API paga, sem rede: regras de engenharia de áudio + DSP Web Audio.
 */
(()=>{'use strict';
const $=id=>document.getElementById(id),B=()=>window.APSMixBridge;
if(!B()||!$('apsBandMixer'))return;
const clip=(x,a,b)=>Math.min(b,Math.max(a,x)),db=v=>20*Math.log10(Math.max(v,1e-9)),lin=d=>Math.pow(10,d/20);
const idle=()=>new Promise(r=>setTimeout(r,0));
// ---------- bandas de análise (1/3 de oitava aproximado) ----------
const BANDS=[31,40,50,63,80,100,125,160,200,250,315,400,500,630,800,1000,1250,1600,2000,2500,3150,4000,5000,6300,8000,10000];
function fft(re,im){const n=re.length;for(let i=1,j=0;i<n;i++){let b=n>>1;for(;j&b;b>>=1)j^=b;j^=b;if(i<j){[re[i],re[j]]=[re[j],re[i]];[im[i],im[j]]=[im[j],im[i]];}}
 for(let len=2;len<=n;len<<=1){const a=-2*Math.PI/len,wr=Math.cos(a),wi=Math.sin(a);for(let i=0;i<n;i+=len){let cr=1,ci=0;for(let j=0;j<len/2;j++){const ur=re[i+j],ui=im[i+j],k=i+j+len/2,vr=re[k]*cr-im[k]*ci,vi=re[k]*ci+im[k]*cr;re[i+j]=ur+vr;im[i+j]=ui+vi;re[k]=ur-vr;im[k]=ui-vi;const t=cr*wr-ci*wi;ci=cr*wi+ci*wr;cr=t;}}}}
// Mono decimado (rápido em celular fraco): até 30 s do trecho mais forte.
function monoSegment(buf,maxSec=30){const sr=buf.sampleRate,ch=[...Array(buf.numberOfChannels)].map((_,i)=>buf.getChannelData(i)),n=buf.length,len=Math.min(n,Math.floor(maxSec*sr));
 let best=0;if(n>len){const win=Math.floor(sr),cnt=Math.floor(n/win);let bestE=-1;const e=new Float32Array(cnt);for(let w=0;w<cnt;w++){let s=0;for(let i=w*win;i<(w+1)*win;i+=64){const v=ch[0][i];s+=v*v;}e[w]=s;}
  const span=Math.floor(len/win);let run=0;for(let w=0;w<cnt;w++){run+=e[w];if(w>=span)run-=e[w-span];if(w>=span-1&&run>bestE){bestE=run;best=(w-span+1)*win;}}}
 const x=new Float32Array(len);for(const c of ch)for(let i=0;i<len;i++)x[i]+=c[best+i]/ch.length;return{x,sr,ch:ch.map(c=>c.subarray(best,best+len))};}
async function analyze(buf){
 const {x,sr,ch}=monoSegment(buf);let pk=0,ss=0;for(const c of ch)for(let i=0;i<c.length;i++){const a=Math.abs(c[i]);if(a>pk)pk=a;}for(let i=0;i<x.length;i++)ss+=x[i]*x[i];
 const rms=Math.sqrt(ss/Math.max(1,x.length));
 const lufs=window.APSMaster?window.APSMaster.integratedLUFS(ch.length>1?[ch[0],ch[1]]:[ch[0]],sr):db(rms)-3;
 await idle();
 const N=2048,hop=Math.max(N,Math.floor(x.length/160)),win=new Float32Array(N).map((_,i)=>.5-.5*Math.cos(2*Math.PI*i/N)),pow=new Float64Array(N/2);let frames=0;
 for(let s=0;s+N<=x.length;s+=hop){const re=new Float64Array(N),im=new Float64Array(N);for(let i=0;i<N;i++)re[i]=x[s+i]*win[i];fft(re,im);for(let k=0;k<N/2;k++)pow[k]+=re[k]*re[k]+im[k]*im[k];frames++;if(frames%40===0)await idle();}
 const bands=BANDS.map((f,i)=>{const lo=f/Math.pow(2,1/6),hi=f*Math.pow(2,1/6);let s=0,c=0;for(let k=Math.max(1,Math.floor(lo*N/sr));k<=Math.min(N/2-1,Math.ceil(hi*N/sr));k++){s+=pow[k];c++;}return 10*Math.log10(s/Math.max(1,c*frames)+1e-20);});
 let num=0,den=0;for(let k=1;k<N/2;k++){num+=k*sr/N*pow[k];den+=pow[k];}const centroid=num/Math.max(1e-20,den);
 // ataques por segundo (envelope 10 ms)
 const h=Math.floor(sr*.01),env=[];for(let s=0;s+h<=x.length;s+=h){let e=0;for(let i=s;i<s+h;i+=2)e+=x[i]*x[i];env.push(Math.sqrt(e/(h/2)));}
 let on=0,mean=env.reduce((a,b)=>a+b,0)/Math.max(1,env.length);for(let i=2;i<env.length;i++)if(env[i]-env[i-2]>mean*1.2&&env[i]>env[i-1]&&env[i]>=(env[i+1]||0))on++;
 const ons=on/Math.max(.1,x.length/sr),crest=db(pk)-db(rms);
 const tot=bands.reduce((a,b)=>a+Math.pow(10,b/10),0),part=(a,b)=>bands.reduce((s,v,i)=>BANDS[i]>=a&&BANDS[i]<=b?s+Math.pow(10,v/10):s,0)/tot;
 return{peakDb:db(pk),rmsDb:db(rms),lufs,crest,centroid,ons,bands,low:part(30,160),mud:part(200,500),pres:part(2000,5000),sib:part(5000,10000),silent:pk<1e-4};
}
// ---------- detecção de instrumento ----------
const ROLES={voz:'🎤 Voz principal',coro:'🎙 Backing vocal',kick:'🥁 Bumbo',snare:'🥁 Caixa',hat:'🎩 Chimbal/pratos',drums:'🥁 Bateria',bass:'🎸 Baixo',guitar:'🎸 Guitarra',violao:'🪕 Violão',keys:'🎹 Teclado/Piano',sanfona:'🪗 Sanfona',horn:'🎺 Metais/sopros',strings:'🎻 Cordas',perc:'🪘 Percussão',other:'🎼 Outros'};
const NAME_RX=[['coro',/back|coro|bv\b|vocal ?2|apoio/i],['voz',/voz|vocal|vox|cantor|lead/i],['kick',/bumbo|kick|\bbd\b/i],['snare',/caixa|snare|\bcx\b/i],['hat',/chimbal|hi.?hat|\bhh\b|prato|crash|ride|overhead|\boh\b/i],['drums',/bateria|drum/i],['bass',/baixo|bass|contrabaixo/i],['violao',/viol[aã]o|acoustic|nylon/i],['guitar',/guitarra|guitar|gtr/i],['sanfona',/sanfona|acorde[oã]o|accordion|zabumba/i],['keys',/piano|teclado|keys|synth|orgao|órgão|pad/i],['horn',/sax|trompete|trombone|metais|sopro|flauta|horn/i],['strings',/violino|cello|cordas|strings/i],['perc',/percuss|conga|pandeiro|shaker|triangulo|triângulo|timbal/i],['other',/outros|other/i]];
function detect(name,a){const n=String(name||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'');for(const [r,rx] of NAME_RX)if(rx.test(n)||rx.test(name))return{role:r,how:'nome',conf:.9};
 if(a.low>.55&&a.centroid<400)return a.ons>1.2&&a.crest>12?{role:'kick',how:'espectro',conf:.6}:{role:'bass',how:'espectro',conf:.65};
 if(a.ons>2.5&&a.crest>13&&a.sib+a.pres>.12)return{role:a.low>.2?'drums':'hat',how:'espectro',conf:.55};
 if(a.pres>.12&&a.centroid>1200&&a.crest<14&&a.low<.15)return{role:'voz',how:'espectro',conf:.45};
 if(a.centroid>1500)return{role:'guitar',how:'espectro',conf:.4};
 return{role:a.centroid>700?'keys':'other',how:'espectro',conf:.35};}
// ---------- gêneros ----------
const GENRES={
 pop:{label:'Pop',voz:0,width:1,rev:14,del:8,duck:4,bright:1.5,comp:1,lufs:-14},
 rock:{label:'Rock',voz:-1,width:1.15,rev:10,del:4,duck:3,bright:1,comp:1.2,lufs:-12},
 gospel:{label:'Gospel',voz:.5,width:1.05,rev:22,del:7,duck:3,bright:1.5,comp:1,lufs:-14},
 sertanejo:{label:'Sertanejo',voz:1,width:.95,rev:16,del:9,duck:3,bright:1.5,comp:1.1,lufs:-13},
 funk:{label:'Funk',voz:.5,width:.85,rev:6,del:4,duck:6,bright:2,comp:1.3,lufs:-10},
 trap:{label:'Trap',voz:.5,width:.9,rev:8,del:12,duck:6,bright:2,comp:1.3,lufs:-11},
 forro:{label:'Forró / Piseiro',voz:1,width:.95,rev:10,del:6,duck:5,bright:1.5,comp:1.2,lufs:-11},
 acustico:{label:'Acústico',voz:1,width:1,rev:18,del:3,duck:0,bright:.5,comp:.7,lufs:-16}};
// volume alvo relativo (LU) e prioridade por papel
const LEVEL={voz:0,coro:-7,kick:-3,snare:-4,hat:-11,drums:-3,bass:-4,guitar:-7,violao:-6,keys:-8,sanfona:-6,horn:-8,strings:-9,perc:-10,other:-9};
const PRIO={voz:10,kick:8,bass:7,snare:7,drums:7,sanfona:6,violao:5,guitar:5,keys:4,horn:4,coro:4,strings:3,perc:3,hat:3,other:2};
const HPF={voz:90,coro:120,kick:30,snare:80,hat:300,drums:35,bass:35,guitar:100,violao:90,keys:60,sanfona:110,horn:120,strings:90,perc:150,other:110};
const COMP={voz:[-24,3,.006,.12],coro:[-24,3,.01,.15],kick:[-18,4,.02,.1],snare:[-18,3.5,.008,.12],hat:[-20,2,.005,.1],drums:[-18,2.5,.012,.15],bass:[-24,4,.012,.18],guitar:[-20,2.5,.015,.18],violao:[-22,2.5,.01,.15],keys:[-22,2,.02,.2],sanfona:[-22,2.5,.012,.18],horn:[-20,2.5,.01,.15],strings:[-24,1.8,.03,.3],perc:[-20,2.5,.005,.1],other:[-20,2,.015,.2]};
const SEND={voz:[1,1],coro:[1.3,.6],kick:[0,0],snare:[.6,0],hat:[.2,0],drums:[.35,0],bass:[0,0],guitar:[.6,.5],violao:[.7,.3],keys:[.8,.4],sanfona:[.6,.2],horn:[.8,.3],strings:[1.1,.2],perc:[.5,.1],other:[.6,.3]};
// ---------- estado ----------
let info=new Map(),before=null,after=null,showing='B',undoStack=[],log=[],lastConflicts=[];
const PARAMS=['gain','pan','bass','mid','midFreq','treble','comp','hpf','reverb','delay'];
function snap(){return B().all().map(t=>({id:t.id,v:Object.fromEntries(PARAMS.map(k=>[k,t[k]])),ai:t.ai?JSON.parse(JSON.stringify(t.ai)):null}));}
function restore(s){for(const r of s){const t=B().raw(r.id);if(!t)continue;Object.assign(t,r.v);t.ai=r.ai?JSON.parse(JSON.stringify(r.ai)):null;if(!t.ai)delete t.ai;}B().refresh();}
// ---------- UI ----------
const panel=document.createElement('section');panel.id='apsMixAI';panel.className='aps-ai';panel.setAttribute('aria-label','Mixagem IA');
panel.innerHTML=`<div class="aps-ai-head"><div><h2>🤖 Mixagem IA</h2><p class="aps-ai-sub">Ouve cada pista, reconhece o instrumento e mixa sozinha — tudo no seu aparelho, sem internet paga.</p></div>
<label class="aps-ai-genre">Estilo <select id="apsAIGenre">${Object.entries(GENRES).map(([k,g])=>`<option value="${k}">${g.label}</option>`).join('')}</select></label></div>
<div class="aps-ai-actions"><button id="apsAIAnalyze" type="button">🔍 Analisar pistas</button><button id="apsAIMix" type="button" class="gold">✨ Mixagem IA (1 toque)</button><button id="apsAIAB" type="button" disabled>🅰🅱 Comparar: ouvindo IA</button><button id="apsAIUndo" type="button" disabled>↩ Desfazer</button></div>
<details class="aps-ai-opts"><summary>Opções da IA</summary><label><input type="checkbox" id="apsAIOptEQ" checked> EQ automático e mascaramento</label><label><input type="checkbox" id="apsAIOptComp" checked> Compressão por instrumento</label><label><input type="checkbox" id="apsAIOptPan" checked> Panorama automático</label><label><input type="checkbox" id="apsAIOptDuck" checked> Sidechain bumbo → baixo</label><label><input type="checkbox" id="apsAIOptDeess" checked> De-esser na voz</label><label><input type="checkbox" id="apsAIOptFx" checked> Reverb e delay pelo estilo</label></details>
<div class="aps-ai-ref"><label class="aps-ai-file">🎧 Música de referência<input id="apsAIRef" type="file" accept="audio/*,.wav,.mp3,.m4a,.flac,.ogg"></label><button id="apsAIRefMatch" type="button" disabled>🎯 Igualar à referência</button><span id="apsAIRefInfo" class="aps-ai-small"></span></div>
<p id="apsAIStatus" class="aps-ai-status" role="status">Importe as pistas (ou use as 6 do separador) e toque em ✨ Mixagem IA.</p>
<div id="apsAITracks" class="aps-ai-tracks"></div>
<canvas id="apsAICanvas" width="640" height="230" aria-label="Espectro das pistas e conflitos" hidden></canvas><p id="apsAICanvasHint" class="aps-ai-small" hidden>Cada linha é o espectro de uma pista. As faixas vermelhas mostram onde dois instrumentos brigam pela mesma frequência — foi ali que a IA abriu espaço.</p>
<ol id="apsAILog" class="aps-ai-log"></ol>`;
const mixer=$('apsBandMixer');mixer.parentNode.insertBefore(panel,mixer.nextSibling);
const say=(t,k)=>{const e=$('apsAIStatus');e.textContent=t;e.dataset.kind=k||'';};
function fmt(v,d=1){return Number.isFinite(v)?v.toFixed(d):'—';}
function drawTracks(){const root=$('apsAITracks');root.replaceChildren();for(const t of B().all()){const a=info.get(t.id);if(!a)continue;const d=document.createElement('div');d.className='aps-ai-card';
 d.innerHTML=`<strong>${ROLES[a.role]||a.role}</strong><small>${t.name.replace(/</g,'&lt;')} · reconhecido pelo ${a.how}</small><span>LUFS <b>${fmt(a.lufs)}</b></span><span>Pico <b>${fmt(a.peakDb)} dB</b></span><span>Crista <b>${fmt(a.crest)} dB</b></span><span>Brilho <b>${Math.round(a.centroid)} Hz</b></span>`;
 const sel=document.createElement('select');sel.setAttribute('aria-label','Instrumento de '+t.name);for(const[k,v]of Object.entries(ROLES))sel.add(new Option(v,k));sel.value=a.role;sel.onchange=()=>{a.role=sel.value;a.how='você';drawTracks();};d.append(sel);root.append(d);}}
async function analyzeAll(){const list=B().all();if(!list.length)throw Error('Não há pistas. Importe suas pistas ou toque em Demonstração.');
 for(let i=0;i<list.length;i++){const t=list[i];say('Analisando '+(i+1)+'/'+list.length+': '+t.name+'…');await idle();if(info.has(t.id)&&info.get(t.id).buf===t.buf)continue;const a=await analyze(t.buf);Object.assign(a,detect(t.name,a),{buf:t.buf});info.set(t.id,a);}
 for(const id of [...info.keys()])if(!list.some(t=>t.id===id))info.delete(id);
 drawTracks();say('Análise pronta: '+list.length+' pistas reconhecidas. Corrija o instrumento se precisar e toque em ✨ Mixagem IA.','ok');}
// ---------- mascaramento ----------
const ZONES=[{name:'graves',lo:40,hi:120},{name:'grave-médio (embolado)',lo:160,hi:400},{name:'médios',lo:500,hi:1600},{name:'presença',lo:2000,hi:5000}];
function conflicts(list){const out=[];for(let i=0;i<list.length;i++)for(let j=i+1;j<list.length;j++){const A=info.get(list[i].id),C=info.get(list[j].id);if(!A||!C||A.silent||C.silent)continue;
 for(const z of ZONES){const idx=BANDS.map((f,k)=>f>=z.lo&&f<=z.hi?k:-1).filter(k=>k>=0);
  const rel=a=>Math.max(...idx.map(k=>a.bands[k]))-Math.max(...a.bands);
  const ra=rel(A),rc=rel(C);if(ra>-6&&rc>-6){let peakK=idx[0],best=-1e9;for(const k of idx){const s=Math.min(A.bands[k]-Math.max(...A.bands),C.bands[k]-Math.max(...C.bands));if(s>best){best=s;peakK=k;}}
   const [hiT,loT]=PRIO[A.role]>=PRIO[C.role]?[list[i],list[j]]:[list[j],list[i]];out.push({zone:z,f:BANDS[peakK],keep:hiT,cut:loT,sev:clip((Math.min(ra,rc)+6)/6,0,1)});}}}
 return out.sort((a,b)=>b.sev-a.sev);}
function drawCanvas(list,conf){const c=$('apsAICanvas');c.hidden=false;const g=c.getContext('2d'),W=c.width,H=c.height;g.fillStyle='#0f141d';g.fillRect(0,0,W,H);
 const x=f=>Math.log(f/25)/Math.log(12000/25)*W,cols=['#e5bd72','#61dcc4','#f08a8a','#8fb4ff','#c9a4ff','#f6e07a','#7fe08a','#ffb36b'];
 for(const k of conf.slice(0,4)){g.fillStyle='rgba(240,110,110,.18)';g.fillRect(x(k.f/1.4),38,x(k.f*1.4)-x(k.f/1.4),H-52);}
 g.fillStyle='#8b93a3';g.font='11px system-ui';for(const f of [50,100,250,500,1000,2500,5000,10000]){g.fillText(f>=1000?f/1000+'k':f,x(f)+2,H-4);g.fillRect(x(f),38,1,H-52);}
 list.forEach((t,n)=>{const a=info.get(t.id);if(!a)return;const mx=Math.max(...a.bands);g.strokeStyle=cols[n%cols.length];g.lineWidth=2;g.beginPath();a.bands.forEach((v,k)=>{const y=46+(mx-v)*(H-64)/40;k?g.lineTo(x(BANDS[k]),y):g.moveTo(x(BANDS[k]),y);});g.stroke();g.fillStyle=cols[n%cols.length];g.fillRect(8+(n%4)*158,8+Math.floor(n/4)*15,10,3);g.fillText(((ROLES[a.role]||'').replace(/^\S+\s/,'')+' · '+t.name).slice(0,22),22+(n%4)*158,13+Math.floor(n/4)*15);});
 $('apsAICanvasHint').hidden=false;}
// ---------- sidechain ----------
function duckCurve(kickT,depthDb,total){const R=100,buf=kickT.buf,sr=buf.sampleRate,d=buf.getChannelData(0),hop=Math.floor(sr/R),n=Math.ceil((total||((kickT.start||0)+buf.duration))*R)+2,curve=new Array(n).fill(1);
 const env=[];for(let i=0;i+hop<=d.length;i+=hop){let e=0;for(let j=i;j<i+hop;j+=4)e=Math.max(e,Math.abs(d[j]));env.push(e);}
 const mx=Math.max(...env,1e-6),thr=mx*.35,off=Math.round((kickT.start||0)*R),depth=lin(-depthDb),relN=Math.round(.12*R);let hits=0;
 for(let k=1;k<env.length;k++)if(env[k]>thr&&env[k]>env[k-1]*1.6){hits++;for(let r=0;r<=relN;r++){const idx=off+k+r;if(idx>=n)break;const g=depth+(1-depth)*(r/relN);curve[idx]=Math.min(curve[idx],g);}}
 return{curve:curve.map(v=>+v.toFixed(3)),rate:R,hits};}
// ---------- a mixagem ----------
async function aiMix(){const list=B().all();await analyzeAll();const G=GENRES[$('apsAIGenre').value]||GENRES.pop,opt=id=>$(id).checked;
 const s0=snap();log=[];const add=(icon,txt)=>log.push(icon+' '+txt);
 const act=list.filter(t=>!info.get(t.id).silent);
 // 1) gain staging
 const want=act.map(t=>{const a=info.get(t.id),lv=LEVEL[a.role]??-9,target=-18+lv+(a.role==='voz'?G.voz:0);return{t,a,f:lin(target-a.lufs)};});
 const scale=Math.min(1,1.25/Math.max(...want.map(w=>w.f),1e-9));
 for(const w of want){const g=clip(Math.round(100*w.f*scale),5,150);w.t.gain=g;}
 add('🎚','Volumes equilibrados por instrumento (voz na frente, '+(G.label)+'): '+want.map(w=>w.t.name+' '+w.t.gain+'%').join(', ')+'.');
 for(const t of list){if(info.get(t.id).silent){add('🔇',t.name+' está praticamente em silêncio — não mexi.');}}
 // 2) EQ por instrumento
 for(const {t,a} of want){t.ai={eq:[]};if(!opt('apsAIOptEQ'))continue;const r=a.role;t.hpf=HPF[r]??80;
  const mudK=BANDS.map((f,k)=>[f,k]).filter(([f])=>f>=200&&f<=500);const avg=a.bands.reduce((s,v)=>s+v,0)/a.bands.length;let [mf,mk]=mudK[0];for(const[f,k]of mudK)if(a.bands[k]>a.bands[mk]){mf=f;mk=k;}
  if(!['bass','kick'].includes(r)&&a.mud>.22){const g=-clip((a.mud-.18)*25,1.5,4);t.ai.eq.push({type:'peaking',f:mf,g:+g.toFixed(1),q:1.4});add('🧹',t.name+': cortei '+Math.abs(g).toFixed(1)+' dB em '+mf+' Hz para tirar o som "embolado" (grave-médio acumulado).');}
  if(r==='voz'){t.ai.eq.push({type:'peaking',f:3000,g:+(1.5+G.bright*.5).toFixed(1),q:1});t.treble=clip(Math.round(G.bright),0,4);add('🎤',t.name+': realcei a presença em 3 kHz para a voz ficar clara e na frente.');}
  if(r==='kick'){t.ai.eq.push({type:'peaking',f:60,g:2,q:1.2},{type:'peaking',f:350,g:-3,q:1.5},{type:'peaking',f:3500,g:2,q:1.5});add('🥁',t.name+': peso em 60 Hz, tirei "papelão" em 350 Hz e dei ataque em 3,5 kHz.');}
  if(r==='bass'){t.ai.eq.push({type:'peaking',f:800,g:1.5,q:1});add('🎸',t.name+': um pouco de 800 Hz para o baixo aparecer em caixinha de celular.');}
  if(r==='snare'){t.ai.eq.push({type:'peaking',f:200,g:1.5,q:1.2},{type:'peaking',f:5000,g:1.5,q:1});}
  if(['guitar','violao','keys','sanfona'].includes(r)&&act.some(x=>info.get(x.id).role==='voz')){t.ai.eq.push({type:'peaking',f:2500,g:-2,q:1.2});add('🎶',t.name+': abri espaço de 2 dB em 2,5 kHz para a voz passar por cima.');}
 }
 // 3) mascaramento entre pistas
 lastConflicts=opt('apsAIOptEQ')?conflicts(act):[];let fixed=0;
 for(const c of lastConflicts.slice(0,8)){const t=c.cut;if(!t.ai)continue;if(t.ai.eq.some(e=>Math.abs(Math.log2(e.f/c.f))<.4&&e.g<0))continue;const g=-(1.5+2*c.sev);t.ai.eq.push({type:'peaking',f:c.f,g:+g.toFixed(1),q:1.6});fixed++;
  add('⚔️',`${c.keep.name} e ${t.name} brigavam nos ${c.zone.name} (~${c.f} Hz). Cortei ${Math.abs(g).toFixed(1)} dB em ${t.name} para ${c.keep.name} aparecer sem aumentar volume.`);}
 if(opt('apsAIOptEQ')&&!fixed)add('✅','Não achei instrumentos brigando forte pela mesma frequência.');
 // 4) compressão
 if(opt('apsAIOptComp'))for(const{t,a}of want){const c=COMP[a.role]||COMP.other;const th=clip(Math.round(a.rmsDb+(a.crest>14?4:7)),-40,-8);t.comp=false;t.ai.comp={th:Math.min(th,c[0]+8),ratio:+(c[1]*G.comp).toFixed(1),att:c[2],rel:c[3],knee:8,makeup:clip(+((c[1]*G.comp-1)*1.2).toFixed(1),0,5)};}
 if(opt('apsAIOptComp'))add('🗜','Compressão própria para cada instrumento (voz 3:1 rápida, baixo 4:1, bumbo segura o ataque, violões/teclados leves).');
 // 5) panorama
 if(opt('apsAIOptPan')){const sides={};const center=['voz','kick','snare','bass','drums'];let flip=1;
  for(const{t,a}of want){if(center.includes(a.role)){t.pan=0;continue;}const base={guitar:45,violao:35,keys:25,sanfona:20,horn:40,strings:50,coro:55,perc:30,hat:20,other:30}[a.role]??30;const n=sides[a.role]=(sides[a.role]||0)+1;const side=n%2?flip:-flip;flip=-flip;t.pan=clip(Math.round(side*base*G.width*(1+.15*Math.floor((n-1)/2))),-90,90);}
  add('↔️','Panorama: voz, bumbo, caixa e baixo no centro; '+want.filter(w=>w.t.pan).map(w=>w.t.name+(w.t.pan<0?' à esquerda ':' à direita ')+Math.abs(w.t.pan)).join(', ')+'.');}
 // 6) sidechain bumbo → baixo
 const kick=want.find(w=>w.a.role==='kick')||want.find(w=>w.a.role==='drums'),bass=want.filter(w=>w.a.role==='bass');
 if(opt('apsAIOptDuck')&&kick&&bass.length&&G.duck>0){const total=Math.max(...list.map(t=>(t.start||0)+t.buf.duration));const dc=duckCurve(kick.t,G.duck,total);if(dc.hits){for(const b of bass)b.t.ai.duck=dc;add('🔗',`Sidechain: o baixo abaixa ${G.duck} dB a cada batida do ${kick.t.name} (${dc.hits} batidas), para os dois não se embolarem.`);}}
 else if(opt('apsAIOptDuck')&&G.duck===0)add('🔗','Sidechain desligado no estilo '+G.label+' (soa mais natural).');
 // 7) de-esser
 if(opt('apsAIOptDeess'))for(const{t,a}of want)if(a.role==='voz'||a.role==='coro'){const sibK=BANDS.map((f,k)=>[f,k]).filter(([f])=>f>=5000&&f<=10000);let[bf,bk]=sibK[0];for(const[f,k]of sibK)if(a.bands[k]>a.bands[bk]){bf=f;bk=k;}const g=-clip(2+(a.sib-.05)*40,2,6);t.ai.deess={f:bf,g:+g.toFixed(1)};add('🐍',`${t.name}: de-esser em ${bf} Hz (−${Math.abs(g).toFixed(1)} dB) para suavizar o "S" e o "X".`);}
 // 8) reverb e delay
 if(opt('apsAIOptFx')){for(const{t,a}of want){const s=SEND[a.role]||SEND.other;t.reverb=clip(Math.round(G.rev*s[0]),0,40);t.delay=clip(Math.round(G.del*s[1]),0,35);}add('🌌',`Ambiência do ${G.label}: reverb ${G.rev}% e delay ${G.del}% na voz; graves secos (bumbo e baixo sem reverb).`);}
 B().refresh();before=s0;after=snap();showing='B';undoStack.push(s0);$('apsAIAB').disabled=false;$('apsAIUndo').disabled=false;$('apsAIAB').textContent='🅰🅱 Comparar: ouvindo IA';
 drawCanvas(act,lastConflicts);renderLog();say('✨ Mixagem IA aplicada no estilo '+G.label+'. Use 🅰🅱 para comparar com o original e ↩ para desfazer.','ok');
 if(window.APSMaster){const tg=$('apsMasterTarget');if(tg&&![...tg.options].some(o=>o.value==='ref'))tg.dataset.genre=G.lufs;}
 return log;}
function renderLog(){const ol=$('apsAILog');ol.replaceChildren();for(const l of log){const li=document.createElement('li');li.textContent=l;ol.append(li);}}
// ---------- referência ----------
let refA=null;
$('apsAIRef').addEventListener('change',async e=>{const f=e.target.files?.[0];if(!f)return;try{say('Analisando a referência '+f.name+'…');const ctx=new (window.AudioContext||window.webkitAudioContext)();const b=await ctx.decodeAudioData(await f.arrayBuffer());ctx.close?.();refA=await analyze(b);refA.name=f.name;$('apsAIRefInfo').textContent=f.name+' · '+fmt(refA.lufs)+' LUFS';$('apsAIRefMatch').disabled=false;say('Referência pronta. Toque em 🎯 Igualar à referência.','ok');}catch(err){say('Não consegui abrir a referência: '+err.message,'error');}});
const REF_BANDS=[{f:60,type:'lowshelf'},{f:150},{f:400},{f:1000},{f:3000},{f:9000,type:'highshelf'}];
async function refMatch(){if(!refA)throw Error('Escolha primeiro a música de referência.');if(!B().all().length)throw Error('Importe as pistas antes.');say('Ouvindo a sua mixagem para comparar com a referência…');
 const mix=await B().renderMix();const m=await analyze(mix);const norm=a=>{const mean=a.bands.reduce((s,v)=>s+v,0)/a.bands.length;return a.bands.map(v=>v-mean);};const R=norm(refA),M=norm(m);
 const eq=REF_BANDS.map(b=>{const ks=BANDS.map((f,k)=>[f,k]).filter(([f])=>f>=b.f/1.7&&f<=b.f*1.7).map(([,k])=>k);const d=ks.reduce((s,k)=>s+(R[k]-M[k]),0)/Math.max(1,ks.length);return{type:b.type||'peaking',f:b.f,g:+clip(d*.6,-4,4).toFixed(1),q:.9};}).filter(b=>Math.abs(b.g)>=.5);
 window.APSMasterRef={eq,lufs:clip(refA.lufs,-16,-7),name:refA.name};
 const tg=$('apsMasterTarget');if(tg){let o=[...tg.options].find(o=>o.value==='ref');if(!o){o=new Option('🎯 Igual à referência','ref');tg.add(o);}o.textContent='🎯 Igual à referência ('+fmt(window.APSMasterRef.lufs)+' LUFS)';tg.value='ref';}
 log.push('🎯 Comparei com "'+refA.name+'": '+(eq.length?eq.map(b=>(b.g>0?'+':'')+b.g+' dB em '+(b.f>=1000?b.f/1000+' kHz':b.f+' Hz')).join(', '):'timbre já parecido')+'. Volume final mirando '+fmt(window.APSMasterRef.lufs)+' LUFS. Isso entra na Masterização abaixo.');renderLog();
 say('Referência aplicada na masterização. Role até 🏆 Masterização e toque em Masterizar.','ok');return window.APSMasterRef;}
// ---------- botões ----------
const guard=fn=>async()=>{try{await fn();}catch(e){say(e.message,'error');}};
$('apsAIAnalyze').onclick=guard(analyzeAll);
$('apsAIMix').onclick=guard(async()=>{$('apsAIMix').disabled=true;try{await aiMix();}finally{$('apsAIMix').disabled=false;}});
$('apsAIAB').onclick=()=>{if(!before||!after)return;if(showing==='B'){after=snap();restore(before);showing='A';$('apsAIAB').textContent='🅰🅱 Comparar: ouvindo ORIGINAL';say('Ouvindo como estava antes da IA (A).');}else{restore(after);showing='B';$('apsAIAB').textContent='🅰🅱 Comparar: ouvindo IA';say('Ouvindo a mixagem da IA (B).');}};
$('apsAIUndo').onclick=()=>{const s=undoStack.pop();if(!s)return;if(showing==='A'){showing='B';}restore(s);before=after=null;$('apsAIAB').disabled=true;$('apsAIUndo').disabled=!undoStack.length;$('apsAIAB').textContent='🅰🅱 Comparar';say('Desfeito: a mixagem voltou ao que era antes da IA.');};
$('apsAIRefMatch').onclick=guard(refMatch);
window.APSMixAI={analyze,analyzeAll,aiMix,refMatch,detect,conflicts:()=>lastConflicts,info:()=>info,GENRES};
})();
