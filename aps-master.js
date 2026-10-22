/* APS Audio Engine 1.8.0 — Masterização local no navegador.
 * Medidor de loudness BS.1770 (simplificado: K-weighting + gating -70 LUFS absoluto / -10 LU relativo),
 * EQ suave, compressor, ganho para o alvo e limitador true-peak (4x sobreamostrado) com teto ~-1 dBTP.
 * Nada é enviado para a internet.
 */
(function(root){'use strict';
// ---------- DSP puro (testável sem navegador) ----------
function biquad(x,c){const y=new Float32Array(x.length);let x1=0,x2=0,y1=0,y2=0;const{b0,b1,b2,a1,a2}=c;
 for(let i=0;i<x.length;i++){const v=x[i],o=b0*v+b1*x1+b2*x2-a1*y1-a2*y2;x2=x1;x1=v;y2=y1;y1=o;y[i]=o;}return y;}
// Coeficientes K-weighting para qualquer taxa (mesma derivação do pyloudnorm / BS.1770-4).
function kShelf(fs){const G=3.999843853973347,Q=0.7071752369554196,fc=1681.974450955533,K=Math.tan(Math.PI*fc/fs),Vh=Math.pow(10,G/20),Vb=Math.pow(Vh,0.4996667741545416),a0=1+K/Q+K*K;
 return{b0:(Vh+Vb*K/Q+K*K)/a0,b1:2*(K*K-Vh)/a0,b2:(Vh-Vb*K/Q+K*K)/a0,a1:2*(K*K-1)/a0,a2:(1-K/Q+K*K)/a0};}
function kHigh(fs){const Q=0.5003270373238773,fc=38.13547087602444,K=Math.tan(Math.PI*fc/fs),a0=1+K/Q+K*K;
 return{b0:1,b1:-2,b2:1,a1:2*(K*K-1)/a0,a2:(1-K/Q+K*K)/a0};}
function integratedLUFS(channels,fs){
 const kw=channels.map(ch=>biquad(biquad(ch,kShelf(fs)),kHigh(fs)));
 const block=Math.round(0.4*fs),step=Math.round(0.1*fs),n=kw[0].length;if(n<block)return -Infinity;
 const z=[];for(let s=0;s+block<=n;s+=step){let sum=0;for(const ch of kw){let e=0;for(let i=s;i<s+block;i++)e+=ch[i]*ch[i];sum+=e/block;}z.push(sum);}
 const L=v=>-0.691+10*Math.log10(v);
 const abs=z.filter(v=>L(v)>-70);if(!abs.length)return -Infinity;
 const rel=L(abs.reduce((a,b)=>a+b,0)/abs.length)-10;
 const g=abs.filter(v=>L(v)>rel);return L(g.reduce((a,b)=>a+b,0)/g.length);}
// True peak por interpolação 4x (Catmull-Rom); aproximação suficiente para teto de -1 dBTP.
function tpAt(x,i){const p0=x[i-1]??x[i],p1=x[i],p2=x[i+1]??x[i],p3=x[i+2]??p2;let m=Math.abs(p1);
 for(const t of[.25,.5,.75]){const t2=t*t,t3=t2*t,v=.5*((2*p1)+(-p0+p2)*t+(2*p0-5*p1+4*p2-p3)*t2+(-p0+3*p1-3*p2+p3)*t3);const a=Math.abs(v);if(a>m)m=a;}return m;}
function truePeak(channels){let m=0;for(const ch of channels)for(let i=0;i<ch.length;i++){const a=tpAt(ch,i);if(a>m)m=a;}return m;}
const db=v=>20*Math.log10(Math.max(v,1e-12)),lin=d=>Math.pow(10,d/20);
function limit(channels,fs,ceilDb=-1){const ceil=lin(ceilDb),n=channels[0].length,need=new Float32Array(n);
 for(let i=0;i<n;i++){let m=0;for(const ch of channels){const a=tpAt(ch,i);if(a>m)m=a;}need[i]=m>ceil?ceil/m:1;}
 const look=Math.max(1,Math.round(.005*fs)),rel=Math.exp(-1/(.08*fs)),g=new Float32Array(n);
 // mínimo à frente (janela de lookahead) com deque
 const dq=[];let head=0;const minAhead=new Float32Array(n);
 for(let i=n-1;i>=0;i--){while(dq.length>head&&need[dq[dq.length-1]]>=need[i])dq.pop();dq.push(i);while(dq[head]>i+look)head++;minAhead[i]=need[dq[head]];if(head>4096){dq.splice(0,head);head=0;}}
 let cur=1;for(let i=0;i<n;i++){const t=minAhead[i];cur=t<cur?t:t+(cur-t)*rel;g[i]=cur;}
 for(const ch of channels)for(let i=0;i<n;i++)ch[i]*=g[i];
 // garantia final
 const tp=truePeak(channels);if(tp>ceil){const k=ceil/tp*0.999;for(const ch of channels)for(let i=0;i<n;i++)ch[i]*=k;}
 return channels;}
function compress(channels,fs,{threshold=-18,ratio=2,attack=.02,release=.2}={}){const n=channels[0].length,aa=Math.exp(-1/(attack*fs)),ar=Math.exp(-1/(release*fs));let env=0;
 for(let i=0;i<n;i++){let m=0;for(const ch of channels){const a=Math.abs(ch[i]);if(a>m)m=a;}env=m>env?m+(env-m)*aa:m+(env-m)*ar;const e=db(env),over=e-threshold,gr=over>0?over*(1-1/ratio):0,g=lin(-gr);for(const ch of channels)ch[i]*=g;}return channels;}
function peaking(fs,f,gDb,Q){const A=lin(gDb/2),w=2*Math.PI*f/fs,al=Math.sin(w)/(2*Q),c=Math.cos(w),a0=1+al/A;return{b0:(1+al*A)/a0,b1:-2*c/a0,b2:(1-al*A)/a0,a1:-2*c/a0,a2:(1-al/A)/a0};}
function shelf(fs,f,gDb,high){const A=lin(gDb/2),w=2*Math.PI*f/fs,c=Math.cos(w),al=Math.sin(w)/2*Math.SQRT2,s=2*Math.sqrt(A)*al;let b0,b1,b2,a0,a1,a2;
 if(high){b0=A*((A+1)+(A-1)*c+s);b1=-2*A*((A-1)+(A+1)*c);b2=A*((A+1)+(A-1)*c-s);a0=(A+1)-(A-1)*c+s;a1=2*((A-1)-(A+1)*c);a2=(A+1)-(A-1)*c-s;}
 else{b0=A*((A+1)-(A-1)*c+s);b1=2*A*((A-1)-(A+1)*c);b2=A*((A+1)-(A-1)*c-s);a0=(A+1)+(A-1)*c+s;a1=-2*((A-1)+(A+1)*c);a2=(A+1)+(A-1)*c-s;}
 return{b0:b0/a0,b1:b1/a0,b2:b2/a0,a1:a1/a0,a2:a2/a0};}
function hp30(fs){const w=2*Math.PI*30/fs,al=Math.sin(w)/(2*0.7071),c=Math.cos(w),a0=1+al;return{b0:(1+c)/2/a0,b1:-(1+c)/a0,b2:(1+c)/2/a0,a1:-2*c/a0,a2:(1-al)/a0};}
function softEQ(channels,fs){const hp=hp30(fs);// passa-alta suave 30 Hz para limpar subgrave
 return channels.map(ch=>biquad(biquad(biquad(biquad(ch,hp),shelf(fs,100,1,false)),peaking(fs,300,-1,1)),shelf(fs,10000,1.5,true)));}
function master(input,fs,{target=-14,ceiling=-1,eq=true}={}){
 const before=integratedLUFS(input,fs),tpBefore=db(truePeak(input));
 let ch=input.map(c=>new Float32Array(c));if(eq)ch=softEQ(ch,fs);
 compress(ch,fs,target>-11?{threshold:-16,ratio:3}:{threshold:-18,ratio:2});
 for(let pass=0;pass<3;pass++){const now=integratedLUFS(ch,fs);if(!isFinite(now))break;const g=lin(target-now);for(const c of ch)for(let i=0;i<c.length;i++)c[i]*=g;limit(ch,fs,ceiling);if(Math.abs(integratedLUFS(ch,fs)-target)<.3)break;}
 return{channels:ch,before,after:integratedLUFS(ch,fs),tpBefore,tpAfter:db(truePeak(ch))};}
function wav16(channels,fs){const n=channels[0].length,nc=channels.length,b=new ArrayBuffer(44+n*nc*2),v=new DataView(b),s=(o,t)=>{for(let i=0;i<t.length;i++)v.setUint8(o+i,t.charCodeAt(i));};
 s(0,'RIFF');v.setUint32(4,36+n*nc*2,true);s(8,'WAVE');s(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,nc,true);v.setUint32(24,fs,true);v.setUint32(28,fs*nc*2,true);v.setUint16(32,nc*2,true);v.setUint16(34,16,true);s(36,'data');v.setUint32(40,n*nc*2,true);
 let p=44;for(let i=0;i<n;i++)for(let c=0;c<nc;c++){const d=(Math.random()-Math.random())/65536,x=Math.max(-1,Math.min(1,channels[c][i]+d));v.setInt16(p,x<0?x*32768:x*32767,true);p+=2;}return b;}
const API={integratedLUFS,truePeak,master,limit,compress,softEQ,wav16,db};
root.APSMaster=API;if(typeof module!=='undefined')module.exports=API;

// ---------- Interface ----------
if(typeof document==='undefined')return;
function ui(){const $=id=>document.getElementById(id),panel=$('apsMasterPanel');if(!panel)return;
 let src=null,srcName='mix',result=null,player=null,ctx=null;
 const say=(t,k)=>{const e=$('apsMasterStatus');e.textContent=t;e.dataset.kind=k||'';};
 const fmt=v=>isFinite(v)?v.toFixed(1):'—';
 const toBuffers=b=>{const ch=[b.getChannelData(0),b.getChannelData(b.numberOfChannels>1?1:0)];return ch.map(c=>new Float32Array(c));};
 async function getSource(){if(src)return src;const br=window.APSMixBridge;if(!br?.renderMix)throw Error('Abra o estúdio (daw.html) para masterizar a mixagem.');if(!br.list().length)throw Error('Não há pistas na sessão. Importe pistas ou escolha um WAV para masterizar.');say('Renderizando a mixagem…');const b=await br.renderMix();return{rate:b.sampleRate,ch:toBuffers(b)};}
 $('apsMasterFile').addEventListener('change',async e=>{const f=e.target.files?.[0];if(!f)return;try{ctx=ctx||new (window.AudioContext||window.webkitAudioContext)();const b=await ctx.decodeAudioData(await f.arrayBuffer());src={rate:b.sampleRate,ch:toBuffers(b)};srcName=f.name.replace(/\.[^.]+$/,'');const l=integratedLUFS(src.ch,src.rate);$('apsMasterBefore').textContent=fmt(l);say('Arquivo carregado: '+f.name+' · '+fmt(l)+' LUFS. Toque em Masterizar.');}catch(err){say('Não foi possível ler o arquivo: '+err.message,'error');}});
 $('apsMasterUseMix').addEventListener('click',()=>{src=null;srcName='mix';$('apsMasterFile').value='';say('Fonte: mixagem atual do estúdio.');});
 $('apsMasterRun').addEventListener('click',async()=>{const btn=$('apsMasterRun');btn.disabled=true;try{const s=await getSource();say('Masterizando… (pode levar alguns segundos)');await new Promise(r=>setTimeout(r,30));
   const target=Number($('apsMasterTarget').value);result=master(s.ch,s.rate,{target,eq:$('apsMasterEQ').checked});result.rate=s.rate;
   $('apsMasterBefore').textContent=fmt(result.before);$('apsMasterAfter').textContent=fmt(result.after);$('apsMasterTP').textContent=fmt(result.tpAfter);
   $('apsMasterPlay').disabled=false;$('apsMasterDownload').disabled=false;say('Pronto: '+fmt(result.after)+' LUFS integrado, pico real '+fmt(result.tpAfter)+' dBTP.','ok');}
  catch(err){say(err.message,'error');}finally{btn.disabled=false;}});
 $('apsMasterPlay').addEventListener('click',async()=>{if(!result)return;if(player){try{player.stop()}catch{}player=null;$('apsMasterPlay').textContent='▶ Ouvir master';return;}
  ctx=ctx||new (window.AudioContext||window.webkitAudioContext)();await ctx.resume();const b=ctx.createBuffer(2,result.channels[0].length,result.rate);b.copyToChannel(result.channels[0],0);b.copyToChannel(result.channels[1],1);player=ctx.createBufferSource();player.buffer=b;player.connect(ctx.destination);player.onended=()=>{player=null;$('apsMasterPlay').textContent='▶ Ouvir master';};player.start();$('apsMasterPlay').textContent='■ Parar';});
 $('apsMasterDownload').addEventListener('click',()=>{if(!result)return;const url=URL.createObjectURL(new Blob([wav16(result.channels,result.rate)],{type:'audio/wav'}));const a=document.createElement('a');a.href=url;a.download=srcName+'_master_'+Math.round(result.after)+'LUFS.wav';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);});
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',ui);else ui();
})(typeof window!=='undefined'?window:globalThis);
