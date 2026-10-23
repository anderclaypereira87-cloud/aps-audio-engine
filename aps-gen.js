/* APS 3.9 — utilitários de geração (Banda virtual e Kit do seu jeito). Criado por Anderclay Pereira Silva.
   Usa somente os kits MMSTUDIO publicados em ./kits (gravações do próprio Anderclay) e síntese no aparelho. */
(function(root){'use strict';
const G={};
G.ctx=()=>G._c||(G._c=new (window.AudioContext||window.webkitAudioContext)());
G.decode=async blob=>{const ab=await blob.arrayBuffer();return await G.ctx().decodeAudioData(ab);};
G.mono=buf=>{const n=buf.length,c=buf.numberOfChannels,y=new Float32Array(n);for(let k=0;k<c;k++){const x=buf.getChannelData(k);for(let i=0;i<n;i++)y[i]+=x[i]/c;}return y;};
G.trim=(buf,max)=>{if(buf.duration<=max)return buf;const n=Math.floor(max*buf.sampleRate),o=G.ctx().createBuffer(buf.numberOfChannels,n,buf.sampleRate);for(let c=0;c<buf.numberOfChannels;c++)o.getChannelData(c).set(buf.getChannelData(c).subarray(0,n));return o;};
G.wav=buf=>{const ch=Math.min(2,buf.numberOfChannels),n=buf.length,sr=buf.sampleRate,ab=new ArrayBuffer(44+n*ch*2),v=new DataView(ab),w=(o,s)=>{for(let i=0;i<s.length;i++)v.setUint8(o+i,s.charCodeAt(i));};
 w(0,'RIFF');v.setUint32(4,36+n*ch*2,true);w(8,'WAVE');w(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,ch,true);v.setUint32(24,sr,true);v.setUint32(28,sr*ch*2,true);v.setUint16(32,ch*2,true);v.setUint16(34,16,true);w(36,'data');v.setUint32(40,n*ch*2,true);
 const d=[...Array(ch)].map((_,c)=>buf.getChannelData(c));let o=44;for(let i=0;i<n;i++)for(let c=0;c<ch;c++){const s=Math.max(-1,Math.min(1,d[c][i]));v.setInt16(o,s<0?s*32768:s*32767,true);o+=2;}return new Blob([ab],{type:'audio/wav'});};
G.download=(blob,name)=>{const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),4000);};
G.sendToStudio=async(blob,name)=>{const db=await new Promise((ok,no)=>{const r=indexedDB.open('aps-media-transfer',1);r.onupgradeneeded=()=>{if(!r.result.objectStoreNames.contains('files'))r.result.createObjectStore('files');};r.onsuccess=()=>ok(r.result);r.onerror=()=>no(r.error);});
 try{await new Promise((ok,no)=>{const tx=db.transaction('files','readwrite');tx.objectStore('files').put({file:new File([blob],name,{type:'audio/wav'})},'next');tx.oncomplete=ok;tx.onerror=()=>no(tx.error);});}finally{db.close();}location.href='./daw.html?modulo=gravacao&importar=midia';};
/* gravação pelo microfone */
G.recorder=async()=>{const s=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false}});const mr=new MediaRecorder(s),parts=[];mr.ondataavailable=e=>e.data.size&&parts.push(e.data);mr.start();
 return{stop:()=>new Promise(ok=>{mr.onstop=()=>{s.getTracks().forEach(t=>t.stop());ok(new Blob(parts,{type:mr.mimeType||'audio/webm'}));};mr.stop();})};};
/* FFT radix-2 in-place */
G.fft=(re,im)=>{const n=re.length;for(let i=1,j=0;i<n;i++){let b=n>>1;for(;j&b;b>>=1)j^=b;j^=b;if(i<j){[re[i],re[j]]=[re[j],re[i]];[im[i],im[j]]=[im[j],im[i]];}}
 for(let len=2;len<=n;len<<=1){const a=-2*Math.PI/len,wr=Math.cos(a),wi=Math.sin(a);for(let i=0;i<n;i+=len){let cr=1,ci=0;for(let k=0;k<len/2;k++){const p=i+k,q=p+len/2,tr=re[q]*cr-im[q]*ci,ti=re[q]*ci+im[q]*cr;re[q]=re[p]-tr;im[q]=im[p]-ti;re[p]+=tr;im[p]+=ti;const t=cr*wr-ci*wi;ci=cr*wi+ci*wr;cr=t;}}}};
/* envelope de ataques (fluxo de energia) — hop 512 */
G.onsetEnv=(x,sr,hop=512)=>{const n=Math.floor(x.length/hop),e=new Float32Array(n),f=new Float32Array(n);for(let i=0;i<n;i++){let s=0;for(let j=0;j<hop;j++){const v=x[i*hop+j];s+=v*v;}e[i]=Math.log(1e-6+s/hop);}if(n)f[0]=Math.max(0,e[0]-Math.log(1e-4));for(let i=1;i<n;i++)f[i]=Math.max(0,e[i]-e[i-1]);return{flux:f,energy:e,hop,sr};};
G.bpm=(x,sr)=>{const{flux,hop}=G.onsetEnv(x,sr),fps=sr/hop;let best=0,bb=100;for(let b=70;b<=180;b+=.5){const lag=fps*60/b,L=Math.floor(lag);const fr=lag-L;let s=0;for(let i=L+1;i<flux.length;i++)s+=flux[i]*(flux[i-L]*(1-fr)+flux[i-L-1]*fr);s/=Math.sqrt(flux.length-L);const pref=Math.exp(-Math.pow(Math.log2(b/110),2)*1.5);if(s*pref>best){best=s*pref;bb=b;}}return Math.round(bb);};
G.onsets=(x,sr,{sens=1}={})=>{const o=G.onsetEnv(x,sr,256),f=o.flux,out=[];let mean=0;for(const v of f)mean+=v;mean/=f.length||1;const peakE=Math.max(...o.energy);const thr=Math.max(mean*3/sens,.8/sens);let last=-99;
 for(let i=0;i<f.length-1;i++){if(f[i]>thr&&(i===0||f[i]>=f[i-1])&&f[i]>=f[i+1]&&i-last>6&&o.energy[i+1]>peakE-9){out.push((i*256)/sr);last=i;}}return out;};
/* kits */
G.kits=null;
G.loadKits=async()=>G.kits||(G.kits=await (await fetch('./kits/kits.json')).json());
G._smp={};G.sample=async file=>G._smp[file]||(G._smp[file]=await G.ctx().decodeAudioData(await (await fetch('./'+file)).arrayBuffer()));
G.kitPiece=async(kitId,piece)=>{const k=await G.loadKits();let list=k[kitId]?.pieces?.[piece];if(!list?.length)list=k['aps-studio'].pieces[piece];if(!list?.length)return null;return G.sample(list[0].file);};
/* síntese */
G.hz=m=>440*Math.pow(2,(m-69)/12);
G.play=(ctx,buf,t,dest,gain=1,rate=1)=>{if(!buf)return;const s=ctx.createBufferSource(),g=ctx.createGain();s.buffer=buf;s.playbackRate.value=rate;g.gain.value=gain;s.connect(g).connect(dest);s.start(t);};
G.tri=(ctx,t,dest,open,g=.25)=>{for(const f of[4180,6230,8100]){const o=ctx.createOscillator(),a=ctx.createGain();o.frequency.value=f;a.gain.setValueAtTime(g/3,t);a.gain.exponentialRampToValueAtTime(.0005,t+(open?.45:.07));o.connect(a).connect(dest);o.start(t);o.stop(t+.5);}};
G.shaker=(ctx,t,dest,g=.15)=>{const n=ctx.createBuffer(1,ctx.sampleRate*.08|0,ctx.sampleRate),d=n.getChannelData(0);for(let i=0;i<d.length;i++)d[i]=(Math.random()*2-1)*(1-i/d.length);const s=ctx.createBufferSource(),f=ctx.createBiquadFilter(),a=ctx.createGain();f.type='highpass';f.frequency.value=6000;a.gain.value=g;s.buffer=n;s.connect(f).connect(a).connect(dest);s.start(t);};
G.bass=(ctx,t,dur,midi,dest,g=.5)=>{const o=ctx.createOscillator(),o2=ctx.createOscillator(),f=ctx.createBiquadFilter(),a=ctx.createGain();o.type='triangle';o2.type='sawtooth';o.frequency.value=o2.frequency.value=G.hz(midi);f.type='lowpass';f.frequency.setValueAtTime(900,t);f.frequency.exponentialRampToValueAtTime(260,t+.2);
 const m=ctx.createGain();m.gain.value=.25;o2.connect(m).connect(f);o.connect(f);f.connect(a).connect(dest);a.gain.setValueAtTime(0,t);a.gain.linearRampToValueAtTime(g,t+.008);a.gain.setTargetAtTime(g*.6,t+.05,.15);a.gain.setTargetAtTime(0,t+dur*.92,.03);o.start(t);o2.start(t);o.stop(t+dur+.2);o2.stop(t+dur+.2);};
G.sanfona=(ctx,t,dur,notes,dest,g=.12)=>{const bp=ctx.createBiquadFilter(),a=ctx.createGain(),lfo=ctx.createOscillator(),lg=ctx.createGain();bp.type='bandpass';bp.frequency.value=1500;bp.Q.value=.6;lfo.frequency.value=5.5;lg.gain.value=g*.18;lfo.connect(lg).connect(a.gain);
 a.gain.setValueAtTime(0,t);a.gain.linearRampToValueAtTime(g,t+.03);a.gain.setValueAtTime(g,t+dur*.85);a.gain.linearRampToValueAtTime(0,t+dur);bp.connect(a).connect(dest);lfo.start(t);lfo.stop(t+dur+.05);
 for(const m of notes)for(const[type,det]of[['sawtooth',-7],['square',6]]){const o=ctx.createOscillator();o.type=type;o.frequency.value=G.hz(m);o.detune.value=det;o.connect(bp);o.start(t);o.stop(t+dur+.05);}};
G.keys=(ctx,t,dur,notes,dest,g=.14)=>{const a=ctx.createGain(),lp=ctx.createBiquadFilter();lp.type='lowpass';lp.frequency.value=2600;a.gain.setValueAtTime(0,t);a.gain.linearRampToValueAtTime(g,t+.006);a.gain.exponentialRampToValueAtTime(g*.25,t+Math.min(dur,1.2));a.gain.linearRampToValueAtTime(0,t+dur+.08);lp.connect(a).connect(dest);
 for(const m of notes){for(const[type,mul,amp]of[['sine',1,1],['triangle',2,.25]]){const o=ctx.createOscillator(),og=ctx.createGain();o.type=type;o.frequency.value=G.hz(m)*mul;og.gain.value=amp;o.connect(og).connect(lp);o.start(t);o.stop(t+dur+.1);}}};
/* cifras */
const NOTES={C:0,D:2,E:4,F:5,G:7,A:9,B:11};
G.parseChord=s=>{const m=/^([A-G])([#b]?)(.*)$/.exec(String(s).trim());if(!m)return null;let r=(NOTES[m[1]]+(m[2]==='#'?1:m[2]==='b'?-1:0)+12)%12;const q=m[3].split('/')[0];const minor=/^m(?!aj)/.test(q),sev=/7/.test(q),maj7=/maj7|7M/.test(q),dim=/dim|°/.test(q);
 const iv=dim?[0,3,6]:minor?[0,3,7]:[0,4,7];if(sev)iv.push(maj7?11:10);return{root:r,iv,name:s.trim()};};
G.voicing=(c,center=62)=>c.iv.map(i=>{let m=48+c.root+i;while(m<center-6)m+=12;while(m>center+6)m-=12;return m;}).sort((a,b)=>a-b);
G.peak=(buf)=>{let p=0;for(let c=0;c<buf.numberOfChannels;c++){const d=buf.getChannelData(c);for(let i=0;i<d.length;i+=4)p=Math.max(p,Math.abs(d[i]));}return p;};
G.normalize=(buf,target=.89)=>{const p=G.peak(buf);if(p>0&&p!==target){const k=target/p;for(let c=0;c<buf.numberOfChannels;c++){const d=buf.getChannelData(c);for(let i=0;i<d.length;i++)d[i]*=k;}}return buf;};
root.APSGen=G;})(window);
