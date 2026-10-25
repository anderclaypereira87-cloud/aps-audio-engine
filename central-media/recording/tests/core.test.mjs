import test from 'node:test';
import assert from 'node:assert/strict';
import { LIMITS, MIME_TYPES, supportedMimeTypes, extensionForMime, stopReason, canAppend, transition, signalLevel, captureConstraints } from '../recording-core.mjs';

test('MIME negotiation follows browser results, not user agent or device type', () => {
  assert.deepEqual(supportedMimeTypes(type => type.includes('vp8')), ['video/webm;codecs=vp8,opus']);
  assert.deepEqual(supportedMimeTypes(type => type === 'video/mp4'), ['video/mp4']);
  assert.deepEqual(supportedMimeTypes(() => false), []);
  assert.deepEqual(supportedMimeTypes(() => { throw Error('unsupported'); }), []);
  assert.deepEqual(supportedMimeTypes(() => true), [...MIME_TYPES]);
  assert.equal(supportedMimeTypes(type => type === 'video/mp4' || type.includes('vp8'))[0], 'video/webm;codecs=vp8,opus');
  assert.equal(extensionForMime('video/mp4;codecs=avc1'), 'mp4');
  assert.equal(extensionForMime('video/webm;codecs=vp9,opus'), 'webm');
  assert.throws(() => extensionForMime('audio/mp4'));
});
test('capture requests one combined stream and exact device IDs only when selected', () => {
  const front = captureConstraints('user', '');
  assert.deepEqual(front.video.facingMode, { ideal: 'user' });
  assert.equal(front.audio.echoCancellation, false);
  assert.equal(front.audio.noiseSuppression, false);
  assert.equal(front.audio.autoGainControl, false);
  assert.deepEqual(captureConstraints('environment').video.facingMode, { ideal: 'environment' });
  const usb = captureConstraints('device:webcam-1', 'device:usb-1');
  assert.deepEqual(usb.video.deviceId, { exact: 'webcam-1' });
  assert.deepEqual(usb.audio.deviceId, { exact: 'usb-1' });
  assert.equal(usb.video.facingMode, undefined);
});
test('time and space limits reserve room for the final recorder chunk', () => {
  assert.equal(stopReason(0, 0), null);
  assert.equal(stopReason(LIMITS.stopAfterMs - 1, 0), null);
  assert.equal(stopReason(LIMITS.stopAfterMs, 0), 'time');
  assert.equal(stopReason(LIMITS.durationMs + 90000, 0), 'time');
  assert.equal(stopReason(0, LIMITS.fileBytes - LIMITS.reserveBytes), 'size');
  assert.equal(stopReason(0, LIMITS.memoryBytes - LIMITS.reserveBytes, LIMITS.memoryBytes), 'size');
  assert.ok(canAppend(LIMITS.fileBytes - 1, 1));
  assert.ok(!canAppend(LIMITS.fileBytes - 1, 2));
  assert.ok(!canAppend(0, LIMITS.memoryBytes + 1, LIMITS.memoryBytes));
  assert.ok(!canAppend(-1, 2)); assert.ok(!canAppend(1, Infinity));
});
test('state flow disallows recording without activation and use before finalization', () => {
  let state = 'idle';
  for (const next of ['requesting', 'preview', 'preparing', 'recording', 'stopping', 'verifying', 'recorded', 'requesting', 'idle']) state = transition(state, next);
  assert.equal(state, 'idle');
  assert.throws(() => transition('idle', 'recording'));
  assert.throws(() => transition('recording', 'recorded'));
  assert.throws(() => transition('stopping', 'requesting'));
  for (const current of ['requesting', 'preview', 'preparing', 'stopping', 'verifying', 'recorded', 'error']) assert.equal(transition(current, 'idle'), 'idle');
});
test('RMS and clipping describe the input without gain or synthesis', () => {
  assert.equal(signalLevel(new Float32Array(128)).db, -Infinity);
  const half = signalLevel(Float32Array.of(-0.5, 0.5));
  assert.equal(half.rms, 0.5); assert.ok(Math.abs(half.db + 6.0206) < 0.001); assert.equal(half.clip, false);
  assert.equal(signalLevel(Float32Array.of(0, -1, 0.1)).clip, true);
});
