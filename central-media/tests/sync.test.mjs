import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeAlignment, correlate, externalTime } from '../../aps-video-sync.js';
import { AudioProcessor, cropRectangle, processPixels, outputDimensions } from '../../aps-video-enhance.js';

function reference(seconds = 60) {
  let seed = 42; const a = new Float32Array(seconds * 200);
  for (let i = 0; i < a.length; i++) { seed = (1664525 * seed + 1013904223) >>> 0; a[i] = (i ? a[i - 1] * 0.93 : 0) + (seed / 2 ** 32 > 0.997 ? 0.6 : 0); }
  return a;
}
function shifted(a, delay, rate = 1) {
  const b = new Float32Array(a.length + 1000);
  for (let j = 0; j < b.length; j++) { const t = (j - delay * 200) / rate, i = Math.floor(t), f = t - i; if (i >= 0 && i + 1 < a.length) b[j] = a[i] * (1 - f) + a[i + 1] * f; }
  return b;
}
for (const delay of [0.25, 1, -0.25, 3]) test(`known offset ${delay}s, including leading silence and advance`, () => {
  const a = reference(), result = analyzeAlignment(a, shifted(a, delay));
  assert.ok(result.accepted, result.reason); assert.ok(Math.abs(result.offsetSeconds + delay) <= 0.005);
  assert.equal(result.rate, 1); assert.ok(result.points.length >= 3);
});

function shortReference(seconds = 2) {
  const a = new Float32Array(Math.round(seconds * 200)); let seed = 42;
  for (let i = 0; i < a.length; i++) {
    seed = (1664525 * seed + 1013904223) >>> 0;
    // A short live recording contains multiple independent attacks.
    a[i] = Math.max(0, (seed / 2 ** 32 - 0.6)) * .05;
    for (const t of [0.11, 0.32, 0.61, 0.91, 1.19, 1.51, 1.75, 2.15, 2.55])
      if (i >= t * 200 && i < t * 200 + 10) a[i] += .8 * Math.exp(-(i - t * 200) / 5);
  }
  return a;
}
for (const seconds of [0.95, 1.85, 2.03, 3.1]) for (const delay of [-0.2, 0, 0.2])
  test(`short clip ${seconds}s resolves ${delay}s offset without guessing drift`, () => {
    const a = shortReference(seconds), b = shifted(a, delay);
    const result = analyzeAlignment(a, b);
    assert.equal(result.accepted, true, JSON.stringify(result));
    assert.ok(Math.abs(result.offsetSeconds + delay) <= .005, JSON.stringify(result));
    assert.equal(result.rate, 1);
    assert.equal(result.shortClip, true);
  });
test('short clips without unique audible markers are rejected safely', () => {
  const a = shortReference(2);
  assert.equal(analyzeAlignment(new Float32Array(a.length), a).accepted, false);
  assert.equal(analyzeAlignment(a, shortReference(2).reverse()).accepted, false);
  const periodic = Float32Array.from(a, (_, i) => i % 40 < 5 ? 1 : 0);
  assert.equal(analyzeAlignment(periodic, periodic).accepted, false);
});
test('590s signal: estimates both clock drift and offset to better than 1/30s', () => {
  const a = reference(590), result = analyzeAlignment(a, shifted(a, 0.25, 1.001));
  assert.ok(result.accepted, result.reason); assert.ok(result.driftDetected);
  assert.ok(Math.abs(result.rate - 1.001) < 0.00003);
  for (const t of [0, 295, 589]) assert.ok(Math.abs(externalTime(t, result.offsetSeconds, result.rate) - (t * 1.001 + 0.25)) < 1 / 30);
});
test('silent, unrelated and repetitive audio must not invent a match', () => {
  const a = reference(); assert.equal(analyzeAlignment(new Float32Array(a.length), a).accepted, false);
  const periodic = Float32Array.from(a, (_, i) => i % 100 < 3 ? 1 : 0);
  assert.equal(analyzeAlignment(periodic, periodic).accepted, false);
  assert.equal(analyzeAlignment(a, Float32Array.from(a, (_, i) => Math.sin(i * 0.532))).accepted, false);
});
test('reject too-short signals and non-linear edits', () => {
  assert.throws(() => analyzeAlignment(new Float32Array(10), reference()));
  const a = reference(), b = shifted(a, 0.25);
  for (let i = a.length / 2; i < a.length; i++) b[i] = a[i - 100];
  assert.equal(analyzeAlignment(a, b).accepted, false);
});
test('FFT correlation agrees with a hand-calculated positive lag', () => {
  const a = reference(4), b = new Float32Array(a.length + 100); b.set(a, 50); const r = correlate(a, b, 0, 100);
  assert.equal(r.lag, 50); assert.ok(r.score > 0.999);
});
test('neutral audio processing preserves the waveform exactly; state survives block boundaries', () => {
  const x = Float32Array.from({ length: 2000 }, (_, i) => Math.sin(i * 0.1) * 0.2);
  const copy = x.slice(); new AudioProcessor(48000, 1).process([copy]); assert.deepEqual(copy, x);
  const all = x.slice(), first = x.slice(0, 800), second = x.slice(800), config = { compressor: true, highpass: 80, bass: 3 };
  new AudioProcessor(48000, 1, config).process([all]); const streaming = new AudioProcessor(48000, 1, config); streaming.process([first]); streaming.process([second]);
  assert.deepEqual([...first, ...second], [...all]);
});
test('gain/clipping, compressor reduction and DC rejection are measurable', () => {
  const loud = new Float32Array(100).fill(0.9), dsp = new AudioProcessor(48000, 1, { gain: 12 }); dsp.process([loud]); assert.equal(dsp.clipped, 100);
  const dc = new Float32Array(48000).fill(0.25); new AudioProcessor(48000, 1, { highpass: 80 }).process([dc]); assert.ok(Math.abs(dc.at(-1)) < 1e-5);
  const sustain = new Float32Array(48000).fill(0.8); new AudioProcessor(48000, 1, { compressor: true }).process([sustain]); assert.ok(sustain.at(-1) < 0.4);
});
test('neutral video is pixel-identical and crop/presets keep correct proportions', () => {
  const data = Uint8ClampedArray.from([20, 100, 220, 255, 200, 1, 40, 255]); const copy = data.slice(); processPixels(copy, 2, 1); assert.deepEqual(copy, data);
  const rect = cropRectangle(1920, 1080, 9 / 16, { zoom: 2, x: 1 }); assert.ok(rect.x + rect.width <= 1920); assert.ok(Math.abs(rect.width / rect.height - 9 / 16) < 1e-6);
  assert.deepEqual(outputDimensions(1920, 1080, '9:16', '1080'), { width: 1080, height: 1920 });
  assert.deepEqual(outputDimensions(1920, 1080, '4:5', '1080'), { width: 1080, height: 1350 });
});
test('exposure raises pixel values without changing alpha; denoise and sharpness keep output finite', () => {
  const pixels = new Uint8ClampedArray(4 * 25).fill(60); for (let i = 3; i < pixels.length; i += 4) pixels[i] = 255;
  processPixels(pixels, 5, 5, { exposure: 1, denoise: 20, sharpness: 15 }); assert.equal(pixels[0], 120); assert.equal(pixels[3], 255);
});
