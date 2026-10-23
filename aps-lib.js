/* APS Biblioteca — timbres próprios de Anderclay Pereira Silva. Carregamento sob demanda (não vai pro cache inicial). */
(function(root){'use strict';
let man=null;const raw=new Map(),dec=new WeakMap();
const NOMES={baixo:'🎸 Baixo',teclado:'🎹 Teclado','violao-guitarra':'🎸 Violão/guitarra',outros:'🎼 Timbres diversos',bateria:'🥁 Bateria',arpejo:'🎵 Arpejo'};
async function manifest(){if(!man)man=fetch('./lib/lib.json').then(r=>{if(!r.ok)throw Error('Biblioteca indisponível');return r.json();}).catch(e=>{man=null;throw e;});return man;}
function bytes(file){if(!raw.has(file))raw.set(file,fetch('./'+file).then(r=>{if(!r.ok)throw Error('Falha ao carregar '+file);return r.arrayBuffer();}).catch(e=>{raw.delete(file);throw e;}));return raw.get(file);}
async function buffer(ac,file){let m=dec.get(ac);if(!m){m=new Map();dec.set(ac,m);}if(!m.has(file))m.set(file,bytes(file).then(ab=>ac.decodeAudioData(ab.slice(0))));return m.get(file);}
async function items(f){return (await manifest()).itens.filter(f||(()=>true));}
/* Sampler afinado: escolhe até 8 amostras de alturas diferentes do instrumento */
async function sampler(ac,inst){const L=(await items(i=>i.inst===inst&&i.tipo==='one-shot'&&typeof i.midi==='number')).sort((a,b)=>a.midi-b.midi);if(!L.length)return null;
 const pick=[];for(const it of L)if(!pick.some(p=>Math.abs(p.midi-it.midi)<1))pick.push(it);const sel=pick.length>8?pick.filter((_,i)=>i%Math.ceil(pick.length/8)===0):pick;
 const zones=[];for(const it of sel){try{zones.push({midi:it.midi,buf:await buffer(ac,it.file)});}catch{}}return zones.length?{inst,zones}:null;}
function note(ac,S,t,dur,midi,out,vel=.8){if(!S)return false;let z=S.zones[0];for(const q of S.zones)if(Math.abs(q.midi-midi)<Math.abs(z.midi-midi))z=q;
 const s=ac.createBufferSource(),g=ac.createGain();s.buffer=z.buf;s.playbackRate.value=Math.pow(2,(midi-z.midi)/12);
 const len=Math.min(dur+.12,z.buf.duration/s.playbackRate.value);g.gain.setValueAtTime(vel,t);g.gain.setValueAtTime(vel,t+Math.max(.01,len-.08));g.gain.linearRampToValueAtTime(0,t+len);
 s.connect(g).connect(out);s.start(t);s.stop(t+len+.02);return true;}
/* Kits de bateria montados com os one-shots da biblioteca (bumbo/caixa/chimbal por música de origem) */
async function drumKits(){const L=await items(i=>i.inst==='bateria'&&i.tipo==='one-shot'&&i.sub);const by={};
 for(const it of L){const o=it.id.split('-')[0];const k=by[o]||(by[o]={name:'',pieces:{}});const p=it.sub==='hat'?'hat':it.sub;(k.pieces[p]=k.pieces[p]||[]).push({file:it.file,label:(p==='kick'?'Bumbo':p==='snare'?'Caixa':'Chimbal')+' '+(k.pieces[p].length+1)});}
 const out={};for(const[o,k]of Object.entries(by))if(k.pieces.kick&&k.pieces.snare&&k.pieces.hat){k.name='🥁 Biblioteca APS '+(Object.keys(out).length+1);out['lib-'+o]=k;}return out;}
root.APSLib={manifest,items,buffer,sampler,note,drumKits,NOMES};
/* Integra com APSGen (kit.html, banda.html): kits da biblioteca aparecem junto com os MMSTUDIO */
function hook(){const G=root.APSGen;if(!G||G.__lib||!G.loadKits)return;G.__lib=1;const orig=G.loadKits.bind(G);let merged=null;
 G.loadKits=async function(){if(merged)return merged;const base=await orig();let extra={};try{extra=await drumKits();}catch{}merged=Object.assign(base,extra);return merged;};}
hook();document.addEventListener('DOMContentLoaded',hook);
})(self);
