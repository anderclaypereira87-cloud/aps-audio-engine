import test from 'node:test';
import assert from 'node:assert/strict';
import { PitchPreservingTempo } from '../advanced/pitch-preserving-tempo.js';

const SR = 48000;
async function render(rate, { offsetSeconds = 0, frequency = 440, seconds = 2.1 } = {}) {
  const processor = new PitchPreservingTempo({ rate, offsetSeconds, sampleRate: SR, channels: 1 });
  const frames = Math.floor(seconds * SR), samples = new Float32Array(frames);
  const source = (index, len) => {
    const data = new Float32Array(len);
    for (let i = 0; i < len; i++) {
      const sample = index + i;
      if (sample >= 0 && sample < (seconds * 1.2 + 3) * SR)
        data[i] = 0.5 * Math.sin(2 * Math.PI * frequency * sample / SR);
    }
    return [data];
  };
  for (let i = 0; i < frames; i += processor.hop) {
    const block = (await processor.next(source))[0];
    samples.set(block.subarray(0, Math.min(block.length, samples.length - i)), i);
  }
  return samples;
}

function crossings(audio, start, length) {
  let count = 0;
  for (let i = start + 1; i < start + length; i++) if (audio[i - 1] <= 0 && audio[i] > 0) count++;
  return count * SR / length;
}

for (const rate of [0.9, 0.962, 1.038, 1.1]) test(`WSOLA ±10% keeps the pitch near 440 Hz (rate ${rate})`, async () => {
  const audio = await render(rate);
  const detected = crossings(audio, .4 * SR, 1.0 * SR);
  assert.ok(Math.abs(detected - 440) <= 12, `tempo ${rate}: got ${detected} Hz`);
  assert.ok(audio.every(Number.isFinite));
});
test('output begins with expected silence before positive offset', async () => {
  const data = await render(1.038, { offsetSeconds: .2 });
  assert.equal(data.slice(0, SR * .15).every(v => v === 0), true);
  assert.ok(data.slice(SR * .3, SR * .5).some(v => v !== 0));
});
test('rejects unsafe correction magnitudes', () => {
  assert.throws(() => new PitchPreservingTempo({ rate: .89 }));
  assert.throws(() => new PitchPreservingTempo({ rate: 1.11 }));
});
