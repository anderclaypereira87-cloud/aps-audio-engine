// APS DAW — entrada de áudio/interface USB, recepção da Central de Mídia e medição de latência.
// Exclusivo da DAW (daw.html). Não grava câmera (isso é da Central de Mídia) e não gera áudio musical:
// o único som produzido é o clique de teste da medição de latência, por pedido explícito do usuário.
(function(root){
'use strict';
const KEY='aps-daw-latency-v1';

// ---------- Funções puras (testadas em tests/daw-io.test.mjs) ----------
// Lê o cabeçalho de um WAV (ArrayBuffer) e devolve {rate, channels, bits, frames, duration} ou null.
function wavInfo(buf){
  const v=new DataView(buf);if(buf.byteLength<12)return null;
  const tag=o=>String.fromCharCode(v.getUint8(o),v.getUint8(o+1),v.getUint8(o+2),v.getUint8(o+3));
  if(tag(0)!=='RIFF'||tag(8)!=='WAVE')return null;
  let o=12,fmt=null;
  while(o+8<=buf.byteLength){const id=tag(o),size=v.getUint32(o+4,true),body=o+8;
    if(id==='fmt '){fmt={format:v.getUint16(body,true),channels:v.getUint16(body+2,true),rate:v.getUint32(body+4,true),block:v.getUint16(body+12,true),bits:v.getUint16(body+14,true)};}
    else if(id==='data'&&fmt){const bytes=Math.min(size,buf.byteLength-body);const frames=Math.floor(bytes/fmt.block);return {...fmt,frames,duration:frames/fmt.rate};}
    o=body+size+(size&1);}
  return null;
}
// Classifica o arquivo recebido.
function classify(file){
  const name=(file&&file.name)||'',type=(file&&file.type)||'';
  if(/^video\//.test(type)||/\.(mp4|mov|webm|mkv|m4v|3gp)$/i.test(name))return 'video';
  if(/wav/.test(type)||/\.wav$/i.test(name))return 'wav';
  if(/^audio\//.test(type)||/\.(mp3|m4a|aac|ogg|opus|flac|aif|aiff)$/i.test(name))return 'audio';
  return 'unknown';
}
// Mensagem clara quando o navegador não decodifica o codec.
function codecMessage(file,err){
  const kind=classify(file),t=(file&&file.type)||'tipo desconhecido';
  const base=kind==='video'?`O navegador não conseguiu extrair o áudio deste vídeo (${t}).`:`O navegador não conseguiu ler este áudio (${t}).`;
  return base+' Isso depende do codec suportado por este aparelho. Na Central de Mídia, exporte o áudio em WAV e envie de novo.'+(err&&err.message?` Detalhe técnico: ${err.message}`:'');
}
// Mede o atraso entre cliques emitidos (em amostras 'clickAt') e o sinal gravado.
// Para cada clique procura o primeiro ponto acima do limiar dentro da janela [click, click+maxMs].
// Devolve {ms, samples, spreadMs, found, total, reliable, reason}.
function estimateLatency(rec,rate,clickAt,{maxMs=600,minRatio=6}={}){
  const n=rec.length;if(!n||!clickAt.length)return {found:0,total:clickAt.length,reliable:false,reason:'sem dados'};
  // ruído de fundo: mediana do valor absoluto antes do primeiro clique (ou do sinal todo)
  const pre=rec.subarray(0,Math.max(64,Math.min(n,clickAt[0])));
  const abs=Float32Array.from(pre,Math.abs).sort();const noise=Math.max(1e-4,abs[Math.floor(abs.length*.9)]||0);
  let peakAll=0;for(let i=0;i<n;i++)peakAll=Math.max(peakAll,Math.abs(rec[i]));
  const thr=Math.max(noise*minRatio,peakAll*.3),win=Math.round(maxMs/1000*rate),delays=[];
  for(const c of clickAt){if(c>=n)continue;const end=Math.min(n,c+win);for(let i=c;i<end;i++){if(Math.abs(rec[i])>=thr){delays.push(i-c);break;}}}
  if(!delays.length)return {found:0,total:clickAt.length,reliable:false,reason:'nenhum clique ouvido pelo microfone'};
  const s=[...delays].sort((a,b)=>a-b),med=s[Math.floor(s.length/2)],spread=(s[s.length-1]-s[0])/rate*1000;
  const reliable=delays.length>=Math.ceil(clickAt.length*.6)&&spread<=5&&peakAll>noise*minRatio;
  return {ms:med/rate*1000,samples:med,spreadMs:spread,found:delays.length,total:clickAt.length,reliable,
    reason:reliable?'ok':(spread>5?'atrasos inconsistentes entre cliques (ruído ou eco)':'poucos cliques detectados')};
}
// Quantas amostras cortar no início de uma tomada para compensar a latência salva.
function compensationSamples(rate,store){
  try{const s=JSON.parse((store||root.localStorage).getItem(KEY)||'null');if(!s||!s.enabled)return 0;
    const ms=Number(s.ms);if(!Number.isFinite(ms)||ms<0||ms>1000)return 0;return Math.round(ms/1000*rate);}catch{return 0;}
}
const api={wavInfo,classify,codecMessage,estimateLatency,compensationSamples,KEY};
if(typeof module!=='undefined'&&module.exports){module.exports=api;return;}
root.APSDawIO=api;

// ---------- Interface na DAW ----------
const $=id=>document.getElementById(id);
function load(){try{return JSON.parse(localStorage.getItem(KEY)||'null')||{enabled:false,ms:0};}catch{return {enabled:false,ms:0};}}
function save(s){localStorage.setItem(KEY,JSON.stringify(s));}
async function permState(){try{const p=await navigator.permissions.query({name:'microphone'});return p.state;}catch{return 'desconhecido';}}
const permLabel={granted:'✅ Permitido',denied:'⛔ Bloqueado (libere nas configurações do navegador)',prompt:'❔ Ainda não pedido',desconhecido:'❔ Não informado por este navegador'};

async function refresh(){
  const box=$('apsIoInfo');if(!box)return;
  const state=await permState();let inputs=[];
  try{inputs=(await navigator.mediaDevices.enumerateDevices()).filter(d=>d.kind==='audioinput');}catch{}
  const names=inputs.map(d=>d.label||'(nome oculto até permitir o microfone)');
  const s=load();
  box.innerHTML='';
  const add=t=>{const p=document.createElement('div');p.textContent=t;box.appendChild(p);};
  add('Permissão do microfone: '+(permLabel[state]||state));
  add(`Entradas encontradas: ${inputs.length}${names.length?' — '+names.join(' · '):''}`);
  add('Monitoramento: a entrada NÃO é enviada aos alto-falantes (evita microfonia). Só o medidor mostra o sinal. Para ouvir a base enquanto grava, use fone de ouvido.');
  add(s.measuredAt?`Última medição: ${s.reliable?s.ms.toFixed(1)+' ms':'sem valor confiável'} (${new Date(s.measuredAt).toLocaleString('pt-BR')}${s.reliable?'':''})`:'Latência ainda não medida neste aparelho.');
}

async function reported(){
  const out=[];const AC=root.AudioContext||root.webkitAudioContext;if(!AC)return ['Áudio Web indisponível.'];
  const c=new AC({latencyHint:'interactive'});
  try{out.push(`Latência informada pelo navegador — base: ${((c.baseLatency||0)*1000).toFixed(1)} ms, saída: ${c.outputLatency?(c.outputLatency*1000).toFixed(1)+' ms':'não informada'}. Taxa: ${c.sampleRate} Hz.`);}finally{c.close();}
  out.push('Atenção: estes números são estimativas do navegador e não incluem o caminho completo; use “Medir latência” para o valor real.');
  return out;
}

// Medição em laço: toca 6 cliques curtos e grava pelo microfone/interface escolhido.
// O usuário deve aproximar o microfone do alto-falante (ou ligar a saída da interface na entrada com um cabo).
async function measure(){
  const status=$('apsIoStatus');const say=t=>{status.textContent=t;};
  if(!navigator.mediaDevices?.getUserMedia)throw Error('Este navegador não dá acesso ao microfone.');
  const dev=$('micDevice')?.value;
  const stream=await navigator.mediaDevices.getUserMedia({audio:{deviceId:dev?{exact:dev}:undefined,echoCancellation:false,noiseSuppression:false,autoGainControl:false,channelCount:1}});
  const AC=root.AudioContext||root.webkitAudioContext,c=new AC({latencyHint:'interactive'});
  try{
    await c.resume();const rate=c.sampleRate,src=c.createMediaStreamSource(stream),proc=c.createScriptProcessor(1024,1,1),mute=c.createGain();mute.gain.value=0;
    const chunks=[];let first=null;
    proc.onaudioprocess=e=>{if(first===null)first=e.playbackTime;chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));};
    src.connect(proc);proc.connect(mute);mute.connect(c.destination);
    say('Medindo… mantenha silêncio.');
    await new Promise(r=>setTimeout(r,600));
    const t0=c.currentTime+.3,times=[];
    for(let i=0;i<6;i++){const t=t0+i*.5;times.push(t);const o=c.createOscillator(),g=c.createGain();o.frequency.value=1000;g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(.8,t+.001);g.gain.exponentialRampToValueAtTime(.001,t+.03);o.connect(g);g.connect(c.destination);o.start(t);o.stop(t+.04);}
    await new Promise(r=>setTimeout(r,(times[5]-c.currentTime+.9)*1000));
    proc.disconnect();src.disconnect();
    const total=chunks.reduce((s,a)=>s+a.length,0),rec=new Float32Array(total);let p=0;for(const a of chunks){rec.set(a,p);p+=a.length;}
    const clickAt=times.map(t=>Math.round((t-first)*rate));
    const r=estimateLatency(rec,rate,clickAt);
    if(!r.found){say('Nenhum clique chegou ao microfone. Aumente o volume, aproxime o microfone do alto-falante e tente de novo. Nada foi salvo.');return r;}
    const s={...load(),ms:r.ms,reliable:r.reliable,measuredAt:Date.now(),found:r.found,spreadMs:r.spreadMs,rate};
    save(r.reliable?s:{...s,ms:load().ms});if(r.reliable)$('apsIoMs').value=r.ms.toFixed(1);
    say(`Atraso medido: ${r.ms.toFixed(1)} ms (${r.found} de ${r.total} cliques, variação ${r.spreadMs.toFixed(1)} ms). ${r.reliable?'Medição consistente.':'Medição NÃO confiável: '+r.reason+'. O valor não foi aplicado; repita em ambiente silencioso.'}`);
    refresh();return r;
  }finally{for(const t of stream.getTracks())t.stop();c.close();}
}

function mount(){
  const anchor=$('micStatus');if(!anchor||$('apsIo'))return;
  const s=load();
  const wrap=document.createElement('details');wrap.id='apsIo';wrap.className='aps-io';
  wrap.innerHTML=`<summary>🎚 Interface de áudio, permissão e latência</summary>
  <div id="apsIoInfo" class="aps-io-info"></div>
  <div class="aps-io-row"><button type="button" id="apsIoRefresh">Atualizar entradas</button><button type="button" id="apsIoReported">Latência informada</button><button type="button" id="apsIoMeasure">Medir latência</button></div>
  <p class="aps-io-hint">Medir: aproxime o microfone do alto-falante (ou ligue a saída da interface na entrada com um cabo), volume médio, ambiente silencioso. Serão tocados 6 cliques curtos.</p>
  <label class="check block"><input id="apsIoComp" type="checkbox"${s.enabled?' checked':''}> Compensar atraso nas novas tomadas</label>
  <label>Atraso (ms) <input id="apsIoMs" type="number" min="0" max="1000" step="0.1" value="${Number(s.ms||0).toFixed(1)}" style="width:6em"></label>
  <div id="apsIoStatus" class="aps-io-status" aria-live="polite"></div>`;
  const head=anchor.parentElement;head.insertAdjacentElement('afterend',wrap);
  const st=document.createElement('style');st.textContent='.aps-io{margin-top:10px;border:1px solid #6b5520;border-radius:8px;padding:8px;color:#eee}.aps-io summary{cursor:pointer;color:#d4af37;font-weight:600}.aps-io-info div{margin:4px 0;font-size:.9em}.aps-io-row{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0}.aps-io-hint{font-size:.8em;opacity:.8}.aps-io-status{margin-top:6px;font-size:.9em;color:#f0d77a}';document.head.appendChild(st);
  const persist=()=>{const v=Number($('apsIoMs').value);save({...load(),enabled:$('apsIoComp').checked,ms:Number.isFinite(v)?Math.min(1000,Math.max(0,v)):0});};
  $('apsIoComp').onchange=persist;$('apsIoMs').onchange=persist;
  $('apsIoRefresh').onclick=()=>refresh();
  $('apsIoReported').onclick=async()=>{$('apsIoStatus').textContent=(await reported()).join(' ');};
  $('apsIoMeasure').onclick=()=>measure().catch(e=>{$('apsIoStatus').textContent='Não foi possível medir: '+(e.name==='NotAllowedError'?'permissão do microfone negada.':e.message);});
  wrap.addEventListener('toggle',()=>{if(wrap.open)refresh();});
  try{navigator.mediaDevices?.addEventListener('devicechange',refresh);}catch{}
}
root.APSDawIO.measure=measure;root.APSDawIO.refresh=refresh;root.APSDawIO.reported=reported;
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount);else mount();
})(typeof window!=='undefined'?window:globalThis);
