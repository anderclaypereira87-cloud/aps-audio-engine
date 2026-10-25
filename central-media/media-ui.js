import { drawVideo, outputDimensions, VIDEO_DEFAULTS, AUDIO_DEFAULTS } from '../aps-video-enhance.js';
import { externalTime, correlate, ENVELOPE_HZ } from '../aps-video-sync.js';
import { encodingOptions, removeTemp } from './media-io.js';

const $ = id => document.getElementById(id), video = $('sync-preview'), audio = $('sync-external');
const state = { videoFile: null, audioFile: null, videoInfo: null, audioInfo: null, alignment: null, reference: null, external: null, motionPlan: null, nativePreviewShift: 0, nativePreviewReady: true, listen: 'after', busy: false, urls: {}, temps: new Set(), report: null };
let active = null, graph = null, graphPromise = null, drawing = false, probeId = 0;
const status = (message, error = false) => { $('media-status').textContent = message; $('media-status').classList.toggle('bad', error); };
const settings = kind => Object.fromEntries([...document.querySelectorAll(`[data-${kind}]`)].map(el => [el.dataset[kind], el.type === 'checkbox' ? el.checked : Number(el.value)]));
const offset = () => { const n = Number($('sync-offset').value); if (!Number.isFinite(n) || Math.abs(n) > 600000) throw Error('Informe um deslocamento entre −600000 e 600000 ms.'); return n / 1000; };
const rate = () => $('sync-drift').checked && state.alignment?.accepted ? state.alignment.rate : 1;
const stageNames = { reference: 'Lendo referência do vídeo', audio: 'Lendo áudio externo', correlation: 'Comparando transientes e marcadores', stabilize: 'Rastreando pontos para estabilização convencional', export: 'Codificando o arquivo', finalize: 'Finalizando o contêiner', validate: 'Conferindo contêiner e duração exportados', verify: 'Medindo o áudio do arquivo exportado', storage: 'Preparando espaço temporário' };

function readiness() {
  const valid = !!state.videoInfo?.videoReadable && !state.videoInfo.hdr && ($('sync-source').value !== 'original' || state.videoInfo.audioReadable);
  $('sync-analyze').disabled = state.busy || !state.videoFile || !state.audioFile;
  $('motion-analyze').disabled = state.busy || !state.videoInfo?.videoReadable;
  $('media-export').disabled = state.busy || !valid || ($('sync-source').value === 'external' && !state.audioInfo?.audioReadable);
  $('media-to-daw').disabled = state.busy || !valid || $('sync-source').value === 'mute' || ($('sync-source').value === 'external' && !state.audioInfo?.audioReadable);
  $('media-controls').disabled = state.busy; $('media-export-controls').disabled = state.busy;
  $('listen-before').disabled = state.busy || !state.videoFile; $('listen-after').disabled = state.busy || !state.videoFile;
  $('media-cancel').disabled = !state.busy;
}

function job(type, data = {}) {
  if (active) return Promise.reject(Error('Aguarde a operação atual ou cancele.'));
  const jobTemps = new Set();
  state.busy = true; video.pause(); audio.pause(); readiness(); $('media-progress').value = 0;
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./media-worker.js', import.meta.url), { type: 'module' });
    let timeout, settled = false, cancelled = false;
    const finish = (error, result) => {
      if (settled) return; settled = true; clearTimeout(timeout); worker.terminate(); active = null;
      state.busy = false; readiness(); if (error) reject(error); else { $('media-progress').value = 1; resolve(result); }
    };
    active = { cancel() { if (cancelled) return; cancelled = true; worker.postMessage({ type: 'cancel' }); status('Cancelando e liberando recursos…'); timeout = setTimeout(() => finish(new DOMException('Operação cancelada.', 'AbortError')), 4000); } };
    worker.onmessage = ({ data: message }) => {
      if (message.tempName) { state.temps.add(message.tempName); jobTemps.add(message.tempName); }
      if (message.type === 'progress') {
        if (Number.isFinite(message.fraction)) $('media-progress').value = message.fraction;
        if (!cancelled) status(`${stageNames[message.stage] || 'Processando'}${Number.isFinite(message.fraction) ? ` · ${Math.round(message.fraction * 100)}%` : '…'}`);
      } else if (message.type === 'result') finish(cancelled ? new DOMException('Operação cancelada.', 'AbortError') : null, message.result);
      else finish(message.type === 'cancelled' ? new DOMException('Operação cancelada.', 'AbortError') : Error(message.message));
    };
    worker.onerror = e => finish(Error(`Falha no processamento local: ${e.message || 'Worker indisponível neste navegador.'}`));
    worker.postMessage({ type, ...data });
  }).catch(async e => {
    for (const name of jobTemps) { await removeTemp(name); state.temps.delete(name); }
    throw e;
  });
}

function error(e) { const cancelled = e.name === 'AbortError' && e.message === 'Operação cancelada.'; status(cancelled ? 'Operação cancelada. Os originais foram preservados.' : (e.message || String(e)), !cancelled); }
function url(key, blob) { if (state.urls[key]) URL.revokeObjectURL(state.urls[key]); state.urls[key] = URL.createObjectURL(blob); return state.urls[key]; }
async function clearResult() {
  $('media-final-preview').pause(); $('media-final-preview').removeAttribute('src'); $('media-final-preview').load();
  $('media-render-result').hidden = true; $('media-download').hidden = true; $('media-wav-download').hidden = true; state.report = null;
  for (const name of state.temps) await removeTemp(name); state.temps.clear();
  for (const key of ['render', 'wav', 'report']) if (state.urls[key]) { URL.revokeObjectURL(state.urls[key]); delete state.urls[key]; }
}
function resetAlignment() {
  state.alignment = null; state.reference = null; state.external = null;
  $('sync-offset').value = '0'; $('sync-drift').checked = false; $('sync-drift').disabled = true;
  $('sync-result').textContent = 'Alinhamento zerado. Use correlação automática ou ajuste manual.';
  $('drift-note').textContent = 'Velocidade original.'; drawWave(); syncPlayback(true);
}

async function selectFile(kind, file) {
  if (!file) return; const meta = $(`${kind}-meta`);
  const info = await job('inspect', { file });
  if (kind === 'video' && !info.hasVideo) throw Error('Selecione um arquivo que contenha vídeo.');
  if (kind === 'audio' && !info.hasAudio) throw Error('O arquivo selecionado não contém uma faixa de áudio.');
  await clearResult(); resetAlignment();
  state[`${kind}File`] = file; state[`${kind}Info`] = info;
  if (kind === 'video') { state.motionPlan = null; $('motion-result').textContent = 'Estabilização desligada ou ainda não analisada.'; }
  const player = kind === 'video' ? video : audio; player.src = url(kind, file); player.load();
  if (kind === 'audio') {
    state.nativePreviewShift = 0; state.nativePreviewReady = !/\.mp3$/i.test(file.name) && file.type !== 'audio/mpeg';
    $('preview-note').textContent = state.nativePreviewReady ? 'A prévia usa o relógio do player. O arquivo final usa timestamps de áudio e vídeo.' : 'MP3: sincronize para calibrar o atraso do codec na prévia. Sem calibração, confira o áudio no arquivo exportado ou use WAV.';
  }
  meta.textContent = `${file.name} · ${info.duration.toFixed(2)} s · ${(file.size / 1048576).toFixed(1)} MB · ${info.mime}`;
  if (kind === 'video' && !info.audioReadable) $('sync-result').textContent = 'Vídeo sem áudio de referência legível. A sincronização automática está indisponível; use o ajuste manual.';
  status(info.hdr ? 'Vídeo HDR: converta uma cópia para SDR antes da exportação.' : 'Arquivo selecionado. Ajuste a sincronização e confira a prévia.', info.hdr);
  readiness(); drawPreview(); await capabilities();
}

async function synchronize() {
  if (!state.videoInfo?.audioReadable) throw Error('O vídeo não possui áudio de referência legível. Ajuste manualmente pelos controles em milissegundos.');
  if (!state.audioInfo?.audioReadable) throw Error('O codec do áudio externo é ilegível neste aparelho. Use uma cópia WAV ou MP3.');
  const result = await job('sync', { videoFile: state.videoFile, audioFile: state.audioFile, videoInfo: state.videoInfo, audioInfo: state.audioInfo });
  state.alignment = result.alignment; state.reference = result.reference; state.external = result.external;
  await calibrateNativePreview();
  const a = result.alignment;
  if (!a.accepted) { $('sync-result').textContent = a.reason; status('Não foi aplicado alinhamento automático. Use o ajuste manual.', true); }
  else {
    $('sync-offset').value = (a.offsetSeconds * 1000).toFixed(2);
    $('sync-drift').disabled = !a.driftDetected; $('sync-drift').checked = false;
    $('sync-result').textContent = `Deslocamento: ${(a.offsetSeconds * 1000).toFixed(1)} ms · Correlação: ${a.confidence.toFixed(3)}\n${a.points.length} marcadores · Resíduo máximo: ${(a.residualSeconds * 1000).toFixed(1)} ms · Resolução de análise: 5 ms`;
    $('drift-note').textContent = a.driftDetected ? `Desvio estimado: ${a.driftPpm.toFixed(0)} ppm · ${(a.driftSeconds * 1000).toFixed(1)} ms no final. Ative a correção para compensar.` : 'Nenhum desvio progressivo significativo foi medido.';
    status('Deslocamento aplicado. Confira início, meio e final antes de exportar.');
  }
  drawWave(); syncPlayback(true);
}

async function scanMotion() {
  if (!state.videoFile || !state.videoInfo?.videoReadable) throw Error('Selecione primeiro um vídeo decodificável.');
  const file = state.videoFile;
  const plan = await job('stabilize', { videoFile: file, videoInfo: state.videoInfo });
  if (file !== state.videoFile) return;
  state.motionPlan = plan;
  $('motion-result').textContent = `${plan.samples} quadros amostrados · ${Math.round(plan.coverage * 100)}% de vetores confiáveis · recorte mínimo estimado ${((plan.requiredZoom - 1) * 100).toFixed(1)}%.${plan.requiredZoom > 1.4 ? ' Movimento excede o recorte seguro; correção parcial nas bordas.' : ''}`;
  status('Rastreamento convencional analisado. Ajuste a intensidade e compare a imagem.');
  drawPreview();
}

/** MP3's native player can trim encoder delay differently from WebCodecs.
 * Measure the difference from a bounded prefix; never assume a fixed codec delay.
 */
async function calibrateNativePreview() {
  const file = state.audioFile;
  if (!file || (!/\.mp3$/i.test(file.name) && file.type !== 'audio/mpeg')) return;
  state.nativePreviewReady = false;
  try {
    const size = Math.min(file.size, 512 * 1024, Math.max(64 * 1024, Math.ceil(file.size * 6 / state.audioInfo.duration)));
    const context = new OfflineAudioContext(1, 1, 24000);
    const pcm = await context.decodeAudioData(await file.slice(0, size).arrayBuffer());
    const seconds = Math.min(10, pcm.duration), n = Math.floor(seconds * ENVELOPE_HZ), native = new Float32Array(n);
    const channels = Array.from({ length: pcm.numberOfChannels }, (_, c) => pcm.getChannelData(c));
    for (let bin = 0; bin < n; bin++) {
      const start = Math.floor(bin * pcm.sampleRate / ENVELOPE_HZ), end = Math.floor((bin + 1) * pcm.sampleRate / ENVELOPE_HZ); let sum = 0;
      for (const channel of channels) for (let i = start; i < end; i++) sum += channel[i] ** 2;
      native[bin] = Math.sqrt(sum / Math.max(1, (end - start) * channels.length));
    }
    const peak = correlate(state.external.subarray(0, n), native, -50, 50, 20);
    if (file !== state.audioFile) return;
    if (peak.score < 0.8 || peak.prominence < 0.04) throw Error('Prefixo sem marcadores confiáveis.');
    state.nativePreviewShift = peak.lag / ENVELOPE_HZ; state.nativePreviewReady = true;
    $('preview-note').textContent = `Atraso do player MP3 calibrado por correlação: ${(state.nativePreviewShift * 1000).toFixed(0)} ms. Confira também o arquivo exportado.`;
  } catch {
    if (file === state.audioFile) $('preview-note').textContent = 'Não foi possível calibrar o player MP3. O áudio externo da prévia está pausado; confira o arquivo exportado ou selecione WAV. A exportação usa o áudio realmente decodificado.';
  }
}

function drawWave() {
  const canvas = $('sync-wave'), ctx = canvas.getContext('2d'); ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!state.reference || !state.videoInfo) return;
  const duration = state.videoInfo.duration;
  for (const [envelope, color, mapped] of [[state.reference, '#6fbad1', false], [state.external, '#e0b867', true]]) {
    let max = 0; for (const v of envelope) max = Math.max(max, v); if (!max) continue;
    ctx.beginPath(); ctx.strokeStyle = color;
    for (let x = 0; x < canvas.width; x++) {
      const t = duration * x / canvas.width, sample = mapped ? externalTime(t, Number($('sync-offset').value) / 1000, rate()) : t;
      const i = Math.round(sample * 200), value = envelope[i] || 0, y = canvas.height - 8 - value / max * 95;
      if (!x) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    } ctx.stroke();
  }
  ctx.strokeStyle = '#aec3a455';
  for (const p of state.alignment?.points || []) { const x = p.video / duration * canvas.width; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke(); }
}

async function setupGraph() {
  if (graph) { await graph.ctx.resume(); return; }
  if (!graphPromise) graphPromise = (async () => {
    const ctx = new AudioContext();
    if (!ctx.audioWorklet) throw Error('AudioWorklet indisponível: use outro navegador para ouvir os efeitos da edição.');
    await ctx.audioWorklet.addModule(new URL('./audio-preview-worklet.js', import.meta.url));
    const dsp = new AudioWorkletNode(ctx, 'aps-media-audio', { outputChannelCount: [2], processorOptions: settings('audio') });
    const native = ctx.createGain(), edited = ctx.createGain(), ext = ctx.createGain();
    native.gain.value = edited.gain.value = ext.gain.value = 0;
    const vs = ctx.createMediaElementSource(video), as = ctx.createMediaElementSource(audio);
    vs.connect(native).connect(ctx.destination); vs.connect(edited).connect(dsp); as.connect(ext).connect(dsp); dsp.connect(ctx.destination);
    graph = { ctx, dsp, native, edited, ext }; video.muted = false; audio.muted = false;
    await ctx.resume();
  })();
  await graphPromise;
}

function route() {
  const original = state.listen === 'before', source = $('sync-source').value;
  if (graph) {
    graph.native.gain.value = original ? 1 : 0;
    graph.edited.gain.value = !original && source === 'original' ? 1 : 0;
    graph.ext.gain.value = !original && source === 'external' ? 1 : 0;
  } else video.muted = !original && source !== 'original';
}

function syncPlayback(force = false) {
  route();
  if (!state.videoInfo) return;
  const desired = externalTime(video.currentTime - state.videoInfo.videoStart, Number($('sync-offset').value) / 1000, rate()) + state.nativePreviewShift;
  const activeAudio = state.nativePreviewReady && state.listen === 'after' && $('sync-source').value === 'external' && !video.paused && !video.seeking && video.readyState >= 3 && desired >= 0 && desired < (state.audioInfo?.duration || 0);
  audio.playbackRate = rate(); audio.preservesPitch = false;
  if (!activeAudio) { audio.pause(); return; }
  if (force || Math.abs(audio.currentTime - desired) > 0.035) audio.currentTime = desired;
  if (audio.paused) audio.play().catch(e => { if (e.name !== 'AbortError') error(Error('Toque em “Conferir edição” para liberar a reprodução do áudio.')); });
}

function drawPreview() {
  if (!video.videoWidth || video.readyState < 2) return;
  const canvas = $('sync-after'), dimensions = outputDimensions(video.videoWidth, video.videoHeight, $('sync-aspect').value, 'source');
  const factor = Math.min(1, 640 / Math.max(dimensions.width, dimensions.height));
  const w = Math.round(dimensions.width * factor), h = Math.round(dimensions.height * factor);
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  drawVideo(canvas, video, video.videoWidth, video.videoHeight, { ...settings('video'), motionPlan: state.motionPlan, videoTime: video.currentTime - (state.videoInfo?.videoStart || 0) });
}
function animate() {
  if (drawing) return; drawing = true;
  const frame = () => { drawPreview(); syncPlayback(); if (!video.paused) requestAnimationFrame(frame); else drawing = false; };
  requestAnimationFrame(frame);
}

async function capabilities() {
  if (!state.videoInfo) return;
  const id = ++probeId, info = state.videoInfo, dim = outputDimensions(info.width, info.height, $('sync-aspect').value, $('sync-resolution').value);
  const c = await encodingOptions(dim.width, dim.height, $('sync-source').value !== 'mute');
  if (id !== probeId) return;
  const memoryMiB = Math.ceil(dim.width * dim.height * 4 * (2 + ((settings('video').denoise || settings('video').sharpness) ? 2 : 0)) / 1048576);
  $('media-capabilities').textContent = `${dim.width} × ${dim.height} · MP4 H.264/AAC: ${c.mp4 ? 'codificador detectado' : 'indisponível'} · WebM VP9/Opus: ${c.webm ? 'codificador detectado' : 'indisponível'} · reserva de canvases estimada ≥${memoryMiB} MiB (não é medição de RAM). ${$('sync-resolution').value === '4k' ? '4K é ampliação convencional; a exportação precisa ser verificada neste aparelho.' : ''}`;
}

async function transferToDAW(file) {
  const db = await new Promise((resolve, reject) => { const r = indexedDB.open('aps-media-transfer', 1); r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains('files')) r.result.createObjectStore('files'); }; r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
  try { await new Promise((resolve, reject) => { const tx = db.transaction('files', 'readwrite'); tx.objectStore('files').put({ file, created: Date.now() }, 'next'); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error || Error('Transferência interrompida.')); }); }
  finally { db.close(); }
  location.href = './daw.html?modulo=gravacao&importar=midia';
}

async function render(audioOnly = false) {
  const options = { videoFile: state.videoFile, audioFile: state.audioFile, source: $('sync-source').value, offsetSeconds: offset(), rate: rate(), audioSettings: settings('audio'), videoSettings: { ...settings('video'), motionPlan: state.motionPlan }, aspect: $('sync-aspect').value, resolution: $('sync-resolution').value, format: $('sync-format').value, audioOnly };
  await clearResult();
  const start = performance.now();
  const result = await job('export', { options, reference: state.reference });
  const file = new File([result.blob], `APS-${audioOnly ? 'audio-editado' : 'video-sincronizado'}.${result.extension}`, { type: result.mime });
  const download = $(audioOnly ? 'media-wav-download' : 'media-download'); download.href = url(audioOnly ? 'wav' : 'render', file); download.download = file.name; download.hidden = false;
  $('media-render-result').hidden = false; $('media-final-preview').hidden = audioOnly;
  if (!audioOnly) $('media-final-preview').src = state.urls.render;
  let measured = 'Sincronismo não verificado por referência. Confira o arquivo final.';
  if (result.verification?.accepted) {
    const v = result.verification;
    const worst = Math.max(Math.abs(v.rate * v.offsetSeconds), Math.abs((v.rate - 1) * result.duration - v.rate * v.offsetSeconds)) + v.residualSeconds + v.resolutionSeconds;
    const passed = worst <= result.minFrameSeconds;
    measured = `Limite estimado por correlação no arquivo exportado: ${(worst * 1000).toFixed(1)} ms (inclui resolução de 5 ms) · ${passed ? 'dentro' : 'fora'} de 1 quadro (${(result.minFrameSeconds * 1000).toFixed(1)} ms).`;
    result.verification.estimatedWorstErrorSeconds = worst; result.verification.withinOneFrame = passed;
  }
  const measuredContainer = result.measuredContainer?.durationSeconds != null
    ? `\nContêiner reaberto: ${result.measuredContainer.durationSeconds.toFixed(3)} s · diferença ${(result.measuredContainer.durationDifferenceSeconds * 1000).toFixed(1)} ms · vídeo ${result.measuredContainer.videoCodec || 'nenhum'} · áudio ${result.measuredContainer.audioCodec || 'nenhum'}.`
    : `\nVerificação da duração exportada indisponível: ${result.measuredContainer?.unavailable || 'sem leitura'}.`;
  $('media-export-result').textContent = `${file.name} · ${(file.size / 1048576).toFixed(2)} MB · ${result.duration.toFixed(3)} s · ${result.frames} quadros\n${measured}${measuredContainer}\nReserva de canvases estimada ≥${(result.memoryEstimateBytes / 1048576).toFixed(1)} MiB; não mede RAM total.${result.stabilization ? `\nEstabilização convencional: ${Math.round(result.stabilization.coverage * 100)}% de rastreios confiáveis.` : ''}${result.clipped ? `\nAtenção: ${result.clipped} amostras de canal limitadas. Reduza o volume e exporte novamente.` : ''}`;
  state.report = { schema: 'aps-media-report-v1', created: new Date().toISOString(), userAgent: navigator.userAgent, inputs: { video: { name: state.videoFile.name, size: state.videoFile.size, ...state.videoInfo }, audio: state.audioFile ? { name: state.audioFile.name, size: state.audioFile.size, ...state.audioInfo } : null }, settings: { ...options, videoFile: undefined, audioFile: undefined }, nativePreview: { calibrated: state.nativePreviewReady, shiftSeconds: state.nativePreviewShift }, alignment: state.alignment, export: { ...result, blob: undefined, tempName: undefined, elapsedSeconds: (performance.now() - start) / 1000 } };
  status(audioOnly ? 'Áudio WAV pronto. Preparando transferência para a DAW…' : 'Arquivo finalizado. Reproduza a exportação abaixo e baixe sua cópia.');
  if (audioOnly) { try { await transferToDAW(file); } catch (e) { throw Error(`Áudio pronto, mas a transferência falhou: ${e.message}. Baixe o WAV e importe na DAW.`); } }
}

for (const kind of ['video', 'audio']) $(`sync-${kind}`).addEventListener('change', e => { const file = e.target.files[0]; selectFile(kind, file).catch(error); });
$('sync-analyze').addEventListener('click', () => synchronize().catch(error));
$('motion-analyze').addEventListener('click', () => scanMotion().catch(error));
$('sync-reset').addEventListener('click', resetAlignment);
$('media-cancel').addEventListener('click', () => active?.cancel());
$('media-export').addEventListener('click', () => render().catch(error));
$('media-to-daw').addEventListener('click', () => render(true).catch(error));
$('media-report').addEventListener('click', () => { if (!state.report) return; const a = document.createElement('a'); a.href = url('report', new Blob([JSON.stringify(state.report, null, 2)], { type: 'application/json' })); a.download = 'APS-relatorio-audiovisual.json'; a.click(); });
for (const el of document.querySelectorAll('[data-video], [data-audio]')) el.addEventListener('input', () => { const out = document.querySelector(`output[for="${el.id}"]`); if (out) out.value = el.value; drawPreview(); graph?.dsp.port.postMessage(settings('audio')); });
for (const id of ['sync-offset', 'sync-drift', 'sync-source', 'sync-aspect', 'sync-resolution']) $(id).addEventListener('input', () => { syncPlayback(true); drawWave(); drawPreview(); readiness(); capabilities().catch(error); });
for (const el of document.querySelectorAll('[data-nudge]')) el.addEventListener('click', () => { const n = el.dataset.nudge, amount = n.includes('frame') ? (n[0] === '-' ? -1 : 1) * 1000 / (state.videoInfo?.fps || 30) : Number(n); $('sync-offset').value = Math.max(-600000, Math.min(600000, Number($('sync-offset').value) + amount)).toFixed(2); syncPlayback(true); drawWave(); });
for (const mode of ['before', 'after']) $(`listen-${mode}`).addEventListener('click', async () => { try { state.listen = mode; await setupGraph(); route(); $('listen-before').setAttribute('aria-pressed', String(mode === 'before')); $('listen-after').setAttribute('aria-pressed', String(mode === 'after')); await video.play(); syncPlayback(true); } catch (e) { error(e); } });
video.addEventListener('play', () => { setupGraph().then(() => syncPlayback(true)).catch(error); animate(); });
for (const event of ['seeked', 'loadeddata']) video.addEventListener(event, () => { drawPreview(); syncPlayback(true); });
for (const event of ['pause', 'seeking', 'waiting', 'ended']) video.addEventListener(event, () => audio.pause());
video.addEventListener('playing', () => syncPlayback(true));
video.addEventListener('ratechange', () => { if (video.playbackRate !== 1) { video.playbackRate = 1; status('Use reprodução em velocidade normal para conferir a sincronização.'); } });
document.addEventListener('visibilitychange', () => { if (document.hidden) { video.pause(); audio.pause(); } });
window.addEventListener('pagehide', () => { active?.cancel(); video.pause(); audio.pause(); graph?.ctx.close(); Object.values(state.urls).forEach(u => URL.revokeObjectURL(u)); for (const name of state.temps) removeTemp(name); });
readiness();
