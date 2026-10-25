/** Deterministic, local music fingerprints: 12 pitch classes from an STFT.
 * No model, network, source replacement, or generative audio.
 * A fingerprint frame represents roughly 150 ms; do not claim frame-accurate
 * export synchronization from fingerprints alone.
 */
export const MUSIC_SAMPLE_RATE = 8000;
export const MUSIC_FFT_SIZE = 2048;
export const MUSIC_HOP = 1200;
export const MUSIC_HZ = MUSIC_SAMPLE_RATE / MUSIC_HOP;
const TAU = 2 * Math.PI;

function fft(real, imaginary) {
  const n = real.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    while (j & bit) { j ^= bit; bit >>= 1; }
    j ^= bit;
    if (i < j) {
      [real[i], real[j]] = [real[j], real[i]];
      [imaginary[i], imaginary[j]] = [imaginary[j], imaginary[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const angle = -TAU / len, cr = Math.cos(angle), ci = Math.sin(angle);
    for (let i = 0; i < n; i += len) {
      let wr = 1, wi = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const br = real[b] * wr - imaginary[b] * wi;
        const bi = real[b] * wi + imaginary[b] * wr;
        real[b] = real[a] - br; imaginary[b] = imaginary[a] - bi;
        real[a] += br; imaginary[a] += bi;
        const next = wr * cr - wi * ci; wi = wr * ci + wi * cr; wr = next;
      }
    }
  }
}

const pitchMap = Array.from({ length: MUSIC_FFT_SIZE / 2 + 1 }, (_, bin) => {
  const frequency = bin * MUSIC_SAMPLE_RATE / MUSIC_FFT_SIZE;
  if (frequency < 95 || frequency > 1800) return -1;
  return ((Math.round(69 + 12 * Math.log2(frequency / 440)) % 12) + 12) % 12;
});
const hann = Float32Array.from({ length: MUSIC_FFT_SIZE }, (_, i) => 0.5 - 0.5 * Math.cos(TAU * i / (MUSIC_FFT_SIZE - 1)));

/** Append decoded source samples incrementally. Input timestamps are seconds.
 * Downsampling uses a box integration before 8 kHz feature extraction.
 * Memory remains bounded by duration / 0.15 seconds rather than source PCM.
 */
export class MusicChromaExtractor {
  constructor({ maxDuration = 600 } = {}) {
    this.maxDuration = maxDuration;
    this.window = new Float32Array(MUSIC_FFT_SIZE);
    this.filled = 0;
    this.frames = [];
    this.currentBin = -1;
    this.binSum = 0;
    this.binCount = 0;
    this.re = new Float64Array(MUSIC_FFT_SIZE);
    this.im = new Float64Array(MUSIC_FFT_SIZE);
  }
  _frame() {
    for (let i = 0; i < MUSIC_FFT_SIZE; i++) {
      this.re[i] = this.window[i] * hann[i]; this.im[i] = 0;
    }
    fft(this.re, this.im);
    const chroma = new Float32Array(12);
    for (let bin = 1; bin < pitchMap.length; bin++) {
      const pitch = pitchMap[bin];
      if (pitch >= 0) chroma[pitch] += Math.hypot(this.re[bin], this.im[bin]);
    }
    this.frames.push(chroma);
    this.window.copyWithin(0, MUSIC_HOP);
    this.filled -= MUSIC_HOP;
  }
  _write(value) {
    this.window[this.filled++] = value;
    if (this.filled === MUSIC_FFT_SIZE) this._frame();
  }
  _flushBin() {
    if (this.currentBin >= 0) this._write(this.binCount ? this.binSum / this.binCount : 0);
    this.binSum = 0; this.binCount = 0;
  }
  add(value, seconds) {
    if (!Number.isFinite(value) || !Number.isFinite(seconds) || seconds < 0 || seconds > this.maxDuration) return;
    const bin = Math.floor(seconds * MUSIC_SAMPLE_RATE);
    if (this.currentBin < 0) {
      // Leading silence must preserve absolute time; do not slide the whole piece.
      this.currentBin = 0;
    }
    if (bin < this.currentBin) return;
    if (bin > this.currentBin) {
      this._flushBin();
      for (let skipped = this.currentBin + 1; skipped < bin; skipped++) this._write(0);
      this.currentBin = bin;
    }
    this.binSum += value; this.binCount++;
  }
  finish() {
    this._flushBin();
    // Subtract track-wide pitch bias so two unrelated songs in the same key
    // cannot achieve artificially high average cosine similarity.
    const means = new Float64Array(12);
    for (const frame of this.frames) for (let c = 0; c < 12; c++) means[c] += frame[c];
    for (let c = 0; c < 12; c++) means[c] /= Math.max(1, this.frames.length);
    const values = new Float32Array(this.frames.length * 12);
    let valid = 0;
    this.frames.forEach((frame, index) => {
      const magnitude = frame.reduce((s, x) => s + x, 0);
      if (magnitude < 1e-5) return;
      let norm = 0;
      for (let c = 0; c < 12; c++) {
        const v = Math.log1p(frame[c]) - Math.log1p(means[c]);
        values[index * 12 + c] = v; norm += v * v;
      }
      if (norm < 1e-7) return;
      valid++;
      norm = Math.sqrt(norm);
      for (let c = 0; c < 12; c++) values[index * 12 + c] /= norm;
    });
    return { values, hz: MUSIC_HZ, count: this.frames.length, validFraction: valid / Math.max(1, this.frames.length) };
  }
}

const med = values => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
};

function scoreWindow(a, b, a0, b0, width) {
  let sum = 0, count = 0;
  for (let j = 0; j < width; j++) {
    const ai = (a0 + j) * 12, bi = (b0 + j) * 12;
    let dot = 0, energyA = 0, energyB = 0;
    for (let c = 0; c < 12; c++) {
      const av = a[ai + c], bv = b[bi + c];
      dot += av * bv; energyA += av * av; energyB += bv * bv;
    }
    if (energyA > 0.1 && energyB > 0.1) { sum += dot; count++; }
  }
  return count >= width * 0.65 ? sum / count : -1;
}

function localPeaks(reference, external, start, width, maxCandidates) {
  const candidates = [];
  for (let i = 0; i <= external.count - width; i++) {
    const score = scoreWindow(reference.values, external.values, start, i, width);
    if (score < 0.28) continue;
    const peak = { video: (start + width / 2) / reference.hz, external: (i + width / 2) / external.hz, score };
    const nearby = candidates.findIndex(p => Math.abs(p.external - peak.external) < 0.75);
    if (nearby >= 0) {
      if (candidates[nearby].score < peak.score) candidates[nearby] = peak;
    } else candidates.push(peak);
    candidates.sort((x, y) => y.score - x.score);
    if (candidates.length > maxCandidates) candidates.length = maxCandidates;
  }
  return candidates;
}

/** Match a common performance with a robust linear mapping.
 * Returns *detection*, not permission to resample or alter pitch.
 * At least four independent matching passages are required.
 */
export function analyzeMusicalAlignment(reference, external, { maxOffset = 600, minRate = 0.90, maxRate = 1.10, onProgress = () => {} } = {}) {
  if (!reference || !external || Math.abs(reference.hz - external.hz) > 1e-4 ||
      reference.validFraction < 0.22 || external.validFraction < 0.22)
    return { accepted: false, reason: 'Sem notas e acordes audíveis suficientes para comparar.', points: [], rejected: [] };
  const width = Math.max(12, Math.round(reference.hz * 2.8));
  if (reference.count < width + 20 || external.count < width + 20)
    return { accepted: false, reason: 'Trecho musical curto demais para estimar diferenças grandes de velocidade.', points: [], rejected: [] };
  const count = 12, candidates = [];
  for (let k = 0; k < count; k++) {
    const start = Math.floor((reference.count - width) * (k + .5) / count);
    candidates.push(localPeaks(reference, external, start, width, 5));
    onProgress((k + 1) / count * 0.6);
  }
  const anchors = candidates.flat();
  if (anchors.length < 4) return { accepted: false, reason: 'Não encontrei quatro trechos musicais compatíveis.', points: anchors, rejected: [] };
  let best = null;
  // Rate/offset hypotheses come from two independently located passages.
  // Try every pair of strong candidates, then count independent inliers.
  for (let i = 0; i < anchors.length; i++) for (let j = i + 1; j < anchors.length; j++) {
    const p = anchors[i], q = anchors[j], difference = q.video - p.video;
    if (Math.abs(difference) < 4) continue;
    const rate = (q.external - p.external) / difference;
    if (rate < minRate || rate > maxRate) continue;
    const intercept = p.external - rate * p.video;
    if (Math.abs(intercept) > maxOffset) continue;
    const hits = [];
    for (const group of candidates) {
      const match = group.find(c => Math.abs(c.external - (rate * c.video + intercept)) < 0.3 && c.score >= 0.33);
      if (match) hits.push(match);
    }
    const quality = hits.reduce((s, point) => s + Math.max(0, point.score - 0.3), 0);
    if (!best || hits.length > best.hits.length || hits.length === best.hits.length && quality > best.quality)
      best = { rate, intercept, hits, quality };
  }
  onProgress(0.85);
  if (!best || best.hits.length < 4 || Math.max(...best.hits.map(p => p.video)) - Math.min(...best.hits.map(p => p.video)) < (reference.count / reference.hz) * 0.45)
    return { accepted: false, reason: 'Correspondências ambíguas ou insuficientes para confirmar o desvio.', points: best?.hits || [], rejected: [] };
  // Median pairwise slope rejects one misleading repeated passage.
  const slopes = [];
  for (let i = 0; i < best.hits.length; i++) for (let j = i + 1; j < best.hits.length; j++) {
    const dx = best.hits[j].video - best.hits[i].video;
    if (dx >= 4) slopes.push((best.hits[j].external - best.hits[i].external) / dx);
  }
  const rate = Math.min(maxRate, Math.max(minRate, med(slopes)));
  const intercept = med(best.hits.map(p => p.external - rate * p.video));
  const points = best.hits.filter(p => Math.abs(p.external - (rate * p.video + intercept)) <= 0.31);
  const residualSeconds = Math.max(...points.map(p => Math.abs(p.external - (rate * p.video + intercept))));
  const confidence = med(points.map(p => p.score));
  // Fingerprint timing is quantized to 150 ms. Allow one analysis-bin slope
  // uncertainty at the exact ±10% boundary, never in the export resampler.
  const quantizedRateTolerance = 1 / reference.hz / (reference.count / reference.hz);
  const consistent = points.length >= 4 && rate >= minRate - quantizedRateTolerance && rate <= maxRate + quantizedRateTolerance && confidence >= 0.38 && residualSeconds <= 0.3;
  onProgress(1);
  if (!consistent) return { accepted: false, reason: 'Trechos parecidos, mas com tempo inconsistente. Nada foi ajustado.', points, rejected: best.hits.filter(p => !points.includes(p)), confidence, estimatedRate: rate, residualSeconds };
  const offsetSeconds = -intercept / rate, driftSeconds = (rate - 1) * reference.count / reference.hz;
  return { accepted: true, method: 'music-chroma-stft', offsetSeconds, rate, driftDetected: Math.abs(driftSeconds) > .02,
    driftSeconds, driftPpm: (rate - 1) * 1e6, confidence, residualSeconds, points,
    rejected: best.hits.filter(p => !points.includes(p)), resolutionSeconds: 1 / reference.hz,
    verifiedFrameAccurate: false, pitchPreserved: false };
}
