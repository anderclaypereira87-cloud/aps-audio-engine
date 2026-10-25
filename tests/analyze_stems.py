# Verifica stems: ffprobe (duração/formato), RMS (não silencioso), lag da correlação cruzada entre
# soma das pistas e a mistura, e SNR de cada pista contra a referência sintética (se existir).
# Uso: python3 tests/analyze_stems.py mix.wav stems_dir [ref_prefix]
import sys, json, subprocess, wave, numpy as np, os
def rd(p):
    with wave.open(p) as f: n=f.getnframes(); ch=f.getnchannels(); sr=f.getframerate(); x=np.frombuffer(f.readframes(n),'<i2').astype(np.float32)/32768
    x=x.reshape(-1,ch).mean(1); return x,sr
def probe(p):
    o=json.loads(subprocess.run(['ffprobe','-v','error','-show_entries','stream=codec_name,sample_rate,channels,duration','-of','json',p],capture_output=True,text=True).stdout)['streams'][0]; return o
mixp,d=sys.argv[1],sys.argv[2]; ref=sys.argv[3] if len(sys.argv)>3 else None
mix,sr=rd(mixp); ids=['bateria','baixo','outros','voz','guitarra','piano']; refk={'bateria':'drums','baixo':'bass','voz':'vocals','guitarra':'guitar','piano':'piano'}
rep={'mix_duration':len(mix)/sr,'stems':{}}; tot=None
for i in ids:
    p=os.path.join(d,i+'.wav'); x,ssr=rd(p); pr=probe(p)
    if ssr!=sr: x=np.interp(np.arange(len(mix))/sr, np.arange(len(x))/ssr, x).astype(np.float32)
    x=x[:len(mix)] if len(x)>=len(mix) else np.pad(x,(0,len(mix)-len(x)))
    tot=x if tot is None else tot+x
    e={'ffprobe':pr,'rms_dbfs':round(float(20*np.log10(np.sqrt((x**2).mean())+1e-12)),1)}
    if ref and i in refk and os.path.exists(f'{ref}_{refk[i]}.wav'):
        r,_=rd(f'{ref}_{refk[i]}.wav'); m=min(len(r),len(x)); e['snr_vs_ref_db']=round(10*np.log10((r[:m]**2).sum()/(((r[:m]-x[:m])**2).sum()+1e-12)),2)
    rep['stems'][i]=e
L=min(len(mix),sr*20); a=mix[:L]; b=tot[:L]; lags=range(-2000,2001)
cc=[float(np.dot(a[max(0,-k):L-max(0,k)],b[max(0,k):L-max(0,-k)])) for k in lags]
rep['sum_vs_mix_lag_samples']=list(lags)[int(np.argmax(cc))]
rep['sum_vs_mix_snr_db']=round(10*np.log10((mix**2).sum()/(((mix-tot)**2).sum()+1e-12)),2)
print(json.dumps(rep,indent=1,default=float))
