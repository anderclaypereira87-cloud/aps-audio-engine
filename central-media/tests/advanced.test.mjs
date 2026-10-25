import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateTranslation, buildStabilizationPlan, motionAt } from '../advanced/stabilization.js';
import { drawVideo } from '../../aps-video-enhance.js';

function scene(width = 160, height = 90) {
  const pixels = new Uint8Array(width * height);
  let seed = 491;
  for (let i = 0; i < pixels.length; i++) {
    seed = (1664525 * seed + 1013904223) >>> 0;
    pixels[i] = seed >>> 24;
  }
  return { width, height, pixels };
}
function moved(frame, dx, dy, personShift = 0) {
  const { width: w, height: h } = frame;
  const pixels = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const sx = x - dx, sy = y - dy;
    pixels[y * w + x] = sx >= 0 && sx < w && sy >= 0 && sy < h ? frame.pixels[sy * w + sx] : 0;
  }
  // A moving foreground object must not dominate the camera translation.
  for (let y = 36; y < 55; y++) for (let x = 65 + personShift; x < 89 + personShift; x++) pixels[y * w + x] = 220;
  return { width: w, height: h, pixels };
}
test('actual feature matching recovers camera movement with a moving foreground', () => {
  const first = moved(scene(), 0, 0);
  const next = moved(scene(), 4, -3, 8);
  const result = estimateTranslation(first, next);
  assert.ok(result.inliers >= 5, JSON.stringify(result));
  assert.ok(result.confidence >= 0.5);
  assert.ok(Math.abs(result.dx - 4) <= 1 && Math.abs(result.dy + 3) <= 1, JSON.stringify(result));
});
test('blank frames do not invent stabilization', () => {
  const a = { width: 160, height: 90, pixels: new Uint8Array(160 * 90) };
  const b = { ...a, pixels: a.pixels.slice() };
  assert.deepEqual(estimateTranslation(a, b), { dx: 0, dy: 0, confidence: 0, inliers: 0 });
});
test('trajectory smoothing returns bounded, time-interpolated, strength-scaled shifts', () => {
  const camera = [0, 5, -3, 6, -2, 4, 0];
  const samples = camera.map((x, t) => ({ t, dx: t ? x - camera[t - 1] : 0, dy: 0, confidence: 0.9 }));
  const plan = buildStabilizationPlan(samples, 160, 90);
  assert.equal(plan.kind, 'conventional-translation');
  assert.equal(plan.points.length, 7);
  assert.ok(plan.cropZoom >= 1);
  assert.deepEqual(motionAt(plan, 3.5, 0), { dx: 0, dy: 0 });
  const full = motionAt(plan, 3.5, 100), half = motionAt(plan, 3.5, 50);
  assert.ok(Math.abs(full.dx) > 0.1);
  assert.ok(Math.abs(full.dx - 2 * half.dx) < 1e-8);
  assert.ok(motionAt(plan, 0).dx !== undefined && motionAt(plan, 6).dy === 0);
  assert.deepEqual(samples.map(x => x.t), [0, 1, 2, 3, 4, 5, 6]);
});
test('low-confidence scans cannot fabricate reliable coverage', () => {
  const plan = buildStabilizationPlan(Array.from({ length: 8 }, (_, t) => ({ t, dx: 0, dy: 0, confidence: 0.1 })), 160, 90);
  assert.equal(plan.coverage, 0);
});
test('stabilization changes crop translation but never distorts frame dimensions', () => {
  const rectangles = [];
  const canvas = { width: 160, height: 90, getContext() { return { drawImage(_src, ...args) { rectangles.push(args); } }; } };
  const plan = { width: 160, height: 90, cropZoom: 1.2, points: [{ t: 0, dx: 0, dy: 0 }, { t: 1, dx: 5, dy: -3 }] };
  drawVideo(canvas, {}, 160, 90, { stabilization: 100, motionPlan: plan, videoTime: 0 });
  drawVideo(canvas, {}, 160, 90, { stabilization: 100, motionPlan: plan, videoTime: 1 });
  const a = rectangles[0], b = rectangles[1];
  assert.equal(a[2], b[2]); assert.equal(a[3], b[3]);
  assert.ok(b[0] < a[0] && b[1] > a[1], JSON.stringify(rectangles));
  assert.deepEqual(a.slice(4), [0, 0, 160, 90]);
});
