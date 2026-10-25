/** Conservative musician framing derived from actual person landmarks.
 * This is NOT an instrument detector. Every output can be overridden manually.
 */
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const BODY_POINTS = [0, 2, 5, 7, 8, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28];

export function regionFromPose(landmarks) {
  if (!Array.isArray(landmarks) || landmarks.length < 29) return null;
  const valid = BODY_POINTS.map(i => landmarks[i]).filter(p =>
    Number.isFinite(p?.x) && Number.isFinite(p?.y) &&
    (p.visibility == null || p.visibility >= 0.45) &&
    (p.presence == null || p.presence >= 0.45));
  if (valid.length < 7) return null;
  const xs = valid.map(p => clamp(p.x, 0, 1)), ys = valid.map(p => clamp(p.y, 0, 1));
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const spreadX = Math.max(0.08, maxX - minX), spreadY = Math.max(0.12, maxY - minY);
  // Safety area around wrists and fingers: the instrument itself is not detected.
  const left = clamp(minX - spreadX * 0.32, 0, 1), right = clamp(maxX + spreadX * 0.32, 0, 1);
  const top = clamp(minY - spreadY * 0.16, 0, 1), bottom = clamp(maxY + spreadY * 0.28, 0, 1);
  return { x: (left + right) / 2, y: (top + bottom) / 2, left, top, right, bottom, count: valid.length };
}

export function makeFramingPlan(readings, { minConfidence = 0.35 } = {}) {
  const samples = readings.filter(x => Number.isFinite(x.t)).sort((a, b) => a.t - b.t);
  if (samples.length < 2) throw Error('Poucos quadros para enquadramento.');
  const detections = samples.filter(s => s.region);
  const coverage = detections.length / samples.length;
  if (coverage < minConfidence) throw Error('Não foi possível detectar uma pessoa com segurança. Use o enquadramento manual.');
  const points = [];
  let last = null;
  for (const sample of samples) {
    const region = sample.region || last;
    if (!region) continue;
    // Time-domain low-pass makes the virtual camera slower than bodily motion.
    const dt = last ? Math.max(0.03, sample.t - last.t) : 1;
    const alpha = last ? clamp(dt / (dt + 0.9), 0.08, 0.55) : 1;
    const x = last ? last.x + (region.x - last.x) * alpha : region.x;
    const y = last ? last.y + (region.y - last.y) * alpha : region.y;
    const point = { t: sample.t, x, y, left: region.left, top: region.top, right: region.right, bottom: region.bottom };
    points.push(point); last = point;
  }
  return { kind: 'neural-human-pose', model: 'MediaPipe Pose Landmarker Lite float16/1',
    license: 'Apache-2.0 (Google BlazePose GHUM model card)', coverage, points, samples: samples.length };
}

export function frameAt(plan, time) {
  const points = plan?.points;
  if (!points?.length) return null;
  const t = clamp(Number(time) || 0, points[0].t, points[points.length - 1].t);
  let lo = 0, hi = points.length - 1;
  while (lo < hi) { const m = (lo + hi) >> 1; if (points[m].t < t) lo = m + 1; else hi = m; }
  const b = points[lo], a = points[Math.max(0, lo - 1)];
  const f = b.t > a.t ? (t - a.t) / (b.t - a.t) : 0;
  const keys = ['x', 'y', 'left', 'top', 'right', 'bottom'];
  return Object.fromEntries(keys.map(key => [key, a[key] + (b[key] - a[key]) * f]));
}

export function centerCropAt(rect, width, height, focus) {
  if (!focus) return rect;
  return { ...rect,
    x: clamp(focus.x * width - rect.width / 2, 0, Math.max(0, width - rect.width)),
    y: clamp(focus.y * height - rect.height / 2, 0, Math.max(0, height - rect.height)) };
}

/** Avoid cropping visible hands/body when the desired ratio is too narrow. */
export function needsSafeContain(rect, width, height, focus) {
  if (!focus || !Number.isFinite(focus.left) || !Number.isFinite(focus.right)) return false;
  return (focus.right - focus.left) * width > rect.width * 0.95 ||
    (focus.bottom - focus.top) * height > rect.height * 0.95;
}
