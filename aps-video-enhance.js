/** Conventional, deterministic processing shared by preview and export. */
import { motionAt } from './central-media/advanced/stabilization.js';
import { frameAt, centerCropAt } from './central-media/advanced/subject-framing.js';
export const VIDEO_DEFAULTS = Object.freeze({ exposure: 0, contrast: 0, saturation: 0, temperature: 0, tint: 0, denoise: 0, sharpness: 0, zoom: 1, x: 0.5, y: 0.5 });
export const AUDIO_DEFAULTS = Object.freeze({ gain: 0, bass: 0, mid: 0, treble: 0, highpass: 20, lowpass: 20000, gate: false, compressor: false });
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

export function outputDimensions(width, height, aspect = 'original', resolution = 'source') {
  const ratio = aspect === 'original' ? width / height : ({ '16:9': 16 / 9, '9:16': 9 / 16, '4:5': 4 / 5 }[aspect]);
  if (!Number.isFinite(ratio)) throw Error('Proporção inválida.');
  const preset = aspect === '4:5' ? 1350 : 1920;
  const edge = resolution === '4k' ? preset * 2 : resolution === '1080' ? preset : Math.min(1920, Math.max(width, height));
  const w = ratio >= 1 ? edge : edge * ratio, h = ratio >= 1 ? edge / ratio : edge;
  return { width: Math.max(2, Math.round(w / 2) * 2), height: Math.max(2, Math.round(h / 2) * 2) };
}

export function cropRectangle(width, height, ratio, settings = {}) {
  const s = { ...VIDEO_DEFAULTS, ...settings };
  let w = width, h = height;
  if (w / h > ratio) w = h * ratio; else h = w / ratio;
  w /= clamp(s.zoom, 1, 3); h /= clamp(s.zoom, 1, 3);
  return { x: (width - w) * clamp(s.x, 0, 1), y: (height - h) * clamp(s.y, 0, 1), width: w, height: h };
}

export function processPixels(data, width, height, settings = {}, scratch = null) {
  const s = { ...VIDEO_DEFAULTS, ...settings };
  const exposure = 2 ** s.exposure, contrast = 1 + s.contrast / 100, saturation = 1 + s.saturation / 100;
  const red = exposure * (1 + s.temperature / 300), blue = exposure * (1 - s.temperature / 300), green = exposure * (1 - s.tint / 400);
  const spatial = s.denoise > 0 || s.sharpness > 0;
  const original = spatial ? scratch?.length === data.length ? scratch : new Uint8ClampedArray(data.length) : data;
  if (spatial) original.set(data);
  const values = new Float64Array(3), gains = [red, green, blue], neighbors = [-4, 4, -width * 4, width * 4];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const p = (y * width + x) * 4;
    for (let c = 0; c < 3; c++) {
      let v = original[p + c];
      if (spatial && x > 0 && x < width - 1 && y > 0 && y < height - 1) {
        let sum = 0, similar = 0, count = 0;
        for (let k = 0; k < 4; k++) { const z = original[p + neighbors[k] + c]; sum += z; if (Math.abs(z - v) < 12 + s.denoise * 0.2) { similar += z; count++; } }
        if (count) v += (similar / count - v) * s.denoise / 125;
        v += (original[p + c] - sum / 4) * s.sharpness / 100;
      }
      values[c] = ((v / 255 - 0.5) * contrast + 0.5) * gains[c];
    }
    const luma = values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
    for (let c = 0; c < 3; c++) data[p + c] = clamp((luma + (values[c] - luma) * saturation) * 255, 0, 255);
  }
  return data;
}

const scratchByCanvas = new WeakMap();
export function drawVideo(canvas, source, width, height, settings = {}) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const amount = Math.max(0, Math.min(100, Number(settings.stabilization) || 0));
  const plan = settings.motionPlan;
  const zoom = plan && amount > 0 ? Math.max(settings.zoom || 1, 1 + (plan.cropZoom - 1) * amount / 100) : (settings.zoom ?? 1);
  let r = cropRectangle(width, height, canvas.width / canvas.height, { ...settings, zoom });
  if (settings.autoFrame && settings.framingPlan) {
    const focus = frameAt(settings.framingPlan, settings.videoTime);
    r = centerCropAt(r, width, height, focus);
    // Horizontal/vertical sliders remain available as manual overrides even
    // when the neural detector is guiding the virtual camera.
    r.x = clamp(r.x + (Number(settings.x ?? 0.5) - 0.5) * (width - r.width), 0, Math.max(0, width - r.width));
    r.y = clamp(r.y + (Number(settings.y ?? 0.5) - 0.5) * (height - r.height), 0, Math.max(0, height - r.height));
  }
  if (plan && amount > 0) {
    const shift = motionAt(plan, settings.videoTime, amount);
    r.x = Math.max(0, Math.min(width - r.width, r.x - shift.dx * width / plan.width));
    r.y = Math.max(0, Math.min(height - r.height, r.y - shift.dy * height / plan.height));
  }
  ctx.drawImage(source, r.x, r.y, r.width, r.height, 0, 0, canvas.width, canvas.height);
  const s = { ...VIDEO_DEFAULTS, ...settings };
  if (s.exposure || s.contrast || s.saturation || s.temperature || s.tint || s.denoise || s.sharpness) {
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let scratch = scratchByCanvas.get(canvas);
    if ((s.denoise || s.sharpness) && scratch?.length !== pixels.data.length) { scratch = new Uint8ClampedArray(pixels.data.length); scratchByCanvas.set(canvas, scratch); }
    processPixels(pixels.data, canvas.width, canvas.height, s, scratch);
    ctx.putImageData(pixels, 0, 0);
  }
}

function coefficients(kind, frequency, gain, sampleRate) {
  const w = 2 * Math.PI * Math.min(frequency, sampleRate * 0.45) / sampleRate;
  const c = Math.cos(w), sn = Math.sin(w), a = sn / (2 * 0.7071), A = 10 ** (gain / 40), beta = 2 * Math.sqrt(A) * a;
  let b0, b1, b2, a0, a1, a2;
  if (kind === 'highpass') { b0 = (1 + c) / 2; b1 = -(1 + c); b2 = b0; a0 = 1 + a; a1 = -2 * c; a2 = 1 - a; }
  else if (kind === 'lowpass') { b0 = (1 - c) / 2; b1 = 1 - c; b2 = b0; a0 = 1 + a; a1 = -2 * c; a2 = 1 - a; }
  else if (kind === 'lowshelf') {
    b0 = A * ((A + 1) - (A - 1) * c + beta); b1 = 2 * A * ((A - 1) - (A + 1) * c); b2 = A * ((A + 1) - (A - 1) * c - beta);
    a0 = (A + 1) + (A - 1) * c + beta; a1 = -2 * ((A - 1) + (A + 1) * c); a2 = (A + 1) + (A - 1) * c - beta;
  } else if (kind === 'highshelf') {
    b0 = A * ((A + 1) + (A - 1) * c + beta); b1 = -2 * A * ((A - 1) + (A + 1) * c); b2 = A * ((A + 1) + (A - 1) * c - beta);
    a0 = (A + 1) - (A - 1) * c + beta; a1 = 2 * ((A - 1) - (A + 1) * c); a2 = (A + 1) - (A - 1) * c - beta;
  } else { b0 = 1 + a * A; b1 = -2 * c; b2 = 1 - a * A; a0 = 1 + a / A; a1 = -2 * c; a2 = 1 - a / A; }
  return [b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0];
}

export class AudioProcessor {
  constructor(sampleRate, channels, settings = {}) {
    this.s = { ...AUDIO_DEFAULTS, ...settings }; this.sampleRate = sampleRate;
    this.env = 0; this.compression = 1; this.clipped = 0; this.peak = 0;
    const s = this.s, stages = [];
    if (s.highpass > 20) stages.push(['highpass', s.highpass, 0]);
    if (s.lowpass < 20000) stages.push(['lowpass', s.lowpass, 0]);
    if (s.bass) stages.push(['lowshelf', 120, s.bass]);
    if (s.mid) stages.push(['peaking', 1200, s.mid]);
    if (s.treble) stages.push(['highshelf', 5000, s.treble]);
    this.filters = stages.map(([kind, f, g]) => ({ k: coefficients(kind, f, g, sampleRate), state: Array.from({ length: channels }, () => [0, 0]) }));
  }
  process(channels) {
    const s = this.s, n = channels[0].length, gain = 10 ** (s.gain / 20);
    for (const filter of this.filters) {
      const [b0, b1, b2, a1, a2] = filter.k;
      for (let c = 0; c < channels.length; c++) {
        let [z1, z2] = filter.state[c];
        for (let i = 0; i < n; i++) {
          const x = channels[c][i], y = b0 * x + z1;
          z1 = b1 * x - a1 * y + z2; z2 = b2 * x - a2 * y; channels[c][i] = y;
        }
        filter.state[c] = [z1, z2];
      }
    }
    const attack = Math.exp(-1 / (0.02 * this.sampleRate)), release = Math.exp(-1 / (0.2 * this.sampleRate));
    for (let i = 0; i < n; i++) {
      let peak = 0;
      for (const channel of channels) peak = Math.max(peak, Math.abs(channel[i]));
      const coeff = peak > this.env ? Math.exp(-1 / (0.002 * this.sampleRate)) : release;
      this.env = coeff * this.env + (1 - coeff) * peak;
      const level = 20 * Math.log10(Math.max(this.env, 1e-9));
      const over = level + 18;
      const reduction = !s.compressor ? 0 : over <= -3 ? 0 : over < 3 ? -((over + 3) ** 2) / 24 : -over / 2;
      const target = 10 ** (reduction / 20), smooth = target < this.compression ? attack : release;
      this.compression = smooth * this.compression + (1 - smooth) * target;
      const gate = s.gate ? 0.5 + 0.5 * clamp((level + 65) / 15, 0, 1) : 1;
      for (const channel of channels) {
        const value = channel[i] * gain * this.compression * gate;
        this.peak = Math.max(this.peak, Math.abs(value));
        if (Math.abs(value) > 1) this.clipped++;
        channel[i] = clamp(value, -1, 1);
      }
    }
    return channels;
  }
}
