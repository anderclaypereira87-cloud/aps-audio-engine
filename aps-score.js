/* APS 2.8.0 — Nota do master (0–100) com checklist em pt-BR. Tudo no aparelho.
 * Loudness BS.1770 (APSMaster), pico real, PLR, balanço tonal × curva do gênero, estéreo/mono, graves e clipping. */
(function(root){'use strict';
const db=v=>20*Math.log10(Math.max(v,1e-12));
const PLAT={spotify:{n:'Spotify',l:-14},youtube:{n:'YouTube',l:-14},apple:{n:'Apple Music',l:-16}};
// curvas de referência (dB por banda, relativo à média): sub, grave, médio-grave, médio, médio-agudo, presença, ar
const BANDS=[[20,60,'sub-grave'],[60,150,'grave'],[150,500,'médio-grave'],[500,2000,'médio'],[2000,5000,'médio-agudo'],[5000,10000,'presença'],[10000,18000,'ar']];
const GENRES={pop:[6,8,4,0,-3,-6,-11],funk:[10,10,3,-1,-3,-6,-11],piseiro:[8,9,4,0,-3,-6,-11],forro:[5,7,4,1,-2,-6,-11],sertanejo:[5,7,4,1,-2,-5,-10],gospel:[5,7,4,0,-2,-5,-10],trap:[11,9,3,-1,-4,-6,-10],acustico:[2,5,4,1,-2,-5,-10]};
const GNAMES={pop:'Pop',funk:'Funk',piseiro:'Piseiro',forro:'Forró',sertanejo:'Sertanejo',gospel:'Gospel',trap:'Trap',acustico:'Acústico / MPB'};
function spectrum(L,R,sr){const N=4096,fft=root.APSClean.fft,acc=new Float64Array(N/2),w=new Float32Array(N);for(let i=0;i<N;i++)w[i]=.5-.5*Math.cos(2*Math.PI*i/N);
 const frames=Math.min(240,Math.floor(L.length/N)),step=Math.max(N,Math.floor((L.length-N)/Math.max(1,frames)));let c=0;
 for(let s=0;s+N<=L.length&&c<frames;s+=step,c++){const re=new Float32Array(N),im=new Float32Array(N);for(let i=0;i<N;i++)re[i]=(L[s+i]+R[s+i])*.5*w[i];fft(re,im);for(let k=0;k<N/2;k++)acc[k]+=re[k]*re[k]+im[k]*im[k];}
 return BANDS.map(([a,b])=>{let e=0,n=0;for(let k=Math.ceil(a*N/sr);k<Math.min(N/2,b*N/sr);k++){e+=acc[k];n++;}return 10*Math.log10(e/Math.max(1,n)/Math.max(1,c)+1e-20)+10*Math.log10((a+b)/2);});}// +10log f: ponderação ~rosa
function corr(L,R,step=1){let lr=0,ll=0,rr=0;for(let i=0;i<L.length;i+=step){lr+=L[i]*R[i];ll+=L[i]*L[i];rr+=R[i]*R[i];}return lr/Math.sqrt(ll*rr+1e-20);}
function lowpass(x,sr,fc){const a=Math.exp(-2*Math.PI*fc/sr),y=new Float32Array(x.length);let s=0,t=0;for(let i=0;i<x.length;i++){s=(1-a)*x[i]+a*s;t=(1-a)*s+a*t;y[i]=t;}return y;}
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
function analyze(buf,{platform='spotify',genre='pop'}={}){const sr=buf.sampleRate,L=buf.getChannelData(0),R=buf.numberOfChannels>1?buf.getChannelData(1):L,M=root.APSMaster;
 const lufs=M.integratedLUFS([L,R],sr),tp=db(M.truePeak([L,R])),target=PLAT[platform].l;let clips=0,run=0;for(const ch of[L,R])for(let i=0;i<ch.length;i++){if(Math.abs(ch[i])>=.999){if(++run===3)clips++;}else run=0;}
 const plr=tp-lufs,c=corr(L,R,4);let mid=0,side=0;for(let i=0;i<L.length;i+=4){const m=L[i]+R[i],s=L[i]-R[i];mid+=m*m;side+=s*s;}const width=side/(mid+1e-20);
 const lc=corr(lowpass(L,sr,150),lowpass(R,sr,150),4),bands=spectrum(L,R,sr),avg=bands.reduce((a,b)=>a+b,0)/bands.length,rel=bands.map(b=>b-avg),curve=GENRES[genre],cav=curve.reduce((a,b)=>a+b,0)/curve.length,dev=rel.map((v,i)=>v-(curve[i]-cav));
 const items=[],add=(key,ok,w,score,title,tip,fix)=>items.push({key,ok,w,score:clamp(score,0,100),title,tip,fix});
 const dl=lufs-target;add('lufs',Math.abs(dl)<=1,22,100-Math.max(0,Math.abs(dl)-1)*14,'Volume (loudness): '+(isFinite(lufs)?lufs.toFixed(1):'—')+' LUFS · alvo '+PLAT[platform].n+' '+target,Math.abs(dl)<=1?'No ponto para a plataforma.':dl<0?'Baixo demais: a plataforma não aumenta e sua música soa mais fraca que as outras.':'Alto demais: a plataforma vai abaixar o volume e você perde dinâmica à toa.','master');
 add('tp',tp<=-1,14,tp<=-1?100:tp<=0?60:Math.max(0,40-(tp)*20),'Pico real: '+tp.toFixed(1)+' dBTP',tp<=-1?'Abaixo de −1 dBTP, seguro para MP3/streaming.':'Acima de −1 dBTP: pode distorcer ao converter para MP3/AAC.','master');
 add('clip',clips===0,12,clips===0?100:Math.max(0,90-clips*6),'Clipping: '+(clips?clips+' trecho(s) cortado(s)':'nenhum'),clips?'Há distorção digital. Abaixe o volume das pistas/master e use o limitador.':'Sem cortes digitais.','master');
 add('plr',plr>=7&&plr<=15,14,plr<7?100-(7-plr)*18:plr>15?100-(plr-15)*10:100,'Dinâmica (PLR): '+plr.toFixed(1)+' dB',plr<7?'Muito espremido: soa cansativo e sem punch. Use alvo menos alto.':plr>15?'Dinâmica grande: pode soar baixo em celular. Aplique o master.':'Boa dinâmica.','master');
 const worst=dev.map((d,i)=>[Math.abs(d),i,d]).sort((a,b)=>b[0]-a[0]),tb=dev.reduce((a,d)=>a+Math.max(0,Math.abs(d)-2),0);
 add('tonal',tb<6,18,100-tb*5,'Balanço tonal × '+GNAMES[genre],tb<6?'Equilíbrio de frequências próximo do gênero.':worst.slice(0,2).filter(w=>w[0]>2).map(w=>(w[2]>0?'Excesso de ':'Falta de ')+BANDS[w[1]][2]+' ('+(w[2]>0?'+':'')+w[2].toFixed(0)+' dB)').join(' · ')+'. Use o EQ do master ou o EQ das pistas.','eq');
 add('stereo',c>.2&&width<.6,10,c<0?20:c<.2?60:width>.6?70:100,'Estéreo: correlação '+c.toFixed(2)+' · largura '+Math.round(width*100)+'%',c<0?'Fase invertida: no celular/caixinha mono partes somem! Confira pistas com estéreo invertido.':c<.2?'Estéreo muito aberto: pode perder força em mono.':width<.02?'Praticamente mono: abra o pan de guitarras/teclados.':'Compatível com mono.','mix');
 add('low',lc>.8,10,lc>.8?100:lc>.5?70:30,'Graves (abaixo de 150 Hz): correlação '+lc.toFixed(2),lc>.8?'Grave centralizado e firme.':'Grave espalhado no estéreo: deixe baixo e bumbo no centro (pan 0).','mix');
 let tot=0,ws=0;for(const it of items){tot+=it.score*it.w;ws+=it.w;}
 return{score:Math.round(tot/ws),lufs,tp,plr,clips,corr:c,width,lowCorr:lc,bands:rel,dev,items,platform,genre};}
root.APSScore={analyze,GENRES,PLAT};
function ui(){const $=id=>document.getElementById(id),panel=$('apsMasterPanel'),B=root.APSMixBridge;if(!panel||!B)return;
 const tgt=$('apsMasterTarget');if(tgt&&![...tgt.options].some(o=>o.value==='-16'))tgt.insertAdjacentHTML('beforeend','<option value="-16">−16 LUFS · Apple Music</option>');
 panel.insertAdjacentHTML('beforeend','<div class="aps-score" id="apsScore"><h3>📊 Nota do master <small>análise no aparelho</small></h3><div class="aps-score-row"><label>Plataforma<select id="apsScPlat"><option value="spotify">Spotify (−14)</option><option value="youtube">YouTube (−14)</option><option value="apple">Apple Music (−16)</option></select></label><label>Gênero<select id="apsScGenre">'+Object.entries(GNAMES).map(([k,v])=>'<option value="'+k+'">'+v+'</option>').join('')+'</select></label></div><div class="aps-score-row"><button type="button" id="apsScMix" class="accent">📊 Avaliar mixagem</button><button type="button" id="apsScMaster">📊 Avaliar master pronto</button><label class="aps-score-file">ou um arquivo <input type="file" id="apsScFile" accept="audio/*"></label></div><div id="apsScOut" role="status" aria-live="polite"><p class="sub">A nota considera volume, pico real, dinâmica, timbre do gênero, estéreo, graves e clipping.</p></div></div>');
 const out=$('apsScOut');let last=null;
 const render=r=>{const col=r.score>=85?'#7fd6a4':r.score>=65?'#e9c46a':'#ef7777',verdict=r.score>=85?'Pronto para lançar':r.score>=65?'Quase lá':'Precisa de ajustes';
  out.innerHTML='<div class="aps-score-big" style="--c:'+col+'"><b>'+r.score+'</b><span>/100 · '+verdict+'</span></div><ul class="aps-score-list">'+r.items.map((it,i)=>'<li class="'+(it.ok?'ok':'bad')+'"><span>'+(it.ok?'✅':'⚠️')+'</span><div><b>'+it.title+'</b><small>'+it.tip+'</small>'+(it.ok?'':'<button type="button" class="mini" data-fix="'+it.fix+'">'+(it.fix==='master'?'🏆 Corrigir no master':it.fix==='eq'?'🎚 Master com EQ suave':'🤖 Abrir Mixagem IA')+'</button>')+'</div><i>'+Math.round(it.score)+'</i></li>').join('')+'</ul>';};
 const run=async(getBuf,label)=>{if(root.APSPlan&&!root.APSPlan.allowed('master.nota')){out.textContent='Recurso do plano Pro.';return;}out.innerHTML='<p class="sub">Analisando '+label+'…</p>';await new Promise(r=>setTimeout(r,30));try{const b=await getBuf();last=APSScore.analyze(b,{platform:$('apsScPlat').value,genre:$('apsScGenre').value});render(last);}catch(e){out.innerHTML='<p class="sub">'+(e.message||e)+'</p>';}};
 $('apsScMix').onclick=()=>run(async()=>{if(!B.all().length)throw Error('Adicione pistas primeiro.');return B.renderMix();},'a mixagem');
 $('apsScMaster').onclick=()=>run(async()=>{const r=root.APSMasterLast;if(!r)throw Error('Toque em "🏆 Masterizar" primeiro.');return r;},'o master');
 $('apsScFile').onchange=e=>{const f=e.target.files[0];if(f)run(async()=>{const AC=root.AudioContext||root.webkitAudioContext,c=new AC();try{return await c.decodeAudioData(await f.arrayBuffer());}finally{c.close();}},f.name);};
 out.addEventListener('click',e=>{const k=e.target.dataset?.fix;if(!k)return;const pl=PLAT[$('apsScPlat').value].l;
  if(k==='mix'){const t=document.querySelector('[data-aps-tab="mixagem"]');t?.click();($('apsMixAssistant')||$('apsMasterPanel')).scrollIntoView({behavior:'smooth'});return;}
  tgt.value=String(pl);if(k==='eq')$('apsMasterEQ').checked=true;$('apsMasterUseMix')?.click();panel.scrollIntoView({behavior:'smooth'});$('apsMasterRun').click();
  out.insertAdjacentHTML('afterbegin','<p class="sub">Master em andamento com alvo '+pl+' LUFS e teto −1 dBTP. Depois toque em "Avaliar master pronto".</p>');});}
if(typeof document!=='undefined'){if(document.readyState==='complete')ui();else root.addEventListener('load',ui);}
})(window);
