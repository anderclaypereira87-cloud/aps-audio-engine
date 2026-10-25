"""Independent FFmpeg/SciPy oracle: decode actual browser outputs; measure timing at start/middle/end."""
import json, pathlib, subprocess, sys
import numpy as np
from scipy.signal import correlate

root=pathlib.Path(sys.argv[1] if len(sys.argv)>1 else '/tmp/aps-media-fixtures')
def pcm(name):
    raw=subprocess.check_output(['ffmpeg','-v','error','-i',str(root/name),'-vn','-ac','1','-ar','8000','-f','f32le','-'])
    return np.frombuffer(raw,dtype='<f4')
def probe(name):
    return json.loads(subprocess.check_output(['ffprobe','-v','error','-show_streams','-show_format','-of','json',str(root/name)]))
def envelope(a):
    n=a.size//8
    return np.sqrt(np.mean(a[:n*8].reshape(-1,8)**2,axis=1))
report=[]
for name in ['250ms','1s','silence','advance','mp3','original','no-reference','1080p','drift-590s']:
    source='long-reference.mp4' if name=='drift-590s' else '1080.mp4' if name=='1080p' else 'reference.mp4'
    output='export-'+name+'.webm'
    info=probe(output); reference=envelope(pcm(source)); edited=envelope(pcm(output))
    duration=min(reference.size,edited.size)/1000
    centers=np.linspace(min(2,duration*.35),max(duration-min(2,duration*.35),duration*.65),3)
    lags=[]
    for center in centers:
        half=min(750,int(duration*1000*.2)); lo=int(center*1000)-half; hi=lo+2*half
        a=reference[lo:hi]; a=a-a.mean(); begin=max(0,lo-100); end=min(edited.size,hi+100)
        b=edited[begin:end]; b=b-b.mean()
        corr=correlate(b,a,mode='valid',method='fft')
        lag=begin+int(np.argmax(corr))-lo; lags.append(int(lag))
    v=next(s for s in info['streams'] if s['codec_type']=='video')
    a=next(s for s in info['streams'] if s['codec_type']=='audio')
    frame_json=json.loads(subprocess.check_output(['ffprobe','-v','error','-select_streams','v','-show_frames','-show_entries','frame=best_effort_timestamp_time','-of','json',str(root/output)]))
    times=np.array([float(f['best_effort_timestamp_time']) for f in frame_json['frames']])
    frame_ms=100 if name=='drift-590s' else 1000/30
    result={'case':name,'output':output,'duration_seconds':float(info['format']['duration']),'bytes':int(info['format']['size']),'video_codec':v['codec_name'],'audio_codec':a['codec_name'],'width':v['width'],'height':v['height'],'frames':len(times),'first_video_pts':float(times[0]),'last_video_pts':float(times[-1]),'audio_error_ms_start_middle_end':lags,'max_error_ms':max(map(abs,lags)),'one_frame_ms':frame_ms}
    assert result['max_error_ms']<=frame_ms,result
    assert abs(times[0])<=.001,result
    assert abs(float(info['format']['duration'])-(590 if name=='drift-590s' else 2 if name=='1080p' else 16))<frame_ms/1000+.03,result
    report.append(result)
wav=probe('export-wav.wav');assert wav['streams'][0]['codec_name']=='pcm_s16le'
muted=probe(next(root.glob('export-mute.*')).name);assert all(s['codec_type']!='audio' for s in muted['streams'])
(root/'export-verification.json').write_text(json.dumps(report,indent=2))
print(json.dumps(report,indent=2))
