/* APS Motor Elástico — núcleo de DSP (Fase 1).
 * Criado para o APS Audio Engine por Anderclay Pereira Silva.
 * Puro JavaScript, sem dependências: roda em Web Worker, na página ou no Node (testes).
 * - Reamostragem com filtro anti-aliasing (sinc janelado)
 * - Detector de altura MPM (McLeod Pitch Method) com FFT
 * - Ataques por fluxo espectral + energia, marcadores de warp e mapa de tempo contínuo
 * - Render elástico: Signalsmith Stretch (WASM, MIT) com proteção de ataque, WSOLA de reserva
 * - TD-PSOLA com marcas refinadas por correlação, mapa de tempo, mapa de altura e formantes
 * - Plano de afinação natural: desloca a curva da nota (mantém vibrato), transição em curva
 * O áudio original nunca é alterado: tudo devolve novos Float32Array. */
(function (root) {
'use strict';
const C = {};
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const midiOf = f => 69 + 12 * Math.log2(f / 440);
const freqOf = m => 440 * Math.pow(2, (m - 69) / 12);
C.clamp = clamp; C.midiOf = midiOf; C.freqOf = freqOf;
C.NOTE = ['Dó', 'Dó#', 'Ré', 'Ré#', 'Mi', 'Fá', 'Fá#', 'Sol', 'Sol#', 'Lá', 'Lá#', 'Si'];
C.NOTE_EN = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
C.SCALES = { maior: [0, 2, 4, 5, 7, 9, 11], menor: [0, 2, 3, 5, 7, 8, 10], harm_menor: [0, 2, 3, 5, 7, 8, 11], pent_maior: [0, 2, 4, 7, 9], pent_menor: [0, 3, 5, 7, 10], blues: [0, 3, 5, 6, 7, 10], cromatica: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] };
C.SCALE_NAMES = { maior: 'Maior', menor: 'Menor', harm_menor: 'Menor harmônica', pent_maior: 'Pentatônica maior', pent_menor: 'Pentatônica menor', blues: 'Blues', cromatica: 'Cromática (todas as notas)' };
C.noteName = m => { const r = Math.round(m); return C.NOTE[((r % 12) + 12) % 12] + (Math.floor(r / 12) - 1); };

function mono(channels) {
  const n = channels[0].length, out = new Float32Array(n), k = channels.length;
  for (const ch of channels) for (let i = 0; i < n; i++) out[i] += ch[i] / k;
  return out;
}
C.mono = mono;

// ---------------- FFT (radix-2, in place) ----------------
const fftCache = new Map();
function fftTables(n) {
  let t = fftCache.get(n); if (t) return t;
  const rev = new Uint32Array(n), bits = Math.log2(n) | 0;
  for (let i = 0; i < n; i++) { let r = 0, x = i; for (let b = 0; b < bits; b++) { r = (r << 1) | (x & 1); x >>= 1; } rev[i] = r; }
  const cos = new Float64Array(n / 2), sin = new Float64Array(n / 2);
  for (let i = 0; i < n / 2; i++) { cos[i] = Math.cos(2 * Math.PI * i / n); sin[i] = Math.sin(2 * Math.PI * i / n); }
  t = { rev, cos, sin }; fftCache.set(n, t); return t;
}
function fft(re, im, inverse) {
  const n = re.length, { rev, cos, sin } = fftTables(n);
  for (let i = 0; i < n; i++) { const j = rev[i]; if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1, step = n / size;
    for (let s = 0; s < n; s += size) for (let k = 0; k < half; k++) {
      const wr = cos[k * step], wi = inverse ? sin[k * step] : -sin[k * step];
      const a = s + k, b = a + half, xr = re[b] * wr - im[b] * wi, xi = re[b] * wi + im[b] * wr;
      re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi;
    }
  }
  if (inverse) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
}
C.fft = fft;

// ---------------- Reamostragem com anti-aliasing ----------------
// Sinc janelado (Blackman). Ao reduzir a taxa, o corte acompanha a nova Nyquist (anti-aliasing).
function resample(x, srIn, srOut, opts = {}) {
  if (srIn === srOut) return Float32Array.from(x);
  const ratio = srOut / srIn, cutoff = Math.min(1, ratio) * (opts.rolloff || 0.94);
  const zc = opts.zeroCrossings || 12, half = Math.ceil(zc / cutoff);
  const n = Math.floor(x.length * ratio), y = new Float32Array(n), N = x.length;
  for (let i = 0; i < n; i++) {
    const t = i / ratio, c = Math.floor(t);
    let acc = 0, wsum = 0;
    for (let k = c - half + 1; k <= c + half; k++) {
      const d = t - k, u = d / half;
      if (u <= -1 || u >= 1) continue;
      const a = Math.PI * cutoff * d, s = a === 0 ? 1 : Math.sin(a) / a;
      const w = 0.42 + 0.5 * Math.cos(Math.PI * u) + 0.08 * Math.cos(2 * Math.PI * u);
      const h = s * w; wsum += h;
      if (k >= 0 && k < N) acc += x[k] * h;
    }
    y[i] = wsum ? acc / wsum : 0;
  }
  return y;
}
C.resample = resample;

// ---------------- MPM (McLeod Pitch Method) ----------------
// NSDF por FFT; escolhe o primeiro máximo-chave >= k * maior máximo; interpolação parabólica.
function createMPM(size) {
  const n2 = 1 << Math.ceil(Math.log2(size * 2)), re = new Float64Array(n2), im = new Float64Array(n2), nsdf = new Float64Array(size);
  return function (frame, sr, opt = {}) {
    const W = Math.min(size, frame.length), fmin = opt.fmin || 27, fmax = opt.fmax || 2200, kThr = opt.k || 0.9;
    let mean = 0; for (let i = 0; i < W; i++) mean += frame[i]; mean /= W;
    let energy = 0;
    re.fill(0); im.fill(0);
    for (let i = 0; i < W; i++) { const v = frame[i] - mean; re[i] = v; energy += v * v; }
    const rms = Math.sqrt(energy / W);
    if (rms < (opt.minRms ?? 1e-4)) return { freq: 0, clarity: 0, rms };
    fft(re, im, false);
    for (let i = 0; i < n2; i++) { re[i] = re[i] * re[i] + im[i] * im[i]; im[i] = 0; }
    fft(re, im, true);
    // m'(tau) = sum x[j]^2 + x[j+tau]^2, j < W - tau
    let m = 2 * re[0];
    const maxLag = Math.min(W - 2, Math.ceil(sr / fmin)), minLag = Math.max(2, Math.floor(sr / fmax));
    const x0 = (i) => frame[i] - mean;
    for (let tau = 0; tau <= maxLag + 1 && tau < W; tau++) {
      nsdf[tau] = m > 0 ? 2 * re[tau] / m : 0;
      const a = x0(tau), b = x0(W - 1 - tau); m -= a * a + b * b;
    }
    // máximos-chave entre cruzamentos positivos
    const peaks = []; let tau = 1;
    while (tau < maxLag && nsdf[tau] > 0) tau++;
    let best = -1, bestV = -1;
    for (; tau < maxLag; tau++) {
      if (nsdf[tau] > 0 && nsdf[tau - 1] <= 0) { best = -1; bestV = -1; }
      if (nsdf[tau] > 0 && nsdf[tau] >= nsdf[tau - 1] && nsdf[tau] >= nsdf[tau + 1] && nsdf[tau] > bestV) { best = tau; bestV = nsdf[tau]; }
      if (best >= 0 && nsdf[tau] <= 0 && nsdf[tau - 1] > 0) { peaks.push(best); best = -1; bestV = -1; }
    }
    if (best >= 0) peaks.push(best);
    const valid = peaks.filter(p => p >= minLag);
    if (!valid.length) return { freq: 0, clarity: 0, rms };
    let hi = 0; for (const p of valid) hi = Math.max(hi, nsdf[p]);
    const pick = valid.find(p => nsdf[p] >= kThr * hi);
    const a = nsdf[pick - 1], b = nsdf[pick], c = nsdf[pick + 1], den = a - 2 * b + c;
    const shift = den ? clamp(0.5 * (a - c) / den, -0.5, 0.5) : 0;
    const clarity = Math.min(1, b - 0.25 * (a - c) * shift);
    return { freq: sr / (pick + shift), clarity, rms };
  };
}
C.createMPM = createMPM;

// Curva de altura offline com MPM (reserva e graves < 46,9 Hz). Quadros de 16 ms como o SwiftF0.
function mpmTrack(x, sr, opt = {}) {
  const target = opt.rate || 16000, y = resample(x, sr, target), hop = Math.round(target * 0.016), W = opt.window || 2048;
  const est = createMPM(W), estSmall = createMPM(W), small = new Float32Array(W), frames = Math.max(1, Math.floor(y.length / hop));
  const f0 = new Float32Array(frames), conf = new Float32Array(frames), buf = new Float32Array(W);
  for (let i = 0; i < frames; i++) {
    const c = i * hop, s = c - (W >> 1);
    for (let k = 0; k < W; k++) { const j = s + k; buf[k] = j >= 0 && j < y.length ? y[j] : 0; }
    let r = est(buf, target, { fmin: opt.fmin || 28, fmax: Math.min(opt.fmax || 1500, target / 4), k: 0.88, minRms: 2e-4 });
    if (r.freq > 110) { // janela curta para notas médias/agudas: acompanha vibrato e ataques
      const Ws = Math.max(256, Math.min(W, Math.round(4.5 * target / r.freq) * 2)), s2 = c - (Ws >> 1);
      for (let k = 0; k < Ws; k++) { const j = s2 + k; small[k] = j >= 0 && j < y.length ? y[j] : 0; }
      const r2 = estSmall(small.subarray(0, Ws), target, { fmin: r.freq / 1.6, fmax: r.freq * 1.6, k: 0.88, minRms: 2e-4 });
      if (r2.freq > 0 && Math.abs(12 * Math.log2(r2.freq / r.freq)) < 1) r = r2;
    }
    f0[i] = r.freq; conf[i] = r.clarity;
  }
  return { f0, conf, hopSec: hop / target, source: 'mpm' };
}
C.mpmTrack = mpmTrack;

// Afinador em tempo real: filtro anti-aliasing (2 biquads), redução para ~16 kHz, janela de
// 2048 amostras (~130 ms, cabe o Si grave de 30,9 Hz do baixo de 5 cordas) e MPM a cada ~40 ms.
C.createTunerDSP = function (sampleRate, opt = {}) {
  const D = Math.max(1, Math.round(sampleRate / 16000)), rate = sampleRate / D, W = opt.window || 2048, hop = opt.hop || 640;
  const fc = Math.min(0.42 * rate, 5000), w0 = 2 * Math.PI * fc / sampleRate, al = Math.sin(w0) / (2 * Math.SQRT1_2), cw = Math.cos(w0);
  const b0 = (1 - cw) / 2 / (1 + al), b1 = (1 - cw) / (1 + al), b2 = b0, a1 = -2 * cw / (1 + al), a2 = (1 - al) / (1 + al);
  const z = new Float64Array(8), ring = new Float32Array(W), frame = new Float32Array(W), est = createMPM(W);
  let w = 0, filled = 0, sinceHop = 0, phase = 0;
  return {
    rate, decimation: D,
    push(input) {
      let res = null;
      for (let i = 0; i < input.length; i++) {
        let x = input[i];
        let y = b0 * x + z[0]; z[0] = b1 * x - a1 * y + z[1]; z[1] = b2 * x - a2 * y; x = y;
        y = b0 * x + z[2]; z[2] = b1 * x - a1 * y + z[3]; z[3] = b2 * x - a2 * y;
        if (++phase < D) continue; phase = 0;
        ring[w] = y; w = (w + 1) % W; if (filled < W) filled++;
        if (++sinceHop >= hop && filled === W) {
          sinceHop = 0;
          for (let k = 0; k < W; k++) frame[k] = ring[(w + k) % W];
          res = est(frame, rate, { fmin: opt.fmin || 27, fmax: opt.fmax || 2100, k: 0.9, minRms: opt.minRms || 0.003 });
        }
      }
      return res;
    }
  };
};

// Combina SwiftF0 com MPM: usa MPM só onde o SwiftF0 não vê (ex.: Si grave 30,9 Hz) ou se falhar.
function fuseTracks(swift, mpm) {
  if (!swift) return finishTrack(mpm, 0.6);
  const n = swift.f0.length, f0 = new Float32Array(n), conf = new Float32Array(n);
  let fromMpm = 0;
  for (let i = 0; i < n; i++) {
    const j = Math.min(mpm.f0.length - 1, Math.round(i * swift.hopSec / mpm.hopSec));
    const mf = mpm.f0[j], mc = mpm.conf[j];
    if (swift.conf[i] >= 0.5 && swift.f0[i] > 0) { f0[i] = swift.f0[i]; conf[i] = swift.conf[i]; }
    else if (mf > 0 && mc >= 0.85 && mf < 52) { f0[i] = mf; conf[i] = mc; fromMpm++; }
  }
  return finishTrack({ f0, conf, hopSec: swift.hopSec, source: fromMpm ? 'swiftf0+mpm' : 'swiftf0' }, 0.5);
}
C.fuseTracks = fuseTracks;

// SwiftF0 (MIT): mesmo recorte em janelas do pacote oficial (1875 quadros, 11 à esquerda, 10 à frente)
// e confiança zerada em silêncio digital (pico < 1e-3). run(Float32Array) -> {pitch, confidence}
C.SWIFT = { rate: 16000, hop: 256, fmin: 46.875, fmax: 2093.75, windowFrames: 1875, left: 11, ahead: 10, silence: 1e-3 };
async function swiftF0Track(x16, run) {
  const S = C.SWIFT, n = Math.max(1, Math.floor(x16.length / S.hop)), f0 = new Float32Array(n), conf = new Float32Array(n);
  for (let start = 0; start < n; start += S.windowFrames) {
    const end = Math.min(start + S.windowFrames, n), left = Math.max(0, start - S.left);
    const a = left * S.hop, b = end < n ? Math.min(x16.length, (end + S.ahead) * S.hop) : x16.length;
    const win = x16.subarray(a, b), r = await run(win);
    for (let i = start; i < end; i++) {
      const j = i - left; if (j < 0 || j >= r.pitch.length) continue;
      let pk = 0; const h0 = i * S.hop; for (let k = h0; k < Math.min(x16.length, h0 + S.hop); k++) pk = Math.max(pk, Math.abs(x16[k]));
      f0[i] = r.pitch[j]; conf[i] = pk < S.silence ? 0 : r.confidence[j];
    }
  }
  return { f0, conf, hopSec: S.hop / S.rate, source: 'swiftf0' };
}
C.swiftF0Track = swiftF0Track;
function finishTrack(t, thr) {
  const n = t.f0.length, f0 = new Float32Array(n);
  for (let i = 0; i < n; i++) f0[i] = t.conf[i] >= thr && t.f0[i] > 0 ? t.f0[i] : 0;
  // remove saltos isolados de oitava (mediana de 5 em quadros sonoros)
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    if (!f0[i]) continue; const w = [];
    for (let k = -2; k <= 2; k++) { const v = f0[i + k]; if (v > 0) w.push(v); }
    w.sort((a, b) => a - b); const med = w[w.length >> 1];
    out[i] = Math.abs(12 * Math.log2(f0[i] / med)) > 5 && w.length >= 3 ? med : f0[i];
  }
  // tira ilhas sonoras curtas (< 3 quadros)
  for (let i = 0; i < n;) { if (!out[i]) { i++; continue; } let j = i; while (j < n && out[j]) j++; if (j - i < 3) out.fill(0, i, j); i = j; }
  return { f0: out, conf: t.conf, hopSec: t.hopSec, source: t.source };
}
C.finishTrack = finishTrack;

// ---------------- Ataques: fluxo espectral + energia ----------------
function detectOnsets(channels, sr, opt = {}) {
  const x = channels.length > 1 ? mono(channels) : channels[0], N = 1024, hop = 256;
  const frames = Math.max(0, Math.floor((x.length - N) / hop) + 1);
  if (frames < 4) return [];
  const win = new Float64Array(N); for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N);
  const re = new Float64Array(N), im = new Float64Array(N), prev = new Float64Array(N / 2), flux = new Float32Array(frames), en = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    const s = f * hop; let e = 0;
    for (let i = 0; i < N; i++) { const v = x[s + i]; re[i] = v * win[i]; im[i] = 0; e += v * v; }
    en[f] = Math.sqrt(e / N);
    fft(re, im, false);
    let fl = 0;
    for (let k = 1; k < N / 2; k++) { const mag = Math.log1p(1000 * Math.hypot(re[k], im[k])), d = mag - prev[k]; if (d > 0) fl += d; prev[k] = mag; }
    flux[f] = fl;
  }
  let maxE = 0; for (const v of en) maxE = Math.max(maxE, v);
  if (maxE < 1e-3) return [];
  const eRise = new Float32Array(frames);
  for (let f = 1; f < frames; f++) eRise[f] = Math.max(0, Math.log((en[f] + 1e-4) / (en[f - 1] + 1e-4)));
  const norm = a => { let m = 0; for (const v of a) m = Math.max(m, v); return m ? a.map(v => v / m) : a; };
  const fN = norm(flux), eN = norm(eRise), odf = new Float32Array(frames);
  for (let f = 0; f < frames; f++) odf[f] = 0.7 * fN[f] + 0.3 * eN[f];
  const spacing = Math.max(2, Math.round((opt.minGapMs || 55) / 1000 * sr / hop)), sens = opt.sensitivity ?? 1;
  const found = [];
  for (let f = 2; f < frames - 1; f++) {
    if (odf[f] < odf[f - 1] || odf[f] < odf[f + 1]) continue;
    let s = 0, cnt = 0; const ws = Math.max(0, f - 16), we = Math.min(frames, f + 6);
    const vals = []; for (let k = ws; k < we; k++) vals.push(odf[k]); vals.sort((a, b) => a - b);
    const med = vals[vals.length >> 1]; for (const v of vals) { s += v; cnt++; }
    const thr = (0.06 + med * 1.0 + (s / cnt) * 0.35) / sens;
    if (odf[f] < thr || en[f] < maxE * 0.02) continue;
    const last = found[found.length - 1];
    if (last && f - last.f < spacing) { if (odf[f] > last.v) found[found.length - 1] = { f, v: odf[f] }; continue; }
    found.push({ f, v: odf[f] });
  }
  // mascaramento: um pico fraco logo depois de um ataque forte é a cauda do mesmo som
  const maskF = Math.round((opt.maskMs || 160) / 1000 * sr / hop), kept = [];
  for (const o of found) {
    const strong = kept.find(k => o.f - k.f <= maskF && k.v > 2.2 * o.v);
    if (!strong) kept.push(o);
  }
  // refino em 1 ms: maior subida de envelope perto do quadro
  const step = Math.max(1, Math.round(sr / 1000));
  return kept.map((o, idx) => {
    const center = o.f * hop + (N >> 1), a = Math.max(0, center - Math.round(0.03 * sr)), b = Math.min(x.length - step, center + Math.round(0.012 * sr));
    let best = center, bestD = -1, prevE = -1;
    for (let p = a; p < b; p += step) {
      let e = 0; for (let i = 0; i < step; i++) e = Math.max(e, Math.abs(x[p + i]));
      if (prevE >= 0 && e - prevE > bestD) { bestD = e - prevE; best = p; }
      prevE = e;
    }
    return { index: idx, time: Math.max(0, best - step) / sr, strength: o.v };
  });
}
C.detectOnsets = detectOnsets;

// ---------------- Marcadores de warp e mapa de tempo ----------------
// markers: [{id, src, dst, locked, auto}] em segundos. src = onde está no original, dst = onde vai tocar.
function planWarp(onsets, opt) {
  const duration = opt.duration, bpm = clamp(Number(opt.bpm) || 100, 30, 300);
  const sub = [4, 8, 12, 16, 24, 32].includes(Number(opt.subdivision)) ? Number(opt.subdivision) : 16;
  const unit = 60 / bpm * 4 / sub, strength = clamp((opt.strength ?? 100) / 100, 0, 1);
  const maxShift = (opt.maxShiftMs ?? 0) > 0 ? opt.maxShiftMs / 1000 : unit / 2;
  const offset = Number(opt.gridOffset) || 0, edits = opt.edits || {}, removed = new Set(opt.removed || []);
  const list = [];
  for (const o of onsets) {
    const id = 'o' + o.index; if (removed.has(id)) continue;
    list.push({ id, src: o.time, strength: o.strength, auto: true });
  }
  for (const a of (opt.added || [])) list.push({ id: a.id, src: a.src, auto: false });
  list.sort((a, b) => a.src - b.src);
  const markers = [];
  for (const m of list) {
    if (m.src <= 0.003 || m.src >= duration - 0.003) continue;
    const e = edits[m.id] || {};
    let dst;
    if (Number.isFinite(e.dst)) dst = e.dst;
    else if (e.locked) dst = m.src;
    else {
      const grid = Math.round((m.src - offset) / unit) * unit + offset, want = (grid - m.src) * strength;
      dst = m.src + clamp(want, -maxShift, maxShift);
    }
    markers.push({ id: m.id, src: m.src, dst, locked: !!e.locked, manual: Number.isFinite(e.dst), auto: m.auto, grid: Math.round((m.src - offset) / unit) * unit + offset });
  }
  return { markers: sanitizeMarkers(markers, duration), unit, bpm, subdivision: sub, strength, duration };
}
C.planWarp = planWarp;
// mantém a ordem e espaço mínimo (nunca inverte nem encosta dois ataques)
function sanitizeMarkers(markers, duration) {
  const out = markers.slice().sort((a, b) => a.src - b.src);
  const minGap = 0.012;
  for (let i = 0; i < out.length; i++) {
    const prevDst = i ? out[i - 1].dst : 0, prevSrc = i ? out[i - 1].src : 0;
    const floor = prevDst + Math.max(minGap, 0.3 * (out[i].src - prevSrc));
    if (out[i].dst < floor) out[i].dst = floor;
  }
  for (let i = out.length - 1; i >= 0; i--) {
    const nextDst = i < out.length - 1 ? out[i + 1].dst : duration, nextSrc = i < out.length - 1 ? out[i + 1].src : duration;
    const ceil = nextDst - Math.max(minGap, 0.3 * (nextSrc - out[i].src));
    if (out[i].dst > ceil) out[i].dst = ceil;
  }
  return out;
}
C.sanitizeMarkers = sanitizeMarkers;

// Mapa contínuo saída→entrada. Proteção de ataque: logo após cada marcador o áudio anda 1:1.
function buildTimeMap(markers, duration, opt = {}) {
  const protect = (opt.protectMs ?? 25) / 1000;
  const pts = [{ src: 0, dst: 0, attack: false }].concat(markers.map(m => ({ src: m.src, dst: m.dst, attack: true, id: m.id })), [{ src: duration, dst: duration, attack: false }]);
  const segs = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1], inLen = b.src - a.src, outLen = b.dst - a.dst;
    if (inLen <= 0 || outLen <= 0) continue;
    const p = a.attack ? Math.min(protect, 0.5 * inLen, 0.5 * outLen) : 0;
    const bodyIn = inLen - p, bodyOut = outLen - p, ratio = bodyOut / bodyIn;
    segs.push({ dst0: a.dst, dst1: b.dst, src0: a.src, src1: b.src, protect: p, ratio, rate: bodyIn / bodyOut, attack: a.attack, id: a.id });
  }
  const map = {
    segs, duration, protect,
    input(t) { // tempo de saída -> tempo de entrada
      let lo = 0, hi = segs.length - 1;
      while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (segs[mid].dst0 <= t) lo = mid; else hi = mid - 1; }
      const s = segs[lo]; if (!s) return t;
      const u = t - s.dst0;
      if (u <= s.protect) return s.src0 + u;
      return s.src0 + s.protect + (u - s.protect) * s.rate;
    },
    rateAt(t) { const s = segs.find(s => t >= s.dst0 && t < s.dst1) || segs[segs.length - 1]; if (!s) return 1; return t - s.dst0 <= s.protect ? 1 : s.rate; },
    output(src) { // tempo de entrada -> tempo de saída (inverso)
      const s = segs.find(s => src >= s.src0 && src < s.src1) || segs[segs.length - 1]; if (!s) return src;
      const u = src - s.src0; if (u <= s.protect) return s.dst0 + u;
      return s.dst0 + s.protect + (u - s.protect) / s.rate;
    }
  };
  map.warnings = segs.filter(s => s.ratio < 0.75 || s.ratio > 1.5).map(s => ({ from: s.dst0, to: s.dst1, ratio: s.ratio, id: s.id }));
  return map;
}
C.buildTimeMap = buildTimeMap;
C.identityMap = duration => buildTimeMap([], duration);

// ---------------- Render polifônico com Signalsmith Stretch (WASM) ----------------
// Modo "streaming": a cada bloco de saída entrega exatamente a entrada que o mapa pede
// (process(inputCount, outputCount)). Medido nos testes: alinhamento de 0 amostra com mapa 1:1.
function renderSignalsmith(wasm, channels, sr, map, opt = {}) {
  const ch = channels.length, inLen = channels[0].length, outLen = opt.outLength || Math.round(map.duration * sr);
  if (opt.cheaper) wasm._presetCheaper(ch, sr); else wasm._presetDefault(ch, sr);
  wasm._reset();
  const inLat = wasm._inputLatency(), outLat = wasm._outputLatency(), B = opt.block || 256, cap = inLat + outLat + B * 8;
  const ptr = wasm._setBuffers(ch, cap), bytes = cap * 4;
  wasm._setTransposeSemitones(opt.semitones || 0, (opt.tonalityHz || 8000) / sr);
  wasm._setFormantSemitones(opt.formantSemitones || 0, opt.formantCompensation ? 1 : 0);
  wasm._setFormantBase((opt.formantBaseHz || 0) / sr);
  const heap = () => (wasm.HEAPF32 ? wasm.HEAPF32.buffer : wasm.HEAP8.buffer);
  const fill = (start, count) => { const H = heap(); for (let c = 0; c < ch; c++) { const d = new Float32Array(H, ptr + bytes * c, count), s = channels[c]; for (let i = 0; i < count; i++) { const j = start + i; d[i] = j >= 0 && j < inLen ? s[j] : 0; } } };
  const inPos = t => Math.round(map.input(clamp(t, 0, map.duration)) * sr + (t > map.duration ? (t - map.duration) * sr : 0) + (t < 0 ? t * sr : 0));
  let fed = inPos(outLat / sr) + inLat;
  const prime = inLat + outLat; fill(fed - prime, prime); wasm._seek(prime, map.rateAt(0) || 1);
  const out = Array.from({ length: ch }, () => new Float32Array(outLen));
  for (let o = 0; o < outLen; o += B) {
    const n = Math.min(B, outLen - o), target = inPos((o + n + outLat) / sr) + inLat, cnt = clamp(target - fed, 0, cap);
    fill(fed, cnt); fed += cnt;
    wasm._process(cnt, n);
    const H = heap(); for (let c = 0; c < ch; c++) out[c].set(new Float32Array(H, ptr + bytes * (c + ch), n), o);
    if (opt.onProgress && (o / B) % 400 === 0) opt.onProgress(o / outLen);
  }
  // os primeiros ms do motor espectral saem com fade de partida: completa com o original mapeado
  const head = Math.min(outLen, Math.round(sr * 0.045));
  for (let i = 0; i < head; i++) {
    const k = i / head, xi = Math.round(map.input(i / sr) * sr);
    for (let c = 0; c < ch; c++) { const v = xi >= 0 && xi < inLen ? channels[c][xi] : 0; out[c][i] = v * (1 - k) + out[c][i] * k; }
  }
  return out;
}
C.renderSignalsmith = renderSignalsmith;

// ---------------- Render de reserva: WSOLA com mapa de tempo ----------------
function renderWSOLA(channels, sr, map, opt = {}) {
  const ch = channels.length, inLen = channels[0].length, outLen = opt.outLength || Math.round(map.duration * sr);
  const N = opt.frame || Math.round(sr * 0.04) & ~1, Hs = N >> 1, tol = Math.round(sr * 0.008);
  const guide = ch > 1 ? mono(channels) : channels[0];
  const win = new Float32Array(N); for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N);
  const out = Array.from({ length: ch }, () => new Float32Array(outLen + N)), wsum = new Float32Array(outLen + N);
  let prevSrc = -1;
  const guard = Math.round(sr * 0.002), near = Math.round((map.protect || 0.025) * sr), bnd = (map.segs || []).map((g, k, a) => ({ d0: Math.round(g.dst0 * sr), s0: k ? Math.round(g.src0 * sr) - guard : -inLen, s1: k < a.length - 1 ? Math.round(g.src1 * sr) - guard : 2 * inLen }));
  for (let o = -Hs; o < outLen; o += Hs) {
    const nominal = Math.round(map.input(clamp((o + Hs) / sr, 0, map.duration)) * sr) - Hs;
    let best = nominal;
    // perto de um ataque a leitura fica exata (sem deslizar): o golpe cai no lugar certo e não dobra
    let nearAttack = false; for (let k = 1; k < bnd.length; k++) { const d = bnd[k].d0 - (o + Hs); if (d > -N - near && d < N + near) { nearAttack = true; break; } if (d > N + near) break; }
    if (prevSrc >= 0 && tol > 0 && !nearAttack) {
      const nat = prevSrc + Hs; let bc = -Infinity; const L = Math.min(Hs, 512);
      for (let d = -tol; d <= tol; d += 2) {
        const s = nominal + d; let c = 0;
        for (let i = 0; i < L; i += 2) { const a = s + i, b = nat + i; if (a >= 0 && a < inLen && b >= 0 && b < inLen) c += guide[a] * guide[b]; }
        if (c > bc) { bc = c; best = s; }
      }
    }
    prevSrc = best;
    let si = 0; while (si < bnd.length - 1 && bnd[si + 1].d0 <= o) si++;
    for (let i = 0; i < N; i++) {
      const y = o + i, x = best + i; if (y < 0 || y >= outLen) continue;
      while (si < bnd.length - 1 && bnd[si + 1].d0 <= y) si++;
      // nunca leva um pedaço do próximo ataque para antes do lugar dele (sem eco/ataque dobrado)
      if (bnd.length && (x >= bnd[si].s1 || x < bnd[si].s0)) continue;
      if (x < 0 || x >= inLen) continue;
      const w = win[i]; wsum[y] += w;
      for (let c = 0; c < ch; c++) out[c][y] += channels[c][x] * w;
    }
  }
  // onde a guarda de ataque deixou pouca cobertura, completa com a leitura direta do mapa (sem buraco)
  const thr = 0.35;
  for (let i = 0; i < outLen; i++) {
    const ws = wsum[i];
    if (ws >= thr) { for (let c = 0; c < ch; c++) out[c][i] /= ws; continue; }
    const xi = Math.round(map.input(i / sr) * sr), k = (thr - ws) / thr;
    for (let c = 0; c < ch; c++) { const fb = xi >= 0 && xi < inLen ? channels[c][xi] : 0; out[c][i] = (out[c][i] + fb * thr * k) / thr; }
  }
  return out.map(o => o.subarray(0, outLen).slice());
}
C.renderWSOLA = renderWSOLA;

// Proteção de ataque: copia o ataque original (só deslocado no tempo) por cima do render,
// com cross-fade curto. Não há corte: o render contínuo existe em todos os pontos.
function protectAttacks(rendered, channels, sr, map, opt = {}) {
  const pre = Math.round((opt.preMs ?? 4) / 1000 * sr), fade = Math.max(8, Math.round((opt.fadeMs ?? 4) / 1000 * sr)), inLen = channels[0].length;
  for (const s of map.segs) {
    if (!s.attack || s.protect <= 0) continue;
    const d0 = Math.round(s.dst0 * sr) - pre, d1 = Math.round((s.dst0 + s.protect) * sr), shift = Math.round(s.src0 * sr) - Math.round(s.dst0 * sr);
    for (let y = d0; y < d1; y++) {
      if (y < 0 || y >= rendered[0].length) continue;
      const x = y + shift; if (x < 0 || x >= inLen) continue;
      const k = Math.min(1, (y - d0) / fade, (d1 - y) / fade);
      for (let c = 0; c < rendered.length; c++) rendered[c][y] = rendered[c][y] * (1 - k) + channels[c][x] * k;
    }
  }
  return rendered;
}
C.protectAttacks = protectAttacks;

// ---------------- TD-PSOLA ----------------
// Marcas de ciclo: começa no pico do primeiro período e segue por correlação normalizada
// (em sinal reduzido 4× + refino fino), evitando a aspereza de "pico bruto".
function pitchMarks(x, sr, track) {
  const N = x.length, hopS = track.hopSec * sr, f0At = s => { const i = Math.round(s / hopS); return i >= 0 && i < track.f0.length ? track.f0[i] : 0; };
  const D = 4, xd = new Float32Array(Math.floor(N / D));
  for (let i = 0; i < xd.length; i++) { let s = 0; for (let k = 0; k < D; k++) s += x[i * D + k]; xd[i] = s / D; }
  const corr = (arr, a, b, L) => { let s = 0, ea = 0, eb = 0; for (let i = -L; i < L; i++) { const u = arr[a + i] || 0, v = arr[b + i] || 0; s += u * v; ea += u * u; eb += v * v; } return s / Math.sqrt(ea * eb + 1e-12); };
  const marks = []; const unvP = Math.round(sr * 0.005);
  let t = 0, prevVoiced = false;
  while (t < N) {
    const f = f0At(t);
    if (!f) { marks.push({ t, P: unvP, v: false }); t += unvP; prevVoiced = false; continue; }
    const P = sr / f;
    if (!prevVoiced) { // âncora no pico absoluto do primeiro período
      let bi = Math.round(t), bv = -1; for (let k = Math.round(t); k < Math.min(N, t + P); k++) { const v = Math.abs(x[k]); if (v > bv) { bv = v; bi = k; } }
      t = bi; marks.push({ t, P, v: true }); prevVoiced = true; t += P; continue;
    }
    const prev = marks[marks.length - 1], pred = prev.t + P, rad = Math.max(2, Math.round(P / 4 / D)), L = Math.max(4, Math.round(P / 2 / D));
    let bc = -2, bd = Math.round(pred / D);
    for (let d = -rad; d <= rad; d++) { const c = corr(xd, Math.round(prev.t / D), Math.round(pred / D) + d, L); if (c > bc) { bc = c; bd = Math.round(pred / D) + d; } }
    let best = bd * D, bf = -2; const Lf = Math.max(8, Math.round(P / 2));
    for (let d = -D; d <= D; d++) { const c = corr(x, Math.round(prev.t), best + d, Lf); if (c > bf) { bf = c; best = best + d; } }
    if (best <= prev.t + P * 0.5) best = Math.round(prev.t + P);
    marks.push({ t: best, P: Math.max(8, best - prev.t), v: true }); t = best + P;
  }
  return marks;
}
C.pitchMarks = pitchMarks;

// ratioAt(srcSeconds) -> razão de altura; formant: semitons de timbre (0 = preserva)
function renderPSOLA(channels, sr, marks, map, ratioAt, opt = {}) {
  const outLen = opt.outLength || Math.round(map.duration * sr), inLen = channels[0].length, ch = channels.length;
  const ff = Math.pow(2, (opt.formantSemitones || 0) / 12);
  const out = Array.from({ length: ch }, () => new Float32Array(outLen)), wsum = new Float32Array(outLen);
  if (marks.length && marks[0].t > 0) marks = [{ t: 0, P: Math.max(8, marks[0].t), v: false }].concat(marks);
  let k = 0, ts = marks.length ? Math.round(map.output(marks[0].t / sr) * sr) : outLen;
  while (ts < outLen) {
    const ti = map.input(ts / sr) * sr;
    while (k + 1 < marks.length && Math.abs(marks[k + 1].t - ti) <= Math.abs(marks[k].t - ti)) k++;
    while (k > 0 && Math.abs(marks[k - 1].t - ti) < Math.abs(marks[k].t - ti)) k--;
    const m = marks[k], P = m.P, r = m.v ? clamp(ratioAt(m.t / sr), 0.25, 4) : 1;
    const Pout = P / r, half = Math.round(m.v ? Math.min(Math.max(P, Pout), 1.5 * P) : P);
    const gHalf = m.v && ff !== 1 ? Math.round(half / ff) : half, center = Math.round(ts), src = m.t;
    for (let j = -gHalf; j < gHalf; j++) {
      const y = center + j; if (y < 0 || y >= outLen) continue;
      const w = 0.5 + 0.5 * Math.cos(Math.PI * j / gHalf);
      const xs = src + j * (gHalf === half ? 1 : ff), xi = Math.floor(xs), fr = xs - xi;
      if (xi < 0 || xi + 1 >= inLen) { wsum[y] += w; continue; }
      for (let c = 0; c < ch; c++) { const a = channels[c]; out[c][y] += (a[xi] + (a[xi + 1] - a[xi]) * fr) * w; }
      wsum[y] += w;
    }
    const step = k + 1 < marks.length ? marks[k + 1].t - m.t : P; // segue as marcas: com razão 1 reconstrói o original
    ts += m.v ? Math.max(4, step / r) : Math.max(4, step);
  }
  for (let c = 0; c < ch; c++) { const o = out[c]; for (let i = 0; i < outLen; i++) o[i] = wsum[i] > 0.08 ? o[i] / wsum[i] : o[i] / 0.08; }
  return out;
}
C.renderPSOLA = renderPSOLA;

// ---------------- Plano de afinação natural ----------------
function smoothCurve(m, voiced, radius) {
  const n = m.length, out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    if (!voiced[i]) continue; let s = 0, w = 0;
    for (let k = -radius; k <= radius; k++) { const j = i + k; if (j < 0 || j >= n || !voiced[j]) continue; const ww = 1 - Math.abs(k) / (radius + 1); s += m[j] * ww; w += ww; }
    out[i] = s / w;
  }
  return out;
}
function snap(m, key, scale) {
  const sc = C.SCALES[scale] || C.SCALES.cromatica; let best = Math.round(m), bd = 1e9;
  for (let o = Math.floor(m) - 2; o <= Math.ceil(m) + 2; o++) { if (!sc.includes(((o - key) % 12 + 12) % 12)) continue; const d = Math.abs(o - m); if (d < bd) { bd = d; best = o; } }
  return best;
}
C.snap = snap;
function median(a) { const s = Array.from(a).sort((x, y) => x - y); return s.length ? s[s.length >> 1] : 0; }

function analyzeNotes(track) {
  const n = track.f0.length, m = new Float32Array(n), voiced = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (track.f0[i] > 0) { m[i] = midiOf(track.f0[i]); voiced[i] = 1; }
  const vibR = Math.max(2, Math.round(0.09 / track.hopSec)); // ~180 ms: remove vibrato (4–8 Hz)
  const sm = smoothCurve(m, voiced, vibR);
  const notes = []; let i = 0;
  while (i < n) {
    if (!voiced[i]) { i++; continue; }
    let j = i; while (j < n && voiced[j]) j++;
    // divide a frase em notas quando a curva lenta muda de patamar
    let s = i, ref = sm[i];
    for (let k = i + 1; k <= j; k++) {
      const edge = k === j;
      if (!edge && Math.abs(sm[k] - ref) < 0.55) { ref = ref * 0.9 + sm[k] * 0.1; continue; }
      if (!edge) { let hold = 0; for (let q = k; q < Math.min(j, k + Math.round(0.05 / track.hopSec)); q++) if (Math.abs(sm[q] - ref) >= 0.55) hold++; if (hold < Math.round(0.04 / track.hopSec)) continue; }
      notes.push({ start: s, end: k - 1 }); s = k; ref = sm[k] ?? ref;
    }
    i = j;
  }
  const minLen = Math.max(3, Math.round(0.06 / track.hopSec)), merged = [];
  for (const nt of notes) {
    const last = merged[merged.length - 1];
    if (nt.end - nt.start + 1 < minLen && last && last.end + 1 >= nt.start) { last.end = nt.end; continue; }
    merged.push({ ...nt });
  }
  const out = merged.filter(nt => nt.end - nt.start + 1 >= 3).map((nt, idx) => {
    const center = median(m.subarray(nt.start, nt.end + 1));
    return { id: 'n' + idx, start: nt.start, end: nt.end, center, t0: nt.start * track.hopSec, t1: (nt.end + 1) * track.hopSec };
  });
  return { notes: out, midi: m, smooth: sm, voiced };
}
C.analyzeNotes = analyzeNotes;

function guessKey(track, an) {
  const PROF = { maior: [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88], menor: [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17] };
  const h = new Float64Array(12);
  for (const nt of an.notes) h[((Math.round(nt.center) % 12) + 12) % 12] += nt.end - nt.start + 1;
  let best = { key: 0, scale: 'maior', s: -1e9 };
  for (let k = 0; k < 12; k++) for (const sc of ['maior', 'menor']) { let s = 0; for (let i = 0; i < 12; i++) s += h[(i + k) % 12] * PROF[sc][i]; if (s > best.s) best = { key: k, scale: sc, s }; }
  return { key: best.key, scale: best.scale };
}
C.guessKey = guessKey;

// opt: key, scale, amount(0-100), vibrato(0-150), drift(0-100), transitionMs, humanize(0-100), edits{id:{target, off}}
function pitchPlan(track, an, opt = {}) {
  const n = track.f0.length, hop = track.hopSec, key = opt.key ?? 0, scale = opt.scale || 'maior';
  const amount = clamp((opt.amount ?? 100) / 100, 0, 1), vibK = clamp((opt.vibrato ?? 100) / 100, 0, 1.5), drift = clamp((opt.drift ?? 0) / 100, 0, 1);
  const hum = clamp((opt.humanize ?? 0) / 100, 0, 1), edits = opt.edits || {}, trans = Math.max(0, opt.transitionMs ?? 60) / 1000;
  const stat = new Float32Array(n), dyn = new Float32Array(n), owner = new Int32Array(n).fill(-1);
  const info = an.notes.map((nt, idx) => {
    const e = edits[nt.id] || {}, auto = snap(nt.center, key, scale), manual = Number.isFinite(e.target);
    const target = manual ? e.target : auto, dur = (nt.end - nt.start + 1) * hop;
    let I = manual ? 1 : amount;
    if (!manual && hum > 0) {
      const flexCents = hum * 45, dev = Math.abs(nt.center - target) * 100;
      if (dev < flexCents) I *= dev / flexCents;             // flex-tune: já está perto, mexe pouco
      const shortMs = hum * 160; if (dur * 1000 < shortMs) I *= dur * 1000 / shortMs; // notas curtas/passagem
    }
    if (e.off) I = 0;
    for (let i = nt.start; i <= nt.end; i++) {
      owner[i] = idx; const d = an.smooth[i] - nt.center, v = an.midi[i] - an.smooth[i];
      stat[i] = I * (target - nt.center);
      dyn[i] = I * (-d * drift + v * (vibK - 1));
    }
    return { ...nt, target, auto, manual, off: !!e.off, intensity: I };
  });
  // transição em curva (cosseno) entre patamares de notas vizinhas
  const shift = new Float32Array(n);
  for (let i = 0; i < n; i++) shift[i] = stat[i] + dyn[i];
  const hw = Math.max(1, Math.round(trans / 2 / hop));
  if (trans > 0) for (let q = 0; q < info.length - 1; q++) {
    const A = info[q], B = info[q + 1]; if (B.start - A.end > Math.round(0.03 / hop)) continue;
    const sa = stat[A.end], sb = stat[B.start], b = (A.end + B.start) / 2;
    const lo = Math.max(A.start + Math.floor((A.end - A.start) / 2), Math.floor(b - hw)), hi = Math.min(B.start + Math.floor((B.end - B.start) / 2), Math.ceil(b + hw));
    // Se a voz já salta de altura aqui, a mistura segue a PRÓPRIA altura cantada (da nota A para a B):
    // a passagem original é mantida e nunca passa do alvo (sem "bico"). Se as notas são quase iguais, curva no tempo.
    const jump = B.center - A.center, byPitch = Math.abs(jump) > 0.3;
    for (let i = lo; i <= hi; i++) {
      if (owner[i] < 0) continue;
      const u = byPitch && an.midi[i] > 0 ? clamp((an.midi[i] - A.center) / jump, 0, 1) : clamp((i - lo) / Math.max(1, hi - lo), 0, 1);
      const w = 0.5 - 0.5 * Math.cos(Math.PI * u); shift[i] = sa * (1 - w) + sb * w + dyn[i];
    }
  }
  // borda de notas isoladas: entra/sai suave em ~15 ms para não estalar
  const edge = Math.max(1, Math.round(0.015 / hop));
  for (const nt of info) for (let k = 0; k < edge; k++) {
    const g = (k + 1) / (edge + 1);
    if (nt.start - 1 < 0 || owner[nt.start - 1] < 0) shift[nt.start + k] *= g;
    if (nt.end + 1 >= n || owner[nt.end + 1] < 0) shift[nt.end - k] *= g;
  }
  const outMidi = new Float32Array(n);
  for (let i = 0; i < n; i++) outMidi[i] = an.voiced[i] ? an.midi[i] + shift[i] : 0;
  return { notes: info, shift, outMidi, hopSec: hop, ratioAt: tSec => { const i = Math.round(tSec / hop); return i >= 0 && i < n ? Math.pow(2, shift[i] / 12) : 1; } };
}
C.pitchPlan = pitchPlan;

// ---------------- Métricas para testes / relatórios ----------------
C.metrics = function (channels, sr, opt = {}) {
  let nan = 0, peak = 0, longestSilent = 0, run = 0; const thr = opt.silence ?? 1e-5;
  for (const c of channels) { run = 0; for (let i = 0; i < c.length; i++) { const v = c[i]; if (!Number.isFinite(v)) nan++; const a = Math.abs(v); if (a > peak) peak = a; if (a < thr) { run++; if (run > longestSilent) longestSilent = run; } else run = 0; } }
  return { nan, peak, longestSilentMs: longestSilent / sr * 1000 };
};

// ---------------- Tempo, compasso e alinhamento multitrack (Quant Multitrack) ----------------
// Compassos aceitos. "beat" = unidade do clique em semínimas (x/8 => colcheia = 0,5 semínima).
// O BPM do APS é sempre em semínimas: duração do compasso = num × (4/den) × 60/BPM.
C.METERS = {
  '4/4': { num: 4, den: 4, accents: [2, 0, 1, 0] },
  '3/4': { num: 3, den: 4, accents: [2, 0, 0] },
  '2/4': { num: 2, den: 4, accents: [2, 0] },
  '6/8': { num: 6, den: 8, accents: [2, 0, 0, 1, 0, 0] },
  '5/4': { num: 5, den: 4, accents: [2, 0, 0, 1, 0] },
  '7/8': { num: 7, den: 8, accents: [2, 0, 1, 0, 1, 0, 0] },
  '12/8': { num: 12, den: 8, accents: [2, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0] }
};
C.METER_LIST = ['4/4', '3/4', '2/4', '6/8', '5/4', '7/8', '12/8'];
function meterInfo(sig, bpm) {
  const m = C.METERS[sig] || C.METERS['4/4'], q = 60 / clamp(Number(bpm) || 100, 30, 300);
  const click = q * 4 / m.den;
  return { sig: C.METERS[sig] ? sig : '4/4', num: m.num, den: m.den, accents: m.accents, click, bar: click * m.num, quarter: q };
}
C.meterInfo = meterInfo;
// Grade de compasso/tempo num intervalo [t0,t1] (segundos locais). offset = onde cai o tempo 1 do compasso 1.
function meterGrid(sig, bpm, t0, t1, offset = 0) {
  const mi = meterInfo(sig, bpm), out = [];
  const k0 = Math.floor((t0 - offset) / mi.click) - 1, k1 = Math.ceil((t1 - offset) / mi.click) + 1;
  for (let k = k0; k <= k1 && out.length < 20000; k++) {
    const t = offset + k * mi.click; if (t < t0 - 1e-9 || t > t1 + 1e-9) continue;
    const pos = ((k % mi.num) + mi.num) % mi.num;
    out.push({ t, beat: pos + 1, bar: Math.floor(k / mi.num) + 1, downbeat: pos === 0, accent: mi.accents[pos] });
  }
  return out;
}
C.meterGrid = meterGrid;

// Força de cada ataque medida no próprio áudio (pico + graves), usada para achar o tempo 1.
function onsetAccents(channels, sr, onsets) {
  const x = channels.length > 1 ? mono(channels) : channels[0], win = Math.round(0.05 * sr), a = Math.exp(-2 * Math.PI * 180 / sr);
  const out = onsets.map(o => {
    const i0 = Math.max(0, Math.round(o.time * sr)), i1 = Math.min(x.length, i0 + win);
    let pk = 0, lo = 0, y = 0, le = 0;
    for (let i = i0; i < i1; i++) { const v = x[i]; pk = Math.max(pk, Math.abs(v)); y = (1 - a) * v + a * y; le += y * y; }
    lo = Math.sqrt(le / Math.max(1, i1 - i0));
    return { pk, lo };
  });
  const mp = Math.max(1e-9, ...out.map(v => v.pk)), ml = Math.max(1e-9, ...out.map(v => v.lo));
  return onsets.map((o, i) => ({ ...o, accent: 0.65 * out[i].pk / mp + 0.35 * out[i].lo / ml }));
}
C.onsetAccents = onsetAccents;

// BPM pela autocorrelação de um envelope de ataques + ajuste fino por mínimos quadrados.
function estimateTempo(onsets, opt = {}) {
  const ev = (onsets || []).filter(o => Number.isFinite(o.time)).map(o => ({ t: o.time, w: Number.isFinite(o.accent) ? 0.75 + 0.25 * o.accent : 1 })).sort((a, b) => a.t - b.t);
  if (ev.length < 4) return { bpm: 0, confidence: 0, phase: 0, period: 0 };
  const fs = 200, t0 = ev[0].t, dur = ev[ev.length - 1].t - t0 + 0.5, n = Math.ceil(dur * fs) + 1, env = new Float64Array(n), sig = 0.012 * fs;
  for (const e of ev) { const c = (e.t - t0) * fs; for (let i = Math.max(0, Math.floor(c - 3 * sig)); i <= Math.min(n - 1, Math.ceil(c + 3 * sig)); i++) env[i] += e.w * Math.exp(-0.5 * ((i - c) / sig) ** 2); }
  let mean = 0; for (const v of env) mean += v; mean /= n; for (let i = 0; i < n; i++) env[i] -= mean;
  const ac = lag => { const L = Math.floor(lag), f = lag - L; let s = 0; for (let i = 0; i + L + 1 < n; i++) s += env[i] * (env[i + L] * (1 - f) + env[i + L + 1] * f); return s / (n - lag); };
  const lo = opt.minBpm || 55, hi = opt.maxBpm || 210, center = opt.preferBpm || 110, cands = [];
  for (let b = lo; b <= hi; b += 0.5) {
    const P = 60 / b * fs; if (P * 2 >= n) continue;
    const s = ac(P) + 0.5 * ac(2 * P) + 0.25 * ac(3 * P);
    const prior = Math.exp(-0.5 * (Math.log2(b / center) / 0.9) ** 2);
    cands.push({ b, s, score: s * (0.55 + 0.45 * prior) });
  }
  if (!cands.length) return { bpm: 0, confidence: 0, phase: 0, period: 0 };
  let best = cands[0]; for (const c of cands) if (c.score > best.score) best = c;
  // refino: casa cada ataque ao tempo mais próximo e ajusta t = fase + k·período
  let P = 60 / best.b, phase = 0;
  { let sx = 0, sy = 0; for (const e of ev) { const a = 2 * Math.PI * e.t / P; sx += e.w * Math.cos(a); sy += e.w * Math.sin(a); } phase = ((Math.atan2(sy, sx) / (2 * Math.PI)) * P + P) % P; }
  for (let it = 0; it < 4; it++) {
    let sw = 0, sk = 0, st = 0, skk = 0, skt = 0;
    for (const e of ev) { const k = Math.round((e.t - phase) / P), r = e.t - (phase + k * P); if (Math.abs(r) > 0.18 * P) continue; sw += e.w; sk += e.w * k; st += e.w * e.t; skk += e.w * k * k; skt += e.w * k * e.t; }
    const den = sw * skk - sk * sk; if (sw < 3 || Math.abs(den) < 1e-9) break;
    const nP = (sw * skt - sk * st) / den, nPh = (st - nP * sk) / sw;
    if (!(nP > 0) || Math.abs(nP / P - 1) > 0.06) break; P = nP; phase = ((nPh % P) + P) % P;
  }
  const scores = cands.map(c => c.score).sort((a, b) => a - b), med = scores[scores.length >> 1];
  let onW = 0, allW = 0; for (const e of ev) { const r = Math.abs(e.t - (phase + Math.round((e.t - phase) / P) * P)); const rh = Math.abs(e.t - (phase + P / 2 + Math.round((e.t - phase - P / 2) / P) * P)); allW += e.w; if (Math.min(r, rh) < 0.07 * P) onW += e.w; }
  const peakness = best.score > 0 ? clamp((best.score - med) / best.score, 0, 1) : 0;
  return { bpm: 60 / P, period: P, phase, confidence: clamp(0.5 * peakness + 0.5 * onW / allW, 0, 1) };
}
C.estimateTempo = estimateTempo;

// Compasso: periodicidade de acentuação nos tempos detectados (contraste tempo 1 × outros tempos).
function estimateMeter(onsets, tempo) {
  const P = tempo.period || 60 / tempo.bpm, phase = tempo.phase || 0;
  const ev = onsets.map(o => ({ t: o.time, a: Number.isFinite(o.accent) ? o.accent : (o.strength || 1) }));
  if (!(P > 0) || ev.length < 6) return { sig: '4/4', confidence: 0, downbeat: phase, beatsPerBar: 4, compound: false, scores: {} };
  const first = Math.floor((Math.min(...ev.map(e => e.t)) - phase) / P), last = Math.ceil((Math.max(...ev.map(e => e.t)) - phase) / P);
  const beats = [];
  for (let k = first; k <= last; k++) { const bt = phase + k * P; let a = 0; for (const e of ev) if (Math.abs(e.t - bt) < 0.12 * P) a = Math.max(a, e.a); beats.push({ k, a }); }
  // subdivisão ternária (colcheias de 6/8) × binária
  let tern = 0, bin = 0, tot = 0;
  for (const e of ev) { const f = (((e.t - phase) / P) % 1 + 1) % 1; tot += e.a; if (Math.abs(f - 1 / 3) < 0.07 || Math.abs(f - 2 / 3) < 0.07) tern += e.a; else if (Math.abs(f - 0.5) < 0.07 || Math.abs(f - 0.25) < 0.05 || Math.abs(f - 0.75) < 0.05) bin += e.a; }
  const compound = tern > 0.15 * tot && tern > 1.5 * bin;
  const scores = {}, contrast = (n) => {
    let best = { c: -1, p: 0 };
    for (let p = 0; p < n; p++) {
      let sd = 0, nd = 0, so = 0, no = 0;
      for (const b of beats) { if ((((b.k - p) % n) + n) % n === 0) { sd += b.a; nd++; } else { so += b.a; no++; } }
      if (nd < 2 || no < 2) continue;
      const md = sd / nd, mo = so / no, c = (md - mo) / (md + mo + 1e-9);
      if (c > best.c) best = { c, p };
    }
    return best;
  };
  for (const n of [2, 3, 4, 5, 7]) if (beats.length >= 2 * n) scores[n] = contrast(n);
  let n = 4; const s = k => (scores[k] ? scores[k].c : -1);
  const base = [2, 3, 4].filter(k => scores[k]).sort((a, b) => s(b) - s(a));
  if (base.length) n = base[0];
  if (n === 2 && !compound && s(4) >= 0.9 * s(2)) n = 4; // 1 e 3 iguais: o mais comum é 4/4
  if (n === 4 && compound && s(2) >= 0.9 * s(4)) n = 2; // colcheias ternárias: 6/8
  if (n === 4 && s(2) > 1.25 * s(4)) n = 2;
  for (const k of [5, 7]) if (s(k) > 1.3 * Math.max(s(2), s(3), s(4)) && s(k) > 0.15) n = k;
  const ranked = Object.keys(scores).map(Number).sort((a, b) => s(b) - s(a)), second = ranked.find(k => k !== n);
  let sig = n === 2 ? '2/4' : n === 3 ? '3/4' : n === 5 ? '5/4' : n === 7 ? '7/8' : '4/4';
  if (compound && (n === 2 || n === 4)) sig = n === 2 ? '6/8' : '12/8';
  const best = scores[n] || { c: 0, p: 0 }, margin = second ? best.c - s(second) : best.c;
  const conf = clamp(0.25 + 1.2 * Math.max(0, best.c) * 0.8 + 1.6 * Math.max(0, margin), 0, 1) * clamp(beats.length / (4 * n), 0, 1);
  return { sig, beatsPerBar: n, compound, downbeat: phase + best.p * P, confidence: conf, scores: Object.fromEntries(Object.entries(scores).map(([k, v]) => [k, +v.c.toFixed(3)])) };
}
C.estimateMeter = estimateMeter;

// Detecção completa: BPM (semínima) + compasso + onde cai o tempo 1.
function detectTempoMeter(onsets, opt = {}) {
  const t = estimateTempo(onsets, opt);
  if (!t.bpm) return { bpm: 0, sig: '4/4', confidence: 0, bpmConfidence: 0, meterConfidence: 0, downbeat: 0 };
  // Pulso rápido (> 130): se os pulsos ímpares são todos mais fracos que os pares, eles são colcheias
  // (subdivisão) e o tempo de verdade é o dobro do período.
  if (t.bpm > 130 && onsets.length >= 8) {
    const P = t.period, acc = []; const end = Math.max(...onsets.map(o => o.time));
    for (let k = 0; t.phase + k * P <= end + 1e-6; k++) { const bt = t.phase + k * P; let a = 0; for (const o of onsets) if (Math.abs(o.time - bt) < 0.15 * P) a = Math.max(a, Number.isFinite(o.accent) ? o.accent : (o.strength || 1)); acc.push(a); }
    const q = (v, f) => { const s2 = v.slice().sort((x, y) => x - y); return s2.length ? s2[Math.min(s2.length - 1, Math.floor(f * s2.length))] : 0; };
    for (const p of [0, 1]) {
      const ev2 = acc.filter((_, i) => i % 2 === p), od = acc.filter((_, i) => i % 2 !== p);
      if (ev2.length >= 4 && od.length >= 4 && q(od, 0.75) < 0.8 * q(ev2, 0.25)) { t.period = 2 * P; t.bpm = 60 / t.period; t.phase = t.phase + p * P; break; }
    }
  }
  const m = estimateMeter(onsets, t);
  let bpm = t.bpm, P = t.period;
  if (m.sig === '6/8' || m.sig === '12/8') bpm = t.bpm * 1.5; // pulso = semínima pontuada
  else if (m.sig === '3/4') {
    // 3/4 × 6/8 no pulso de semínima: em 6/8 o acento secundário cai no meio do compasso (contratempo do 2º tempo)
    const acc = at => { let a = 0; for (const o of onsets) if (Math.abs(o.time - at) < 0.1 * P) a = Math.max(a, Number.isFinite(o.accent) ? o.accent : (o.strength || 1)); return a; };
    let mid = 0, b23 = 0, nb = 0, nm = 0; const end = Math.max(...onsets.map(o => o.time));
    for (let d = m.downbeat; d < end; d += 3 * P) { mid += acc(d + 1.5 * P); nm++; b23 += acc(d + P) + acc(d + 2 * P); nb += 2; }
    if (nm >= 2 && mid / nm > 1.3 * (b23 / Math.max(1, nb)) && mid / nm > 0.15) m.sig = '6/8';
  }
  if (m.sig === '7/8') bpm = t.bpm / 2; // pulso = colcheia
  while (bpm > 240) bpm /= 2; while (bpm < 40) bpm *= 2;
  const mi = meterInfo(m.sig, bpm), downbeat = ((m.downbeat % mi.bar) + mi.bar) % mi.bar;
  return { bpm: Math.round(bpm * 10) / 10, sig: m.sig, downbeat, beatPeriod: P, compound: m.compound, bpmConfidence: t.confidence, meterConfidence: m.confidence, confidence: Math.min(t.confidence, m.confidence), meterScores: m.scores };
}
C.detectTempoMeter = detectTempoMeter;

// Desvio de cada ataque em relação à grade (ms); off = fora da tolerância.
function gridDeviation(times, opt = {}) {
  const bpm = clamp(Number(opt.bpm) || 100, 30, 300), sub = Number(opt.subdivision) || 16, unit = 60 / bpm * 4 / sub, off = Number(opt.gridOffset) || 0;
  const tol = (opt.toleranceMs ?? Math.min(25, unit * 1000 * 0.18)) / 1000;
  return times.map(t => { const g = Math.round((t - off) / unit) * unit + off, d = t - g; return { time: t, grid: g, devMs: d * 1000, off: Math.abs(d) > tol }; });
}
C.gridDeviation = gridDeviation;

// Alinhamento pela pista guia: cada ataque é puxado (elástico, sem cortes) para o ataque mais próximo da guia.
// Casamento 1:1 por distância; ataques sem par ficam no lugar (ou vão para a grade, se pedido).
function planGuideWarp(onsets, guideTimes, opt = {}) {
  const duration = opt.duration, strength = clamp((opt.strength ?? 100) / 100, 0, 1), maxShift = (opt.maxShiftMs ?? 90) / 1000;
  const edits = opt.edits || {}, removed = new Set(opt.removed || []), guide = (guideTimes || []).filter(Number.isFinite).slice().sort((a, b) => a - b);
  const bpm = clamp(Number(opt.bpm) || 100, 30, 300), sub = [4, 8, 12, 16, 24, 32].includes(Number(opt.subdivision)) ? Number(opt.subdivision) : 16, unit = 60 / bpm * 4 / sub, goff = Number(opt.gridOffset) || 0;
  const list = [];
  for (const o of onsets) { const id = 'o' + o.index; if (!removed.has(id)) list.push({ id, src: o.time, auto: true }); }
  for (const a of (opt.added || [])) list.push({ id: a.id, src: a.src, auto: false });
  list.sort((a, b) => a.src - b.src);
  const pairs = [];
  const near = t => { let lo = 0, hi = guide.length - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (guide[m] < t) lo = m + 1; else hi = m; } return lo; };
  list.forEach((m, i) => { if (!guide.length) return; const j = near(m.src); for (const k of [j - 1, j, j + 1]) if (k >= 0 && k < guide.length && Math.abs(guide[k] - m.src) <= maxShift) pairs.push({ i, k, d: Math.abs(guide[k] - m.src) }); });
  pairs.sort((a, b) => a.d - b.d);
  const usedM = new Map(), usedG = new Set();
  for (const p of pairs) if (!usedM.has(p.i) && !usedG.has(p.k)) { usedM.set(p.i, guide[p.k]); usedG.add(p.k); }
  const markers = []; let matched = 0;
  list.forEach((m, i) => {
    if (m.src <= 0.003 || m.src >= duration - 0.003) return;
    const e = edits[m.id] || {}, g = usedM.get(i);
    let dst, target = null;
    if (Number.isFinite(e.dst)) dst = e.dst;
    else if (e.locked) dst = m.src;
    else if (Number.isFinite(g)) { dst = m.src + (g - m.src) * strength; target = g; matched++; }
    else if (opt.unmatched === 'grid') { const gr = Math.round((m.src - goff) / unit) * unit + goff; dst = m.src + clamp((gr - m.src) * strength, -unit / 2, unit / 2); }
    else dst = m.src;
    markers.push({ id: m.id, src: m.src, dst, locked: !!e.locked, manual: Number.isFinite(e.dst), auto: m.auto, guide: target, grid: Math.round((m.src - goff) / unit) * unit + goff });
  });
  return { markers: sanitizeMarkers(markers, duration), unit, bpm, subdivision: sub, strength, duration, mode: 'guide', matched, guideCount: guide.length };
}
C.planGuideWarp = planGuideWarp;
// Ímã do arraste manual: grade e/ou pontos das outras pistas.
C.snapTime = function (t, opt = {}) {
  let best = t, bd = (opt.radiusMs ?? 60) / 1000;
  if (opt.grid) { const u = opt.grid.unit, o = opt.grid.offset || 0, g = Math.round((t - o) / u) * u + o; if (Math.abs(g - t) < bd) { bd = Math.abs(g - t); best = g; } }
  for (const p of (opt.points || [])) if (Math.abs(p - t) < bd) { bd = Math.abs(p - t); best = p; }
  return best;
};

C.version = 'aps-elastic-core 1.1.0';
root.APSElasticCore = C;
if (typeof module === 'object' && module.exports) module.exports = C;
})(typeof globalThis !== 'undefined' ? globalThis : this);
