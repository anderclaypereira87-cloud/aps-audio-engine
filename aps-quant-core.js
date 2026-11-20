/* APS Quant Pro v1 — time-domain slice editor, no playback-rate or pitch resampling.
 * Local-only; no API, recording upload or paid processing.
 */
(function(global){
'use strict';
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
function detect(buffer){
  if(!buffer||!buffer.length||!buffer.sampleRate)throw Error('Selecione uma pista de áudio.');
  const sr=buffer.sampleRate,hop=Math.max(64,Math.round(sr/200)),frames=Math.ceil(buffer.length/hop),ch=buffer.numberOfChannels;
  const energy=new Float32Array(frames),rise=new Float32Array(frames);
  let max=0,mean=0;
  for(let k=0;k<frames;k++){
    const start=k*hop,end=Math.min(buffer.length,start+hop);
    let sum=0,count=0;
    for(let c=0;c<ch;c++){
      const data=buffer.getChannelData(c);
      for(let n=start;n<end;n+=4){sum+=data[n]*data[n];count++;}
    }
    energy[k]=Math.sqrt(sum/Math.max(1,count));
    max=Math.max(max,energy[k]);
  }
  if(max<0.001)return [];
  for(let k=2;k<frames;k++){
    const baseline=(energy[k-1]+energy[k-2])/2;
    rise[k]=Math.max(0,energy[k]-baseline);
    mean+=rise[k];
  }
  mean/=frames;
  const spacing=Math.max(1,Math.round(.067*sr/hop));
  const candidates=[];
  for(let k=3;k<frames-1;k++){
    const threshold=Math.max(.0015,mean*1.85,max*.014);
    if(energy[k]<max*.045||rise[k]<threshold||rise[k]<rise[k-1]||rise[k]<rise[k+1])continue;
    const prev=candidates[candidates.length-1];
    if(prev&&k-prev.frame<spacing){
      if(rise[k]>prev.peak)candidates[candidates.length-1]={frame:k,peak:rise[k]};
    }else candidates.push({frame:k,peak:rise[k]});
  }
  return candidates.slice(0,4000).map((v,i)=>({index:i,sample:clamp(v.frame*hop-Math.round(.004*sr),0,buffer.length-1),strength:v.peak}));
}
function plan(buffer,events,opts={}){
 const sr=buffer.sampleRate,bpm=clamp(Number(opts.bpm)||100,40,240);
 const sub=[4,8,16,32].includes(Number(opts.subdivision))?Number(opts.subdivision):16;
 const unit=60/bpm*4/sub,strength=clamp(Number(opts.strength??65)/100,0,1);
 const limit=Math.round(clamp(Number(opts.maxShiftMs??65),10,120)*sr/1000),lead=Math.round(.010*sr),minLength=Math.round(.035*sr);
 const list=[...(events||[])].filter(e=>Number.isInteger(e.sample)&&e.sample>=0&&e.sample<buffer.length).sort((a,b)=>a.sample-b.sample);
 if(!list.length)throw Error("Nenhum ataque rítmico detectado.");
 const targets=opts.manualTargets||{},regions=[];let lastCut=0,lastTarget=-1;
 for(const e of list){
  const cut=e.sample-lead;if(cut-lastCut<minLength||cut>=buffer.length-minLength)continue;
  if(regions.length)regions[regions.length-1].end=cut;
  else regions.push({start:0,end:cut,onset:null,offset:0,index:null});
  const manual=targets[e.index],onset=e.sample/sr;
  const target=Number.isFinite(manual)?clamp(manual,0,buffer.duration):Math.round(onset/unit)*unit;
  const desired=(target-onset)*(Number.isFinite(manual)?1:strength);
  let offset=Math.round(clamp(desired*sr,-limit,limit));
  if(e.sample+offset<0)offset=-e.sample;
  if(e.sample+offset<=lastTarget)offset=lastTarget+1-e.sample;
  lastTarget=e.sample+offset;
  regions.push({start:cut,end:buffer.length,onset:e.sample,index:e.index,offset,targetSample:e.sample+offset,rawTarget:target});
  lastCut=cut;
 }
 if(regions.length<2)throw Error("Não há ataques suficientemente separados para cortar.");
 return {regions,events:list,frameLength:buffer.length,sampleRate:sr,bpm,subdivision:sub,interval:unit,strength};
}
function render(buffer,edit,context){
 if(!edit?.regions||edit.frameLength!==buffer.length||edit.sampleRate!==buffer.sampleRate)throw Error("Plano incompatível com o áudio.");
 const sr=buffer.sampleRate,n=buffer.length,ch=buffer.numberOfChannels,result=context.createBuffer(ch,n,sr);
 const inputs=Array.from({length:ch},(_,c)=>buffer.getChannelData(c)),outputs=Array.from({length:ch},(_,c)=>result.getChannelData(c));
 const weights=new Float32Array(n),fade=Math.max(12,Math.round(.006*sr));
 for(let i=0;i<edit.regions.length;i++){
  const r=edit.regions[i],left=i>0&&edit.regions[i-1].offset!==r.offset,right=i<edit.regions.length-1&&edit.regions[i+1].offset!==r.offset;
  for(let x=r.start;x<r.end;x++){
   const y=x+r.offset;if(y<0||y>=n)continue;
   const w=Math.max(.0001,Math.min(1,left?(x-r.start+1)/fade:1,right?(r.end-x)/fade:1));
   weights[y]+=w;for(let c=0;c<ch;c++)outputs[c][y]+=inputs[c][x]*w;
  }
 }
 for(let x=0;x<n;x++)if(weights[x])for(let c=0;c<ch;c++)outputs[c][x]/=weights[x];
 let gaps=0,longest=0;
 for(let x=0;x<n;){
  if(weights[x]){x++;continue;}
  const begin=x;while(x<n&&!weights[x])x++;const size=x-begin;gaps+=size;longest=Math.max(longest,size);
  const ramp=Math.max(1,Math.min(Math.round(.006*sr),Math.floor(size/2)));
  for(let c=0;c<ch;c++){
   const left=begin>0?outputs[c][begin-1]:0,right=x<n?outputs[c][x]:0;
   for(let j=0;j<size;j++)outputs[c][begin+j]=j<ramp?left*(1-(j+1)/ramp):j>=size-ramp?right*(j-(size-ramp)+1)/ramp:0;
  }
 }
 return {buffer:result,gapSamples:gaps,longestGapSeconds:longest/sr,moved:edit.regions.filter(r=>Math.abs(r.offset)>.002*sr).length};
}
global.APSQuantCore=Object.freeze({detect,plan,render});
})(typeof window!=='undefined'?window:globalThis);
