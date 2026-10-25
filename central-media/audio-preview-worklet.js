import { AudioProcessor } from '../aps-video-enhance.js';
class APSMediaAudio extends AudioWorkletProcessor {
  constructor(options) {
    super(); this.settings = options.processorOptions || {}; this.dsp = null;
    this.port.onmessage = ({ data }) => { this.settings = data; this.dsp = null; };
  }
  process(inputs, outputs) {
    const output = outputs[0], input = inputs[0];
    if (!input?.length) { output.forEach(c => c.fill(0)); return true; }
    if (!this.dsp) this.dsp = new AudioProcessor(sampleRate, output.length, this.settings);
    output.forEach((channel, c) => channel.set(input[Math.min(c, input.length - 1)]));
    this.dsp.process(output); return true;
  }
}
registerProcessor('aps-media-audio', APSMediaAudio);
