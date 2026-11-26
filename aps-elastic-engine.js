/* APS Motor Elástico — comandos do motor (roda no Web Worker; na página só como reserva).
 * Usa APSElasticCore + Signalsmith Stretch (MIT, WASM embutido) + SwiftF0 (MIT) via onnxruntime-web (MIT). */
(function (root) {
'use strict';
const C = root.APSElasticCore || (typeof require === 'function' ? require('./aps-elastic-core.js') : null);
const E = {};
const isWorker = typeof WorkerGlobalScope !== 'undefined' && root instanceof WorkerGlobalScope;
E.base = (() => {
  try { if (isWorker) return new URL('./', root.location.href).href; if (root.document) return new URL('./', root.document.baseURI).href; } catch (e) {}
  return './';
})();
function loadScript(src) {
  if (isWorker) { root.importScripts(src); return Promise.resolve(); }
  return new Promise((res, rej) => { const s = root.document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(Error('Falha ao carregar ' + src)); root.document.head.appendChild(s); });
}
let stretchP = null, swiftP = null;
E.loadStretch = E.loadStretch || function () {
  if (!stretchP) stretchP = (async () => {
    if (!root.SignalsmithStretchWasm) await loadScript(E.base + 'vendor/signalsmith-stretch/signalsmith-stretch-wasm.js');
    const m = await root.SignalsmithStretchWasm(); if (m._main) m._main(); return m;
  })().catch(e => { stretchP = null; throw e; });
  return stretchP;
};
E.loadSwift = E.loadSwift || function () {
  if (!swiftP) swiftP = (async () => {
    if (!root.ort) await loadScript(E.base + 'vendor/onnxruntime-web/ort.wasm.min.js');
    const ort = root.ort; ort.env.wasm.numThreads = 1; ort.env.wasm.wasmPaths = E.base + 'vendor/onnxruntime-web/';
    const resp = await fetch(E.base + 'vendor/swift-f0/model.onnx'); if (!resp.ok) throw Error('Modelo SwiftF0 indisponível');
    const session = await ort.InferenceSession.create(new Uint8Array(await resp.arrayBuffer()), { executionProviders: ['wasm'] });
    return async win => {
      const r = await session.run({ audio: new ort.Tensor('float32', Float32Array.from(win), [1, win.length]), fmin: new ort.Tensor('float32', [C.SWIFT.fmin], []), fmax: new ort.Tensor('float32', [C.SWIFT.fmax], []) });
      return { pitch: r.pitch.data, confidence: r.confidence.data };
    };
  })().catch(e => { swiftP = null; throw e; });
  return swiftP;
};
E.setLoaders = (o) => { if (o.loadStretch) E.loadStretch = o.loadStretch; if (o.loadSwift) E.loadSwift = o.loadSwift; };

const H = {};
H.ping = async () => ({ ok: true, version: C.version });

H.analyzePitch = async (d, progress) => {
  const x = C.mono(d.channels), sr = d.sampleRate;
  progress(0.05, 'Preparando a voz…');
  const x16 = C.resample(x, sr, 16000);
  let swift = null, swiftError = null;
  if (d.engine !== 'mpm') {
    try { progress(0.2, 'Lendo as notas (SwiftF0)…'); const run = await E.loadSwift(); swift = await C.swiftF0Track(x16, run); }
    catch (e) { swiftError = String(e && e.message || e); }
  }
  progress(0.6, 'Conferindo graves e reserva (MPM)…');
  const mpm = C.mpmTrack(x16, 16000, { rate: 16000 });
  const track = C.fuseTracks(swift, mpm);
  const an = C.analyzeNotes(track), key = C.guessKey(track, an);
  progress(1, 'Pronto');
  return { track: { f0: track.f0, conf: track.conf, hopSec: track.hopSec, source: track.source }, notes: an.notes, key, swiftError };
};

H.tune = async (d, progress) => {
  const sr = d.sampleRate, track = d.track, an = C.analyzeNotes(track);
  const plan = C.pitchPlan(track, an, d.options || {});
  progress(0.15, 'Marcando os ciclos da voz…');
  const marks = C.pitchMarks(C.mono(d.channels), sr, track);
  progress(0.35, 'Afinando com preservação de formantes…');
  const dur = d.channels[0].length / sr, map = C.identityMap(dur);
  const out = C.renderPSOLA(d.channels, sr, marks, map, plan.ratioAt, { outLength: d.channels[0].length, formantSemitones: (d.options || {}).formant || 0 });
  progress(1, 'Pronto');
  return { channels: out, metrics: C.metrics(out, sr), outMidi: plan.outMidi, notes: plan.notes, transfer: out.map(c => c.buffer) };
};

H.onsets = async (d) => ({ onsets: C.detectOnsets(d.channels, d.sampleRate, d.options || {}) });

H.quantize = async (d, progress) => {
  const sr = d.sampleRate, len = d.channels[0].length, dur = len / sr, o = d.options || {};
  const map = C.buildTimeMap(C.sanitizeMarkers(d.markers || [], dur), dur, { protectMs: o.protectMs ?? 25 });
  let out, engine = o.engine || 'poly';
  progress(0.1, 'Esticando entre os marcadores (sem cortes)…');
  if (engine === 'mono') {
    const track = o.track || (await H.analyzePitch({ channels: d.channels, sampleRate: sr, engine: 'mpm' }, () => {})).track;
    const marks = C.pitchMarks(C.mono(d.channels), sr, track);
    out = C.renderPSOLA(d.channels, sr, marks, map, () => 1, { outLength: len });
  } else {
    try { const w = await E.loadStretch(); out = C.renderSignalsmith(w, d.channels, sr, map, { outLength: len, onProgress: p => progress(0.1 + 0.8 * p) }); engine = 'poly'; }
    catch (e) { out = C.renderWSOLA(d.channels, sr, map, { outLength: len }); engine = 'wsola'; }
  }
  if (engine !== 'mono') out = C.protectAttacks(out, d.channels, sr, map, {});
  progress(1, 'Pronto');
  return { channels: out, engine, metrics: C.metrics(out, sr), warnings: map.warnings, transfer: out.map(c => c.buffer) };
};

// mudança de tom polifônica (instrumento inteiro) com formantes — Signalsmith
H.transpose = async (d) => {
  const sr = d.sampleRate, len = d.channels[0].length, o = d.options || {}, w = await E.loadStretch();
  const out = C.renderSignalsmith(w, d.channels, sr, C.identityMap(len / sr), { outLength: len, semitones: o.semitones || 0, formantSemitones: o.formantSemitones || 0, formantCompensation: o.preserveFormants !== false, formantBaseHz: o.formantBaseHz || 0 });
  return { channels: out, metrics: C.metrics(out, sr), transfer: out.map(c => c.buffer) };
};

E.handle = async (cmd, data, progress = () => {}) => {
  if (!H[cmd]) throw Error('Comando desconhecido: ' + cmd);
  return H[cmd](data, progress);
};
root.APSElasticEngine = E;
if (typeof module === 'object' && module.exports) module.exports = E;
})(typeof globalThis !== 'undefined' ? globalThis : this);
