import * as M from './vendor/mediabunny-1.62.1.mjs';
import { ENVELOPE_HZ, externalTime } from '../aps-video-sync.js';
import { AudioProcessor, outputDimensions, drawVideo } from '../aps-video-enhance.js';
import { scanCameraMotion } from './advanced/motion-scan.js';
import { scanMusician } from './advanced/pose-scan.js';

export const LIMITS = Object.freeze({ seconds: 600, fileBytes: 768 * 1048576, memoryOutputBytes: 96 * 1048576 });
export const openInput = file => new M.Input({ formats: M.ALL_FORMATS, source: new M.BlobSource(file, { maxCacheSize: 2 * 1048576 }) });
const check = signal => signal?.throwIfAborted();

export async function inspectFile(file) {
  if (!file?.size) throw Error('O arquivo está vazio.');
  if (file.size > LIMITS.fileBytes) throw Error('O arquivo excede 768 MB. Use uma cópia menor.');
  const input = openInput(file);
  try {
    const video = await input.getPrimaryVideoTrack(), audio = await input.getPrimaryAudioTrack();
    const start = video ? await video.getFirstTimestamp() : 0;
    const duration = video ? await video.computeDuration() - start : await input.computeDuration();
    if (!Number.isFinite(duration) || duration <= 0) throw Error('Não foi possível ler a duração.');
    if (duration > LIMITS.seconds + 0.05) throw Error('Duração maior que 10 minutos. Recorte uma cópia antes de editar.');
    const result = { duration, videoStart: start, hasVideo: !!video, hasAudio: !!audio, audioReadable: !!audio && await audio.canDecode(), videoReadable: !!video && await video.canDecode(), mime: await input.getMimeType(), videoCodec: video?.codec || null, audioCodec: audio?.codec || null, hdr: false };
    if (video) {
      result.width = await video.getDisplayWidth(); result.height = await video.getDisplayHeight();
      result.hdr = await video.hasHighDynamicRange();
      const metrics = await video.computeFrameRateMetrics({ targetPacketCount: 256 });
      result.fps = metrics.averageFrameRate || metrics.averagePacketRate || 30;
    }
    return result;
  } finally { input.dispose(); }
}

function copySample(sample) {
  const channels = [];
  for (let c = 0; c < sample.numberOfChannels; c++) {
    const data = new Float32Array(sample.numberOfFrames);
    sample.copyTo(data, { planeIndex: c, format: 'f32-planar' }); channels.push(data);
  }
  return { channels, timestamp: sample.timestamp, sampleRate: sample.sampleRate, duration: sample.duration };
}

/** Streaming energy envelope: fixed memory, timestamps retained, no whole-file PCM decode. */
export async function readEnvelope(file, { duration, base = 0, signal, progress = () => {} } = {}) {
  const input = openInput(file);
  try {
    const track = await input.getPrimaryAudioTrack();
    if (!track || !await track.canDecode()) throw Error('Áudio de referência ausente ou codec de áudio ilegível. Use o ajuste manual.');
    duration ??= await input.computeDuration();
    const sums = new Float64Array(Math.ceil(duration * ENVELOPE_HZ)), counts = new Uint32Array(sums.length);
    for await (const sample of new M.AudioSampleSink(track).samples(Math.max(0, base), base + duration)) {
      try {
        check(signal); const pcm = copySample(sample), channels = pcm.channels.length;
        for (let i = 0; i < sample.numberOfFrames; i++) {
          const bin = Math.floor((pcm.timestamp - base + i / pcm.sampleRate) * ENVELOPE_HZ);
          if (bin < 0 || bin >= sums.length) continue;
          let energy = 0;
          for (let c = 0; c < channels; c++) energy += pcm.channels[c][i] ** 2;
          sums[bin] += energy / channels; counts[bin]++;
        }
        progress(Math.min(1, (sample.timestamp + sample.duration - base) / duration));
      } finally { sample.close(); }
    }
    const envelope = Float32Array.from(sums, (v, i) => counts[i] ? Math.sqrt(v / counts[i]) : 0);
    check(signal); return envelope;
  } finally { input.dispose(); }
}

/** One rolling decode window, used for deterministic timestamp-based resampling. */
class PCMReader {
  constructor(track, start, end) {
    this.iter = new M.AudioSampleSink(track).samples(Math.max(0, start - 0.1), end);
    this.segments = []; this.done = false; this.end = -Infinity;
  }
  async window(start, end, signal) {
    this.segments = this.segments.filter(s => s.timestamp + s.duration >= start - 0.001);
    while (!this.done && this.end <= end + 0.001) {
      check(signal); const item = await this.iter.next();
      if (item.done) { this.done = true; break; }
      try {
        const pcm = copySample(item.value); this.segments.push(pcm); this.end = pcm.timestamp + pcm.duration;
      } finally { item.value.close(); }
    }
    return this.segments;
  }
  async close() { await this.iter.return(); this.segments = []; }
}

export async function* mappedAudio(file, { duration, offsetSeconds = 0, rate = 1, audioSettings = {}, signal, progress = () => {} }) {
  if (!Number.isFinite(offsetSeconds) || !Number.isFinite(rate) || Math.abs(offsetSeconds) > 600 || rate < 0.995 || rate > 1.005) throw Error('Deslocamento ou velocidade fora dos limites.');
  const input = openInput(file); let reader;
  try {
    const track = await input.getPrimaryAudioTrack();
    if (!track || !await track.canDecode()) throw Error('O codec de áudio não pode ser decodificado neste aparelho.');
    if (track.numberOfChannels > 2) throw Error('Use áudio mono ou estéreo para esta versão.');
    const sampleRate = 48000, channels = Math.max(1, track.numberOfChannels), total = Math.round(duration * sampleRate), block = 12000;
    const end = await track.computeDuration();
    const processor = new AudioProcessor(sampleRate, channels, audioSettings);
    reader = new PCMReader(track, externalTime(0, offsetSeconds, rate), end);
    for (let frame = 0; frame < total; frame += block) {
      check(signal);
      const length = Math.min(block, total - frame), t0 = externalTime(frame / sampleRate, offsetSeconds, rate);
      const t1 = externalTime((frame + length) / sampleRate, offsetSeconds, rate);
      const segments = t1 <= 0 || t0 > end ? [] : await reader.window(Math.max(0, t0), Math.min(end, t1), signal);
      const pcm = Array.from({ length: channels }, () => new Float32Array(length));
      let segment = 0;
      for (let i = 0; i < length; i++) {
        const time = externalTime((frame + i) / sampleRate, offsetSeconds, rate);
        while (segment < segments.length && segments[segment].timestamp + segments[segment].duration <= time) segment++;
        const current = segments[segment];
        if (!current || time < current.timestamp || time < 0 || time >= end) continue;
        const pos = (time - current.timestamp) * current.sampleRate, index = Math.floor(pos), fraction = pos - index;
        for (let c = 0; c < channels; c++) {
          const data = current.channels[c], next = segments[segment + 1];
          const v0 = data[index] || 0;
          const v1 = index + 1 < data.length ? data[index + 1] : next && Math.abs(next.timestamp - (current.timestamp + current.duration)) < 1 / current.sampleRate ? next.channels[c][0] : v0;
          pcm[c][i] = v0 + (v1 - v0) * fraction;
        }
      }
      processor.process(pcm);
      const planar = new Float32Array(length * channels);
      for (let c = 0; c < channels; c++) planar.set(pcm[c], c * length);
      const sample = new M.AudioSample({ data: planar, format: 'f32-planar', numberOfChannels: channels, sampleRate, timestamp: frame / sampleRate });
      yield { sample, clipped: processor.clipped, peak: processor.peak };
      progress((frame + length) / total);
    }
  } finally { await reader?.close(); input.dispose(); }
}

export async function encodingOptions(width, height, needsAudio = true) {
  const audio = { sampleRate: 48000, numberOfChannels: 2 };
  const video = { width, height, frameRate: 30 };
  const [avc, aac, vp9, opus] = await Promise.all([
    M.canEncodeVideo('avc', video), needsAudio ? M.canEncodeAudio('aac', audio) : true,
    M.canEncodeVideo('vp9', video), needsAudio ? M.canEncodeAudio('opus', audio) : true,
  ]);
  return { mp4: avc && aac, webm: vp9 && opus };
}

export async function removeTemp(name) {
  if (!name) return;
  try { const root = await navigator.storage.getDirectory(); const dir = await root.getDirectoryHandle('aps-media-temp'); await dir.removeEntry(name); } catch { /* Already removed or storage disabled. */ }
}

async function makeTarget(estimatedBytes, progress) {
  let dir, name;
  try {
    const root = await navigator.storage.getDirectory();
    dir = await root.getDirectoryHandle('aps-media-temp', { create: true });
    name = `render-${crypto.randomUUID()}`;
    const handle = await dir.getFileHandle(name, { create: true }), stream = await handle.createWritable();
    progress({ stage: 'storage', tempName: name });
    return { target: new M.StreamTarget(stream, { chunked: true, chunkSize: 1024 * 1024 }), tempName: name, blob: () => handle.getFile(), cleanup: () => removeTemp(name) };
  } catch {
    if (name) await removeTemp(name);
    if (estimatedBytes > LIMITS.memoryOutputBytes * 0.7) throw Error('Sem espaço temporário para esta exportação. Use menor resolução ou um trecho menor.');
    const target = new M.BufferTarget();
    target.on('write', ({ end }) => { if (end > LIMITS.memoryOutputBytes) throw Error('A exportação atingiu o limite de memória de 96 MB. Use menor resolução.'); });
    return { target, tempName: null, blob: async () => new Blob([target.buffer]), cleanup: async () => {} };
  }
}

/** Export off the playback clock. Audio and video timestamps share the same zero. */
export async function exportMedia({ videoFile, audioFile, source = 'external', offsetSeconds = 0, rate = 1, videoSettings = {}, audioSettings = {}, aspect = 'original', resolution = 'source', format = 'auto', audioOnly = false, signal, progress = () => {} }) {
  const info = await inspectFile(videoFile), input = openInput(videoFile);
  let target, output, audioIter, videoIter;
  try {
    check(signal);
    if (!info.hasVideo || !info.videoReadable) throw Error('O codec de vídeo não pode ser decodificado neste aparelho.');
    if (info.hdr) throw Error('Esta versão processa vídeo SDR. Converta uma cópia do vídeo HDR antes de corrigir a cor.');
    const dim = outputDimensions(info.width, info.height, aspect, resolution);
    let motionPlan = videoSettings.motionPlan || null;
    if (!audioOnly && Number(videoSettings.stabilization) > 0 && !motionPlan) {
      const scanInput = openInput(videoFile);
      try {
        progress({ stage: 'stabilize', fraction: 0 });
        motionPlan = await scanCameraMotion(scanInput, info, {
          signal, progress: f => progress({ stage: 'stabilize', fraction: Math.min(0.2, f * 0.2) }),
        });
      } finally { scanInput.dispose(); }
    }
    let framingPlan = videoSettings.framingPlan || null;
    if (!audioOnly && videoSettings.autoFrame && !framingPlan) {
      const scanInput = openInput(videoFile);
      try {
        progress({ stage: 'framing', fraction: 0 });
        framingPlan = await scanMusician(scanInput, info, { signal, progress: f => progress({ stage: 'framing', fraction: f }) });
      } finally { scanInput.dispose(); }
    }
    check(signal);
    const chosenAudio = source === 'external' ? audioFile : source === 'original' ? videoFile : null;
    if (source === 'external' && !audioFile) throw Error('Selecione o arquivo de áudio externo.');
    const supported = await encodingOptions(dim.width, dim.height, !!chosenAudio);
    if (!audioOnly) {
      if (format === 'auto') format = supported.mp4 ? 'mp4' : 'webm';
      if (!supported[format]) throw Error(`Codificação ${format.toUpperCase()} indisponível nesta resolução. Experimente WebM ou outro navegador.`);
    }
    const bitrate = resolution === '4k' ? 24e6 : Math.max(800000, dim.width * dim.height * 4);
    const memoryEstimateBytes = dim.width * dim.height * 4 * (2 + ((videoSettings.denoise || videoSettings.sharpness) ? 2 : 0));
    const storage = await navigator.storage?.estimate?.().catch(() => null);
    const estimatedOutputBytes = info.duration * (audioOnly ? 1536000 : bitrate + 192000) / 8 * 1.2;
    if (storage?.quota && Number.isFinite(storage.usage) && storage.quota - storage.usage < estimatedOutputBytes)
      throw Error('Espaço temporário estimado insuficiente. Escolha resolução menor, libere espaço ou edite um trecho mais curto.');
    target = await makeTarget(estimatedOutputBytes, progress);
    const outputFormat = audioOnly ? new M.WavOutputFormat() : format === 'mp4' ? new M.Mp4OutputFormat({ fastStart: 'fragmented' }) : new M.WebMOutputFormat();
    output = new M.Output({ format: outputFormat, target: target.target });
    const canvas = !audioOnly ? new OffscreenCanvas(dim.width, dim.height) : null;
    const videoSource = !audioOnly ? new M.CanvasSource(canvas, { codec: format === 'mp4' ? 'avc' : 'vp9', quality: new M.Quality({ bitrate }), keyFrameInterval: 2 }) : null;
    if (videoSource) output.addVideoTrack(videoSource);
    const audioSource = chosenAudio ? new M.AudioSampleSource({ codec: audioOnly ? 'pcm-s16' : format === 'mp4' ? 'aac' : 'opus', quality: new M.Quality({ bitrate: 192000 }) }) : null;
    if (audioSource) output.addAudioTrack(audioSource);
    if (audioOnly && !audioSource) throw Error('Escolha áudio externo ou original antes de enviar à DAW.');
    await output.start();
    let clipped = 0, peak = 0, audioEnd = 0, frames = 0, minFrame = Infinity;
    if (audioSource) audioIter = mappedAudio(chosenAudio, { duration: info.duration, offsetSeconds: source === 'original' ? -info.videoStart : offsetSeconds, rate: source === 'original' ? 1 : rate, audioSettings, signal });
    async function audioUntil(time) {
      while (audioIter && audioEnd < time - 1e-8) {
        check(signal); const next = await audioIter.next();
        if (next.done) { audioSource.close(); audioIter = null; break; }
        const { sample } = next.value;
        try { await audioSource.add(sample); audioEnd = sample.timestamp + sample.duration; clipped = next.value.clipped; peak = next.value.peak; } finally { sample.close(); }
      }
    }
    if (!audioOnly) {
      const track = await input.getPrimaryVideoTrack();
      videoIter = new M.CanvasSink(track, { poolSize: 1 }).canvases(info.videoStart, info.videoStart + info.duration);
      for await (const frame of videoIter) {
        check(signal);
        const timestamp = Math.max(0, frame.timestamp - info.videoStart), duration = Math.min(frame.duration, info.duration - timestamp);
        if (duration <= 0) continue;
        drawVideo(canvas, frame.canvas, frame.canvas.width, frame.canvas.height, { ...videoSettings, motionPlan, framingPlan, videoTime: timestamp });
        await videoSource.add(timestamp, duration);
        await audioUntil(timestamp + duration); frames++; minFrame = Math.min(minFrame, duration);
        progress({ stage: 'export', fraction: Math.min(0.98, 0.2 + (timestamp + duration) / info.duration * 0.78), frames });
      }
      if (!frames) throw Error('Nenhum quadro de vídeo foi decodificado.');
      videoSource.close();
    } else {
      while (audioIter) { await audioUntil(Math.min(info.duration + 1, audioEnd + 0.25)); progress({ stage: 'export', fraction: Math.min(0.98, audioEnd / info.duration * 0.98) }); }
    }
    await audioUntil(info.duration + 1); check(signal);
    progress({ stage: 'finalize', fraction: 0.99 }); await output.finalize(); check(signal);
    const blob = await target.blob();
    return { blob, tempName: target.tempName, mime: audioOnly ? 'audio/wav' : `video/${format}`, extension: audioOnly ? 'wav' : format, width: dim.width, height: dim.height, duration: info.duration, frames, minFrameSeconds: Number.isFinite(minFrame) ? minFrame : null, bytes: blob.size, clipped, peak,
      memoryEstimateBytes, memoryMeasurement: 'estimated-canvas-buffers-not-process-RSS', storageQuotaBytes: storage?.quota ?? null, storageAvailableBytes: Number.isFinite(storage?.usage) ? storage.quota - storage.usage : null,
      stabilization: motionPlan ? { kind: motionPlan.kind, samples: motionPlan.samples, coverage: motionPlan.coverage, requiredZoom: motionPlan.requiredZoom, applied: Number(videoSettings.stabilization) } : null,
      framing: videoSettings.autoFrame && framingPlan ? { kind: framingPlan.kind, model: framingPlan.model, version: framingPlan.version, modelLicense: framingPlan.modelLicense, coverage: framingPlan.coverage, samples: framingPlan.samples, note: framingPlan.note } : null };
  } catch (e) {
    await output?.cancel().catch(() => {}); await target?.cleanup(); throw e;
  } finally { await audioIter?.return(); await videoIter?.return(); input.dispose(); }
}
