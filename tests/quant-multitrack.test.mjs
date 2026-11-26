// Testes reais de DSP da Quantização Multitrack (BPM + compasso automáticos e alinhamento pela pista guia).
// Rodar: node --test tests/quant-multitrack.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const C = require(path.join(ROOT, 'aps-elastic-core.js'));
const E = require(path.join(ROOT, 'aps-elastic-engine.js'));
const Q = require(path.join(ROOT, 'aps-quant-core.js'));
const wasmFactory = require(path.join(ROOT, 'vendor/signalsmith-stretch/signalsmith-stretch-wasm.js'));
let stretchP = null;
E.setLoaders({ loadStretch: () => stretchP || (stretchP = wasmFactory().then(m => { if (m._main) m._main(); return m; })) });
const SR = 44100, report = {};

// Bateria sintética num compasso: tempo 1 acentuado (bumbo forte), demais tempos mais fracos, pad contínuo.
function meterSynth(bpm, num, bars, opt = {}) {
  const beat = 60 / bpm, sub = opt.sub || 1, lead = opt.lead ?? 0.37, n = Math.round((lead + bars * num * beat + 0.6) * SR), x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = 0.03 * Math.sin(2 * Math.PI * 220 * i / SR);
  let s = opt.seed || 3; const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let k = 0; k < bars * num * sub; k++) {
    const t = lead + k * beat / sub + (rnd() - 0.5) * (opt.jitter || 0), onBeat = k % sub === 0, b = Math.floor(k / sub) % num;
    const amp = !onBeat ? 0.18 : b === 0 ? 0.9 : 0.38, f = b === 0 && onBeat ? 60 : 150, i0 = Math.round(t * SR);
    for (let i = 0; i < 0.1 * SR && i0 + i < n; i++) { const e = Math.exp(-i / SR * 40); x[i0 + i] += amp * e * (onBeat ? Math.sin(2 * Math.PI * f * i / SR) : (rnd() * 2 - 1)); }
  }
  return x;
}
const buf = x => ({ numberOfChannels: 1, length: x.length, sampleRate: SR, duration: x.length / SR, getChannelData: () => x });
function detect(x) { return C.detectTempoMeter(C.onsetAccents([x], SR, C.detectOnsets([x], SR))); }

const CASES = [
  { name: '4/4 a 100 BPM (só semínimas)', bpm: 100, num: 4, sig: '4/4' },
  { name: '3/4 a 90 BPM (só semínimas)', bpm: 90, num: 3, sig: '3/4' },
  { name: '4/4 a 120 BPM com colcheias e humanização ±5 ms', bpm: 120, num: 4, sub: 2, jitter: 0.01, sig: '4/4' },
  { name: '3/4 a 76 BPM com colcheias e humanização ±5 ms', bpm: 76, num: 3, sub: 2, jitter: 0.01, sig: '3/4' },
  { name: '2/4 a 100 BPM', bpm: 100, num: 2, sig: '2/4' }
];
for (const c of CASES) test(`Auto (BPM + Compasso): ${c.name}`, () => {
  const x = meterSynth(c.bpm, c.num, 8, c), r = detect(x);
  report['auto_' + c.sig + '_' + c.bpm] = { esperado: { bpm: c.bpm, compasso: c.sig }, detectado: { bpm: r.bpm, compasso: r.sig, tempo1: +r.downbeat.toFixed(3), confianca: +r.confidence.toFixed(2) }, contrastes: r.meterScores };
  assert.ok(Math.abs(r.bpm - c.bpm) <= 1, `BPM ${r.bpm} ≠ ${c.bpm}`);
  assert.equal(r.sig, c.sig);
  const bar = C.meterInfo(c.sig, c.bpm).bar, lead = 0.37 % bar; // tempo 1 cai no 1º golpe acentuado
  assert.ok(Math.min(Math.abs(r.downbeat - lead), Math.abs(r.downbeat - lead - bar), Math.abs(r.downbeat - lead + bar)) < 0.02, 'tempo 1 em ' + r.downbeat);
  assert.ok(r.confidence > 0.5, 'confiança ' + r.confidence);
});

test('Auto (BPM + Compasso): 6/8 (colcheias com acento no 1 e no 4)', () => {
  const P = 60 / 80, x = new Float32Array(Math.round((0.3 + 16 * P + 0.5) * SR));
  for (let i = 0; i < x.length; i++) x[i] = 0.03 * Math.sin(2 * Math.PI * 220 * i / SR);
  for (let k = 0; k < 48; k++) { const pos = k % 6, amp = pos === 0 ? 0.9 : pos === 3 ? 0.5 : 0.2, i0 = Math.round((0.3 + k * P / 3) * SR); for (let i = 0; i < 0.08 * SR && i0 + i < x.length; i++) x[i0 + i] += amp * Math.exp(-i / SR * 45) * Math.sin(2 * Math.PI * (pos === 0 ? 60 : pos === 3 ? 150 : 900) * i / SR); }
  const r = detect(x);
  report.auto_6_8 = { esperado: { bpm: 120, compasso: '6/8' }, detectado: { bpm: r.bpm, compasso: r.sig, confianca: +r.confidence.toFixed(2) } };
  assert.equal(r.sig, '6/8'); assert.ok(Math.abs(r.bpm - 120) <= 1.5);
});

test('API APSQuantCore.analyzeTempoMeter usa o mesmo motor', () => {
  const r = Q.analyzeTempoMeter(buf(meterSynth(100, 3, 8)));
  assert.equal(r.sig, '3/4'); assert.ok(Math.abs(r.bpm - 100) <= 1); assert.ok(r.onsets >= 20);
});

test('grade de compasso: tempo 1 destacado e compassos x/8 em colcheias', () => {
  const g34 = C.meterGrid('3/4', 120, 0, 3, 0), g68 = C.meterGrid('6/8', 120, 0, 3, 0), g78 = C.meterGrid('7/8', 120, 0, 1.75, 0);
  assert.deepEqual(g34.filter(b => b.downbeat).map(b => +b.t.toFixed(3)), [0, 1.5, 3]);
  assert.equal(g34.length, 7);
  assert.deepEqual(g68.filter(b => b.downbeat).map(b => +b.t.toFixed(3)), [0, 1.5, 3]);
  assert.equal(g68.filter(b => b.t < 1.5).length, 6); assert.equal(g68[3].accent, 1);
  assert.equal(g78.filter(b => b.t < 1.75).length, 7);
  for (const s of C.METER_LIST) assert.equal(C.METERS[s].accents.length, C.METERS[s].num);
});

// fim suave da nota (sem clique no final, que viraria um ataque falso)
const tail = (i, L) => { const r = (L - i) / (0.4 * L); return r >= 1 ? 1 : 0.5 - 0.5 * Math.cos(Math.PI * Math.max(0, r)); };
// Pista A (bateria/guia) e pista B (baixo) tocando os mesmos tempos, B atrasada/adiantada até ±35 ms.
function guidePair(seconds = 7, bpm = 96) {
  const n = Math.round(seconds * SR), a = new Float32Array(n), b = new Float32Array(n), beat = 60 / bpm; let s = 11;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < n; i++) { a[i] = 0.03 * Math.sin(2 * Math.PI * 330 * i / SR); b[i] = 0.04 * Math.sin(2 * Math.PI * 55 * i / SR) + 0.02 * Math.sin(2 * Math.PI * 82.5 * i / SR); }
  const hitsA = [], hitsB = [];
  for (let k = 1; k * beat / 2 < seconds - 0.5; k++) {
    const tA = k * beat / 2 + (rnd() - 0.5) * 0.012; hitsA.push(tA);
    const i0 = Math.round(tA * SR), LA = Math.round(0.14 * SR); for (let i = 0; i < LA && i0 + i < n; i++) { const e = Math.exp(-i / SR * 45) * tail(i, LA); a[i0 + i] += 0.6 * e * Math.sin(2 * Math.PI * (k % 2 ? 180 : 65) * i / SR * (1 + Math.exp(-i / SR * 60))); }
    if (k % 2 === 0) continue; // baixo só nos contratempos ímpares: metade dos ataques da guia
    const off = (rnd() < 0.5 ? -1 : 1) * (0.015 + rnd() * 0.02), tB = tA + off; hitsB.push({ tB, tA });
    const j0 = Math.round(tB * SR), LB = Math.round(0.26 * SR); for (let i = 0; i < LB && j0 + i < n; i++) { const e = Math.exp(-i / SR * 14) * Math.min(1, i / (0.002 * SR)) * tail(i, LB); b[j0 + i] += 0.45 * e * (Math.sin(2 * Math.PI * 98 * i / SR) + 0.4 * Math.sin(2 * Math.PI * 196 * i / SR)); }
  }
  return { a, b, hitsA, hitsB };
}
const medianOf = v => { const s = v.slice().sort((x, y) => x - y); return s[s.length >> 1]; };
function errToGuide(onsets, guide) { return onsets.map(o => Math.min(...guide.map(g => Math.abs(g - o.time))) * 1000); }

for (const engine of ['poly', 'wsola']) test(`Alinhar pela pista guia (${engine}): baixo puxado para os ataques da bateria, sem cortes`, async () => {
  const { a, b, hitsB } = guidePair(), truth = hitsB.map(h => h.tA), bCopy = Float32Array.from(b);
  const guide = C.detectOnsets([a], SR).map(o => o.time), onB = C.detectOnsets([b], SR);
  const before = errToGuide(onB, guide);
  const plan = C.planGuideWarp(onB, guide, { duration: b.length / SR, strength: 100, maxShiftMs: 90 });
  let r;
  if (engine === 'poly') r = await E.handle('quantize', { channels: [b], sampleRate: SR, markers: plan.markers, options: { engine: 'poly', protectMs: 25 } });
  else { const map = C.buildTimeMap(plan.markers, b.length / SR, { protectMs: 25 }); const out = C.protectAttacks(C.renderWSOLA([b], SR, map, { outLength: b.length }), [b], SR, map); r = { channels: out, metrics: C.metrics(out, SR), engine: 'wsola' }; }
  const y = r.channels[0], onY = C.detectOnsets([y], SR), after = errToGuide(onY, guide), truthBefore = errToGuide(onB, truth), truthAfter = errToGuide(onY, truth);
  const res = { motor: r.engine, ataquesBaixo: onB.length, pareados: plan.matched, erroMedianoAntesMs: +medianOf(before).toFixed(2), erroMedianoDepoisMs: +medianOf(after).toFixed(2), erroMaxDepoisMs: +Math.max(...after).toFixed(2), gabaritoAntesMs: +medianOf(truthBefore).toFixed(2), gabaritoDepoisMs: +medianOf(truthAfter).toFixed(2), ataquesSaida: onY.length, buracos: r.metrics.longestSilentMs >= 1 ? 1 : 0, maiorSilencioMs: +r.metrics.longestSilentMs.toFixed(3), nan: r.metrics.nan, pico: +r.metrics.peak.toFixed(3) };
  report['guia_' + engine] = res;
  assert.deepEqual(Array.from(b), Array.from(bCopy), 'original intacto');
  assert.equal(y.length, b.length, 'duração preservada');
  assert.equal(r.metrics.nan, 0); assert.ok(r.metrics.peak <= 1);
  assert.ok(r.metrics.longestSilentMs < 1, 'sem buracos: ' + r.metrics.longestSilentMs);
  assert.ok(plan.matched >= onB.length - 1, 'quase todos os ataques pareados');
  assert.ok(medianOf(before) > 12, 'cenário realmente desalinhado');
  assert.ok(medianOf(after) < 3 && medianOf(after) < medianOf(before) / 5, JSON.stringify(res));
  assert.ok(medianOf(truthAfter) < 4, 'erro contra o gabarito real da guia');
  assert.equal(onY.length, onB.length, 'nenhum ataque novo/duplicado criado');
  if (engine === 'poly') assert.equal(r.engine, 'poly');
});

test('pista guia: pares 1:1, sem par fica no lugar, edição manual vence, ordem preservada', () => {
  const on = [{ index: 0, time: 1.0 }, { index: 1, time: 1.03 }, { index: 2, time: 2.0 }, { index: 3, time: 3.5 }];
  const p = C.planGuideWarp(on, [1.02, 2.04], { duration: 5, maxShiftMs: 90, edits: { o3: { dst: 3.45 } } });
  const by = Object.fromEntries(p.markers.map(m => [m.id, m]));
  assert.ok(Math.abs(by.o1.dst - 1.02) < 1e-9 && by.o1.guide === 1.02, 'o mais próximo fica com o ataque da guia');
  assert.ok(Math.abs(by.o2.dst - 2.04) < 1e-9);
  assert.equal(by.o3.dst, 3.45); assert.ok(by.o3.manual);
  for (let i = 1; i < p.markers.length; i++) assert.ok(p.markers[i].dst > p.markers[i - 1].dst, 'sem inversão');
  const g = C.planGuideWarp([{ index: 0, time: 0.97 }, { index: 1, time: 2.06 }], [], { duration: 5, unmatched: 'grid', bpm: 120, subdivision: 4 });
  assert.deepEqual(g.markers.map(m => +m.dst.toFixed(6)), [1, 2], 'sem guia: vai para a grade se pedido');
  const k = C.planGuideWarp([{ index: 0, time: 0.97 }], [], { duration: 5 });
  assert.equal(k.markers[0].dst, 0.97, 'sem par e sem grade: fica onde foi tocado');
});

test('desvio da grade e ímã do arraste (grade / outras pistas)', () => {
  const d = C.gridDeviation([0.5, 0.53, 1.012], { bpm: 120, subdivision: 4, toleranceMs: 20 });
  assert.deepEqual(d.map(v => v.off), [false, true, false]);
  assert.ok(Math.abs(d[1].devMs - 30) < 1e-6);
  assert.equal(C.snapTime(1.04, { grid: { unit: 0.25 }, radiusMs: 60 }), 1.0);
  assert.equal(C.snapTime(1.11, { grid: { unit: 0.25 }, points: [1.1], radiusMs: 60 }), 1.1);
  assert.equal(C.snapTime(1.13, { grid: { unit: 0.25 }, radiusMs: 60 }), 1.13);
});

test.after(() => {
  const out = path.join(ROOT, 'tests', 'quant-multitrack-report.json');
  fs.writeFileSync(out, JSON.stringify(report, null, 2));
  console.log('RELATORIO ' + JSON.stringify(report));
});
