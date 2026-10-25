# Gera músicas de teste SINTÉTICAS com stems conhecidos (bateria, baixo, piano, voz-like, guitarra).
# Uso: python3 tests/make_fixtures.py OUTDIR 10 30 60 600
import sys, numpy as np, wave, os
SR=44100; rng=np.random.default_rng(7)
def w(path,x):
    x=np.clip(x,-1,1); d=(x.T*32767).astype('<i2') if x.ndim==2 else (x*32767).astype('<i2')
    with wave.open(path,'wb') as f:
        f.setnchannels(2 if x.ndim==2 else 1); f.setsampwidth(2); f.setframerate(SR); f.writeframes(d.tobytes())
def song(sec,bpm=100):
    n=int(sec*SR); t=np.arange(n)/SR; beat=60/bpm; step=beat/4
    drums=np.zeros(n); bass=np.zeros(n); keys=np.zeros(n); voc=np.zeros(n); gtr=np.zeros(n)
    def hit(buf,start,snd):
        s=int(start*SR); e=min(n,s+len(snd)); 
        if s<n: buf[s:e]+=snd[:e-s]
    tt=np.arange(int(.5*SR))/SR
    kick=np.sin(2*np.pi*(50*tt+40*(1-np.exp(-tt*30))/30))*np.exp(-tt*9)
    snare=(rng.standard_normal(len(tt))*.6*np.exp(-tt*22)+.3*np.sin(2*np.pi*190*tt)*np.exp(-tt*25))
    hh=np.diff(rng.standard_normal(int(.08*SR)+1))*.12*np.exp(-np.arange(int(.08*SR))/SR*60)
    roots=[55,55*4/3,55*1.5,55*1.2]
    k=0; tm=0.0
    while tm<sec:
        b=k%16; vel=.85+.15*rng.random()
        if b in(0,8,10): hit(drums,tm,kick*vel)
        if b in(4,12): hit(drums,tm,snare*vel)
        if b==7: hit(drums,tm,snare*.15)   # ghost note
        hit(drums,tm,hh*(1 if b%2==0 else .5))
        if b%4==0:
            f=roots[(k//16)%4]; d=np.arange(int(beat*SR))/SR
            hit(bass,tm,.5*np.sign(np.sin(2*np.pi*f*d))*np.exp(-d*2)*.6)
            ch=[f*4,f*5,f*6]; hit(keys,tm,sum(np.sin(2*np.pi*c*d)*np.exp(-d*3) for c in ch)*.12)
            hit(gtr,tm+step*2,sum(((2*((c*2*d)%1)-1))*np.exp(-d*5) for c in ch)*.06)
        k+=1; tm+=step
    f0=220*(1+.02*np.sin(2*np.pi*5*t))*np.where((t//(beat*2))%2==0,1,1.25)
    ph=2*np.pi*np.cumsum(f0)/SR
    voc=sum(np.sin(h*ph)/h for h in range(1,8))*.12*(0.5+0.5*np.sin(2*np.pi*t/(beat*4))**2)
    stems={'drums':drums*.6,'bass':bass,'piano':keys,'vocals':voc,'guitar':gtr}
    st={k:np.stack([v,v*.9]) for k,v in stems.items()}
    mix=sum(st.values()); peak=np.abs(mix).max(); g=.9/peak
    return mix*g,{k:v*g for k,v in st.items()}
out=sys.argv[1]; os.makedirs(out,exist_ok=True)
for s in sys.argv[2:]:
    sec=int(s); mix,st=song(sec)
    w(f'{out}/mix_{sec}s.wav',mix)
    if sec<=60:
        for k,v in st.items(): w(f'{out}/ref_{sec}s_{k}.wav',v)
    print('ok',sec)
