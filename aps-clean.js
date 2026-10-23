/* APS 2.5.0 — Limpeza de ruído e eco de sala no aparelho.
 * Porta de ruído espectral (perfil aprendido nos trechos mais silenciosos) + redução de reverberação tardia
 * (estimativa estatística por decaimento, estilo Lebart). Tudo no navegador, nada é enviado. */
(function(root){'use strict';
const idle=()=>new Promise(r=>setTimeout(r,0));
function fft(re,im){const n=re.length;for(let i=1,j=0;i<n;i++){let b=n>>1;for(;j&b;b>>=1)j^=b;j^=b;if(i<j){let t=re[i];re[i]=re[j];re[j]=t;t=im[i];im[i]=im[j];im[j]=t;}}
 for(let len=2;len<=n;len<<=1){const a=-2*Math.PI/len,wr=Math.cos(a),wi=Math.sin(a);for(let i=0;i<n;i+=len){let cr=1,ci=0;for(let k=0;k<len/2;k++){const p=i+k,q=p+len/2,tr=re[q]*cr-im[q]*ci,ti=re[q]*ci+im[q]*cr;re[q]=re[p]-tr;im[q]=im[p]-ti;re[p]+=tr;im[p]+=ti;const nr=cr*wr-ci*wi;ci=cr*wi+ci*wr;cr=nr;}}}}
function ifft(re,im){for(let i=0;i<im.length;i++)im[i]=-im[i];fft(re,im);const n=re.length;for(let i=0;i<n;i++){re[i]/=n;im[i]=-im[i]/n;}}
/** opts: noise 0..100, room 0..100 (eco), t60 s, floor dB */
async function cleanChannel(x,sr,{noise=60,room=40,t60=.6,floorDb=-24,onProgress}={}){
 const N=2048,H=512,B=N/2+1,win=new Float32Array(N);for(let i=0;i<N;i++)win[i]=Math.sqrt(.5-.5*Math.cos(2*Math.PI*i/N));
 const L=x.length,F=Math.ceil((L+N)/H)+1,pad=new Float32Array(F*H+N);pad.set(x,N/2);
 const P=new Array(F),RE=new Array(F),IM=new Array(F),en=new Float32Array(F);
 for(let f=0;f<F;f++){const re=new Float32Array(N),im=new Float32Array(N),s=f*H;for(let i=0;i<N;i++)re[i]=pad[s+i]*win[i];fft(re,im);const p=new Float32Array(B);let e=0;for(let k=0;k<B;k++){p[k]=re[k]*re[k]+im[k]*im[k];e+=p[k];}P[f]=p;RE[f]=re;IM[f]=im;en[f]=e;if(f%400===0){onProgress?.(.4*f/F);await idle();}}
 // perfil de ruído: média dos 12% de quadros mais silenciosos (ignorando silêncio digital)
 const idx=[...en.keys()].filter(i=>en[i]>1e-12).sort((a,b)=>en[a]-en[b]),q=idx.slice(0,Math.max(4,Math.floor(idx.length*.12))),nz=new Float32Array(B);
 for(const i of q)for(let k=0;k<B;k++)nz[k]+=P[i][k]/q.length;
 const over=1+3*noise/100,floor=Math.pow(10,floorDb/20),D=Math.max(1,Math.round(.05*sr/H)),dec=Math.exp(-6.91*2*D*H/sr/Math.max(.1,t60)),rw=room/100*1.5;
 let prev=new Float32Array(B).fill(1);const out=new Float32Array(F*H+N),ws=new Float32Array(F*H+N);
 for(let f=0;f<F;f++){const p=P[f],g=new Float32Array(B),late=f>=D?P[f-D]:null;
  for(let k=0;k<B;k++){let interf=noise>0?over*nz[k]:0;if(late&&rw>0)interf+=rw*dec*late[k];const snr=Math.max(0,p[k]-interf)/(p[k]+1e-20);let gg=Math.sqrt(snr);gg=Math.max(floor,gg);
   // suavização temporal (ataque rápido, soltura lenta) reduz "ruído musical"
   gg=gg>prev[k]?.7*gg+.3*prev[k]:.55*gg+.45*prev[k];g[k]=gg;}
  for(let k=1;k<B-1;k++)g[k]=Math.max(floor,(g[k-1]+2*g[k]+g[k+1])/4);prev=g;
  const re=RE[f],im=IM[f];for(let k=0;k<B;k++){re[k]*=g[k];im[k]*=g[k];if(k>0&&k<N/2){re[N-k]=re[k];im[N-k]=-im[k];}}
  ifft(re,im);const s=f*H;for(let i=0;i<N;i++){out[s+i]+=re[i]*win[i];ws[s+i]+=win[i]*win[i];}
  RE[f]=IM[f]=P[f-D-1]=null;if(f%400===0){onProgress?.(.4+.6*f/F);await idle();}}
 const y=new Float32Array(L);for(let i=0;i<L;i++){const w=ws[i+N/2];y[i]=w>1e-6?out[i+N/2]/w:0;}return y;}
async function clean(buf,opts={}){const AC=root.OfflineAudioContext||root.webkitOfflineAudioContext;const o=new AC(buf.numberOfChannels,buf.length,buf.sampleRate).createBuffer(buf.numberOfChannels,buf.length,buf.sampleRate);
 for(let c=0;c<buf.numberOfChannels;c++){const y=await cleanChannel(buf.getChannelData(c),buf.sampleRate,{...opts,onProgress:p=>opts.onProgress?.((c+p)/buf.numberOfChannels)});o.copyToChannel(y,c);}return o;}
const originals=new Map();
function ui(){const host=document.getElementById('apsClean'),B=root.APSMixBridge;if(!host||!B)return;const $=id=>document.getElementById(id);
 host.className='aps-cl';host.innerHTML='<h3>🧽 Limpar gravação <small>(ruído e eco da sala)</small></h3>'+
 '<label>Ruído de fundo <input type="range" id="apsClNoise" min="0" max="100" value="60"><span id="apsClNoiseV">60</span></label>'+
 '<label>Eco da sala <input type="range" id="apsClRoom" min="0" max="100" value="40"><span id="apsClRoomV">40</span></label>'+
 '<label>Sala <select id="apsClT60"><option value=".35">pequena / quarto</option><option value=".6" selected>média / sala</option><option value="1.1">grande / igreja</option></select></label>'+
 '<label>Naturalidade <select id="apsClFloor"><option value="-14">mais natural</option><option value="-24" selected>equilibrado</option><option value="-36">mais limpo</option></select></label>'+
 '<div class="actions"><button id="apsClApply" class="accent">🧽 Limpar pista selecionada</button><button id="apsClUndo" disabled>↩ Voltar original</button></div>'+
 '<p class="sub" id="apsClStatus">Dica: deixe 1–2 s de silêncio no começo da gravação; o app aprende o ruído ali.</p>';
 for(const k of['Noise','Room'])$('apsCl'+k).oninput=e=>$('apsCl'+k+'V').textContent=e.target.value;
 const st=t=>$('apsClStatus').textContent=t,sync=()=>{const t=B.current();$('apsClUndo').disabled=!(t&&originals.has(t.id));};
 $('apsClApply').onclick=async()=>{const t=B.current();if(!t){st('Selecione ou grave uma pista primeiro.');return;}if(root.APSPlan&&!root.APSPlan.allowed('voz.limpeza')){st('Recurso do plano Pro.');return;}const btn=$('apsClApply');btn.disabled=true;
  try{if(!originals.has(t.id))originals.set(t.id,t.buf);const src=originals.get(t.id),t0=performance.now();
   const y=await clean(src,{noise:+$('apsClNoise').value,room:+$('apsClRoom').value,t60:+$('apsClT60').value,floorDb:+$('apsClFloor').value,onProgress:p=>st('Limpando… '+Math.round(p*100)+'%')});
   B.setBuffer(t.id,y);st('✨ Pista limpa em '+((performance.now()-t0)/1000).toFixed(1)+' s. Toque ▶ para ouvir; ↩ volta o original.');}
  catch(e){st('Não foi possível limpar: '+e.message);}finally{btn.disabled=false;sync();}};
 $('apsClUndo').onclick=()=>{const t=B.current();if(!t||!originals.has(t.id))return;B.setBuffer(t.id,originals.get(t.id));originals.delete(t.id);st('Original restaurado.');sync();};
 setInterval(sync,1000);}
root.APSClean={clean,cleanChannel,fft,ifft};
if(typeof document!=='undefined'){if(document.readyState==='complete')ui();else root.addEventListener('load',ui);}
})(window);
