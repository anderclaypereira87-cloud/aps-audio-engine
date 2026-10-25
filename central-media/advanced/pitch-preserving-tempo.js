/** Time-domain WSOLA (waveform-similarity overlap/add) for moderate tempo
 * matching without resampling the musical pitch. Local, deterministic and
 * explicitly experimental: complex transient material must be listened to.
 * This class never edits source samples or changes notes/chords.
 */
export class PitchPreservingTempo {
  constructor({ rate, offsetSeconds = 0, sampleRate = 48000, channels = 2, hop = 960, search = 240 } = {}) {
    if (!Number.isFinite(rate) || rate < .9 || rate > 1.1 ||
        !Number.isFinite(offsetSeconds) || Math.abs(offsetSeconds) > 600)
      throw Error('Correção com preservação tonal: limite de ±10% e ±600 s.');
    if (!Number.isInteger(hop) || hop < 256 || !Number.isInteger(search) || search < 0 || search > hop / 2)
      throw Error('Janela WSOLA inválida.');
    this.rate = rate; this.offsetSeconds = offsetSeconds; this.sampleRate = sampleRate;
    this.channels = channels; this.hop = hop; this.search = search;
    this.previous = null; this.step = 0;
  }

  /** `read(startFrame, count)` must return one Float32Array per channel,
   * zero-filled outside file bounds and sampled at `sampleRate` (pitch 1:1).
   * Emits the next hop of timeline audio. No full-file PCM allocation.
   */
  async next(read) {
    const { hop, search, channels } = this;
    const desired = Math.round(((this.step * hop / this.sampleRate - this.offsetSeconds) * this.rate) * this.sampleRate);
    const buffer = await read(desired - search, 2 * hop + 2 * search);
    if (!Array.isArray(buffer) || buffer.length !== channels || buffer.some(v => v.length < 2 * hop + 2 * search))
      throw Error('Fonte WSOLA forneceu um quadro de áudio incompleto.');
    let bestShift = 0;
    if (this.previous) {
      let bestScore = -Infinity;
      // Decimation is only used to choose a matching segment; copied signal
      // samples remain at their original pitch and sample rate.
      const stride = 6, searchStep = 6;
      let prevEnergy = 1e-8;
      for (let i = 0; i < hop; i += stride)
        for (let c = 0; c < channels; c++) prevEnergy += this.previous[c][hop + i] ** 2;
      for (let shift = -search; shift <= search; shift += searchStep) {
        const start = search + shift;
        let dot = 0, energy = 1e-8;
        for (let i = 0; i < hop; i += stride) for (let c = 0; c < channels; c++) {
          const p = this.previous[c][hop + i], q = buffer[c][start + i];
          dot += p * q; energy += q * q;
        }
        // Penalize large excursions that could drift towards repeated notes.
        const similarity = dot / Math.sqrt(prevEnergy * energy) - 0.012 * Math.abs(shift) / (search || 1);
        if (similarity > bestScore) { bestScore = similarity; bestShift = shift; }
      }
    }
    const frame = buffer.map(channel => channel.slice(search + bestShift, search + bestShift + 2 * hop));
    const output = Array.from({ length: channels }, () => new Float32Array(hop));
    for (let c = 0; c < channels; c++) for (let i = 0; i < hop; i++) {
      const blend = i / hop;
      output[c][i] = this.previous
        ? this.previous[c][hop + i] * (1 - blend) + frame[c][i] * blend
        : frame[c][i];
    }
    this.previous = frame; this.step++;
    return output;
  }
}
