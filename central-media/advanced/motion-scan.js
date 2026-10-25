import * as M from '../vendor/mediabunny-1.62.1.mjs';
import { estimateTranslation, buildStabilizationPlan } from './stabilization.js';

/** Decodes selected original frames in the same Worker as export; input and video are read-only. */
export async function scanCameraMotion(input, info, { signal, progress = () => {} } = {}) {
  if (!info.hasVideo || !info.videoReadable) throw Error('É necessário um vídeo decodificável para rastrear o movimento.');
  const track = await input.getPrimaryVideoTrack();
  const width = 160, height = Math.max(56, Math.round(width * info.height / info.width));
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw Error('Canvas de análise indisponível.');
  const count = Math.min(1200, Math.max(3, Math.ceil(info.duration * 3)));
  const times = Array.from({ length: count }, (_, i) => info.videoStart + i * info.duration / Math.max(1, count - 1));
  const frames = new M.CanvasSink(track, { poolSize: 1 }).canvasesAtTimestamps(times);
  const readings = [];
  let prev = null, index = 0;
  for await (const frame of frames) {
    signal?.throwIfAborted();
    if (!frame?.canvas) { index++; continue; }
    ctx.drawImage(frame.canvas, 0, 0, width, height);
    const rgba = ctx.getImageData(0, 0, width, height).data;
    const pixels = new Uint8Array(width * height);
    for (let p = 0, k = 0; k < pixels.length; k++, p += 4)
      pixels[k] = (rgba[p] * 77 + rgba[p + 1] * 150 + rgba[p + 2] * 29) >> 8;
    const current = { width, height, pixels };
    const movement = prev ? estimateTranslation(prev, current) : { dx: 0, dy: 0, confidence: 1 };
    readings.push({ t: Math.max(0, frame.timestamp - info.videoStart), ...movement });
    prev = current; index++;
    if (index % 8 === 0) progress(index / times.length);
  }
  signal?.throwIfAborted();
  const plan = buildStabilizationPlan(readings, width, height);
  if (plan.points.length < 3 || plan.coverage < 0.35)
    throw Error('Pontos fixos insuficientes para estabilização confiável. Desative o recurso ou use vídeo com mais detalhes de fundo.');
  progress(1);
  return plan;
}
