import numpy as np, sys, wave, struct
sr=48000; mins=float(sys.argv[1]); out=sys.argv[2]; bits=int(sys.argv[3]); bpm=100
beat=60/bpm; chords=[(60,[0,4,7]),(57,[0,3,7]),(53,[0,4,7]),(55,[0,4,7])]
dur=int(mins*60*sr); total_chords=int(mins*60/(4*beat))+1
def chunk(t0,n):
    t=(np.arange(n)+t0)/sr; y=np.zeros(n)
    ci=(t//(4*beat)).astype(int)%4
    for k,(root,iv) in enumerate(chords):
        m=ci==k
        if not m.any(): continue
        tt=t[m]; s=np.zeros(m.sum())
        for d in iv:
            for mi in (root+d, root+d+12):
                f=440*2**((mi-69)/12)
                for h in (1,2,3): s+=np.sin(2*np.pi*f*h*tt)/h/2
        f=440*2**((root-24-69)/12); s+=1.2*np.sin(2*np.pi*f*tt)
        ph=(tt%beat)/beat; env=np.exp(-ph*2.5)*0.7+0.3; y[m]=s*env
    return y
w=wave.open(out,'wb'); w.setnchannels(2); w.setsampwidth(bits//8); w.setframerate(sr)
B=sr*30; 
for a in range(0,dur,B):
    n=min(B,dur-a); y=chunk(a,n); y=y/6; 
    L=y; R=y*0.9
    if bits==16:
        arr=np.stack([L,R],1); w.writeframes((np.clip(arr,-1,1)*32767).astype('<i2').tobytes())
    else:
        arr=(np.clip(np.stack([L,R],1),-1,1)*8388607).astype('<i4'); b=arr.tobytes(); bs=np.frombuffer(b,dtype=np.uint8).reshape(-1,4)[:,:3]; w.writeframes(bs.tobytes())
w.close()
