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
 if(/menos agudo|menos brilh|prato suave|sem asperez|menos estriden/.test(s)){set('treble',clip(track.treble-3,-12,12));tags.push('redução de agudos');}
 if(/mais med|m[eé]dios present|definic.*m[eé]di/.test(s)){set('mid',clip(track.mid+3,-12,12));tags.push('definição de médios');}
 if(/seco|sem reverb|sem ambi/.test(s)){set('reverb',0);set('delay',0);tags.push('som seco');}
 if(/reverb|ambi[eê]ncia|espac|sala/.test(s)){set('reverb',clip(track.reverb+8,0,40));tags.push('ambiência discreta');}
 if(/compress|control.*din[aâ]mic/.test(s)){set('comp',true);tags.push('compressão dinâmica');}
 if(/sem compres|tirar compres/.test(s)){set('comp',false);tags.push('compressor desligado');}
 if(/esquerd/.test(s)){set('pan',-38);tags.push('pan à esquerda');}
 if(/direit/.test(s)){set('pan',38);tags.push('pan à direita');}
 if(/centro|centraliz/.test(s)){set('pan',0);tags.push('pan central');}
 // Entender alvos por frase: voz, baixo, bateria etc. Evita aplicar descrição de baixo a todos.
 if(!tags.length){if(voice){vals={mid:clip(track.mid+1,-12,12)};tags=['leve presença da voz'];}else if(kick){vals={bass:clip(track.bass+1,-12,12)};tags=['corpo de bumbo'];}else if(bass){vals={mid:clip(track.mid+1,-12,12)};tags=['definição do baixo'];}else if(drum){vals={gain:track.gain};tags=['preservar bateria sem alterações'];}else{vals={gain:track.gain};tags=['sem ajuste necessário'];}}
 return {vals,tags};
}
function sentencesForTrack(text,t,global){const normalized=clean(text);if(!global)return text;
 // Decomposição por palavras-alvo de instrumentos; segmentos independentes isolam os pedidos.
 const pieces=text.split(/[;\n]|,(?=\s*(?:o |a |os |as |quero |voz|baixo|bateria|guitarra|piano|teclado))/i).map(x=>x.trim()).filter(Boolean);
 if(pieces.length<2)return text;
 const kinds={bass:/\bbaix|fretless|contrabaix/i,drum:/bateri|bumbo|caixa|prato|chimbal/i,voice:/voz|vocal|canto/i,guitar:/guitarr|viol[aã]o/i,piano:/piano|teclad/i};
 const k=/bass|baixo|fretless/.test(clean(t.name+' '+t.type))?'bass':isDrum(t)?'drum':/voz|vocal/.test(clean(t.name+' '+t.type))?'voice':/guitarra|violao/.test(clean(t.name+' '+t.type))?'guitar':/piano|teclado/.test(clean(t.name+' '+t.type))?'piano':null;
 return pieces.filter(p=>{const matches=Object.entries(kinds).filter(([,re])=>re.test(p)).map(([key])=>key);return !matches.length||matches.includes(k)}).join('. ')||'Preserve naturalidade';
}
function preview(){const text=$('apsMixRequest').value.trim();if(text.length<5){say('Escreva como deseja o som. Exemplo: "baixo aveludado e presente, voz clara, pratos suaves".','error');return;}
 const tracks=all(),isGlobal=$('apsMixTarget').value==='all';const chosen=isGlobal?tracks:tracks.filter(t=>t.id===$('apsMixTarget').value);
 if(!chosen.length){say('Ainda não há pistas disponíveis. Importe áudio primeiro.','error');return;}
 const needCloud=/separ(a|e)|isol(ar|e)|transcri|partitura|afinar|autotune|melodyne|harmoni|masteriz.*\bia\b|identific.*acord/.test(clean(text));
 const target=chosen.map(t=>{const {vals,tags}=classify(sentencesForTrack(text,t,isGlobal),t);if($('apsMixFlavor').value==='strong'&&vals.gain!==undefined){vals.gain=clip(vals.gain+5,0,150);tags.push('presença reforçada');}return {id:t.id,name:t.name,values:vals,tags};});
 pending=target;lastPrompt=text;
 $('apsMixApply').disabled=false;
 say('Prévia dos ajustes — nada foi alterado ainda:\n'+target.map(t=>'• '+t.name+': '+t.tags.join(', ')).join('\n')+'\n\n'+(needCloud?'Atenção: separação, identificação harmônica e afinador neural não estão conectados à IA avançada; esses pedidos não serão executados.\n\n':'')+'Confirme em “Aplicar ao áudio”. As gravações originais e seus ataques permanecem intactos.');
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
