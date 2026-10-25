import { inspectFile, readEnvelope, exportMedia, openInput } from './media-io.js';
import { analyzeAlignment } from '../aps-video-sync.js?v=wide-sync-preview-20261025';
import { scanCameraMotion } from './advanced/motion-scan.js';
import { scanMusician } from './advanced/pose-scan.js';
import { readMusicFingerprint } from './advanced/read-music-fingerprint.js';
import { analyzeMusicalAlignment } from './advanced/music-fingerprint.js';

let controller;
const post = data => self.postMessage(data);
self.onmessage = async ({ data }) => {
  if (data.type === 'cancel') { controller?.abort(); return; }
  if (controller) return;
  controller = new AbortController();
  const signal = controller.signal;
  let last = 0;
  const progress = value => {
    const now = performance.now();
    if (value.tempName || now - last > 100 || value.fraction >= 0.99) { post({ type: 'progress', ...value }); last = now; }
  };
  try {
    let result;
    if (data.type === 'inspect') result = await inspectFile(data.file);
    else if (data.type === 'stabilize') {
      const input = openInput(data.videoFile);
      try {
        result = await scanCameraMotion(input, data.videoInfo, { signal, progress: f => progress({ stage: 'stabilize', fraction: f }) });
      } finally { input.dispose(); }
    }
    else if (data.type === 'frame') {
      const input = openInput(data.videoFile);
      try {
        result = await scanMusician(input, data.videoInfo, { signal, progress: f => progress({ stage: 'framing', fraction: f }) });
      } finally { input.dispose(); }
    }
    else if (data.type === 'sync') {
      const reference = await readEnvelope(data.videoFile, { duration: data.videoInfo.duration, base: data.videoInfo.videoStart, signal, progress: f => progress({ stage: 'reference', fraction: f * 0.35 }) });
      const external = await readEnvelope(data.audioFile, { duration: data.audioInfo.duration, signal, progress: f => progress({ stage: 'audio', fraction: 0.35 + f * 0.35 }) });
      let alignment = analyzeAlignment(reference, external, { onProgress: f => progress({ stage: 'correlation', fraction: 0.7 + f * 0.12 }) });
      if (!alignment.accepted && data.videoInfo.duration > 5 && data.audioInfo.duration > 5) {
        // Fallback when different recordings have recognizably similar chords
        // but dissimilar volume envelopes or >0.5% tempo divergence.
        const videoMusic = await readMusicFingerprint(data.videoFile, { duration: data.videoInfo.duration, base: data.videoInfo.videoStart, signal,
          progress: f => progress({ stage: 'music-reference', fraction: 0.82 + f * .06 }) });
        const externalMusic = await readMusicFingerprint(data.audioFile, { duration: data.audioInfo.duration, signal,
          progress: f => progress({ stage: 'music-audio', fraction: 0.88 + f * .06 }) });
        const musical = analyzeMusicalAlignment(videoMusic, externalMusic, { onProgress: f => progress({ stage: 'music-match', fraction: 0.94 + f * .06 }) });
        if (musical.accepted) alignment = musical;
      }
      result = { alignment, reference, external };
    } else if (data.type === 'export') {
      result = await exportMedia({ ...data.options, signal, progress });
      progress({ stage: 'validate', fraction: 0 });
      try {
        const actual = await inspectFile(result.blob);
        result.measuredContainer = { mime: actual.mime, videoCodec: actual.videoCodec, audioCodec: actual.audioCodec, durationSeconds: actual.duration,
          durationDifferenceSeconds: actual.duration - result.duration, width: actual.width || null, height: actual.height || null };
      } catch (e) {
        if (signal.aborted) throw e;
        result.measuredContainer = { unavailable: e.message };
      }
      if (!data.options.audioOnly && data.reference && data.options.source !== 'mute') {
        progress({ stage: 'verify', fraction: 0 });
        try {
          const exported = await readEnvelope(result.blob, { duration: result.duration, signal, progress: f => progress({ stage: 'verify', fraction: f }) });
          result.verification = analyzeAlignment(data.reference, exported, { maxOffset: 2 });
          if (!result.verification.accepted && Math.abs(data.options.rate - 1) > .005) {
            // Musical evidence survives a different mix/tempo more often than
            // RMS envelopes; do not label this 150ms analysis frame-accurate.
            const videoInfo = await inspectFile(data.options.videoFile);
            const first = await readMusicFingerprint(data.options.videoFile, { duration: videoInfo.duration, base: videoInfo.videoStart, signal });
            const second = await readMusicFingerprint(result.blob, { duration: result.duration, signal });
            const musical = analyzeMusicalAlignment(first, second, { maxOffset: 2 });
            if (musical.accepted) result.verification = musical;
          }
        } catch (e) { if (signal.aborted) throw e; result.verification = { accepted: false, reason: e.message }; }
      }
    } else throw Error('Operação desconhecida.');
    signal.throwIfAborted(); post({ type: 'result', result });
  } catch (e) { post({ type: signal.aborted ? 'cancelled' : 'error', message: e.message || String(e) }); }
  finally { controller = null; }
};
