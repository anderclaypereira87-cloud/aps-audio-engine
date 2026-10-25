import * as M from '../vendor/mediabunny-1.62.1.mjs';
import { regionFromPose, makeFramingPlan } from './subject-framing.js';

// On-device neural pose estimation. No footage is sent to a server; only the
// published runtime/weights are downloaded. Pin versions for reproducibility.
export const POSE_MODEL = Object.freeze({
  name: 'Google MediaPipe Pose Landmarker Lite',
  version: 'float16/1',
  runtimeVersion: '1.1.1',
  license: 'Apache-2.0 (BlazePose GHUM model card)',
  weights: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
  runtime: 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.1/vision_bundle.mjs',
  wasm: 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.1/wasm',
});

/** Runs at most one neural inference per second in the existing cancellable Worker. */
export async function scanMusician(input, info, { signal, progress = () => {} } = {}) {
  if (!info.hasVideo || !info.videoReadable) throw Error('Selecione um vídeo que este aparelho consiga decodificar.');
  if (typeof OffscreenCanvas === 'undefined') throw Error('Este navegador não suporta detecção neural em segundo plano; use o recorte manual.');
  let pose;
  try {
    signal?.throwIfAborted();
    const { FilesetResolver, PoseLandmarker } = await import(POSE_MODEL.runtime);
    signal?.throwIfAborted();
    const vision = await FilesetResolver.forVisionTasks(POSE_MODEL.wasm);
    signal?.throwIfAborted();
    pose = await PoseLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: POSE_MODEL.weights, delegate: 'CPU' },
      runningMode: 'VIDEO', numPoses: 1, outputSegmentationMasks: false,
      minPoseDetectionConfidence: 0.5, minPosePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
    const track = await input.getPrimaryVideoTrack();
    const width = Math.min(320, info.width), height = Math.max(2, Math.round(width * info.height / info.width));
    const resized = new OffscreenCanvas(width, height);
    const ctx = resized.getContext('2d', { alpha: false });
    if (!ctx) throw Error('Canvas de detecção indisponível.');
    // Sampling sparsely bounds CPU work and memory on mobile devices.
    const count = Math.max(2, Math.min(600, Math.ceil(info.duration) + 1));
    const times = Array.from({ length: count }, (_, i) => info.videoStart + i * Math.max(0, info.duration - 0.002) / (count - 1));
    const frames = new M.CanvasSink(track, { poolSize: 1 }).canvasesAtTimestamps(times);
    const readings = []; let index = 0;
    for await (const frame of frames) {
      signal?.throwIfAborted();
      const t = frame?.timestamp != null ? Math.max(0, frame.timestamp - info.videoStart) : times[index] - info.videoStart;
      let region = null;
      if (frame?.canvas) {
        ctx.drawImage(frame.canvas, 0, 0, width, height);
        // MediaPipe runs a real, published neural model, not a fixed crop.
        const result = pose.detectForVideo(resized, Math.round(t * 1000));
        region = regionFromPose(result.landmarks?.[0]);
      }
      readings.push({ t, region });
      index++;
      if (index % 4 === 0) progress(Math.min(1, index / times.length));
    }
    signal?.throwIfAborted();
    const plan = makeFramingPlan(readings);
    progress(1);
    return { ...plan, model: POSE_MODEL.name, version: POSE_MODEL.version, runtimeVersion: POSE_MODEL.runtimeVersion,
      modelLicense: POSE_MODEL.license, weightsOrigin: POSE_MODEL.weights, note: 'Detecta uma pessoa, não o instrumento; revise o corte e use ajuste manual se necessário.' };
  } catch (error) {
    if (signal?.aborted) throw error;
    throw Error(`Detecção de pessoa indisponível: ${error.message}. Confira a conexão e use o enquadramento manual.`);
  } finally { pose?.close(); }
}
