/** APS conventional frame-translation stabilization; does not recognize people or use AI.
 * Match textured image patches, reject outlier motion, and smooth a camera path.
 * Only translates/crops full frames; never warps limbs, instruments or sound.
 */
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const median = arr => {
  if (!arr.length) return 0;
  const a = [...arr].sort((x, y) => x - y), mid = a.length >> 1;
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
};

/** Input frame: {width,height,pixels:Uint8Array} monochrome luma. */
export function estimateTranslation(previous, current, radius = 8) {
  if (!previous || !current || previous.width !== current.width || previous.height !== current.height)
    throw Error('Quadros de movimento incompatíveis.');
  const { width: w, height: h } = previous, a = previous.pixels, b = current.pixels;
  if (w < 40 || h < 40) return { dx: 0, dy: 0, confidence: 0, inliers: 0 };
  const candidates = [], pad = radius + 4;
  for (let y = pad; y < h - pad; y += 9) for (let x = pad; x < w - pad; x += 9) {
    const k = y * w + x, contrast = Math.abs(a[k - 1] - a[k + 1]) + Math.abs(a[k - w] - a[k + w]);
    if (contrast > 26) candidates.push({ x, y, contrast });
  }
  candidates.sort((a, b) => b.contrast - a.contrast);
  const features = [];
  for (const p of candidates) {
    if (features.every(q => Math.abs(p.x - q.x) + Math.abs(p.y - q.y) > 17)) features.push(p);
    if (features.length >= 28) break;
  }
  const vectors = [], patch = 2;
  for (const { x, y } of features) {
    let min = Infinity, vx = 0, vy = 0;
    for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
      let error = 0;
      for (let py = -patch; py <= patch; py++) for (let px = -patch; px <= patch; px++)
        error += Math.abs(a[(y + py) * w + x + px] - b[(y + py + dy) * w + x + px + dx]);
      if (error < min) { min = error; vx = dx; vy = dy; }
    }
    if (min < 25 * 48) vectors.push({ dx: vx, dy: vy });
  }
  if (vectors.length < 5) return { dx: 0, dy: 0, confidence: 0, inliers: 0 };
  const mx = median(vectors.map(v => v.dx)), my = median(vectors.map(v => v.dy));
  const inliers = vectors.filter(v => Math.hypot(v.dx - mx, v.dy - my) <= 2);
  const confidence = inliers.length / vectors.length;
  if (inliers.length < 5 || confidence < 0.5) return { dx: 0, dy: 0, confidence, inliers: inliers.length };
  return { dx: median(inliers.map(v => v.dx)), dy: median(inliers.map(v => v.dy)), confidence, inliers: inliers.length };
}

export function buildStabilizationPlan(samples, width, height, seconds = 1.15) {
  if (!Array.isArray(samples) || !width || !height) throw Error('Amostras de estabilização inválidas.');
  if (samples.length < 3) return { kind: 'conventional-translation', width, height, points: [], coverage: 0, cropZoom: 1 };
  let x = 0, y = 0;
  const path = samples.map((v, i) => {
    if (i) { x += clamp(Number(v.dx) || 0, -width / 8, width / 8); y += clamp(Number(v.dy) || 0, -height / 8, height / 8); }
    return { t: v.t, x, y };
  });
  const sigma = Math.max(0.2, seconds / 1.7);
  const points = path.map(p => {
    let sx = 0, sy = 0, weight = 0;
    for (const q of path) {
      const dt = Math.abs(p.t - q.t);
      if (dt > seconds * 2.6) continue;
      const w = Math.exp(-0.5 * (dt / sigma) ** 2);
      sx += q.x * w; sy += q.y * w; weight += w;
    }
    return { t: p.t, dx: sx / weight - p.x, dy: sy / weight - p.y };
  });
  const maxX = Math.max(...points.map(p => Math.abs(p.dx))), maxY = Math.max(...points.map(p => Math.abs(p.dy)));
  const requiredZoom = Math.max(1, 1 + 2 * maxX / width, 1 + 2 * maxY / height);
  const coverage = samples.filter(p => (p.confidence || 0) >= 0.5).length / samples.length;
  return { kind: 'conventional-translation', width, height, points, cropZoom: requiredZoom <= 1.002 ? 1 : Math.min(1.4, requiredZoom * 1.03), requiredZoom, coverage, samples: samples.length };
}

export function motionAt(plan, seconds, strength = 100) {
  if (!plan?.points?.length || strength <= 0) return { dx: 0, dy: 0 };
  const p = plan.points, t = clamp(Number(seconds) || 0, p[0].t, p[p.length - 1].t);
  let lo = 0, hi = p.length - 1;
  while (lo < hi) { const m = (lo + hi) >> 1; if (p[m].t < t) lo = m + 1; else hi = m; }
  const b = p[lo], a = p[Math.max(0, lo - 1)], f = b.t > a.t ? (t - a.t) / (b.t - a.t) : 0;
  const k = clamp(strength / 100, 0, 1);
  return { dx: (a.dx + (b.dx - a.dx) * f) * k, dy: (a.dy + (b.dy - a.dy) * f) * k };
}
