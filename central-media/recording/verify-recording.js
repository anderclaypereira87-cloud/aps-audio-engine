import * as M from '../vendor/mediabunny-1.62.1.mjs';
import { LIMITS, signalLevel } from './recording-core.mjs';

/** Reopen the finished container, then decode samples from THAT file. */
export async function verifyRecording(file) {
  const input = new M.Input({ formats: M.ALL_FORMATS, source: new M.BlobSource(file, { maxCacheSize: 2 * 1048576 }) });
  try {
    const video = await input.getPrimaryVideoTrack(), audio = await input.getPrimaryAudioTrack();
    if (!video || !audio) throw Error('O arquivo reaberto não contém as duas faixas (vídeo e áudio). Baixe o original para conferir.');
    const [videoStart, audioStart, videoEnd, audioEnd] = await Promise.all([
      video.getFirstTimestamp(), audio.getFirstTimestamp(), video.computeDuration(), audio.computeDuration(),
    ]);
    const duration = Math.max(videoEnd, audioEnd) - Math.min(videoStart, audioStart);
    if (!Number.isFinite(duration) || duration <= 0) throw Error('A duração da gravação não pôde ser lida.');
    const report = {
      duration, videoCodec: video.codec, audioCodec: audio.codec,
      videoStart, audioStart, startDifferenceMs: (audioStart - videoStart) * 1000,
      endDifferenceMs: (audioEnd - videoEnd) * 1000, withinLimits: duration <= LIMITS.durationMs / 1000,
      decodedVideo: false, decodedAudio: false, rms: null, peak: null, decodeWarnings: [],
    };
    try {
      if (await video.canDecode()) {
        const sample = await new M.VideoSampleSink(video).getSample(videoStart + Math.min(0.1, duration / 4));
        if (sample) { report.decodedVideo = true; sample.close(); }
      }
    } catch (error) { report.decodeWarnings.push(`Vídeo: ${error.message}`); }
    try {
      if (await audio.canDecode()) {
        // A bounded beginning of the recording, without decoding ten minutes into RAM.
        let sum = 0, count = 0, peak = 0;
        for await (const sample of new M.AudioSampleSink(audio).samples(audioStart, Math.min(audioEnd, audioStart + 2))) {
          try {
            for (let channel = 0; channel < sample.numberOfChannels; channel++) {
              const data = new Float32Array(sample.numberOfFrames);
              sample.copyTo(data, { planeIndex: channel, format: 'f32-planar' });
              const level = signalLevel(data); sum += level.rms ** 2 * data.length; count += data.length;
              peak = Math.max(peak, level.peak);
            }
          } finally { sample.close(); }
        }
        report.decodedAudio = count > 0; report.rms = count ? Math.sqrt(sum / count) : 0; report.peak = peak;
      }
    } catch (error) { report.decodeWarnings.push(`Áudio: ${error.message}`); }
    return report;
  } finally { input.dispose(); }
}
