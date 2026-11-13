/**
 * APS — núcleo do equalizador gráfico/paramétrico (sem DOM).
 * Usado pelo painel da DAW e pelos testes. Não altera bass/mid/treble/hpf.
 */
(function (root) {
  'use strict';

  const TYPES = ['peaking', 'lowshelf', 'highshelf', 'highpass', 'lowpass'];
  const FREQS = [60, 125, 250, 500, 1000, 2000, 4000, 8000];
  const GAIN_MIN = -18;
  const GAIN_MAX = 18;
  const F_MIN = 20;
  const F_MAX = 20000;
  const Q_MIN = 0.1;
  const Q_MAX = 18;

  function clamp(v, lo, hi) {
    const n = Number(v);
    if (!Number.isFinite(n)) return lo;
    return Math.min(hi, Math.max(lo, n));
  }

  function defaultBands() {
    return FREQS.map((f, i) => ({
      type: i === 0 ? 'lowshelf' : i === FREQS.length - 1 ? 'highshelf' : 'peaking',
      f,
      g: 0,
      q: i === 0 || i === FREQS.length - 1 ? 0.7 : 1
    }));
  }

  function sanitizeBand(b) {
    if (!b || typeof b !== 'object') return null;
    const f = Number(b.f);
    if (!Number.isFinite(f)) return null;
    return {
      type: TYPES.includes(b.type) ? b.type : 'peaking',
      f: clamp(f, F_MIN, F_MAX),
      g: clamp(b.g, GAIN_MIN, GAIN_MAX),
      q: clamp(b.q == null ? 1 : b.q, Q_MIN, Q_MAX)
    };
  }

  function sanitize(g) {
    const src = Array.isArray(g && g.bands) ? g.bands : Array.isArray(g) ? g : [];
    const bands = src.map(sanitizeBand).filter(Boolean).slice(0, 10);
    return { bypass: !!(g && g.bypass), bands: bands.length ? bands : defaultBands() };
  }

  function cloneBands(bands) {
    return (bands || []).map((b) => ({ type: b.type, f: b.f, g: b.g, q: b.q }));
  }

  // RBJ Audio EQ Cookbook, then |H(e^{jω})| in dB.
  function biquadCoeffs(type, f, g, q, fs) {
    const w0 = 2 * Math.PI * (f / fs);
    const cos = Math.cos(w0);
    const sin = Math.sin(w0);
    const Q = Math.max(Q_MIN, q || 1);
    const alpha = sin / (2 * Q);
    const A = Math.pow(10, (g || 0) / 40);
    let b0, b1, b2, a0, a1, a2;
    switch (type) {
      case 'lowshelf': {
        const twoSqrtA = 2 * Math.sqrt(A) * alpha;
        b0 = A * ((A + 1) - (A - 1) * cos + twoSqrtA);
        b1 = 2 * A * ((A - 1) - (A + 1) * cos);
        b2 = A * ((A + 1) - (A - 1) * cos - twoSqrtA);
        a0 = (A + 1) + (A - 1) * cos + twoSqrtA;
        a1 = -2 * ((A - 1) + (A + 1) * cos);
        a2 = (A + 1) + (A - 1) * cos - twoSqrtA;
        break;
      }
      case 'highshelf': {
        const twoSqrtA = 2 * Math.sqrt(A) * alpha;
        b0 = A * ((A + 1) + (A - 1) * cos + twoSqrtA);
        b1 = -2 * A * ((A - 1) + (A + 1) * cos);
        b2 = A * ((A + 1) + (A - 1) * cos - twoSqrtA);
        a0 = (A + 1) - (A - 1) * cos + twoSqrtA;
        a1 = 2 * ((A - 1) - (A + 1) * cos);
        a2 = (A + 1) - (A - 1) * cos - twoSqrtA;
        break;
      }
      case 'highpass':
        b0 = (1 + cos) / 2;
        b1 = -(1 + cos);
        b2 = (1 + cos) / 2;
        a0 = 1 + alpha;
        a1 = -2 * cos;
        a2 = 1 - alpha;
        break;
      case 'lowpass':
        b0 = (1 - cos) / 2;
        b1 = 1 - cos;
        b2 = (1 - cos) / 2;
        a0 = 1 + alpha;
        a1 = -2 * cos;
        a2 = 1 - alpha;
        break;
      default: { // peaking
        b0 = 1 + alpha * A;
        b1 = -2 * cos;
        b2 = 1 - alpha * A;
        a0 = 1 + alpha / A;
        a1 = -2 * cos;
        a2 = 1 - alpha / A;
      }
    }
    return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
  }

  function biquadMagDb(coeffs, freq, fs) {
    const w = 2 * Math.PI * (freq / fs);
    const cos = Math.cos(w);
    const sin = Math.sin(w);
    const cos2 = Math.cos(2 * w);
    const sin2 = Math.sin(2 * w);
    const { b0, b1, b2, a1, a2 } = coeffs;
    const realN = b0 + b1 * cos + b2 * cos2;
    const imagN = -(b1 * sin + b2 * sin2);
    const realD = 1 + a1 * cos + a2 * cos2;
    const imagD = -(a1 * sin + a2 * sin2);
    const mag2 = (realN * realN + imagN * imagN) / Math.max(1e-20, realD * realD + imagD * imagD);
    return 20 * Math.log10(Math.sqrt(mag2));
  }

  function classicBands(params) {
    const p = params || {};
    return [
      { type: 'highpass', f: clamp(p.hpf == null ? 25 : p.hpf, 20, 500), g: 0, q: 0.7 },
      { type: 'lowshelf', f: 150, g: clamp(p.bass || 0, -12, 12), q: 0.7 },
      { type: 'peaking', f: clamp(p.midFreq == null ? 800 : p.midFreq, 200, 3000), g: clamp(p.mid || 0, -12, 12), q: 0.8 },
      { type: 'highshelf', f: 3800, g: clamp(p.treble || 0, -12, 12), q: 0.7 }
    ];
  }

  function responseDb(bands, freqs, fs) {
    const rate = fs || 44100;
    const list = (bands || []).map((b) => ({
      c: biquadCoeffs(b.type || 'peaking', b.f, b.g, b.q, rate)
    }));
    return freqs.map((f) => {
      let db = 0;
      for (const item of list) db += biquadMagDb(item.c, f, rate);
      return db;
    });
  }

  function logFreqs(n, lo, hi) {
    const a = Math.log(lo || 20);
    const b = Math.log(hi || 20000);
    const out = [];
    const count = n || 128;
    for (let i = 0; i < count; i++) out.push(Math.exp(a + (b - a) * (i / (count - 1))));
    return out;
  }

  function combinedResponse(params, graphic, freqs, fs) {
    const g = sanitize(graphic);
    const bands = classicBands(params).concat(g.bypass ? [] : g.bands);
    return responseDb(bands, freqs, fs);
  }

  function graphicResponse(graphic, freqs, fs) {
    const g = sanitize(graphic);
    return responseDb(g.bypass ? [] : g.bands, freqs, fs);
  }

  /** Band energies from a mono PCM buffer, in dB relative to peak band. */
  function spectrumSummary(samples, sampleRate, centers) {
    const sr = sampleRate || 44100;
    const data = samples || [];
    const freqs = centers || FREQS;
    const n = Math.min(data.length, sr * 8);
    const bands = freqs.map((f) => {
      // Goertzel at band center
      const w = 2 * Math.PI * f / sr;
      const coeff = 2 * Math.cos(w);
      let s0 = 0, s1 = 0, s2 = 0;
      const step = Math.max(1, Math.floor(n / 48000));
      for (let i = 0; i < n; i += step) {
        s0 = data[i] + coeff * s1 - s2;
        s2 = s1;
        s1 = s0;
      }
      const power = s1 * s1 + s2 * s2 - coeff * s1 * s2;
      const db = 10 * Math.log10(Math.max(power, 1e-12));
      return { f, db, energy: power };
    });
    const peak = Math.max(...bands.map((b) => b.db), -120);
    return bands.map((b) => ({ f: b.f, db: Math.round((b.db - peak) * 10) / 10, energy: b.energy }));
  }

  function mapCurveToDefault(curve) {
    const src = sanitize(curve).bands;
    const base = defaultBands();
    return base.map((slot) => {
      let best = src[0];
      let dist = Infinity;
      for (const b of src) {
        const d = Math.abs(Math.log(b.f / slot.f));
        if (d < dist) { dist = d; best = b; }
      }
      if (!best) return { ...slot };
      return {
        type: slot.type,
        f: slot.f,
        g: clamp(best.g, GAIN_MIN, GAIN_MAX),
        q: clamp(best.q, Q_MIN, Q_MAX)
      };
    });
  }

  const Core = {
    TYPES, FREQS, GAIN_MIN, GAIN_MAX, F_MIN, F_MAX, Q_MIN, Q_MAX,
    clamp, defaultBands, sanitizeBand, sanitize, cloneBands,
    biquadCoeffs, biquadMagDb, classicBands, responseDb, logFreqs,
    combinedResponse, graphicResponse, spectrumSummary, mapCurveToDefault
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Core;
  root.APSEqGraficoCore = Core;
})(typeof globalThis !== 'undefined' ? globalThis : this);
