// Browser-independent policy shared by the recorder and Node tests.
export const LIMITS = Object.freeze({
  durationMs: 600000, stopAfterMs: 599000, fileBytes: 768 * 1048576,
  memoryBytes: 96 * 1048576, reserveBytes: 4 * 1048576, chunkMs: 1000,
});
export const MIME_TYPES = Object.freeze([
  'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
  'video/webm;codecs=vp8,opus', 'video/webm;codecs=vp9,opus', 'video/mp4', 'video/webm',
]);
export function supportedMimeTypes(isSupported) {
  return MIME_TYPES.filter(type => { try { return !!isSupported(type); } catch { return false; } });
}
export function extensionForMime(mime) {
  const container = mime.split(';')[0].trim().toLowerCase();
  if (container === 'video/mp4') return 'mp4';
  if (container === 'video/webm') return 'webm';
  throw Error('O navegador não informou um formato MP4 ou WebM válido.');
}
export function stopReason(elapsedMs, bytes, budget = LIMITS.fileBytes) {
  if (elapsedMs >= LIMITS.stopAfterMs) return 'time';
  if (bytes >= Math.min(budget, LIMITS.fileBytes) - LIMITS.reserveBytes) return 'size';
  return null;
}
export function canAppend(bytes, nextBytes, budget = LIMITS.fileBytes) {
  return Number.isSafeInteger(bytes) && Number.isSafeInteger(nextBytes) && bytes >= 0 && nextBytes >= 0
    && bytes + nextBytes <= Math.min(budget, LIMITS.fileBytes);
}
const FLOW = Object.freeze({
  idle: ['requesting', 'error'], requesting: ['preview', 'idle', 'error'],
  preview: ['preparing', 'idle', 'recorded', 'error'], preparing: ['recording', 'idle', 'error'],
  recording: ['stopping'], stopping: ['verifying', 'idle', 'error'],
  verifying: ['recorded', 'idle', 'error'], recorded: ['requesting', 'idle', 'error'],
  error: ['requesting', 'idle'],
});
export function transition(current, next) {
  if (current !== next && !FLOW[current]?.includes(next)) throw Error(`Transição inválida: ${current} → ${next}`);
  return next;
}
export function signalLevel(samples) {
  let sum = 0, peak = 0;
  for (const value of samples) { sum += value * value; peak = Math.max(peak, Math.abs(value)); }
  const rms = Math.sqrt(sum / Math.max(1, samples.length));
  return { rms, db: rms > 0 ? 20 * Math.log10(rms) : -Infinity, peak, clip: peak >= 0.99 };
}
export function captureConstraints(camera, microphone) {
  const video = { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 30 } };
  if (camera === 'user' || camera === 'environment') video.facingMode = { ideal: camera };
  else if (camera?.startsWith('device:')) video.deviceId = { exact: camera.slice(7) };
  const audio = { echoCancellation: false, noiseSuppression: false, autoGainControl: false };
  if (microphone?.startsWith('device:')) audio.deviceId = { exact: microphone.slice(7) };
  return { video, audio };
}
