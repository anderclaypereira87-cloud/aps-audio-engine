/* APS 3.0.0 — Biblioteca de loops brasileiros 100% originais, SINTETIZADOS no aparelho.
 * Nenhuma amostra gravada é usada: cada som (bumbo, caixa, zabumba, triângulo, 808, sanfona, piano, violão…)
 * é gerado por fórmulas matemáticas (osciladores, ruído filtrado, Karplus-Strong) e os ritmos são padrões
 * escritos para o APS. Livres de royalties para uso em suas músicas. */
(function(root){'use strict';
const SR=44100;
function rng(seed){let s=seed>>>0||1;return()=>{s^=s<<13;s^=s>>>17;s^=s<<5;return((s>>>0)/4294967296)*2-1;};}
const mf=m=>440*Math.pow(2,(m-69)/12);
// ---------- vozes sintetizadas (escrevem em L/R a partir do instante t) ----------
function put(L,R,i,v,pan=0){if(i<0||i>=L.length)return;L[i]+=v*(1-Math.max(0,pan));R[i]+=v*(1+Math.min(0,pan));}
function kick(L,R,t,a=1,{f0=150,f1=45,dec=9}={}){const s=Math.round(t*SR),n=Math.round(.45*SR);let ph=0;for(let i=0;i<n;i++){const x=i/SR,f=f1+(f0-f1)*Math.exp(-x*35);ph+=2*Math.PI*f/SR;put(L,R,s+i,a*.9*Math.sin(ph)*Math.exp(-x*dec)+(i<60?a*.25*(1-i/60):0));}}
function noiseHit(L,R,t,a,{dur=.2,dec=20,hp=.0,lp=1,pan=0,seed=7,tone=0,toneDec=25}={}){const s=Math.round(t*SR),n=Math.round(dur*SR),r=rng(seed+s);let y1=0,y2=0,ph=0;for(let i=0;i<n;i++){const x=i/SR,w=r();y1+=lp*(w-y1);const h=y1-y2;y2+=hp*(y1-y2);ph+=2*Math.PI*tone/SR;put(L,R,s+i,a*((hp?h:y1)*Math.exp(-x*dec)+(tone?.5*Math.sin(ph)*Math.exp(-x*toneDec):0)),pan);}}
const snare=(L,R,t,a=1)=>noiseHit(L,R,t,a*.6,{dur:.25,dec:18,hp:.08,lp:.7,tone:190,toneDec:30});
const clap=(L,R,t,a=1)=>{for(const d of[0,.011,.023])noiseHit(L,R,t+d,a*.45,{dur:d===.023?.18:.02,dec:d===.023?22:120,hp:.2,lp:.5});};
const hat=(L,R,t,a=1,open=false)=>noiseHit(L,R,t,a*.32,{dur:open?.3:.05,dec:open?12:80,hp:.6,lp:1,pan:.25});
const shaker=(L,R,t,a=1)=>noiseHit(L,R,t,a*.18,{dur:.07,dec:45,hp:.45,lp:.6,pan:-.3});
function tom(L,R,t,a=1,f=110){const s=Math.round(t*SR),n=Math.round(.35*SR);let ph=0;for(let i=0;i<n;i++){const x=i/SR;ph+=2*Math.PI*(f*(1+.6*Math.exp(-x*40)))/SR;put(L,R,s+i,a*.7*Math.sin(ph)*Math.exp(-x*10),-.15);}}
const zabumba=(L,R,t,a=1)=>{kick(L,R,t,a*.9,{f0:120,f1:70,dec:7});noiseHit(L,R,t,a*.15,{dur:.05,dec:60,lp:.3});};
const bacalhau=(L,R,t,a=1)=>noiseHit(L,R,t,a*.35,{dur:.04,dec:90,hp:.5,lp:.9,pan:.35,tone:1800,toneDec:80});
function triangle(L,R,t,a=1,open=true){const s=Math.round(t*SR),n=Math.round((open?.5:.06)*SR);for(let i=0;i<n;i++){const x=i/SR,e=Math.exp(-x*(open?7:70));put(L,R,s+i,a*.12*e*(Math.sin(2*Math.PI*4100*x)+.7*Math.sin(2*Math.PI*5350*x)+.5*Math.sin(2*Math.PI*7020*x)),.45);}}
function b808(L,R,t,a,m,dur,glideFrom){const s=Math.round(t*SR),n=Math.round((dur+.15)*SR);let ph=0;for(let i=0;i<n;i++){const x=i/SR;let f=mf(m);if(glideFrom!=null)f=mf(m+(glideFrom-m)*Math.exp(-x*18));f*=1+.8*Math.exp(-x*60);ph+=2*Math.PI*f/SR;const e=Math.min(1,x*400)*(x<dur?Math.exp(-x*1.2):Math.exp(-dur*1.2)*Math.exp(-(x-dur)*40));put(L,R,s+i,a*.75*Math.tanh(1.6*Math.sin(ph))*e);}}
function bass(L,R,t,a,m,dur){const s=Math.round(t*SR),n=Math.round((dur+.05)*SR),f=mf(m);let ph=0,y=0;for(let i=0;i<n;i++){const x=i/SR;ph+=f/SR;const saw=2*(ph%1)-1,sq=(ph%1)<.5?1:-1;y+=.08*((.6*sq+.4*saw)-y);const e=Math.min(1,x*300)*(x<dur?Math.exp(-x*3):Math.exp(-dur*3)*Math.exp(-(x-dur)*60));put(L,R,s+i,a*.55*(y+.6*Math.sin(2*Math.PI*f*x))*e);}}
function sanfona(L,R,t,a,notes,dur){const s=Math.round(t*SR),n=Math.round((dur+.08)*SR);const ph=notes.map(()=>[0,0]);let y=0;for(let i=0;i<n;i++){const x=i/SR,vib=1+.004*Math.sin(2*Math.PI*5.5*x);let v=0;notes.forEach((m,k)=>{const f=mf(m)*vib;ph[k][0]+=f/SR;ph[k][1]+=f*1.004/SR;for(const p of ph[k]){const q=p%1;v+=(q<.35?1:-1)*.5+(2*q-1)*.5;}});y+=.18*(v/notes.length/2-y);const e=Math.min(1,x*40)*(x<dur?1:Math.exp(-(x-dur)*50));put(L,R,s+i,a*.32*y*e,-.2);}}
function piano(L,R,t,a,notes,dur){const s=Math.round(t*SR),n=Math.round((dur+.6)*SR);for(const m of notes){const f=mf(m);for(let i=0;i<n;i++){const x=i/SR,e=Math.exp(-x*(2.2+f/900))*(x<dur?1:Math.exp(-(x-dur)*8))*Math.min(1,x*900);put(L,R,s+i,a*.12*e*(Math.sin(2*Math.PI*f*x)+.45*Math.sin(4*Math.PI*f*x)*Math.exp(-x*3)+.2*Math.sin(6*Math.PI*f*x)*Math.exp(-x*6)),.1);}}}
function pluck(L,R,t,a,m,dur,pan=.2,seed=3){const f=mf(m),P=Math.max(2,Math.round(SR/f)),buf=new Float32Array(P),r=rng(seed+m);for(let i=0;i<P;i++)buf[i]=r();const s=Math.round(t*SR),n=Math.round((dur+.3)*SR);let k=0;for(let i=0;i<n;i++){const j=k%P,nx=(k+1)%P,v=buf[j];buf[j]=.497*(v+buf[nx])*(i/SR<dur?1:.985);k++;put(L,R,s+i,a*.35*v,pan);}}
function strum(L,R,t,a,notes,dur,down=true){const ns=down?notes:[...notes].reverse();ns.forEach((m,i)=>pluck(L,R,t+i*.012,a*(1-i*.06),m,dur,.25,i*17));}
function lead(L,R,t,a,m,dur){const s=Math.round(t*SR),n=Math.round((dur+.05)*SR),f=mf(m);let p1=0,p2=0,y=0;for(let i=0;i<n;i++){const x=i/SR,vib=1+.006*Math.sin(2*Math.PI*6*x)*Math.min(1,x*3);p1+=f*vib/SR;p2+=f*1.007*vib/SR;y+=.3*(((2*(p1%1)-1)+(2*(p2%1)-1))*.5-y);const e=Math.min(1,x*200)*(x<dur?1:Math.exp(-(x-dur)*40));put(L,R,s+i,a*.22*y*e,.15);}}
// ---------- harmonia ----------
const PROG={forro:[[0,'M'],[5,'M'],[7,'M'],[0,'M']],piseiro:[[9,'m'],[5,'M'],[0,'M'],[7,'M']],funk:[[9,'m'],[9,'m'],[5,'M'],[7,'M']],gospel:[[0,'M'],[7,'M'],[9,'m'],[5,'M']],sertanejo:[[0,'M'],[7,'M'],[9,'m'],[5,'M']],trap:[[9,'m'],[5,'M'],[0,'M'],[7,'M']]};
const triad=(r,q,base=60)=>[base+r,base+r+(q==='m'?3:4),base+r+7];
// ---------- padrões (16 semicolcheias por compasso) ----------
const P=s=>s.split('').map((c,i)=>c==='x'?i:-1).filter(i=>i>=0);
const GENRES={
 forro:{name:'Forró (baião/xote)',bpm:120},piseiro:{name:'Piseiro',bpm:150},funk:{name:'Funk (tamborzão)',bpm:130},gospel:{name:'Gospel',bpm:76},sertanejo:{name:'Sertanejo',bpm:90},trap:{name:'Trap',bpm:140}};
const LOOPS=[
 {id:'forro-bat',g:'forro',kind:'bateria',name:'Zabumba + triângulo (baião)',fn:(c,b,st)=>{for(const i of P('x--x----x--x----'))zabumba(c.L,c.R,b+i*st);for(const i of P('----x-------x---'))bacalhau(c.L,c.R,b+i*st);for(let i=0;i<16;i++)triangle(c.L,c.R,b+i*st,i%4===2?1:.55,i%4===2);}},
 {id:'forro-baixo',g:'forro',kind:'baixo',name:'Baixo de baião',fn:(c,b,st,k,bar)=>{const[r]=PROG.forro[bar%4];for(const[i,o,d]of[[0,0,3],[3,7,1],[4,12,3],[8,0,3],[11,7,1],[12,12,3]])bass(c.L,c.R,b+i*st,.8,36+k+r+o,d*st*.9);}},
 {id:'forro-sanf',g:'forro',kind:'harmonia',name:'Sanfona (acordes)',fn:(c,b,st,k,bar)=>{const[r,q]=PROG.forro[bar%4],n=triad(r+k,q,60);for(const[i,d]of[[0,3],[3,1],[4,4],[8,3],[11,1],[12,4]])sanfona(c.L,c.R,b+i*st,.9,n,d*st*.85);}},
 {id:'pis-bat',g:'piseiro',kind:'bateria',name:'Batida de piseiro',fn:(c,b,st)=>{for(const i of P('x---x---x---x---'))kick(c.L,c.R,b+i*st);for(const i of P('----x-------x---'))clap(c.L,c.R,b+i*st);for(const i of P('--x---x---x---x-'))hat(c.L,c.R,b+i*st,.9,true);for(let i=0;i<16;i++)shaker(c.L,c.R,b+i*st,i%2?1:.5);}},
 {id:'pis-baixo',g:'piseiro',kind:'baixo',name:'Baixo synth piseiro',fn:(c,b,st,k,bar)=>{const[r]=PROG.piseiro[bar%4];for(const i of P('--x---x---x---x-'))bass(c.L,c.R,b+i*st,.85,36+k+r,st*1.6);}},
 {id:'pis-tecl',g:'piseiro',kind:'harmonia',name:'Teclado (lead) piseiro',fn:(c,b,st,k,bar)=>{const[r,q]=PROG.piseiro[bar%4],n=triad(r+k,q,72);[n[0],n[1],n[2],n[1],n[0]+12,n[2],n[1],n[2]].forEach((m,i)=>lead(c.L,c.R,b+i*2*st,.8,m,st*1.7));}},
 {id:'funk-bat',g:'funk',kind:'bateria',name:'Tamborzão',fn:(c,b,st)=>{for(const i of P('x--x---x--x-----'))kick(c.L,c.R,b+i*st,1,{f0:110,f1:42,dec:6});for(const[i,f]of[[3,180],[6,140],[10,180],[12,120],[14,140]])tom(c.L,c.R,b+i*st,.8,f);for(const i of P('----x-------x---'))clap(c.L,c.R,b+i*st,.8);}},
 {id:'funk-808',g:'funk',kind:'baixo',name:'Grave 808 do funk',fn:(c,b,st,k,bar)=>{const[r]=PROG.funk[bar%4];for(const[i,d]of[[0,3],[7,3],[10,4]])b808(c.L,c.R,b+i*st,.9,24+k+r+12,d*st);}},
 {id:'funk-vox',g:'funk',kind:'harmonia',name:'Synth "beat" do funk',fn:(c,b,st,k,bar)=>{const[r,q]=PROG.funk[bar%4],n=triad(r+k,q,64);for(const i of P('x--x--x---x-x---'))lead(c.L,c.R,b+i*st,.7,n[(i/3|0)%3],st*.7);}},
 {id:'gos-bat',g:'gospel',kind:'bateria',name:'Bateria gospel (balada)',fn:(c,b,st)=>{for(const i of P('x-------x-x-----'))kick(c.L,c.R,b+i*st);for(const i of P('----x-------x---'))snare(c.L,c.R,b+i*st);for(const i of P('x-x-x-x-x-x-x-x-'))hat(c.L,c.R,b+i*st,i%4?.6:1);}},
 {id:'gos-piano',g:'gospel',kind:'harmonia',name:'Piano gospel',fn:(c,b,st,k,bar)=>{const[r,q]=PROG.gospel[bar%4],n=triad(r+k,q,60);piano(c.L,c.R,b,.9,[48+k+r,...n],st*7);piano(c.L,c.R,b+8*st,.7,[...n,n[0]+12],st*6);piano(c.L,c.R,b+14*st,.5,[n[2]+12],st*2);}},
 {id:'gos-baixo',g:'gospel',kind:'baixo',name:'Baixo gospel',fn:(c,b,st,k,bar)=>{const[r]=PROG.gospel[bar%4];bass(c.L,c.R,b,.8,36+k+r,st*7);bass(c.L,c.R,b+8*st,.7,36+k+r,st*3);bass(c.L,c.R,b+12*st,.6,36+k+r+7,st*3);}},
 {id:'sert-bat',g:'sertanejo',kind:'bateria',name:'Bateria sertaneja',fn:(c,b,st)=>{for(const i of P('x-----x-x-------'))kick(c.L,c.R,b+i*st);for(const i of P('----x-------x---'))snare(c.L,c.R,b+i*st);for(const i of P('x-x-x-x-x-x-x-x-'))hat(c.L,c.R,b+i*st,.7);for(let i=0;i<16;i++)shaker(c.L,c.R,b+i*st,i%2?.9:.5);}},
 {id:'sert-viol',g:'sertanejo',kind:'harmonia',name:'Violão (levada)',fn:(c,b,st,k,bar)=>{const[r,q]=PROG.sertanejo[bar%4],n=[48+k+r,...triad(r+k,q,55),55+k+r+12];for(const[i,d]of[[0,1],[4,1],[6,0],[8,1],[10,0],[12,1],[14,0]])strum(c.L,c.R,b+i*st,d?.9:.6,n,st*2,!!d);}},
 {id:'sert-baixo',g:'sertanejo',kind:'baixo',name:'Baixo sertanejo',fn:(c,b,st,k,bar)=>{const[r]=PROG.sertanejo[bar%4];for(const[i,o]of[[0,0],[6,7],[8,0],[12,7]])bass(c.L,c.R,b+i*st,.8,36+k+r+o,st*1.8);}},
 {id:'trap-bat',g:'trap',kind:'bateria',name:'Bateria trap (hi-hat rolls)',fn:(c,b,st)=>{for(const i of P('x---------x-----'))kick(c.L,c.R,b+i*st,1,{dec:7});for(const i of P('--------x-------'))clap(c.L,c.R,b+i*st);for(let i=0;i<16;i++){hat(c.L,c.R,b+i*st,i%2?.5:.8);if(i===13||i===14||i===15){hat(c.L,c.R,b+(i+.5)*st,.45);}}snare(c.L,c.R,b+8*st,.5);}},
 {id:'trap-808',g:'trap',kind:'baixo',name:'808 com glide',fn:(c,b,st,k,bar)=>{const[r]=PROG.trap[bar%4];b808(c.L,c.R,b,.9,24+k+r+12,st*6);b808(c.L,c.R,b+10*st,.8,24+k+r+12,st*5,24+k+r+19);}},
 {id:'trap-pluck',g:'trap',kind:'harmonia',name:'Melodia sombria (pluck)',fn:(c,b,st,k,bar)=>{const[r,q]=PROG.trap[bar%4],n=triad(r+k,q,72);[0,0,2,1,0,2].forEach((j,i)=>pluck(c.L,c.R,b+[0,3,6,8,11,14][i]*st,.8,n[j],st*2,-.2,i));}}
];
function render(id,{bpm=100,bars=2,key=0,ac}={}){const L0=LOOPS.find(l=>l.id===id);if(!L0)throw Error('Loop não encontrado');const st=60/bpm/4,len=Math.round(bars*16*st*SR),c={L:new Float32Array(len+SR*2),R:new Float32Array(len+SR*2)};
 for(let bar=0;bar<bars;bar++)L0.fn(c,bar*16*st,st,((key%12)+12)%12>6?key-12:key,bar);
 // cauda do fim reaparece no início (loop sem emenda) e normaliza
 for(let i=len;i<c.L.length;i++){c.L[i-len]+=c.L[i];c.R[i-len]+=c.R[i];}let pk=0;for(let i=0;i<len;i++)pk=Math.max(pk,Math.abs(c.L[i]),Math.abs(c.R[i]));const g=pk>0?.89/pk:1;
 const C=ac||new (root.OfflineAudioContext||root.webkitOfflineAudioContext)(2,len,SR),buf=C.createBuffer(2,len,SR);const l=buf.getChannelData(0),r=buf.getChannelData(1);for(let i=0;i<len;i++){l[i]=c.L[i]*g;r[i]=c.R[i]*g;}return buf;}
root.APSLoops={LOOPS,GENRES,render};
// ---------- interface ----------
function ui(){const host=document.getElementById('apsLoopsPanel'),B=root.APSMixBridge;if(!host||!B)return;const $=id=>document.getElementById(id);
 const KEYS=['Dó','Dó#','Ré','Ré#','Mi','Fá','Fá#','Sol','Sol#','Lá','Lá#','Si'],KIND={bateria:'🥁',baixo:'🎸',harmonia:'🎹'};
 host.innerHTML='<div class="ph"><div><h2>🇧🇷 Loops brasileiros</h2><p class="sub">Sons e ritmos originais criados pelo APS (sintetizados no aparelho) — livres de royalties.</p></div></div><div class="aps-lp"><div class="aps-lp-row"><label>Gênero<select id="apsLpGenre">'+Object.entries(GENRES).map(([k,v])=>'<option value="'+k+'">'+v.name+'</option>').join('')+'</select></label><label>Tom<select id="apsLpKey">'+KEYS.map((k,i)=>'<option value="'+i+'">'+k+'</option>').join('')+'</select></label><label>Compassos<select id="apsLpBars"><option>1</option><option selected>2</option><option>4</option><option>8</option></select></label><button type="button" id="apsLpBpm" class="mini">BPM do gênero</button></div><p class="sub" id="apsLpInfo"></p><div id="apsLpList" class="aps-lp-list"></div><p class="sub">Toque ▶ para ouvir, "+ Adicionar" para colocar na posição atual, ou arraste o cartão para a área das pistas.</p></div>';
 let prev=null,pctx=null;const info=()=>$('apsLpInfo').textContent='Andamento do projeto: '+B.bpm()+' BPM · sugerido para '+GENRES[$('apsLpGenre').value].name+': '+GENRES[$('apsLpGenre').value].bpm+' BPM. Os loops seguem o BPM do projeto.';
 const list=()=>{const g=$('apsLpGenre').value;$('apsLpList').innerHTML=LOOPS.filter(l=>l.g===g).map(l=>'<div class="aps-lp-card" draggable="true" data-id="'+l.id+'"><span>'+KIND[l.kind]+'</span><b>'+l.name+'</b><button type="button" data-a="play" data-id="'+l.id+'">▶</button><button type="button" class="accent" data-a="add" data-id="'+l.id+'">+ Adicionar</button></div>').join('');info();};
 const opts=()=>({bpm:B.bpm(),bars:+$('apsLpBars').value,key:+$('apsLpKey').value});
 const stopPrev=()=>{try{prev?.stop();}catch{}prev=null;host.querySelectorAll('[data-a="play"]').forEach(b=>b.textContent='▶');};
 const add=(id,at)=>{if(root.APSPlan&&!root.APSPlan.allowed('loops.biblioteca'))throw Error('Recurso do plano Pro.');const l=LOOPS.find(x=>x.id===id),o=opts(),buf=render(id,o);const t=at??B.position();B.addTrack(GENRES[l.g].name.split(' ')[0]+' · '+l.name,buf,l.kind==='bateria'?'drums':l.kind==='baixo'?'bass':'flat',t);$('apsLpInfo').textContent='✅ "'+l.name+'" adicionado em '+t.toFixed(1)+' s ('+o.bars+' compasso(s) a '+o.bpm+' BPM, tom '+KEYS[o.key]+').';};
 host.addEventListener('click',e=>{const b=e.target.closest('button[data-a]');if(!b)return;const id=b.dataset.id;try{if(b.dataset.a==='add'){stopPrev();add(id);}else{const was=b.textContent==='■';stopPrev();if(was)return;pctx=pctx||new (root.AudioContext||root.webkitAudioContext)();pctx.resume();const s=pctx.createBufferSource();s.buffer=render(id,{...opts(),ac:pctx});s.loop=true;s.connect(pctx.destination);s.start();prev=s;b.textContent='■';}}catch(err){$('apsLpInfo').textContent=err.message;}});
 host.addEventListener('dragstart',e=>{const c=e.target.closest('.aps-lp-card');if(c)e.dataTransfer.setData('text/aps-loop',c.dataset.id);});
 const drop=document.getElementById('tracks')||document.querySelector('.tracks')||document.querySelector('.layout > main > section.panel');
 if(drop){drop.addEventListener('dragover',e=>{if([...e.dataTransfer.types].includes('text/aps-loop'))e.preventDefault();});drop.addEventListener('drop',e=>{const id=e.dataTransfer.getData('text/aps-loop');if(!id)return;e.preventDefault();e.stopPropagation();try{add(id);}catch(err){$('apsLpInfo').textContent=err.message;}});}
 $('apsLpGenre').onchange=()=>{stopPrev();list();};$('apsLpBpm').onclick=()=>{B.setBpm(GENRES[$('apsLpGenre').value].bpm);info();};list();}
if(typeof document!=='undefined'){if(document.readyState==='complete')ui();else root.addEventListener('load',ui);}
})(window);
