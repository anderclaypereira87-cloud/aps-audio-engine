"""Decode the actual downloaded test files with ffmpeg; report packet timing and signal."""
import array
import hashlib
import json
import math
import pathlib
import subprocess
import sys

folder = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else '/tmp/aps-recording-evidence')
reports = []
for file in sorted(folder.glob('*.webm')) + sorted(folder.glob('*.mp4')):
    metadata = json.loads(subprocess.check_output([
        'ffprobe', '-v', 'error', '-count_frames', '-show_streams', '-show_packets',
        '-show_entries', 'stream=index,codec_type,codec_name,width,height,sample_rate,channels,nb_read_frames:packet=stream_index,pts_time,duration_time', '-of', 'json', str(file),
    ]))
    streams = metadata['streams']
    assert {stream['codec_type'] for stream in streams} == {'video', 'audio'}
    assert all(int(stream['nb_read_frames']) > 0 for stream in streams)
    for stream in streams:
        packets = [p for p in metadata['packets'] if p['stream_index'] == stream['index'] and 'pts_time' in p]
        stream['firstPacketSeconds'] = min(float(p['pts_time']) for p in packets)
        stream['lastPacketEndSeconds'] = max(float(p['pts_time']) + float(p.get('duration_time', 0)) for p in packets)
    subprocess.run(['ffmpeg', '-v', 'error', '-i', str(file), '-f', 'null', '-'], check=True, capture_output=True)
    data = subprocess.check_output(['ffmpeg', '-v', 'error', '-i', str(file), '-t', '10', '-map', '0:a:0', '-f', 'f32le', '-'])
    pcm = array.array('f'); pcm.frombytes(data)
    rms = math.sqrt(sum(value * value for value in pcm) / max(1, len(pcm)))
    assert rms > 0.001, 'Expected an audible synthetic test tone in the recorded file'
    reports.append({'file': file.name, 'sha256': hashlib.sha256(file.read_bytes()).hexdigest(), 'bytes': file.stat().st_size, 'streams': streams, 'decodedAudioRms': rms, 'fullFileDecodePassed': True})
assert reports, 'No downloaded MediaRecorder files found'
(folder / 'file-evidence.json').write_text(json.dumps(reports, indent=2) + '\n')
print(json.dumps(reports, indent=2))
