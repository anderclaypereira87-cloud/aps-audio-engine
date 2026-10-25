import * as M from '../vendor/mediabunny-1.62.1.mjs';
import { MusicChromaExtractor } from './music-fingerprint.js';

/** Incremental audio decoding for chroma matching, independent of the RMS
 * envelope path. Input recordings stay on-device and are never modified.
 */
export async function readMusicFingerprint(file, { duration, base = 0, signal, progress = () => {} } = {}) {
  const input = new M.Input({ formats: M.ALL_FORMATS, source: new M.BlobSource(file, { maxCacheSize: 2 * 1048576 }) });
  try {
    const track = await input.getPrimaryAudioTrack();
    if (!track || !await track.canDecode()) throw Error('O vídeo precisa ter áudio de referência legível para reconhecer a música.');
    duration ??= await input.computeDuration();
    const extractor = new MusicChromaExtractor({ maxDuration: duration + .5 });
    for await (const sample of new M.AudioSampleSink(track).samples(Math.max(0, base), base + duration)) {
      try {
        signal?.throwIfAborted();
        const channels = [];
        for (let c = 0; c < sample.numberOfChannels; c++) {
          const pcm = new Float32Array(sample.numberOfFrames);
          sample.copyTo(pcm, { planeIndex: c, format: 'f32-planar' }); channels.push(pcm);
        }
        for (let i = 0; i < sample.numberOfFrames; i++) {
          let mono = 0;
          for (const pcm of channels) mono += pcm[i] / channels.length;
          extractor.add(mono, sample.timestamp - base + i / sample.sampleRate);
        }
        progress(Math.min(1, (sample.timestamp + sample.duration - base) / duration));
      } finally { sample.close(); }
    }
    signal?.throwIfAborted();
    return extractor.finish();
  } finally { input.dispose(); }
}
