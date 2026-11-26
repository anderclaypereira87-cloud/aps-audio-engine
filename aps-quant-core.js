/* APS Quant Pro v2 — núcleo de quantização ELÁSTICA (sem cortes).
 * Substitui o editor de fatias da v1: agora os ataques viram marcadores de warp e o áudio é
 * esticado/comprimido de forma contínua entre eles (sem buracos, sem trechos dobrados).
 * Esta API síncrona usa o WSOLA de reserva do APSElasticCore; as telas usam o Web Worker
 * (aps-elastic.js) com Signalsmith Stretch (MIT). Local, sem envio de áudio. */
(function (global) {
'use strict';
const core = () => global.APSElasticCore || (typeof require === 'function' ? require('./aps-elastic-core.js') : null);
function channels(buffer) { return Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c)); }
function detect(buffer) {
  if (!buffer || !buffer.length || !buffer.sampleRate) throw Error('Selecione uma pista de áudio.');
  return core().detectOnsets(channels(buffer), buffer.sampleRate).map(o => ({ index: o.index, time: o.time, sample: Math.round(o.time * buffer.sampleRate), strength: o.strength }));
}
function plan(buffer, events, opts = {}) {
  const C = core(), edits = {};
  for (const [k, v] of Object.entries(opts.manualTargets || {})) if (Number.isFinite(v)) edits['o' + k] = { dst: v };
  for (const k of (opts.locked || [])) edits['o' + k] = { locked: true };
  const onsets = (events || []).map(e => ({ index: e.index, time: Number.isFinite(e.time) ? e.time : e.sample / buffer.sampleRate, strength: e.strength || 1 }));
  if (!onsets.length) throw Error('Nenhum ataque rítmico detectado.');
  const p = C.planWarp(onsets, { duration: buffer.duration, bpm: opts.bpm, subdivision: opts.subdivision, strength: opts.strength ?? 100, edits });
  p.sampleRate = buffer.sampleRate; p.frameLength = buffer.length; p.protectMs = opts.protectMs ?? 25;
  return p;
}
function render(buffer, edit, context) {
  const C = core();
  if (!edit || !edit.markers || edit.frameLength !== buffer.length || edit.sampleRate !== buffer.sampleRate) throw Error('Plano incompatível com o áudio.');
  const src = channels(buffer), map = C.buildTimeMap(edit.markers, buffer.duration, { protectMs: edit.protectMs ?? 25 });
  const out = C.protectAttacks(C.renderWSOLA(src, buffer.sampleRate, map, { outLength: buffer.length }), src, buffer.sampleRate, map);
  const result = context.createBuffer(out.length, buffer.length, buffer.sampleRate);
  out.forEach((c, i) => result.copyToChannel(c, i));
  const m = C.metrics(out, buffer.sampleRate);
  return { buffer: result, engine: 'wsola', metrics: m, warnings: map.warnings, gapSamples: 0, longestGapSeconds: m.longestSilentMs / 1000, moved: edit.markers.filter(k => Math.abs(k.dst - k.src) > 0.002).length };
}
const API = Object.freeze({ version: '2.0.0-elastico', detect, plan, render });
global.APSQuantCore = API;
if (typeof module === 'object' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
