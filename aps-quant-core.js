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
function plan(buffer,events,options={}){
  const sr=buffer.sampleRate,bpm=clamp(Number(options.bpm)||100,40,240);
  const subdivision=[4,8,16,32].includes(Number(options.subdivision))?Number(options.subdivision):16;
  const interval=60/bpm*4/subdivision;
  const strength=clamp(Number(options.strength) / 100 || 0,0,1);
  const maxShift=Math.round(Math.min(.065,interval*.45)*sr);
  const lead=Math.round(.009*sr),minRegion=Math.round(.045*sr);
  const list=(events||[]).filter(e=>Number.isFinite(e.sample)&&e.sample>=0&&e.sample<buffer.length)
    .sort((a,b)=>a.sample-b.sample);
  if(!list.length)throw Error('Não encontrei ataques rítmicos nessa pista.');
  const selected=[list[0]];
  for(let i=1;i<list.length;i++)if(list[i].sample-selected[selected.length-1].sample>minRegion)selected.push(list[i]);
  const cuts=[0],kept=[selected[0]];
  for(let i=1;i<selected.length;i++){
    const cut=selected[i].sample-lead;
    if(cut-cuts[cuts.length-1]>=minRegion && cut<buffer.length-minRegion){
      cuts.push(cut);kept.push(selected[i]);
    }
  }
  cuts.push(buffer.length);
  const targets=options.manualTargets||{};
  const regions=[];
  let lastEnd=-1;
  for(let i=0;i<cuts.length-1;i++){
    const event=kept[i],onset=event.sample/sr;
    const custom=targets[event.index];
    const target=Number.isFinite(custom)?clamp(custom,0,buffer.duration):
      Math.max(0,Math.round(onset/interval)*interval);
    let offset=Math.round(clamp((target-onset)*strength*sr,-maxShift,maxShift));
    // Preserve the ordering of attacks and don't push an onset out of the clip.
    if(event.sample+offset<0)offset=-event.sample;
    if(event.sample+offset<=lastEnd)offset=lastEnd+1-event.sample;
    lastEnd=event.sample+offset;
    regions.push({start:cuts[i],end:cuts[i+1],onset:event.sample,index:event.index,offset,
      targetSample:event.sample+offset,rawTarget:target,detected:event.strength});
  }
  return {regions,events:kept,bpm,subdivision,interval,strength,frameLength:buffer.length,sampleRate:sr};
}
function render(buffer,edit,context){
  if(!edit||!edit.regions||buffer.length!==edit.frameLength)throw Error('O plano de edição não corresponde ao áudio.');
  const sr=buffer.sampleRate,n=buffer.length,ch=buffer.numberOfChannels;
  const output=context.createBuffer(ch,n,sr);
  const weights=new Float32Array(n);
  const inputs=Array.from({length:ch},(_,i)=>buffer.getChannelData(i));
  const outputs=Array.from({length:ch},(_,i)=>output.getChannelData(i));
  const fade=Math.max(12,Math.round(.006*sr));
  for(let i=0;i<edit.regions.length;i++){
    const r=edit.regions[i],a=r.start,b=r.end,shift=r.offset;
    const edgeL=i>0&&edit.regions[i-1].offset!==shift;
    const edgeR=i<edit.regions.length-1&&edit.regions[i+1].offset!==shift;
    for(let x=a;x<b;x++){
      const y=x+shift;
      if(y<0||y>=n)continue;
      // Equal-weight overlap normalization keeps stereo channels linked.
      const gain=Math.max(.001,Math.min(1,edgeL?(x-a+1)/fade:1,edgeR?(b-x)/fade:1));
      weights[y]+=gain;
      for(let c=0;c<ch;c++)outputs[c][y]+=inputs[c][x]*gain;
    }
  }
  let gaps=0,longest=0;
  for(let x=0;x<n;){
    if(weights[x]>0){const w=1/weights[x];for(let c=0;c<ch;c++)outputs[c][x]*=w;x++;continue;}
    const begin=x;while(x<n&&weights[x]===0)x++;
    const end=x,length=end-begin;gaps+=length;longest=Math.max(longest,length);
    const before=begin>0?begin-1:-1,after=end<n?end:-1;
    // Fill the join by interpolating adjacent *edited* samples. Never restore
    // the old attacks from the original track, which produces double hits.
    if(before>=0&&after>=0){
      for(let c=0;c<ch;c++){
        const l=outputs[c][before],r=outputs[c][after]/weights[after];
        for(let t=0;t<length;t++){
          const alpha=(t+1)/(length+1);
          const edgeFade=length>sr*.025?
            Math.min(1,(t+1)/(sr*.007),(length-t)/(sr*.007)):1;
          outputs[c][begin+t]=(l*(1-alpha)+r*alpha)*edgeFade;
        }
      }
    }
  }
  return {buffer:output,gapSamples:gaps,longestGapSeconds:longest/sr,
    moved:edit.regions.filter(r=>Math.abs(r.offset)>Math.round(.002*sr)).length};
}
global.APSQuantCore=Object.freeze({detect,plan,render});
})(typeof window!=='undefined'?window:globalThis);
