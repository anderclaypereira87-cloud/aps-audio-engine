import test from 'node:test';
import assert from 'node:assert/strict';
import { regionFromPose, makeFramingPlan, frameAt, centerCropAt, needsSafeContain } from '../advanced/subject-framing.js';
import { drawVideo, cropRectangle } from '../../aps-video-enhance.js';

function body(cx = 0.5) {
  const points = Array.from({ length: 33 }, () => ({ x: cx, y: 0.5, visibility: 0.01 }));
  for (const i of [0, 2, 5, 7, 8, 11, 12, 13, 14, 15, 16, 19, 20, 23, 24, 25, 26, 27, 28]) {
    points[i] = { x: cx + ((i % 5) - 2) * 0.06, y: 0.16 + (i / 33) * 0.63, visibility: 0.98 };
  }
  return points;
}

test('real pose landmark geometry returns bounded region with hand/body safety margin', () => {
  const region = regionFromPose(body(0.32));
  assert.ok(region && region.count > 10);
  assert.ok(region.x < 0.4 && region.y < 0.7, JSON.stringify(region));
  assert.ok(region.left >= 0 && region.right <= 1);
  assert.equal(regionFromPose([]), null);
  assert.equal(regionFromPose(body().map(p => ({ ...p, visibility: 0.1 }))), null);
});

test('framing needs actual person detections and creates a smoothed time-based plan', () => {
  assert.throws(() => makeFramingPlan(Array.from({ length: 8 }, (_, t) => ({ t, region: null }))), /detectar uma pessoa/);
  const readings = Array.from({ length: 5 }, (_, t) => ({ t, region: regionFromPose(body(t < 2 ? 0.25 : 0.7)) }));
  const plan = makeFramingPlan(readings);
  assert.equal(plan.kind, 'neural-human-pose');
  assert.equal(plan.coverage, 1);
  const halfway = frameAt(plan, 2.5);
  assert.ok(halfway.x > 0.25 && halfway.x < 0.7);
  assert.deepEqual(frameAt(plan, -10), frameAt(plan, 0));
});

test('automatic crop is bounded, time-dependent, and manual adjustments work', () => {
  const plan = { points: [0, 1, 2].map(t => ({ t, x: t === 0 ? .25 : .7, y: .5, left: (t === 0 ? .25 : .7) - .08, right: (t === 0 ? .25 : .7) + .08, top: .3, bottom: .7 })) };
  const canvasCalls = [];
  const canvas = { width: 100, height: 150, getContext() { return { drawImage(_s, ...rect) { canvasCalls.push(rect); } }; } };
  drawVideo(canvas, {}, 1920, 1080, { autoFrame: true, framingPlan: plan, videoTime: 0, x: 0.5, y: 0.5 });
  drawVideo(canvas, {}, 1920, 1080, { autoFrame: true, framingPlan: plan, videoTime: 2, x: 0.5, y: 0.5 });
  drawVideo(canvas, {}, 1920, 1080, { autoFrame: true, framingPlan: plan, videoTime: 2, x: 1, y: 0.5 });
  assert.ok(canvasCalls[1][0] > canvasCalls[0][0], JSON.stringify(canvasCalls));
  assert.ok(canvasCalls[2][0] >= canvasCalls[1][0]);
  for (const [x, y, w, h] of canvasCalls) {
    assert.ok(x >= 0 && x + w <= 1920 + 1e-8);
    assert.ok(y >= 0 && y + h <= 1080 + 1e-8);
  }
  const rect = cropRectangle(1920, 1080, 9 / 16);
  const bounded = centerCropAt(rect, 1920, 1080, { x: 5, y: -5 });
  assert.equal(bounded.x, 1920 - rect.width);
  assert.equal(bounded.y, 0);
});

test('too-narrow format uses letterbox rather than cutting detected hands', () => {
  const region = regionFromPose(body(.5));
  const rect = cropRectangle(1920, 1080, 9 / 16);
  assert.equal(needsSafeContain(rect, 1920, 1080, region), true);
  const events = [];
  const canvas = { width: 108, height: 192, getContext() { return {
    fillRect(...args) { events.push(['fill', ...args]); },
    drawImage(_source, ...args) { events.push(['draw', ...args]); },
  }; } };
  drawVideo(canvas, {}, 1920, 1080, { autoFrame: true, framingPlan: { points: [{ t: 0, ...region }] }, videoTime: 0 });
  assert.equal(events[0][0], 'fill');
  assert.deepEqual(events[1].slice(0, 5), ['draw', 0, 0, 1920, 1080]);
  const [,, , , , dx, dy, dw, dh] = events[1];
  assert.ok(dx >= 0 && dy >= 0 && dw <= canvas.width && dh <= canvas.height);
});
