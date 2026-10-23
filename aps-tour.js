/* APS 3.1.0 — Tour guiado na primeira visita (index e estúdio). Pular a qualquer momento; rever pelo botão "?". */
(function(root){'use strict';
const PAGE=/daw\.html/.test(location.pathname)?'daw':'index',KEY='aps-tour-'+PAGE+'-v1';
const STEPS={
 index:[{sel:null,t:'Bem-vindo ao APS Audio Engine 🎶',d:'Estúdio completo no celular: gravar, mixar, masterizar e compartilhar. Tudo grátis e no seu aparelho.'},
  {sel:'a[href*="daw.html"]',t:'Estúdio',d:'Toque aqui para gravar, importar pistas, usar loops, afinar a voz e mixar.'},
  {sel:'a[href*="projetos.html"]',t:'Meus Projetos',d:'Suas músicas ficam salvas aqui (e no Google Drive, se quiser).'},
  {sel:'a[href*="separador.html"]',t:'Separador',d:'Separe voz, baixo e bateria de uma música pronta.'},
  {sel:'a[href*="bateria.html"]',t:'Bateria',d:'Troque o timbre da bateria pelos seus kits.'},
  {sel:'#apsTourBtn',t:'Rever o tour',d:'Quando quiser ver este guia de novo, toque no "?".'}],
 daw:[{sel:null,t:'Este é o estúdio 🎛',d:'Vamos fazer um passeio rápido de 6 passos.'},
  {sel:'.pro-top, nav',t:'Transporte',d:'Tocar, parar, gravar, repetir, BPM, compasso, metrônomo, grade e ferramentas de edição.'},
  {sel:'#proImport, #importBtn',t:'Importar',d:'Traga áudios do celular (guia, playback, voz).'},
  {sel:'#proRec, #record',t:'Gravar',d:'Grava com contagem, metrônomo e até punch-in num trecho.'},
  {sel:'#proCanvas, #play',t:'Linha do tempo',d:'Arraste regiões para mover, puxe as bordas para aparar, as alças brancas fazem fades. S divide, Ctrl+Z desfaz. Pinça para zoom.'},
  {sel:'.pro-tabs, #apsLoopsPanel',t:'Painéis',d:'Mixer, Editor, Mixagem IA, Master, Gravar (punch-in, afinador), Loops brasileiros e Exportar.'},
  {sel:'#apsTourBtn',t:'Ajuda',d:'Toque no "?" para rever este tour. Bom som!'}]};
function vis(el){if(!el)return false;const r=el.getBoundingClientRect();return r.width>0&&r.height>0;}
function start(){end();const steps=STEPS[PAGE];let i=0;const ov=document.createElement('div');ov.id='apsTour';ov.className='aps-tour';ov.innerHTML='<div class="aps-tour-hole"></div><div class="aps-tour-box" role="dialog" aria-modal="true" aria-labelledby="apsTourT"><small id="apsTourN"></small><h3 id="apsTourT"></h3><p id="apsTourD"></p><div><button type="button" id="apsTourSkip">Pular</button><button type="button" id="apsTourBack">◀</button><button type="button" id="apsTourNext" class="accent">Próximo ▶</button></div></div>';document.body.appendChild(ov);
 const hole=ov.querySelector('.aps-tour-hole'),box=ov.querySelector('.aps-tour-box'),$=id=>document.getElementById(id);
 const show=()=>{const s=steps[i];let el=null;if(s.sel)for(const q of s.sel.split(','))for(const e of document.querySelectorAll(q.trim()))if(vis(e)){el=e;break;}
  $('apsTourN').textContent=(i+1)+' de '+steps.length;$('apsTourT').textContent=s.t;$('apsTourD').textContent=s.d;$('apsTourBack').disabled=i===0;$('apsTourNext').textContent=i===steps.length-1?'Concluir ✓':'Próximo ▶';
  if(el){el.scrollIntoView({block:'center'});const r=el.getBoundingClientRect();Object.assign(hole.style,{display:'block',left:r.left-6+'px',top:r.top-6+'px',width:r.width+12+'px',height:r.height+12+'px'});const bh=box.offsetHeight||170,below=r.bottom+bh+20<innerHeight;let top=below?r.bottom+14:r.top-14-bh;if(top<10||top+bh>innerHeight-10)top=innerHeight-bh-12;Object.assign(box.style,{top:Math.max(10,top)+'px',transform:'none'});}
  else{hole.style.display='none';Object.assign(box.style,{top:'50%',transform:'translateY(-50%)'});}};
 const done=()=>{try{localStorage.setItem(KEY,'1');}catch{}end();};
 $('apsTourSkip').onclick=done;$('apsTourBack').onclick=()=>{i=Math.max(0,i-1);show();};$('apsTourNext').onclick=()=>{if(i>=steps.length-1)done();else{i++;show();}};
 ov.addEventListener('keydown',e=>{if(e.key==='Escape')done();});show();$('apsTourNext').focus();}
function end(){document.getElementById('apsTour')?.remove();}
function init(){if(!document.getElementById('apsTourBtn')){const b=document.createElement('button');b.type='button';b.id='apsTourBtn';b.className='aps-tour-btn';b.title='Rever o tour';b.setAttribute('aria-label','Rever o tour guiado');b.textContent='?';b.onclick=start;document.body.appendChild(b);}
 let seen=false;try{seen=localStorage.getItem(KEY)==='1';}catch{}if(!seen&&!/[?&]notour/.test(location.search))setTimeout(start,700);}
root.APSTour={start,end,reset:()=>{try{localStorage.removeItem(KEY);}catch{}}};
if(document.readyState==='complete')init();else root.addEventListener('load',init);
})(window);
