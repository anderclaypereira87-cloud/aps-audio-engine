import test from 'node:test';
import assert from 'node:assert/strict';
import { MusicChromaExtractor, MUSIC_HZ, analyzeMusicalAlignment } from '../advanced/music-fingerprint.js';

const beats = Array.from({ length: 500 }, (_, i) => {
  let x = (i * 1664525 + 1013904223) >>> 0;
  x = (1664525 * x + 1013904223) >>> 0;
  return x % 12;
});
const profile = (time, unrelated = false) => {
  const index = Math.max(0, Math.floor(time / 0.57));
  const pitch = unrelated ? beats[(index * 7 + 31) % beats.length] : beats[index % beats.length];
  const next = unrelated ? beats[((index + 1) * 7 + 31) % beats.length] : beats[(index + 1) % beats.length];
  const chord = Array.from({ length: 12 }, (_, c) =>
    c === pitch ? 1 : c === (pitch + 4) % 12 ? .5 : c === (pitch + 7) % 12 ? .35 : c === next ? .12 : 0);
  return chord;
};
function fakeFinger(seconds, { lead = 0, rate = 1, unrelated = false } = {}) {
  const count = Math.round(seconds * MUSIC_HZ), values = new Float32Array(count * 12);
  for (let frame = 0; frame < count; frame++) {
    const time = (frame / MUSIC_HZ - lead) / rate;
    if (time < 0) continue;
    const vector = profile(time, unrelated);
    const mean = vector.reduce((a, b) => a + b, 0) / 12;
    const norm = Math.hypot(...vector.map(v => v - mean));
    for (let c = 0; c < 12; c++) values[frame * 12 + c] = (vector[c] - mean) / norm;
  }
  return { values, hz: MUSIC_HZ, count, validFraction: 0.95 };
}

test('detects strong 3.8% time divergence without assuming unchanged tempo', () => {
  const reference = fakeFinger(130), external = fakeFinger(138, { lead: 1.5, rate: 1.038 });
  const result = analyzeMusicalAlignment(reference, external);
  assert.equal(result.accepted, true, JSON.stringify(result));
  assert.ok(Math.abs(result.rate - 1.038) < 0.004, JSON.stringify(result));
  assert.ok(Math.abs(result.offsetSeconds + 1.5 / 1.038) < .28, JSON.stringify(result));
  assert.equal(result.pitchPreserved, false, 'detection alone never claims pitch-preserving export');
});

for (const rate of [0.9, 1.1]) test(`detects tempo drift up to 10% (rate ${rate})`, () => {
  const reference = fakeFinger(90), external = fakeFinger(116, { lead: 1.5, rate });
  const result = analyzeMusicalAlignment(reference, external);
  assert.equal(result.accepted, true, JSON.stringify(result));
  assert.ok(Math.abs(result.rate - rate) < .005, JSON.stringify(result));
});

test('can find delayed passage and remains conservative on unrelated music', () => {
  const reference = fakeFinger(80), external = fakeFinger(100, { lead: 12, rate: 1 });
  const match = analyzeMusicalAlignment(reference, external);
  assert.equal(match.accepted, true, JSON.stringify(match));
  assert.ok(Math.abs(match.offsetSeconds + 12) < .28, JSON.stringify(match));
  const wrong = analyzeMusicalAlignment(reference, fakeFinger(100, { unrelated: true }));
  assert.equal(wrong.accepted, false, JSON.stringify(wrong));
});

test('the extractor builds musical pitch features, without storing full 48k PCM', () => {
  const extractor = new MusicChromaExtractor({ maxDuration: 4 });
  for (let i = 0; i < 3 * 8000; i++) {
    const t = i / 8000;
    const pitch = t < 1 ? 440 : t < 2 ? 523.25 : 659.25;
    extractor.add(.3 * Math.sin(2 * Math.PI * pitch * t), t);
  }
  const result = extractor.finish();
  assert.ok(result.count >= 15);
  assert.ok(result.validFraction > .7);
  assert.equal(result.values.length, result.count * 12);
});

test('silence and short files do not yield fabricated music alignment', () => {
  const reference = fakeFinger(130);
  const silent = { values: new Float32Array(reference.values.length), count: reference.count, hz: MUSIC_HZ, validFraction: 0 };
  assert.equal(analyzeMusicalAlignment(reference, silent).accepted, false);
  assert.equal(analyzeMusicalAlignment(fakeFinger(2), fakeFinger(2)).accepted, false);
});
