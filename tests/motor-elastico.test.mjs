// Testes reais de DSP do Motor Elástico (Fase 1). Rodar: node --test tests/motor-elastico.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const C = require(path.join(ROOT, 'aps-elastic-core.js'));
const E = require(path.join(ROOT, 'aps-elastic-engine.js'));
const Q = require(path.join(ROOT, 'aps-quant-core.js'));
const wasmFactory = require(path.join(ROOT, 'vendor/signalsmith-stretch/signalsmith-stretch-wasm.js'));
let stretchP = null;
const loadStretch = () => stretchP || (stretchP = wasmFactory().then(m => { if (m._main) m._main(); return m; }));
E.setLoaders({ loadStretch });
const SR = 44100;
const report = {};

// bateria sintética fora da grade + pad contínuo (nunca silencioso na origem)
function drums(bpm, sr, seconds, seed = 7) {
  const n = Math.round(seconds * sr), x = new Float32Array(n), unit = 60 / bpm / 4; let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const hits = [];
  for (let k = 1; k * unit < seconds - 0.3; k += 2) hits.push(k * unit + (rnd() - 0.5) * 0.04);
  for (let i = 0; i < n; i++) x[i] = 0.06 * Math.sin(2 * Math.PI * 220 * i / sr) + 0.04 * Math.sin(2 * Math.PI * 330 * i / sr);
  hits.forEach((t, j) => { const i0 = Math.round(t * sr), f = j % 2 ? 180 : 70; for (let i = 0; i < 0.12 * sr && i0 + i < n; i++) { const e = Math.exp(-i / sr * 35); x[i0 + i] += 0.55 * e * Math.sin(2 * Math.PI * f * i / sr * (1 + 1.5 * Math.exp(-i / sr * 60))) + (j % 2 ? 0.2 * e * (rnd() * 2 - 1) : 0); } });
  return { x, hits, unit };
}
function gridErrors(onsets, unit) { const e = onsets.map(o => Math.abs(o.time - Math.round(o.time / unit) * unit) * 1000).sort((a, b) => a - b); return { median: e[e.length >> 1], max: e[e.length - 1], n: e.length }; }

test('detecção de ataques (fluxo espectral + energia) acha os golpes', () => {
  const { x, hits } = drums(100, SR, 6);
  const on = C.detectOnsets([x], SR);
  const err = hits.map(h => Math.min(...on.map(o => Math.abs(o.time - h))) * 1000).sort((a, b) => a - b);
  const found = err.filter(e => e < 15).length;
  report.onsets = { reais: hits.length, detectados: on.length, acertos: found, erroMedianoMs: +err[err.length >> 1].toFixed(2) };
  assert.equal(found, hits.length); assert.ok(on.length <= hits.length + 1);
});

for (const engine of ['poly', 'wsola']) test(`Quant Pro v2 elástico (${engine}): sem buracos, sem NaN/clipping, ataques na grade, duração igual`, async () => {
  const bpm = 100, { x } = drums(bpm, SR, 6), src = Float32Array.from(x);
  const on = C.detectOnsets([x], SR), before = gridErrors(on, 60 / bpm / 4);
  const p = C.planWarp(on, { duration: x.length / SR, bpm, subdivision: 16, strength: 100 });
  let r;
  if (engine === 'poly') r = await E.handle('quantize', { channels: [x], sampleRate: SR, markers: p.markers, options: { engine: 'poly', protectMs: 25 } });
  else { const map = C.buildTimeMap(p.markers, x.length / SR, { protectMs: 25 }); const out = C.protectAttacks(C.renderWSOLA([x], SR, map, { outLength: x.length }), [x], SR, map); r = { channels: out, metrics: C.metrics(out, SR), engine: 'wsola' }; }
  const y = r.channels[0], after = gridErrors(C.detectOnsets([y], SR), 60 / bpm / 4);
  report['quant_' + engine] = { motor: r.engine, antes: before, depois: after, ...r.metrics };
  assert.deepEqual(Array.from(x.subarray(0, 4000)), Array.from(src.subarray(0, 4000)), 'original intacto');
  assert.equal(y.length, x.length, 'duração preservada');
  assert.equal(r.metrics.nan, 0); assert.ok(r.metrics.peak <= 1, 'sem clipping');
  assert.ok(r.metrics.longestSilentMs < 1, 'sem buracos de silêncio: ' + r.metrics.longestSilentMs);
  assert.ok(after.median < 2 && after.max < (engine === 'poly' ? 3 : 12), JSON.stringify(after));
  assert.ok(after.median < before.median / 4);
  if (engine === 'poly') assert.equal(r.engine, 'poly');
});

test('mapa de tempo: sem sobreposição dupla, aviso fora de 0,75–1,5×', () => {
  const m = C.sanitizeMarkers([{ id: 'a', src: 1, dst: 1.6 }, { id: 'b', src: 1.2, dst: 1.1 }], 3);
  assert.ok(m[1].dst > m[0].dst, 'ordem mantida');
  const map = C.buildTimeMap(m, 3, { protectMs: 25 });
  let prev = -1; for (let t = 0; t < 3; t += 0.001) { const s = map.input(t); assert.ok(s >= prev - 1e-9, 'mapa monotônico'); prev = s; }
  assert.ok(map.warnings.length > 0);
});

test('aps-quant-core v2 (API síncrona do estúdio) continua funcionando', () => {
  const { x } = drums(100, SR, 4);
  const buf = { numberOfChannels: 1, length: x.length, sampleRate: SR, duration: x.length / SR, getChannelData: () => x };
  const ctx = { createBuffer: (ch, len, sr) => { const d = [new Float32Array(len)]; return { length: len, sampleRate: sr, copyToChannel: (c, i) => d[i].set(c), getChannelData: i => d[i] }; } };
  const ev = Q.detect(buf), p = Q.plan(buf, ev, { bpm: 100, subdivision: 16 }), r = Q.render(buf, p, ctx);
  assert.match(Q.version, /^2\.\d+\.\d+-/); assert.equal(r.buffer.length, x.length); assert.equal(r.metrics.nan, 0); assert.ok(r.metrics.longestSilentMs < 1);
});

// voz sintética com vibrato e formantes (pulsos glotais filtrados)
function voice(notes, sr) {
  const total = notes.reduce((a, n) => a + n.dur, 0), x = new Float32Array(Math.round(total * sr)); let ph = 0, i = 0;
  const forms = [[700, 80], [1220, 90], [2600, 120]];
  const st = forms.map(() => [0, 0]);
  for (const nt of notes) for (let k = 0; k < nt.dur * sr; k++, i++) {
    const t = k / sr, f = C.freqOf(nt.midi + 0.35 * Math.sin(2 * Math.PI * 5.5 * t));
    ph += f / sr; let g = 0; if (ph >= 1) { ph -= 1; g = 1; }
    let s = 0; forms.forEach(([fc, bw], j) => { const r = Math.exp(-Math.PI * bw / sr), a1 = 2 * r * Math.cos(2 * Math.PI * fc / sr), a2 = -r * r; const y = g + a1 * st[j][0] + a2 * st[j][1]; st[j][1] = st[j][0]; st[j][0] = y; s += y; });
    const env = Math.min(1, k / (0.02 * sr), (nt.dur * sr - k) / (0.02 * sr)); x[i] = 0.05 * s * env;
  }
  let pk = 0; for (const v of x) pk = Math.max(pk, Math.abs(v)); for (let j = 0; j < x.length; j++) x[j] *= 0.5 / pk; return x;
}
const noteStats = (track, t0, t1) => { const v = []; for (let i = Math.round(t0 / track.hopSec); i < t1 / track.hopSec; i++) if (track.f0[i] > 0) v.push(C.midiOf(track.f0[i])); const m = v.reduce((a, b) => a + b, 0) / v.length; return { mean: m, sdCents: 100 * Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length) }; };

test('afinação natural: nota arrastada chega ao alvo, vibrato mantido, sem distorção', async () => {
  const x = voice([{ midi: 56.75, dur: 1.2 }, { midi: 60.3, dur: 1.2 }], SR);
  const a = await E.handle('analyzePitch', { channels: [x], sampleRate: SR, engine: 'mpm' });
  assert.ok(a.notes.length >= 2);
  const n1 = a.notes.find(n => Math.abs(n.center - 56.75) < 0.5), n2 = a.notes.find(n => Math.abs(n.center - 60.3) < 0.5);
  const r = await E.handle('tune', { channels: [x], sampleRate: SR, track: a.track, options: { key: 0, scale: 'cromatica', amount: 100, vibrato: 100, transitionMs: 60, edits: { [n1.id]: { target: 59 } } } });
  const y = r.channels[0], b = await E.handle('analyzePitch', { channels: [y], sampleRate: SR, engine: 'mpm' });
  const in1 = noteStats(a.track, 0.25, 1.0), out1 = noteStats(b.track, 0.25, 1.0), out2 = noteStats(b.track, 1.45, 2.2);
  report.afinacao = { nota1: { de: +in1.mean.toFixed(2), para: +out1.mean.toFixed(2), alvo: 59, vibratoAntesCents: +in1.sdCents.toFixed(1), vibratoDepoisCents: +out1.sdCents.toFixed(1) }, nota2: { de: 60.3, para: +out2.mean.toFixed(2), alvo: 60 }, ...r.metrics };
  let over = 0; for (let i = Math.round(1.0 / a.track.hopSec); i < 1.45 / a.track.hopSec; i++) over = Math.max(over, r.outMidi[i] || 0);
  report.afinacao_passagemMax = +over.toFixed(2);
  assert.ok(over < 60.7, 'passagem entre notas sem bico acima do alvo: ' + over);
  assert.ok(Math.abs(out1.mean - 59) < 0.1, 'nota arrastada no alvo');
  assert.ok(Math.abs(out2.mean - 60) < 0.12, 'nota automática no alvo');
  assert.ok(Math.abs(out1.sdCents - in1.sdCents) < 4, 'vibrato mantido');
  assert.equal(r.metrics.nan, 0); assert.ok(r.metrics.peak < 1); assert.equal(y.length, x.length);
});

test('MPM: Si grave do baixo de 5 cordas (30,87 Hz) e agudos', () => {
  const res = {};
  for (const f of [30.87, 41.2, 82.41, 440, 1046.5]) {
    const d = C.createTunerDSP(48000); let last = null;
    for (let o = 0; o < 48000; o += 128) { const b = new Float32Array(128); for (let i = 0; i < 128; i++) { const t = (o + i) / 48000; b[i] = 0.3 * Math.sin(2 * Math.PI * f * t) + 0.25 * Math.sin(4 * Math.PI * f * t) + 0.15 * Math.sin(6 * Math.PI * f * t); } const r = d.push(b); if (r && r.freq) last = r; }
    res[f] = +(1200 * Math.log2(last.freq / f)).toFixed(2);
    assert.ok(Math.abs(res[f]) < 3, f + ' Hz: ' + res[f] + ' cents');
  }
  report.afinadorCents = res;
});

test('Signalsmith Stretch: alinhamento 0 e transposição +3 semitons', async () => {
  const n = SR * 2, x = new Float32Array(n); for (let i = 0; i < n; i++) x[i] = 0.4 * Math.sin(2 * Math.PI * 220 * i / SR);
  const r = await E.handle('transpose', { channels: [x], sampleRate: SR, options: { semitones: 3 } });
  const t = C.mpmTrack(r.channels[0].subarray(SR * 0.3, SR * 1.7), SR), v = Array.from(t.f0).filter(f => f > 0).sort((a, b) => a - b);
  const st = 12 * Math.log2(v[v.length >> 1] / 220); report.signalsmithTransposeSt = +st.toFixed(3);
  assert.ok(Math.abs(st - 3) < 0.08, "seno puro: Signalsmith tem erro de alguns cents"); // medido: 3,058 st (≈ +6 cents) num seno puro de 220 Hz
  // alinhamento: mapa identidade deve reproduzir o impulso no mesmo lugar
  const imp = new Float32Array(SR); for (let i = 0; i < SR; i++) imp[i] = 0.02 * Math.sin(2 * Math.PI * 300 * i / SR); imp[22050] = 0.9;
  const w = await loadStretch(), o = C.renderSignalsmith(w, [imp], SR, C.identityMap(1), { outLength: SR })[0];
  let pk = 0; for (let i = 1; i < SR; i++) if (Math.abs(o[i]) > Math.abs(o[pk])) pk = i; report.signalsmithLagSamples = pk - 22050;
  assert.ok(Math.abs(pk - 22050) <= 2);
});

test('SwiftF0 (onnxruntime-web local) lê a altura', async () => {
  const ortPath = path.join(ROOT, 'vendor/onnxruntime-web/ort.wasm.min.js');
  globalThis.self = globalThis.self || globalThis;
  const ort = require(ortPath); ort.env.wasm.numThreads = 1; ort.env.wasm.wasmPaths = pathToFileURL(path.join(ROOT, 'vendor/onnxruntime-web/')).href;
  const session = await ort.InferenceSession.create(new Uint8Array(fs.readFileSync(path.join(ROOT, 'vendor/swift-f0/model.onnx'))), { executionProviders: ['wasm'] });
  const run = async win => { const r = await session.run({ audio: new ort.Tensor('float32', Float32Array.from(win), [1, win.length]), fmin: new ort.Tensor('float32', [C.SWIFT.fmin], []), fmax: new ort.Tensor('float32', [C.SWIFT.fmax], []) }); return { pitch: r.pitch.data, confidence: r.confidence.data }; };
  const x = new Float32Array(16000); for (let i = 0; i < x.length; i++) x[i] = 0.4 * Math.sin(2 * Math.PI * 220 * i / 16000) + 0.2 * Math.sin(2 * Math.PI * 440 * i / 16000);
  const t = await C.swiftF0Track(x, run), v = Array.from(t.f0).filter((f, i) => f > 0 && t.conf[i] > 0.5).sort((a, b) => a - b);
  report.swiftF0 = { mediana: +v[v.length >> 1].toFixed(2), quadros: v.length };
  assert.ok(v.length > 20 && Math.abs(1200 * Math.log2(v[v.length >> 1] / 220)) < 15);
});

test('APSVocal (API antiga usada por Partituras/MIDI) continua exposta', () => {
  const src = fs.readFileSync(path.join(ROOT, 'aps-vocal.js'), 'utf8');
  assert.match(src, /const API=\{track,snap,notes,ratios,psola,tune,guessKey/);
  assert.doesNotMatch(fs.readFileSync(path.join(ROOT, 'afinacao.html'), 'utf8'), /createDelay|shiftCh/);
});

test.after(() => { fs.writeFileSync('/tmp/aps-elastico-report.json', JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2)); });
