/* APS 3.5.0 — Tour de início: mostra ONDE fica cada coisa (tela inicial e estúdio Pro). Pular a qualquer momento; rever pelo botão "?". Criado por Anderclay Pereira Silva. */
(function(root){'use strict';
const PAGE=/daw\.html/.test(location.pathname)?'daw':'index',KEY='aps-tour-'+PAGE+'-v2';
const CRED='Criado por Anderclay Pereira Silva';
const STEPS={
 index:[{sel:null,t:'Bem-vindo ao APS Audio Engine 🎶',d:'Seu estúdio completo no celular: gravar, separar, mixar com IA, masterizar e compartilhar. Vou te mostrar onde fica cada coisa.',c:CRED},
  {sel:'a[href*="daw.html"]',t:'Estúdio (gravar e importar)',d:'Aqui você abre o estúdio em tela cheia: grava, importa tracks, mixa com IA, faz master, cifra, loops e troca instrumentos.'},
  {sel:'a[href*="separador.html"]',t:'Separação de instrumentos',d:'Separe voz, bateria, baixo, guitarra e piano de uma música pronta.'},
  {sel:'a[href*="bateria.html"]',t:'Drum Sampler',d:'Troque o timbre da bateria pelos seus kits e samples.'},
  {sel:'a[href*="projetos.html"]',t:'Meus Projetos',d:'Suas músicas ficam salvas aqui no aparelho — e podem ir para o seu Google Drive.'},
  {sel:'#apsTourBtn',t:'Ajuda / tutorial',d:'Quando quiser ver este guia de novo, toque no "?". No estúdio tem um tour só dele.'}],
 daw:[{sel:null,t:'Este é o estúdio Pro 🎛',d:'Vou te mostrar onde fica cada ferramenta. Use Próximo e Voltar, ou Pular quando quiser.',c:CRED},
  {sel:'#proImport',t:'Importar uma track',d:'Toque em "⤓ Importar" para trazer áudios do celular (guia, playback, voz, instrumento). Cada arquivo vira uma pista.'},
  {sel:'#proRec',t:'Gravar',d:'O botão vermelho grava com contagem e metrônomo. Tocar, parar e repetir ficam ao lado.'},
  {sel:'#proCanvas',t:'Linha do tempo (editar)',d:'Arraste as regiões para mover, puxe as bordas para cortar, ✂ divide, ↩ desfaz. Pinça para zoom.'},
  {sel:'.pro-tabs [data-tab="ia"]',tab:'ia',t:'Mixagem com IA',d:'A IA analisa as pistas e sugere volume, EQ, compressão e efeitos. Dá para comparar A/B e desfazer.'},
  {sel:'.pro-tabs [data-tab="master"]',tab:'master',t:'Master + nota',d:'Masterize a música e veja a nota da mixagem e do master.'},
  {sel:'.pro-tabs [data-tab="gravar"]',tab:'gravar',t:'Cifra / acordes',d:'Na aba Gravar ficam a cifra automática (acordes), afinador, punch-in e partitura.'},
  {sel:'.pro-tabs [data-tab="loops"]',tab:'loops',t:'Loops brasileiros',d:'Ritmos brasileiros livres de royalties. Toque em "+ Adicionar" para pôr na música.'},
  {sel:'.pro-tabs [data-tab="trocar"]',tab:'trocar',t:'Trocar instrumento',d:'Muda o som do instrumento sem mexer na sua interpretação: as notas e o tempo continuam seus.'},
  {sel:'.pro-tabs [data-tab="projeto"]',tab:'projeto',t:'Salvar e exportar',d:'Na aba Exportar: 💾 Salvar em Meus Projetos (e Drive), baixar MP3 e compartilhar.'},
  {sel:'.pro-logo',t:'Separação e Drum Sampler',d:'Toque em "APS" para voltar à tela inicial: lá ficam a Separação de instrumentos, o Drum Sampler e Meus Projetos.'},
  {sel:'#apsTourBtn',t:'Ajuda / tutorial',d:'Toque no "?" para rever este tour quando quiser. Bom som! 🎶'}]};
function vis(el){if(!el)return false;const r=el.getBoundingClientRect();return r.width>0&&r.height>0;}
function find(s){if(!s.sel)return null;for(const q of s.sel.split(','))for(const e of document.querySelectorAll(q.trim()))if(vis(e))return e;return null;}
function start(){end();const steps=STEPS[PAGE].filter(s=>!s.sel||s.tab||find(s));let i=0;const ov=document.createElement('div');ov.id='apsTour';ov.className='aps-tour';ov.innerHTML='<div class="aps-tour-hole"></div><div class="aps-tour-box" role="dialog" aria-modal="true" aria-labelledby="apsTourT"><small id="apsTourN"></small><h3 id="apsTourT"></h3><p id="apsTourD"></p><p id="apsTourC" class="aps-tour-cred"></p><div><button type="button" id="apsTourSkip">Pular</button><button type="button" id="apsTourBack">◀ Voltar</button><button type="button" id="apsTourNext" class="accent">Próximo ▶</button></div></div>';document.body.appendChild(ov);
 const hole=ov.querySelector('.aps-tour-hole'),box=ov.querySelector('.aps-tour-box'),$=id=>document.getElementById(id);
 const show=()=>{const s=steps[i];if(s.tab){const tb=document.querySelector('.pro-tabs [data-tab="'+s.tab+'"]');if(tb)tb.click();}const el=find(s);
  $('apsTourN').textContent='Passo '+(i+1)+' de '+steps.length;$('apsTourT').textContent=s.t;$('apsTourD').textContent=s.d;$('apsTourC').textContent=s.c||'';$('apsTourC').style.display=s.c?'block':'none';$('apsTourBack').disabled=i===0;$('apsTourNext').textContent=i===steps.length-1?'Concluir ✓':'Próximo ▶';
  if(el){el.scrollIntoView({block:'nearest',inline:'center',behavior:'instant'});clearTimeout(ov._t);ov._t=setTimeout(()=>place(el),120);place(el);}
  else{ov.classList.add('dim');hole.style.display='none';Object.assign(box.style,{top:'50%',transform:'translate(-50%,-50%)'});}};
 const place=el=>{ov.classList.remove('dim');const r=el.getBoundingClientRect();const L=Math.max(2,r.left-6),T=Math.max(2,r.top-6);Object.assign(hole.style,{display:'block',left:L+'px',top:T+'px',width:Math.min(innerWidth-4,r.right+6)-L+'px',height:Math.min(innerHeight-4,r.bottom+6)-T+'px'});const bh=box.offsetHeight||190;let top=r.bottom+14+bh<innerHeight?r.bottom+14:r.top-14-bh;if(top<10)top=innerHeight-bh-12;Object.assign(box.style,{top:Math.max(10,top)+'px',transform:'translateX(-50%)'});};
 const done=()=>{try{localStorage.setItem(KEY,'1');}catch{}end();document.querySelector('.pro-tabs [data-tab="mixer"]')?.click();};
 $('apsTourSkip').onclick=done;$('apsTourBack').onclick=()=>{i=Math.max(0,i-1);show();};$('apsTourNext').onclick=()=>{if(i>=steps.length-1)done();else{i++;show();}};
 ov.addEventListener('keydown',e=>{if(e.key==='Escape')done();if(e.key==='ArrowRight')$('apsTourNext').click();if(e.key==='ArrowLeft')$('apsTourBack').click();});root.addEventListener('resize',show);ov._rs=show;show();$('apsTourNext').focus();}
function end(){const o=document.getElementById('apsTour');if(o){root.removeEventListener('resize',o._rs);o.remove();}}
function init(){if(!document.getElementById('apsTourBtn')){const b=document.createElement('button');b.type='button';b.id='apsTourBtn';b.className='aps-tour-btn';b.title='Ajuda: rever o tutorial';b.setAttribute('aria-label','Ajuda: rever o tutorial');b.textContent='?';b.onclick=start;document.body.appendChild(b);}
 let seen=false;try{seen=localStorage.getItem(KEY)==='1';}catch{}if(!seen&&!/[?&]notour/.test(location.search))setTimeout(start,700);}
root.APSTour={start,end,steps:()=>STEPS[PAGE].length,reset:()=>{try{localStorage.removeItem(KEY);}catch{}}};
if(document.readyState==='complete')init();else root.addEventListener('load',init);
})(window);
