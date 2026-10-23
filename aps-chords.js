/* APS 2.9.0 — Cifra automática: tom, BPM e acordes (cromagrama + modelos de tríades), cifra sincronizada,
 * transposição, capotraste e exportação em texto. Tudo no aparelho. */
(function(root){'use strict';
const SH=['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'],FL=['C','Db','D','Eb','E','F','Gb','G','Ab','A','Bb','B'],PT=['Dó','Dó#','Ré','Ré#','Mi','Fá','Fá#','Sol','Sol#','Lá','Lá#','Si'];
const idle=()=>new Promise(r=>setTimeout(r,0));
const QUAL={'':[0,4,7],m:[0,3,7],'7':[0,4,7,10],m7:[0,3,7,10],maj7:[0,4,7,11]};
const MAJ=[6.35,2.23,3.48,2.33,4.38,4.09,2.52,5.19,2.39,3.66,2.29,2.88],MIN=[6.33,2.68,3.52,5.38,2.6,3.53,2.54,4.75,3.98,2.69,3.34,3.17];
function mono(buf){const n=buf.length,c=buf.numberOfChannels,y=new Float32Array(n);for(let k=0;k<c;k++){const x=buf.getChannelData(k);for(let i=0;i<n;i++)y[i]+=x[i]/c;}return y;}
async function chroma(buf,{hopSec=.1,onProgress}={}){const sr=buf.sampleRate,dec=Math.max(1,Math.round(sr/11025)),r=sr/dec,x0=mono(buf),n=Math.floor(x0.length/dec),x=new Float32Array(n);for(let i=0;i<n;i++){let s=0;for(let k=0;k<dec;k++)s+=x0[i*dec+k];x[i]=s/dec;}
 const N=4096,H=Math.round(hopSec*r),fft=root.APSClean.fft,w=new Float32Array(N);for(let i=0;i<N;i++)w[i]=.5-.5*Math.cos(2*Math.PI*i/N);
 const bin=new Int16Array(N/2).fill(-1),wt=new Float32Array(N/2);for(let k=1;k<N/2;k++){const f=k*r/N;if(f<55||f>2000)continue;const m=69+12*Math.log2(f/440),pc=((Math.round(m)%12)+12)%12;bin[k]=pc;wt[k]=Math.max(0,1-2*Math.abs(m-Math.round(m)))*(f<140?.5:1);}
 const F=Math.max(0,Math.floor((n-N)/H)+1),out=[],en=new Float32Array(F);
 for(let f=0;f<F;f++){const re=new Float32Array(N),im=new Float32Array(N),s=f*H;for(let i=0;i<N;i++)re[i]=x[s+i]*w[i];fft(re,im);const c=new Float32Array(12);for(let k=1;k<N/2;k++)if(bin[k]>=0){const m=Math.sqrt(re[k]*re[k]+im[k]*im[k]);c[bin[k]]+=m*wt[k];}
  let e=0;for(const v of c)e+=v;en[f]=e;out.push(c);if(f%150===0){onProgress?.(f/F);await idle();}}
 return{frames:out,energy:en,hop:H/r,offset:N/2/r};}
function key(frames){const t=new Float32Array(12);for(const c of frames){let s=0;for(const v of c)s+=v;if(s>0)for(let i=0;i<12;i++)t[i]+=c[i]/s;}
 const cor=(p,a)=>{const ma=p.reduce((x,y)=>x+y)/12,mb=a.reduce((x,y)=>x+y)/12;let n=0,d1=0,d2=0;for(let i=0;i<12;i++){n+=(a[i]-mb)*(p[i]-ma);d1+=(a[i]-mb)**2;d2+=(p[i]-ma)**2;}return n/Math.sqrt(d1*d2+1e-20);};
 let best={s:-2};for(let k=0;k<12;k++)for(const[mode,P]of[['maior',MAJ],['menor',MIN]]){const rot=[...Array(12)].map((_,i)=>t[(i+k)%12]),s=cor(P,rot);if(s>best.s)best={s,tonic:k,mode};}return best;}
function chords(ch,{sevenths=false,minLen=.45}={}){const temps=[];for(let r=0;r<12;r++)for(const[q,iv]of Object.entries(QUAL)){if(!sevenths&&q.length&&q!=='m')continue;const v=new Float32Array(12);iv.forEach((d,j)=>v[(r+d)%12]=j===0?1.2:1);temps.push({r,q,v});}
 const F=ch.frames.length,lab=new Int16Array(F).fill(-1),maxE=Math.max(...ch.energy,1e-9);
 // suavização: média de 5 quadros
 for(let f=0;f<F;f++){if(ch.energy[f]<maxE*.03)continue;const c=new Float32Array(12);for(let k=-2;k<=2;k++){const g=ch.frames[f+k];if(g)for(let i=0;i<12;i++)c[i]+=g[i];}let nrm=0;for(const v of c)nrm+=v*v;nrm=Math.sqrt(nrm)||1;
  let bs=-1,bi=-1;temps.forEach((t,i)=>{let s=0,tn=0;for(let j=0;j<12;j++){s+=c[j]*t.v[j];tn+=t.v[j]*t.v[j];}s/=nrm*Math.sqrt(tn);if(t.q.length>1)s-=.02;if(s>bs){bs=s;bi=i;}});lab[f]=bs>.5?bi:-1;}
 // segmentos + remoção de curtos
 let segs=[];for(let f=0;f<F;f++){const l=lab[f],t=ch.offset+f*ch.hop;if(segs.length&&segs[segs.length-1].i===l)segs[segs.length-1].end=t+ch.hop;else segs.push({i:l,start:t,end:t+ch.hop});}
 for(let pass=0;pass<3;pass++){const o=[];for(const s of segs){if(o.length&&(s.end-s.start<minLen||s.i===o[o.length-1].i)){o[o.length-1].end=s.end;continue;}o.push({...s});}segs=o;}
 if(segs.length)segs[0].start=0;return segs.map(s=>s.i<0?{start:s.start,end:s.end,root:-1,q:'',name:'N.C.'}:{start:s.start,end:s.end,root:temps[s.i].r,q:temps[s.i].q});}
function name(root,q,semi=0,flats=false){if(root<0)return 'N.C.';const r=((root+semi)%12+12)%12;return(flats?FL:SH)[r]+q;}
function toText(res,{title='Música',semi=0,capo=0,flats=false,perLine=4}={}){const bar=60/res.bpm*res.beats,lines=['APS Audio Engine — cifra automática (confira de ouvido)',title,'Tom: '+name(res.key.tonic,res.key.mode==='menor'?'m':'',semi,flats)+(capo?' · Capo '+capo+' (formas em '+name(res.key.tonic,res.key.mode==='menor'?'m':'',semi-capo,flats)+')':'')+' · BPM '+res.bpm,''];
 const nb=Math.ceil((res.duration||res.chords.at(-1)?.end||0)/bar),at=t=>res.chords.find(c=>t>=c.start&&t<c.end)||res.chords.at(-1);let row=[],prev='';
 for(let b=0;b<nb;b++){const c=at(b*bar+bar*.25);const nm=c?name(c.root,c.q,semi-capo,flats):'';row.push((nm===prev?'%':nm).padEnd(7));prev=nm;if(row.length===perLine||b===nb-1){const t=Math.floor((b-row.length+1)*bar);lines.push('['+Math.floor(t/60)+':'+String(t%60).padStart(2,'0')+'] | '+row.join('| ')+'|');row=[];}}return lines.join('\n');}
async function analyze(buf,{onProgress,bpm}={}){const ch=await chroma(buf,{onProgress}),k=key(ch.frames);return{key:k,chords:chords(ch),bpm,beats:4,duration:buf.duration};}
root.APSChords={chroma,key,chords,name,toText,analyze,PT};
function ui(){const host=document.getElementById('apsAutoChords'),B=root.APSMixBridge;if(!host||!B)return;const $=id=>document.getElementById(id);
 host.className='aps-ch';host.innerHTML='<h3>🎼 Cifra automática <small>tom · BPM · acordes</small></h3><div class="aps-ch-row"><button type="button" id="apsChTrack" class="accent">🎼 Analisar pista selecionada</button><button type="button" id="apsChMix">Analisar mixagem</button><label class="aps-ch-file">ou música <input type="file" id="apsChFile" accept="audio/*"></label></div>'+
 '<div class="aps-ch-row"><label>Transpor <span class="aps-ch-step"><button type="button" id="apsChDn">−</button><b id="apsChSemi">0</b><button type="button" id="apsChUp">+</button></span></label><label>Capotraste <select id="apsChCapo">'+[...Array(10)].map((_,i)=>'<option value="'+i+'">'+(i?i+'ª casa':'sem capo')+'</option>').join('')+'</select></label><label>Notação <select id="apsChFlat"><option value="0">sustenidos (#)</option><option value="1">bemóis (b)</option></select></label></div>'+
 '<div id="apsChInfo" class="aps-ch-info">Analise uma pista (violão, teclado ou a música inteira) para gerar a cifra.</div><div class="aps-ch-now"><span id="apsChPrev">—</span><b id="apsChCur">—</b><span id="apsChNext">—</span></div><div id="apsChLane" class="aps-ch-lane"></div>'+
 '<div class="aps-ch-row"><button type="button" id="apsChPlay">▶ Tocar com a cifra</button><button type="button" id="apsChStop">■ Parar</button><button type="button" id="apsChTxt">↓ Baixar cifra (.txt)</button><button type="button" id="apsChCopy">⧉ Copiar</button></div><pre id="apsChText" class="aps-ch-text" hidden></pre>';
 let res=null,semi=0,fileBuf=null,usesTimeline=true;const st=t=>$('apsChInfo').innerHTML=t,opt=()=>({semi,capo:+$('apsChCapo').value,flats:$('apsChFlat').value==='1'});
 const draw=()=>{if(!res)return;const o=opt(),d=res.duration||1,ks=name(res.key.tonic,res.key.mode==='menor'?'m':'',o.semi,o.flats);
  st('Tom provável: <b>'+ks+'</b> ('+PTn(res.key,o.semi)+') · BPM <b>'+res.bpm+'</b> · '+res.chords.filter(c=>c.root>=0).length+' acordes'+(o.capo?' · capo na '+o.capo+'ª: toque as formas abaixo':'')+(usesTimeline?'':' · (arquivo externo: use ▶ do player abaixo)'));
  $('apsChLane').innerHTML=res.chords.map((c,i)=>'<button type="button" data-i="'+i+'" style="left:'+(c.start/d*100)+'%;width:'+((c.end-c.start)/d*100)+'%"'+(c.root<0?' class="nc"':'')+'>'+name(c.root,c.q,o.semi-o.capo,o.flats)+'</button>').join('');
  const tx=toText(res,{...o,title:$('projectName')?.value||'Música'});$('apsChText').textContent=tx;$('apsChText').hidden=false;};
 const PTn=(k,s)=>PT[((k.tonic+s)%12+12)%12]+' '+k.mode;
 const run=async(get,isTL)=>{if(root.APSPlan&&!root.APSPlan.allowed('cifra.auto')){st('Recurso do plano Pro.');return;}try{st('Analisando…');const {buf,bpm}=await get();usesTimeline=isTL;res=await analyze(buf,{bpm,onProgress:p=>st('Analisando acordes… '+Math.round(p*100)+'%')});semi=0;$('apsChSemi').textContent='0';draw();}catch(e){st(e.message||String(e));}};
 $('apsChTrack').onclick=()=>run(async()=>{const t=B.current();if(!t)throw Error('Selecione ou importe uma pista primeiro.');let bpm=B.bpm();try{bpm=B.guessBPM(t).bpm;B.setBpm(bpm);}catch{}fileBuf=null;res&&(res.offset=0);trackStart=t.start||0;return{buf:t.buf,bpm};},true);
 $('apsChMix').onclick=()=>run(async()=>{if(!B.all().length)throw Error('Adicione pistas primeiro.');trackStart=0;return{buf:await B.renderMix(),bpm:B.bpm()};},true);
 $('apsChFile').onchange=e=>{const f=e.target.files[0];if(!f)return;run(async()=>{const AC=root.AudioContext||root.webkitAudioContext,c=new AC();let buf;try{buf=await c.decodeAudioData(await f.arrayBuffer());}finally{c.close();}fileBuf=buf;trackStart=0;
  if(!$('apsChAudio')){host.querySelector('.aps-ch-now').insertAdjacentHTML('beforebegin','<audio id="apsChAudio" controls style="width:100%;margin-top:6px"></audio>');}$('apsChAudio').src=URL.createObjectURL(f);
  let bpm=B.bpm();try{bpm=B.guessBPM({buf}).bpm;}catch{}return{buf,bpm};},false);};
 let trackStart=0;
 $('apsChUp').onclick=()=>{semi=Math.min(11,semi+1);$('apsChSemi').textContent=(semi>0?'+':'')+semi;draw();};$('apsChDn').onclick=()=>{semi=Math.max(-11,semi-1);$('apsChSemi').textContent=(semi>0?'+':'')+semi;draw();};
 $('apsChCapo').onchange=draw;$('apsChFlat').onchange=draw;
 $('apsChLane').onclick=e=>{const i=e.target.dataset?.i;if(i==null||!res)return;const t=res.chords[+i].start;if(usesTimeline)B.seek(trackStart+t);else if($('apsChAudio'))$('apsChAudio').currentTime=t;};
 $('apsChPlay').onclick=()=>{if(!usesTimeline&&$('apsChAudio'))$('apsChAudio').play();else B.play();};$('apsChStop').onclick=()=>{if($('apsChAudio'))$('apsChAudio').pause();B.stop();};
 const save=()=>{const tx=$('apsChText').textContent;if(!tx)return null;return tx;};
 $('apsChTxt').onclick=()=>{const tx=save();if(!tx){st('Analise primeiro.');return;}const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([tx],{type:'text/plain;charset=utf-8'}));a.download=(($('projectName')?.value||'cifra').replace(/[\\/:*?"<>|]/g,''))+' - cifra.txt';a.click();};
 $('apsChCopy').onclick=async()=>{const tx=save();if(!tx)return;try{await navigator.clipboard.writeText(tx);st('Cifra copiada.');}catch{st('Não foi possível copiar; use o download.');}};
 let lastI=-2;const tick=()=>{requestAnimationFrame(tick);if(!res||host.offsetParent===null)return;const t=usesTimeline?B.position()-trackStart:($('apsChAudio')?.currentTime||0);const i=res.chords.findIndex(c=>t>=c.start&&t<c.end);if(i===lastI)return;lastI=i;const o=opt(),nm=k=>{const c=res.chords[k];return c?name(c.root,c.q,o.semi-o.capo,o.flats):'—';};$('apsChPrev').textContent=nm(i-1);$('apsChCur').textContent=nm(i);$('apsChNext').textContent=nm(i+1);host.querySelectorAll('.aps-ch-lane button').forEach((b,k)=>b.classList.toggle('on',k===i));};tick();}
if(typeof document!=='undefined'){if(document.readyState==='complete')ui();else root.addEventListener('load',ui);}
})(window);
