"""Generate owned, deterministic fixtures, never user files. Requires numpy and ffmpeg."""
import pathlib, subprocess, sys, wave
import numpy as np

root = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else '/tmp/aps-media-fixtures')
root.mkdir(parents=True, exist_ok=True)
sr = 16000
def save(name, data):
    with wave.open(str(root / name), 'wb') as f:
        f.setnchannels(1); f.setsampwidth(2); f.setframerate(sr)
        f.writeframes((np.clip(data, -1, 1) * 32767).astype('<i2').tobytes())
def signal(seconds):
    rng = np.random.default_rng(6947)
    t = np.arange(round(seconds * sr)) / sr
    env = np.zeros(t.size, np.float32)
    p = 0.8
    while p < seconds - 0.3:
        p += rng.uniform(.13, .66); start = int(p * sr); n = min(int(.2 * sr), t.size - start)
        if n > 0: env[start:start+n] += rng.uniform(.15,.5) * np.exp(-np.arange(n) / (sr * rng.uniform(.015,.08)))
    return (env * (np.sin(2*np.pi*220*t) + .35*np.sin(2*np.pi*731*t))).astype(np.float32)
def warp(a, delay, rate=1):
    time = np.arange(int(min(599, len(a)/sr*rate+max(0,delay)) * sr)) / sr
    return np.interp((time-delay)/rate*sr, np.arange(a.size), a, left=0, right=0)
def ff(args):
    subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-y',*map(str,args)], check=True)
def video(wav, name, size, fps, duration, audio=True):
    args=['-f','lavfi','-i',f'testsrc2=size={size}:rate={fps}','-i',root/wav,'-t',duration,'-map','0:v']
    if audio: args += ['-map','1:a','-c:a','aac','-b:a','128k']
    args += ['-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-movflags','+faststart',root/name]
    ff(args)
a=signal(16); save('reference.wav',a)
for delay,name in [(.25,'offset-250ms.wav'),(1,'offset-1s.wav'),(3,'silence-3s.wav'),(-.25,'advance-250ms.wav')]: save(name,warp(a,delay))
ff(['-i',root/'offset-250ms.wav','-c:a','libmp3lame','-b:a','128k',root/'offset-250ms.mp3'])
video('reference.wav','reference.mp4','320x180',30,16)
video('reference.wav','no-reference.mp4','320x180',30,16,False)
video('reference.wav','1080.mp4','1920x1080',30,2)
long=signal(590); save('long-reference.wav',long); save('drift-1000ppm.wav',warp(long,.25,1.001))
video('long-reference.wav','long-reference.mp4','160x90',10,590)
print(root)
