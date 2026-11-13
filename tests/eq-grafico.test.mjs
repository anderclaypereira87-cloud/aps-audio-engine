// Testes do núcleo do EQ gráfico: sanitização, resposta e mapeamento de curvas.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const C = require('../aps-eq-grafico-core.js');

test('defaultBands: 8 bandas com graves em shelf e agudos em shelf', () => {
  const bands = C.defaultBands();
  assert.equal(bands.length, 8);
  assert.equal(bands[0].type, 'lowshelf');
  assert.equal(bands[0].f, 60);
  assert.equal(bands[7].type, 'highshelf');
  assert.equal(bands[7].f, 8000);
  assert.ok(bands.slice(1, 7).every((b) => b.type === 'peaking'));
  assert.ok(bands.every((b) => b.g === 0));
});

test('sanitize descarta inválidos, limita 10 bandas e aplica default se vazio', () => {
  const empty = C.sanitize(null);
  assert.equal(empty.bypass, false);
  assert.equal(empty.bands.length, 8);

  const dirty = C.sanitize({
    bypass: 1,
    bands: [
      { type: 'peaking', f: 300, g: 40, q: 99 },
      { type: 'nope', f: -5, g: 0 },
      { foo: 1 },
      ...Array.from({ length: 20 }, (_, i) => ({ type: 'peaking', f: 100 + i, g: 1, q: 1 }))
    ]
  });
  assert.equal(dirty.bypass, true);
  assert.equal(dirty.bands.length, 10);
  assert.equal(dirty.bands[0].g, 18);
  assert.equal(dirty.bands[0].q, 18);
  assert.equal(dirty.bands[0].f, 300);
  assert.ok(!dirty.bands.some((b) => b.f < 20));
});

test('peaking +6 dB no centro fica perto de +6 dB; longe do centro ~0', () => {
  const bands = [{ type: 'peaking', f: 1000, g: 6, q: 2 }];
  const [at] = C.responseDb(bands, [1000], 44100);
  const [far] = C.responseDb(bands, [80], 44100);
  assert.ok(Math.abs(at - 6) < 0.15, 'centro=' + at);
  assert.ok(Math.abs(far) < 0.6, 'longe=' + far);
});

test('lowshelf +6 dB eleva graves e quase não mexe 8 kHz', () => {
  const bands = [{ type: 'lowshelf', f: 150, g: 6, q: 0.7 }];
  const [low, high] = C.responseDb(bands, [40, 8000], 44100);
  assert.ok(Math.abs(low - 6) < 0.4, 'grave=' + low);
  assert.ok(Math.abs(high) < 1, 'agudo=' + high);
});

test('curva combinada soma EQ clássico + gráfico; bypass ignora o gráfico', () => {
  const params = { bass: 6, mid: 0, midFreq: 800, treble: 0, hpf: 25 };
  const graphic = { bypass: false, bands: [{ type: 'peaking', f: 1000, g: 4, q: 1 }] };
  const freqs = [40, 1000];
  const on = C.combinedResponse(params, graphic, freqs);
  const off = C.combinedResponse(params, { ...graphic, bypass: true }, freqs);
  const onlyGraphic = C.graphicResponse(graphic, freqs);
  assert.ok(on[0] > 4, 'grave com lowshelf clássico: ' + on[0]);
  assert.ok(Math.abs(off[0] - on[0]) < 0.2 || onlyGraphic[0] < 1);
  assert.ok(on[1] - off[1] > 3, '1 kHz deve cair no bypass: on=' + on[1] + ' off=' + off[1]);
  assert.ok(Math.abs(off[1] - C.combinedResponse(params, { bypass: true, bands: [] }, freqs)[1]) < 0.2);
});

test('mapCurveToDefault encaixa um corte em 300 Hz na banda 250 e preserva ganho', () => {
  const mapped = C.mapCurveToDefault({
    bands: [
      { type: 'peaking', f: 300, g: -5, q: 1.4 },
      { type: 'highshelf', f: 9000, g: 3, q: 0.7 }
    ]
  });
  assert.equal(mapped.length, 8);
  const at250 = mapped.find((b) => b.f === 250);
  const at8k = mapped.find((b) => b.f === 8000);
  assert.equal(at250.g, -5);
  assert.ok(Math.abs(at250.q - 1.4) < 1e-9);
  assert.equal(at8k.g, 3);
  assert.equal(at250.type, 'peaking');
  assert.equal(at8k.type, 'highshelf');
  assert.equal(mapped.find((b) => b.f === 60).g, -5); // 60 mais perto de 300 que 9k, mas 250 is closer... wait 60 vs 300
});

test('mapCurveToDefault: 60 Hz não herda o corte de 300 quando há banda mais próxima', () => {
  const mapped = C.mapCurveToDefault({
    bands: [
      { type: 'lowshelf', f: 60, g: 0, q: 0.7 },
      { type: 'peaking', f: 300, g: -5, q: 1.4 }
    ]
  });
  assert.equal(mapped.find((b) => b.f === 60).g, 0);
  assert.equal(mapped.find((b) => b.f === 250).g, -5);
  // 125 Hz está mais perto de 60 do que de 300, em escala log
  assert.equal(mapped.find((b) => b.f === 125).g, 0);
});

test('spectrumSummary de um seno em 1 kHz marca 1 kHz como pico (0 dB relativo)', () => {
  const sr = 44100;
  const n = sr;
  const samples = new Float32Array(n);
  for (let i = 0; i < n; i++) samples[i] = Math.sin(2 * Math.PI * 1000 * i / sr);
  const spec = C.spectrumSummary(samples, sr, C.FREQS);
  const peak = spec.reduce((a, b) => (b.db > a.db ? b : a));
  assert.equal(peak.f, 1000);
  assert.equal(peak.db, 0);
  const low = spec.find((b) => b.f === 60);
  assert.ok(low.db < -10, '60 Hz relativo=' + low.db);
});

test('classicBands respeita bass/mid/treble/hpf atuais (não os quebra)', () => {
  const c = C.classicBands({ bass: 4, mid: -3, midFreq: 1100, treble: 2, hpf: 80 });
  assert.equal(c[0].type, 'highpass');
  assert.equal(c[0].f, 80);
  assert.equal(c[1].g, 4);
  assert.equal(c[2].f, 1100);
  assert.equal(c[2].g, -3);
  assert.equal(c[3].g, 2);
});

// Worker sanitizer (mesmo recorte usado em POST /eq), via leitura do fonte + eval do helper isolado.
test('worker sanitizeEqBands recorta ganho/freq e ignora bandas sem frequência', () => {
  const src = readFileSync(new URL('../workers/aps-ia/index.js', import.meta.url), 'utf8');
  const start = src.indexOf('function clampNum(');
  const end = src.indexOf('function eqSystemPrompt(');
  assert.ok(start > 0 && end > start);
  const api = new Function(
    'const EQ_TYPES = ["peaking","lowshelf","highshelf","highpass","lowpass"];\n' +
    src.slice(start, end) +
    '\nreturn { clampNum, sanitizeEqBands };'
  )();
  const bands = api.sanitizeEqBands({
    bands: [
      { type: 'peaking', f: 300, g: 40, q: 0 },
      { type: 'weird', f: 1000, g: -2 },
      { type: 'highshelf' }
    ]
  });
  assert.equal(bands.length, 2);
  assert.equal(bands[0].g, 18);
  assert.equal(bands[0].f, 300);
  assert.equal(bands[0].q, 0.1);
  assert.equal(bands[1].type, 'peaking');
  assert.equal(bands[1].g, -2);
});
