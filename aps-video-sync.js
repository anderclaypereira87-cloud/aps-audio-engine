/** Local, deterministic audio alignment. No model, generated audio or network calls.
 * Convention: videoTime = offsetSeconds + externalTime / rate.
 * Positive offset delays the external audio; negative offset advances it.
 */
export const ENVELOPE_HZ = 200;

function fft(re, im, inverse = false) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let size = 2; size <= n; size *= 2) {
    const angle = (inverse ? 2 : -2) * Math.PI / size;
    const wr = Math.cos(angle), wi = Math.sin(angle);
    for (let base = 0; base < n; base += size) {
      let ar = 1, ai = 0;
      for (let j = 0; j < size / 2; j++) {
        const a = base + j, b = a + size / 2;
        const tr = ar * re[b] - ai * im[b], ti = ar * im[b] + ai * re[b];
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
        const next = ar * wr - ai * wi; ai = ar * wi + ai * wr; ar = next;
      }
    }
  }
  if (inverse) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
}

function prefix(a) {
  const sum = new Float64Array(a.length + 1), square = new Float64Array(a.length + 1);
  for (let i = 0; i < a.length; i++) { sum[i + 1] = sum[i] + a[i]; square[i + 1] = square[i] + a[i] * a[i]; }
  return { sum, square };
}

/** Full normalized cross-correlation with overlap/energy checks and ambiguity score. */
export function correlate(a, b, minLag, maxLag, exclusion = 24, minOverlapRatio = 0.85) {
  let n = 1;
  while (n < a.length + b.length) n *= 2;
  const ar = new Float64Array(n), ai = new Float64Array(n), br = new Float64Array(n), bi = new Float64Array(n);
  ar.set(a); br.set(b); fft(ar, ai); fft(br, bi);
  for (let i = 0; i < n; i++) {
    const r = ar[i] * br[i] + ai[i] * bi[i];
    ai[i] = ar[i] * bi[i] - ai[i] * br[i]; ar[i] = r;
  }
  fft(ar, ai, true);
  const pa = prefix(a), pb = prefix(b), scores = [];
  const minOverlap = Math.max(Math.min(80, a.length), Math.ceil(a.length * minOverlapRatio));
  let best = { lag: 0, score: -1, prominence: 0 };
  for (let lag = Math.ceil(minLag); lag <= Math.floor(maxLag); lag++) {
    const a0 = Math.max(0, -lag), b0 = Math.max(0, lag), count = Math.min(a.length - a0, b.length - b0);
    if (count < minOverlap) continue;
    const sa = pa.sum[a0 + count] - pa.sum[a0], sb = pb.sum[b0 + count] - pb.sum[b0];
    const va = pa.square[a0 + count] - pa.square[a0] - sa * sa / count;
    const vb = pb.square[b0 + count] - pb.square[b0] - sb * sb / count;
    if (va < 1e-8 || vb < 1e-8) continue;
    const score = (ar[(lag + n) % n] - sa * sb / count) / Math.sqrt(va * vb);
    scores.push({ lag, score });
    if (score > best.score) best = { lag, score, prominence: 0 };
  }
  let second = -1;
  for (const s of scores) if (Math.abs(s.lag - best.lag) > exclusion) second = Math.max(second, s.score);
  best.prominence = best.score - second;
  return best;
}

const median = xs => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : NaN; };
function fit(points) {
  const mx = points.reduce((s, p) => s + p.video, 0) / points.length;
  const my = points.reduce((s, p) => s + p.external, 0) / points.length;
  let xx = 0, xy = 0;
  for (const p of points) { xx += (p.video - mx) ** 2; xy += (p.video - mx) * (p.external - my); }
  const rate = xx > 1e-6 ? xy / xx : 1;
  return { rate, intercept: my - rate * mx };
}

/** Envelope combines the log waveform energy and onset/transient strength. */
export function transientFeatures(energy) {
  const out = new Float32Array(energy.length);
  let max = 0;
  for (const e of energy) max = Math.max(max, e);
  if (max < 1e-7) return out;
  let previous = 0;
  for (let i = 0; i < out.length; i++) {
    const v = Math.log1p(30 * energy[i] / max);
    out[i] = 0.35 * v + 0.65 * Math.max(0, v - previous); previous = v;
  }
  return out;
}

function localCorrelation(a, b, lag, from, to) {
  let count = 0, sa = 0, sb = 0, aa = 0, bb = 0, ab = 0;
  for (let i = from; i < to; i++) {
    const j = i + lag;
    if (j < 0 || j >= b.length) continue;
    const x = a[i], y = b[j];
    count++; sa += x; sb += y; aa += x * x; bb += y * y; ab += x * y;
  }
  if (count < (to - from) * 0.55 || count < 25) return -1;
  const va = aa - sa * sa / count, vb = bb - sb * sb / count;
  return va > 1e-7 && vb > 1e-7 ? (ab - sa * sb / count) / Math.sqrt(va * vb) : -1;
}

/** Short clips lack three independent windows for drift estimation.
 * Use a conservative full-signal match, verified separately at both ends.
 */
function analyzeShortAlignment(a, b, hz, maxOffset, onProgress) {
  // Match the shorter recording against *all* of the longer one. An excerpt
  // may occur minutes into a video rather than near the beginning.
  const referenceIsShorter = a.length <= b.length;
  const template = referenceIsShorter ? a : b;
  const haystack = referenceIsShorter ? b : a;
  const duration = template.length / hz;
  const maxLag = Math.round(Math.min(maxOffset * hz, haystack.length));
  const peak = correlate(template, haystack, -maxLag, maxLag, Math.max(15, Math.round(hz * 0.12)), 0.58);
  onProgress(0.65);
  const center = Math.floor(template.length / 2);
  const first = localCorrelation(template, haystack, peak.lag, 0, center);
  const last = localCorrelation(template, haystack, peak.lag, center, template.length);
  onProgress(1);
  const accepted = peak.score >= 0.78 && peak.prominence >= 0.075 && first >= 0.55 && last >= 0.55;
  if (!accepted) return { accepted: false, reason: 'Trecho curto sem marcadores suficientes ou som de referência diferente. Confira se o vídeo tem áudio audível e ajuste manualmente.', points: [], rejected: [], confidence: peak.score, shortClip: true };
  const offsetSeconds = (referenceIsShorter ? -1 : 1) * peak.lag / hz;
  const videoTime = referenceIsShorter ? duration / 2 : duration / 2 + peak.lag / hz;
  const externalTime = referenceIsShorter ? duration / 2 + peak.lag / hz : duration / 2;
  return { accepted: true, offsetSeconds, rate: 1, driftDetected: false, driftSeconds: 0, driftPpm: 0,
    residualSeconds: 0, confidence: Math.min(peak.score, first, last),
    points: [{ video: videoTime, external: externalTime, score: peak.score, prominence: peak.prominence }],
    rejected: [], resolutionSeconds: 1 / hz, shortClip: true };
}

function analyzeWindowAlignment(a, b, hz, referenceLength, candidateLag, searchSeconds, onProgress) {
  const availableFrom = Math.max(0, -candidateLag), availableUntil = Math.min(a.length, b.length - candidateLag);
  const available = availableUntil - availableFrom;
  if (available < hz * 3.5) return { accepted: false, reason: 'Sobreposição sonora curta demais para confirmar a sincronização.', points: [], rejected: [] };
  const seconds = available / hz;
  const windowSize = Math.min(Math.floor(8 * hz), Math.floor(available * 0.7));
  const count = seconds > 20 ? 7 : 3, points = [], rejected = [];
  const searchSamples = Math.round(searchSeconds * hz);
  for (let k = 0; k < count; k++) {
    const start = Math.round(availableFrom + (available - windowSize) * (k + 0.5) / count);
    const begin = Math.max(0, start + candidateLag - searchSamples);
    const end = Math.min(b.length, start + windowSize + candidateLag + searchSamples);
    if (end - begin < windowSize) { rejected.push({ video: (start + windowSize / 2) / hz, score: -1 }); continue; }
    const peak = correlate(a.subarray(start, start + windowSize), b.subarray(begin, end), 0, end - begin - windowSize, Math.round(hz * 0.15));
    const point = { video: (start + windowSize / 2) / hz, external: (begin + peak.lag + windowSize / 2) / hz, score: peak.score, prominence: peak.prominence };
    if (peak.score >= 0.48 && peak.prominence >= 0.035) points.push(point); else rejected.push(point);
    onProgress((k + 1) / count);
  }
  if (points.length < 3) return { accepted: false, reason: 'Referência silenciosa, diferente ou repetitiva: não há 3 marcadores confiáveis. Ajuste manualmente.', points, rejected };
  const slopes = [];
  for (let i = 0; i < points.length; i++) for (let j = i + 1; j < points.length; j++) {
    if (points[j].video - points[i].video > 1) slopes.push((points[j].external - points[i].external) / (points[j].video - points[i].video));
  }
  const slope = slopes.length ? median(slopes) : 1, intercept = median(points.map(p => p.external - slope * p.video));
  const inliers = points.filter(p => Math.abs(p.external - (slope * p.video + intercept)) <= 0.025);
  if (inliers.length < 3 || inliers.length < points.length * 0.7) return { accepted: false, reason: 'Os marcadores discordam. Pode haver cortes ou outra execução; use o ajuste manual.', points, rejected };
  const model = fit(inliers);
  const residualSeconds = Math.max(...inliers.map(p => Math.abs(p.external - (model.rate * p.video + model.intercept))));
  if (Math.abs(model.rate - 1) > 0.005 || residualSeconds > 0.025) return { accepted: false, reason: 'Desvio irregular ou velocidade fora do limite de 0,5%. Não foi aplicada correção automática.', points, rejected };
  const driftSeconds = (model.rate - 1) * referenceLength / hz;
  // Do not introduce a rate correction for sub-resolution measurement noise.
  const driftDetected = Math.abs(driftSeconds) > 0.02;
  const rate = driftDetected ? model.rate : 1;
  const offsetSeconds = driftDetected ? -model.intercept / rate : -median(inliers.map(p => p.external - p.video));
  return { accepted: true, offsetSeconds, rate, driftDetected, driftSeconds, driftPpm: (rate - 1) * 1e6, residualSeconds, confidence: median(inliers.map(p => p.score)), points: inliers, rejected, resolutionSeconds: 1 / hz };
}

export function analyzeAlignment(reference, external, { hz = ENVELOPE_HZ, maxOffset = 600, onProgress = () => {} } = {}) {
  if (reference.length < hz * 0.75 || external.length < hz * 0.75) throw Error('Trecho inferior a 0,75 segundo: áudio insuficiente para sincronização confiável. Use o ajuste manual.');
  if (!Number.isFinite(maxOffset) || maxOffset < 0 || maxOffset > 600) throw Error('Busca de deslocamento fora do limite de 10 minutos.');
  const a = transientFeatures(reference), b = transientFeatures(external);
  const seconds = Math.min(a.length, b.length) / hz;
  if (seconds < 3.5) return analyzeShortAlignment(a, b, hz, maxOffset, onProgress);
  // Fast original path first: preserve the proven multi-marker drift analysis.
  const localSearch = Math.min(30, maxOffset);
  const near = analyzeWindowAlignment(a, b, hz, reference.length, 0, localSearch, f => onProgress(f * 0.4));
  if (near.accepted || maxOffset <= localSearch) { onProgress(1); return near; }

  // FFT-based wide search runs only when the local window match failed.
  // It can find a shared passage shifted by minutes; a peak is NOT sufficient
  // by itself, as repetitive songs may produce a deceptive correlation.
  const referenceIsShorter = a.length <= b.length;
  const template = referenceIsShorter ? a : b, haystack = referenceIsShorter ? b : a;
  const maxLag = Math.round(Math.min(maxOffset * hz, haystack.length));
  const overlapNeeded = template.length < haystack.length * 0.6 ? 0.58 : 0.2;
  const coarse = correlate(template, haystack, -maxLag, maxLag, Math.max(30, Math.round(hz * 0.2)), overlapNeeded);
  onProgress(0.65);
  if (coarse.score < 0.65 || coarse.prominence < 0.06)
    return { ...near, accepted: false, reason: 'Não encontrei trecho musical comum e único na busca ampliada. Use um áudio com referência audível ou ajuste manualmente.', wideSearch: true };
  const candidateLag = referenceIsShorter ? coarse.lag : -coarse.lag;
  const far = analyzeWindowAlignment(a, b, hz, reference.length, candidateLag, Math.min(2, localSearch), f => onProgress(0.65 + f * 0.35));
  if (!far.accepted) return { ...far, reason: 'Foi encontrada uma possível posição, mas faltou confirmação em trechos independentes. Ajuste manualmente.', wideSearch: true };
  onProgress(1);
  return { ...far, wideSearch: true, coarseOffsetSeconds: -candidateLag / hz };
}

export function externalTime(videoTime, offsetSeconds, rate = 1) { return (videoTime - offsetSeconds) * rate; }
