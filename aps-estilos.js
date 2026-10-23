/* APS 3.6.0 — Modelos de mixagem por estilo brasileiro (1 toque).
   Valores de referência: medianas dos perfis de mixagem das gravações do próprio Anderclay
   (loudness ~ -11 LUFS, crest ~13 dB, correlação estéreo ~0.9). Nenhum áudio da biblioteca é usado. */
(function(){'use strict';
const clean=s=>String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
const ROLES=[['voz',/voz|vocal|canto|lead/],['coro',/coro|backing|bv/],['kick',/kick|bumbo|zabumba/],['snare',/snare|caixa|aro|rim/],['hat',/hat|chimbal|prato|crash|ride|triangulo/],['perc',/perc|conga|pandeiro|shaker|tamborim|repique|timba|surdo|agogo/],['drums',/drum|bateria/],['bass',/bass|baixo/],['sanfona',/sanfona|acorde|acordeon|teclado sanfona/],['violao',/violao|acoust|nylon|cavaco/],['guitar',/guitar|guitarra/],['keys',/piano|keys|teclado|synth|organ|orgao/],['horn',/metais|horn|sax|trompete|trombone/],['strings',/string|cordas|violino/]];
const role=t=>{const n=clean(t.name+' '+t.type);for(const[r,re]of ROLES)if(re.test(n))return r;return 'other';};
// base por papel: g=volume(0-150), b/m/t=EQ dB, h=HPF Hz, r=reverb, d=delay, c=comp, p=pan
const BASE={voz:{g:100,b:-1,m:1,t:2,h:90,r:12,d:6,c:1,p:0},coro:{g:70,b:-2,m:0,t:2,h:130,r:18,d:6,c:1,p:30},kick:{g:92,b:3,m:-2,t:1,h:30,r:0,d:0,c:1,p:0},snare:{g:85,b:0,m:1,t:2,h:90,r:10,d:0,c:1,p:0},hat:{g:60,b:-4,m:-1,t:1,h:300,r:4,d:0,c:0,p:20},perc:{g:65,b:-2,m:0,t:2,h:160,r:8,d:0,c:0,p:-25},drums:{g:90,b:1,m:-1,t:1,h:35,r:6,d:0,c:1,p:0},bass:{g:88,b:2,m:1,t:-2,h:35,r:0,d:0,c:1,p:0},sanfona:{g:82,b:-2,m:1,t:1,h:110,r:10,d:2,c:1,p:-15},violao:{g:75,b:-2,m:0,t:2,h:90,r:10,d:0,c:1,p:-30},guitar:{g:72,b:-1,m:1,t:1,h:100,r:8,d:4,c:1,p:30},keys:{g:70,b:-2,m:0,t:1,h:70,r:14,d:3,c:0,p:15},horn:{g:70,b:-2,m:1,t:1,h:120,r:12,d:2,c:1,p:-20},strings:{g:62,b:-2,m:0,t:1,h:100,r:20,d:0,c:0,p:20},other:{g:70,b:-1,m:0,t:0,h:100,r:10,d:0,c:0,p:0}};
// ajustes por estilo (somados à base) + alvo de master
const S={
 forro:{label:'Forró',ico:'🪗',lufs:-11,desc:'Sanfona na frente, zabumba com peso, triângulo brilhante.',adj:{sanfona:{g:12,m:2,t:1,p:0},kick:{g:6,b:2},hat:{g:8,t:3},bass:{g:4},voz:{r:-2}},rev:0},
 piseiro:{label:'Piseiro',ico:'🔥',lufs:-9.5,desc:'Grave forte e seco, teclado/sanfona brilhante, voz na cara.',adj:{kick:{g:10,b:4},bass:{g:8,b:3},keys:{g:10,t:2},sanfona:{g:8,t:2},voz:{g:4,r:-6,d:2}},rev:-4},
 sertanejo:{label:'Sertanejo',ico:'🤠',lufs:-11,desc:'Vozes abertas com ambiência, violão definido, baixo redondo.',adj:{voz:{r:6,d:4,t:1},coro:{g:10,r:6},violao:{g:10,t:1},bass:{b:1},guitar:{r:4}},rev:4},
 gospel:{label:'Gospel',ico:'🙌',lufs:-12,desc:'Voz e coro grandes, teclados largos, reverb mais longo.',adj:{voz:{r:10,d:4},coro:{g:15,r:10},keys:{g:10,r:8,p:0},strings:{g:8},drums:{r:4}},rev:8},
 pagode:{label:'Pagode',ico:'🥁',lufs:-11,desc:'Percussão viva (pandeiro, tantã, repique), cavaco na frente.',adj:{perc:{g:18,t:2,c:1},violao:{g:10,m:2,t:2},bass:{g:4,b:1},voz:{r:2},coro:{g:10}},rev:2},
 mpb:{label:'MPB',ico:'🎶',lufs:-14,desc:'Mais dinâmica, menos compressão, timbres naturais.',adj:{voz:{c:0,r:4},violao:{g:12,c:0},drums:{g:-8,c:0},kick:{g:-8},bass:{g:-4},keys:{r:4}},rev:4},
 axe:{label:'Axé',ico:'🎉',lufs:-10,desc:'Percussão e metais na frente, energia alta.',adj:{perc:{g:18,t:2},horn:{g:14,t:2},guitar:{g:6,t:2},kick:{g:6},voz:{g:4}},rev:0},
 arrocha:{label:'Arrocha',ico:'💔',lufs:-10.5,desc:'Voz romântica com delay, guitarra/teclado melódicos, grave cheio.',adj:{voz:{d:10,r:4,g:4},guitar:{g:10,d:6,r:6},keys:{g:6,r:6},bass:{b:2,g:4}},rev:3}};
let undo=null;
function apply(key){const B=window.APSMixBridge,st=S[key];if(!B){msg('Abra o estúdio para aplicar.');return;}
 const tracks=B.list();if(!tracks.length){msg('Importe ou grave pistas primeiro — depois toque no estilo.');return;}
 const ups=tracks.map(t=>{const r=role(t),b=BASE[r],a=(st.adj[r]||{});const v=k=>(b[k]||0)+(a[k]||0);
  return {id:t.id,values:{gain:v('g'),bass:v('b'),mid:v('m'),treble:v('t'),hpf:v('h'),reverb:Math.max(0,v('r')+(r==='kick'||r==='bass'?0:st.rev)),delay:Math.max(0,v('d')),comp:!!v('c'),pan:v('p')}};});
 try{undo=B.update(ups);const mc=document.getElementById('masterComp');if(mc&&!mc.checked){mc.checked=true;mc.dispatchEvent(new Event('change',{bubbles:true}));}
  document.getElementById('apsEstUndo').disabled=!undo?.length;
  msg('✓ Estilo '+st.label+' aplicado em '+ups.length+' pista(s): EQ, compressão, reverb/delay e panorama por instrumento. Alvo de master: '+st.lufs+' LUFS. Toque em ↩ para desfazer.');
 }catch(e){msg('Não foi possível aplicar: '+e.message);}}
function msg(t){const m=document.getElementById('apsEstMsg');if(m)m.textContent=t;}
function mount(){if(document.getElementById('apsEstilos'))return true;const host=document.getElementById('apsMixAI');if(!host)return false;
 const box=document.createElement('section');box.id='apsEstilos';box.className='aps-estilos';
 box.innerHTML='<h3>🇧🇷 Estilos brasileiros · mix em 1 toque</h3><p class="aps-est-sub">Ajusta volume, EQ, compressão, reverb/delay e panorama de cada instrumento pelo estilo. As gravações não são alteradas.</p><div class="aps-est-grid">'+Object.entries(S).map(([k,s])=>'<button type="button" data-est="'+k+'" title="'+s.desc+'"><span>'+s.ico+'</span>'+s.label+'</button>').join('')+'</div><div class="aps-est-row"><button type="button" id="apsEstUndo" disabled>↩ Desfazer estilo</button></div><p id="apsEstMsg" class="aps-est-msg" role="status">Escolha um estilo.</p>';
 host.prepend(box);box.querySelectorAll('[data-est]').forEach(b=>b.onclick=()=>apply(b.dataset.est));
 document.getElementById('apsEstUndo').onclick=()=>{if(!undo?.length)return;window.APSMixBridge.update(undo);undo=null;document.getElementById('apsEstUndo').disabled=true;msg('Estilo desfeito.');};
 return true;}
function mountTools(){const logo=document.querySelector('.pro-logo');if(!logo||document.getElementById('apsToolsLink'))return;const a=document.createElement('a');a.id='apsToolsLink';a.href='./afinador.html';a.className='aps-tools-link';a.textContent='🎯';a.title='Afinador e metrônomo';logo.insertAdjacentElement('afterend',a);}
const st=document.createElement('style');st.textContent='.aps-estilos{background:#151a26;border:1px solid #9e7c42;border-radius:14px;padding:12px;margin:0 0 12px}.aps-estilos h3{margin:0 0 4px;color:#e5be74;font-size:15px}.aps-est-sub{font-size:12px;color:#aab;margin:0 0 8px}.aps-est-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(92px,1fr));gap:6px}.aps-est-grid button{background:#232a3a;color:#f5d79e;border:1px solid #5d4c2c;border-radius:10px;padding:9px 4px;font-weight:700;font-size:13px;min-height:52px;display:flex;flex-direction:column;align-items:center;gap:2px}.aps-est-grid button span{font-size:18px}.aps-est-grid button:active{background:#dbb66f;color:#151922}.aps-est-row{margin-top:8px}.aps-est-row button{background:#282f3d;color:#ddd;border:1px solid #555;border-radius:8px;padding:6px 10px}.aps-est-msg{font-size:12px;color:#b4e4ba;margin:6px 0 0;white-space:pre-wrap}.aps-tools-link{color:#e5be74;font-size:12px;text-decoration:none;border:1px solid #9e7c42;border-radius:8px;padding:3px 7px;margin-left:6px;white-space:nowrap}';document.head.append(st);
window.APSEstilos={apply,styles:S};
let n=0;const iv=setInterval(()=>{const ok=mount();mountTools();if((ok&&document.getElementById('apsToolsLink'))||++n>60)clearInterval(iv);},250);
})();
