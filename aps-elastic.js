/* APS Motor Elástico — cliente da página. Envia o trabalho para o Web Worker
 * (aps-elastic-worker.js) e, se o navegador não permitir Worker, roda o mesmo motor na página.
 * Nunca altera o AudioBuffer original: sempre copia os canais antes de processar. */
(function (root) {
'use strict';
const base = (() => { try { return new URL('./', document.currentScript && document.currentScript.src || document.baseURI).href; } catch (e) { return './'; } })();
let worker = null, workerBroken = false, seq = 0;
const pending = new Map();
function getWorker() {
  if (workerBroken || typeof Worker === 'undefined') return null;
  if (worker) return worker;
  try {
    worker = new Worker(base + 'aps-elastic-worker.js?v=2');
    worker.onmessage = ev => {
      const m = ev.data, p = pending.get(m.id); if (!p) return;
      if ('progress' in m) { p.onProgress && p.onProgress(m.progress, m.message); return; }
      pending.delete(m.id);
      if (m.error) p.reject(Error(m.error)); else p.resolve(m.result);
    };
    worker.onerror = ev => { ev.preventDefault && ev.preventDefault(); workerBroken = true; worker = null; for (const [id, p] of pending) { pending.delete(id); p.retry(); } };
  } catch (e) { workerBroken = true; worker = null; }
  return worker;
}
let inlineP = null;
function inlineEngine() {
  if (!inlineP) inlineP = (async () => {
    const load = src => new Promise((res, rej) => { const s = document.createElement('script'); s.src = base + src; s.onload = res; s.onerror = () => rej(Error('Falha ao carregar ' + src)); document.head.appendChild(s); });
    if (!root.APSElasticCore) await load('aps-elastic-core.js?v=2');
    if (!root.APSElasticEngine) await load('aps-elastic-engine.js?v=2');
    return root.APSElasticEngine;
  })();
  return inlineP;
}
async function runInline(cmd, make, onProgress) {
  const E = await inlineEngine(), data = make(); const r = await E.handle(cmd, data, onProgress || (() => {})); if (r) delete r.transfer; return r;
}
// make(): devolve cópias novas dos dados (se o Worker falhar no meio, refazemos na página)
function run(cmd, make, onProgress) {
  if (typeof make !== 'function') { const d = make; make = () => d; }
  return new Promise((resolve, reject) => {
    const w = getWorker();
    const retry = () => runInline(cmd, make, onProgress).then(resolve, reject);
    if (!w) { retry(); return; }
    const id = ++seq; pending.set(id, { resolve, reject, onProgress, retry });
    const data = make(), transfer = []; // cópias: o original continua intacto na página
    (data.channels || []).forEach(c => transfer.push(c.buffer));
    try { w.postMessage({ id, cmd, data }, transfer); } catch (e) { pending.delete(id); retry(); }
  });
}
function channelsOf(buffer) { const out = []; for (let c = 0; c < buffer.numberOfChannels; c++) out.push(buffer.getChannelData(c).slice()); return out; }
function monoOf(buffer) { const n = buffer.length, out = new Float32Array(n), k = buffer.numberOfChannels; for (let c = 0; c < k; c++) { const d = buffer.getChannelData(c); for (let i = 0; i < n; i++) out[i] += d[i] / k; } return out; }
function toAudioBuffer(channels, sampleRate, ctx) {
  const len = channels[0].length;
  let b;
  try { b = new AudioBuffer({ length: len, numberOfChannels: channels.length, sampleRate }); }
  catch (e) { const c = ctx || new (root.OfflineAudioContext || root.webkitOfflineAudioContext)(channels.length, len, sampleRate); b = c.createBuffer(channels.length, len, sampleRate); }
  channels.forEach((c, i) => b.copyToChannel(c instanceof Float32Array ? c : Float32Array.from(c), i));
  return b;
}
const API = {
  run, channelsOf, monoOf, toAudioBuffer, base,
  usingWorker: () => !!worker && !workerBroken,
  analyzePitch: (buffer, onProgress, opt = {}) => run('analyzePitch', () => ({ channels: [monoOf(buffer)], sampleRate: buffer.sampleRate, engine: opt.engine }), onProgress),
  tune: async (buffer, track, options, onProgress) => { const r = await run('tune', () => ({ channels: channelsOf(buffer), sampleRate: buffer.sampleRate, track, options }), onProgress); r.buffer = toAudioBuffer(r.channels, buffer.sampleRate); return r; },
  onsets: (buffer, options) => run('onsets', () => ({ channels: [monoOf(buffer)], sampleRate: buffer.sampleRate, options })),
  tempoMeter: (buffer, options) => run('tempoMeter', () => ({ channels: [monoOf(buffer)], sampleRate: buffer.sampleRate, options })),
  quantize: async (buffer, markers, options, onProgress) => { const r = await run('quantize', () => ({ channels: channelsOf(buffer), sampleRate: buffer.sampleRate, markers, options }), onProgress); r.buffer = toAudioBuffer(r.channels, buffer.sampleRate); return r; },
  transpose: async (buffer, options) => { const r = await run('transpose', () => ({ channels: channelsOf(buffer), sampleRate: buffer.sampleRate, options })); r.buffer = toAudioBuffer(r.channels, buffer.sampleRate); return r; },
  wav16(buffer) { // WAV PCM 16 bits para baixar
    const ch = buffer.numberOfChannels, len = buffer.length, sr = buffer.sampleRate, data = new DataView(new ArrayBuffer(44 + len * ch * 2));
    const w = (o, s) => { for (let i = 0; i < s.length; i++) data.setUint8(o + i, s.charCodeAt(i)); };
    w(0, 'RIFF'); data.setUint32(4, 36 + len * ch * 2, true); w(8, 'WAVEfmt '); data.setUint32(16, 16, true); data.setUint16(20, 1, true); data.setUint16(22, ch, true);
    data.setUint32(24, sr, true); data.setUint32(28, sr * ch * 2, true); data.setUint16(32, ch * 2, true); data.setUint16(34, 16, true); w(36, 'data'); data.setUint32(40, len * ch * 2, true);
    const chans = Array.from({ length: ch }, (_, c) => buffer.getChannelData(c)); let o = 44;
    for (let i = 0; i < len; i++) for (let c = 0; c < ch; c++) { const v = Math.max(-1, Math.min(1, chans[c][i])); data.setInt16(o, v < 0 ? v * 0x8000 : v * 0x7fff, true); o += 2; }
    return new Blob([data.buffer], { type: 'audio/wav' });
  }
};
root.APSElastic = API;
})(typeof window !== 'undefined' ? window : globalThis);
