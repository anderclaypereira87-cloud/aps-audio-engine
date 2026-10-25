import { inspectFile, readEnvelope, exportMedia } from './media-io.js';
import { analyzeAlignment } from '../aps-video-sync.js';

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
    else if (data.type === 'sync') {
      const reference = await readEnvelope(data.videoFile, { duration: data.videoInfo.duration, base: data.videoInfo.videoStart, signal, progress: f => progress({ stage: 'reference', fraction: f * 0.35 }) });
      const external = await readEnvelope(data.audioFile, { duration: data.audioInfo.duration, signal, progress: f => progress({ stage: 'audio', fraction: 0.35 + f * 0.35 }) });
      const alignment = analyzeAlignment(reference, external, { onProgress: f => progress({ stage: 'correlation', fraction: 0.7 + f * 0.3 }) });
      result = { alignment, reference, external };
    } else if (data.type === 'export') {
      result = await exportMedia({ ...data.options, signal, progress });
      if (!data.options.audioOnly && data.reference && data.options.source !== 'mute') {
        progress({ stage: 'verify', fraction: 0 });
        try {
          const exported = await readEnvelope(result.blob, { duration: result.duration, signal, progress: f => progress({ stage: 'verify', fraction: f }) });
          result.verification = analyzeAlignment(data.reference, exported, { maxOffset: 2 });
        } catch (e) { if (signal.aborted) throw e; result.verification = { accepted: false, reason: e.message }; }
      }
    } else throw Error('Operação desconhecida.');
    signal.throwIfAborted(); post({ type: 'result', result });
  } catch (e) { post({ type: signal.aborted ? 'cancelled' : 'error', message: e.message || String(e) }); }
  finally { controller = null; }
};
