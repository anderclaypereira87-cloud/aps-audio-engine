# Bateria SINTÉTICA com gabarito (tempo, peça, intensidade) para medir a detecção por peça.
# Uso: python3 tests/make_drum_fixture.py out.wav out.json [segundos]
import sys,json,numpy as np,wave
SR=44100;rng=np.random.default_rng(3);sec=float(sys.argv[3]) if len(sys.argv)>3 else 30
n=int(sec*SR);x=np.zeros(n);bpm=100;step=60/bpm/4
def snd(kind):
    L={'kick':.5,'floor':.7,'tom2':.5,'tom1':.45,'crash':1.6,'ride':1.4,'splash':.6,'open':.3}.get(kind,.25);t=np.arange(int(L*SR))/SR;r=rng.standard_normal(len(t));hp=np.diff(np.r_[0,r])
    if kind=='kick':return np.sin(2*np.pi*(50*t+60*(1-np.exp(-t*30))/30))*np.exp(-t*9)
    if kind=='snare':return .7*r*np.exp(-t*20)+.4*np.sin(2*np.pi*190*t)*np.exp(-t*25)
    if kind=='rim':return (.6*r+.6*np.sin(2*np.pi*410*t))*np.exp(-t*90)
    if kind in('tom1','tom2','floor'):f={'tom1':240,'tom2':160,'floor':95}[kind];return .9*np.sin(2*np.pi*(f*t+20*(1-np.exp(-t*30))/30))*np.exp(-t*7)+.05*r*np.exp(-t*30)
    if kind=='hat':return .35*hp*np.exp(-t*60)
    if kind=='open':return .3*hp*np.exp(-t*9)
    if kind=='ride':return .2*hp*np.exp(-t*1.8)+.15*np.sin(2*np.pi*3200*t)*np.exp(-t*3)
    if kind=='crash':return .45*hp*np.exp(-t*2.2)+.2*r*np.exp(-t*3)
    if kind=='splash':return .4*hp*np.exp(-t*6)
truth=[];k=0;tm=0.05
while tm<sec-1.7:
    b=k%16;bar=k//16;ev=[]
    fill=bar%4==3
    if not fill:
        if b in(0,8,10):ev.append(('kick',1))
        if b in(4,12):ev.append(('rim' if bar%4==2 and b==12 else 'snare',1))
        if b in(7,15):ev.append(('snare',.18))
        cym='ride' if 8<=bar%16<12 else 'hat'
        if b%2==0:ev.append(('open' if (cym=='hat' and b==14 and bar%2) else cym,1 if b%4==0 else .6))
    else:
        if b in(0,4):ev.append(('kick',1))
        if b in(0,4):ev.append(('hat',.8))
        if b in(8,9):ev.append(('tom1',1))
        if b in(10,11):ev.append(('tom2',1))
        if b in(12,13,14):ev.append(('floor',1))
    if b==0 and bar%4==0:ev.append(('crash',1))
    if b==0 and bar%8==6:ev.append(('splash',1))
    for p,v in ev:
        v=v*(0.85+0.3*rng.random());s=snd(p)*v*.5;i=int(tm*SR);e=min(n,i+len(s));x[i:e]+=s[:e-i];truth.append({'time':round(tm,5),'piece':p,'vel':round(v,3),'ghost':v<.3})
    k+=1;tm+=step
x/=np.abs(x).max()*1.12
with wave.open(sys.argv[1],'wb') as f:f.setnchannels(1);f.setsampwidth(2);f.setframerate(SR);f.writeframes((x*32767).astype('<i2').tobytes())
json.dump(truth,open(sys.argv[2],'w'));print(len(truth),'eventos')
