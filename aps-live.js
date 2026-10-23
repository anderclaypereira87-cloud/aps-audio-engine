/* APS 3.9.0 — utilidades do Ensaio, Professor, Cifra ao vivo e Palco. Criado por Anderclay Pereira Silva. */
(function(R){'use strict';
const SH=['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'],FL=['C','Db','D','Eb','E','F','Gb','G','Ab','A','Bb','B'],PT=['Dó','Dó#','Ré','Ré#','Mi','Fá','Fá#','Sol','Sol#','Lá','Lá#','Si'];
let AC=null;const ac=()=>{AC=AC||new (R.AudioContext||R.webkitAudioContext)();if(AC.state==='suspended')AC.resume();return AC;};
function yin(x,sr,thr=.12,minRms=.01){const W=Math.floor(x.length/2),d=new Float32Array(W);let rms=0;for(let i=0;i<x.length;i++)rms+=x[i]*x[i];if(Math.sqrt(rms/x.length)<minRms)return -1;
 const minT=Math.floor(sr/1200),maxT=Math.min(W-1,Math.floor(sr/50));for(let t=1;t<=maxT;t++){let s=0;for(let i=0;i<W;i++){const v=x[i]-x[i+t];s+=v*v;}d[t]=s;}
 let run=0;d[0]=1;for(let t=1;t<=maxT;t++){run+=d[t];d[t]=d[t]*t/(run||1);}let T=-1;for(let t=minT;t<maxT;t++){if(d[t]<thr){while(t+1<maxT&&d[t+1]<d[t])t++;T=t;break;}}
 if(T<1)return -1;const a=d[T-1],b=d[T],c=d[T+1]||b,den=a+c-2*b;return sr/(den?T+(a-c)/(2*den):T);}
const midi=f=>69+12*Math.log2(f/440),hz=m=>440*Math.pow(2,(m-69)/12),nm=m=>PT[((Math.round(m)%12)+12)%12]+(Math.floor(Math.round(m)/12)-1);
function cname(root,q,semi=0,flats=false){if(root<0)return 'N.C.';return (flats?FL:SH)[((root+semi)%12+12)%12]+q;}
// Acorde a partir de um AnalyserNode (tempo real)
const TEMPL=[];for(let r=0;r<12;r++)for(const[q,iv]of[['',[0,4,7]],['m',[0,3,7]]]){const v=new Float32Array(12);iv.forEach((d,j)=>v[(r+d)%12]=j?1:1.2);TEMPL.push({r,q,v});}
function chromaFromAnalyser(an,arr){an.getFloatFrequencyData(arr);const sr=an.context.sampleRate,N=an.fftSize,c=new Float32Array(12);let e=0;
 for(let k=2;k<arr.length;k++){const f=k*sr/N;if(f<70)continue;if(f>1600)break;const m=midi(f),dv=Math.abs(m-Math.round(m));if(dv>.35)continue;const a=Math.pow(10,arr[k]/20);c[((Math.round(m)%12)+12)%12]+=a*(1-dv*2)*(f<150?.5:1);e+=a;}return{c,e};}
function matchChord(c){let n=0;for(const v of c)n+=v*v;n=Math.sqrt(n);if(!n)return null;let best=null,bs=-1;for(const t of TEMPL){let s=0,tn=0;for(let j=0;j<12;j++){s+=c[j]*t.v[j];tn+=t.v[j]*t.v[j];}s/=n*Math.sqrt(tn);if(s>bs){bs=s;best=t;}}return bs>.55?{root:best.r,q:best.q,score:bs}:null;}
// WSOLA: muda velocidade sem mudar o tom, e tom sem mudar velocidade (offline)
async function stretchAll(bufs,speed=1,semi=0,onP){const p=Math.pow(2,semi/12),alpha=p/speed;if(Math.abs(alpha-1)<1e-3&&Math.abs(p-1)<1e-3)return bufs;
 const sr=bufs[0].sampleRate,len=bufs[0].length,N=sr>30000?2048:1024,Hs=N/2,Ha=Hs/alpha,D=4,del=Math.round(N/4);
 // guia mono decimado (soma das pistas)
 const gl=Math.floor(len/D),g=new Float32Array(gl);for(const b of bufs)for(let ch=0;ch<b.numberOfChannels;ch++){const x=b.getChannelData(ch);for(let i=0;i<gl;i++)g[i]+=x[i*D];}
 const K=Math.floor((len-N-del)/Ha),pos=new Int32Array(Math.max(K,1)),L=Math.floor(Hs/D/2),dd=Math.floor(del/D);let prev=0;
 for(let k=1;k<K;k++){const nom=Math.round(k*Ha/D),nat=Math.round(prev/D)+Hs/D;let bd=0,bc=-1e30;for(let d=-dd;d<=dd;d++){const s=nom+d;if(s<0||s+L>=gl||nat+L>=gl)continue;let c=0;for(let i=0;i<L;i++)c+=g[s+i]*g[nat+i];if(c>bc){bc=c;bd=d;}}pos[k]=Math.max(0,Math.round(k*Ha)+bd*D);prev=pos[k];if(k%400===0){onP&&onP(k/K*.8);await new Promise(r=>setTimeout(r,0));}}
 const w=new Float32Array(N);for(let i=0;i<N;i++)w[i]=.5-.5*Math.cos(2*Math.PI*i/N);const outLen=K*Hs+N,finalLen=Math.floor(outLen/p),A=ac(),res=[];
 for(const b of bufs){const nb=A.createBuffer(b.numberOfChannels,Math.max(1,finalLen),sr);for(let ch=0;ch<b.numberOfChannels;ch++){const x=b.getChannelData(ch),y=new Float32Array(outLen);
   for(let k=0;k<K;k++){const s=pos[k],o=k*Hs;for(let i=0;i<N;i++)y[o+i]+=(x[s+i]||0)*w[i];}
   const z=nb.getChannelData(ch);if(p===1)z.set(y.subarray(0,finalLen));else for(let i=0;i<finalLen;i++){const t=i*p,j=Math.floor(t),f=t-j;z[i]=(y[j]||0)*(1-f)+(y[j+1]||0)*f;}}
  res.push(nb);onP&&onP(.8+.2*res.length/bufs.length);await new Promise(r=>setTimeout(r,0));}return res;}
function lastStems(){return new Promise((ok,fail)=>{if(!R.indexedDB)return fail(Error('Sem armazenamento local'));const r=indexedDB.open('aps-stems-transfer-v1',1);r.onupgradeneeded=()=>{if(!r.result.objectStoreNames.contains('sessions'))r.result.createObjectStore('sessions');};
 r.onsuccess=()=>{const db=r.result;try{const g=db.transaction('sessions','readonly').objectStore('sessions').get('latest');g.onsuccess=()=>{db.close();ok(g.result||null);};g.onerror=()=>fail(g.error);}catch(e){fail(e);}};r.onerror=()=>fail(r.error);});}
let wl=null;async function wake(on){try{if(on&&'wakeLock' in navigator){wl=await navigator.wakeLock.request('screen');return true;}if(!on&&wl){await wl.release();wl=null;}}catch(e){}return false;}
const enc=o=>btoa(unescape(encodeURIComponent(JSON.stringify(o)))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const dec=s=>JSON.parse(decodeURIComponent(escape(atob(s.replace(/-/g,'+').replace(/_/g,'/')))));
async function share(title,text,url){try{if(navigator.share){await navigator.share({title,text,url});return 'Compartilhado.';}}catch(e){if(e.name==='AbortError')return '';}
 try{await navigator.clipboard.writeText((text?text+'\n':'')+(url||''));return 'Copiado. Cole no WhatsApp.';}catch(e){return 'Copie: '+(url||text);}}
async function mic(){return navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false}});}
const fmt=t=>Math.floor(t/60)+':'+String(Math.floor(t%60)).padStart(2,'0');
// transpor texto de cifra: troca acordes reconhecidos
function transposeText(txt,semi,flats){if(!semi)return txt;return txt.replace(/(^|[\s|(\[])([A-G])([#b]?)(?=(m|maj|dim|aug|sus|add|°|º|[0-9]|\/|\s|\||$|\)|\]))/g,(a,pre,L,acc)=>{let i=SH.indexOf(L);if(acc==='#')i++;if(acc==='b')i--;return pre+(flats?FL:SH)[((i+semi)%12+12)%12];}).replace(/\/([A-G])([#b]?)/g,(a,L,acc)=>{let i=SH.indexOf(L);if(acc==='#')i++;if(acc==='b')i--;return '/'+(flats?FL:SH)[((i+semi)%12+12)%12];});}
R.APSLive={ac,yin,midi,hz,nm,cname,chromaFromAnalyser,matchChord,stretchAll,lastStems,wake,enc,dec,share,mic,fmt,transposeText,SH,FL,PT};
})(window);
