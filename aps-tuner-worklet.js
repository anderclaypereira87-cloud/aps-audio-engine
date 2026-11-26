/* APS Afinador — AudioWorklet: MPM fora da tela principal. Requer aps-elastic-core.js carregado antes
 * (audioWorklet.addModule) no mesmo AudioWorkletGlobalScope. */
class APSMpmTuner extends AudioWorkletProcessor {
  constructor() { super(); this.dsp = globalThis.APSElasticCore.createTunerDSP(sampleRate); this.on = true; this.port.onmessage = e => { if (e.data === 'stop') this.on = false; }; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0]; if (!ch) return this.on;
    const r = this.dsp.push(ch); if (r) this.port.postMessage(r);
    return this.on;
  }
}
registerProcessor('aps-mpm-tuner', APSMpmTuner);
