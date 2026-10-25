import test from 'node:test';
import assert from 'node:assert/strict';
import { createChunkStore } from '../chunk-store.js';
import { LIMITS } from '../recording-core.mjs';

function useStorage(storage) { Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { storage } }); }
test('memory fallback returns complete ordered chunks and enforces its smaller budget', async () => {
  useStorage({ getDirectory: async () => { throw Error('blocked'); } });
  const store = await createChunkStore();
  assert.equal(store.mode, 'memory'); assert.equal(store.budget, LIMITS.memoryBytes);
  await Promise.all([store.append(new Blob(['first'])), store.append(new Blob(['second']))]);
  assert.equal(await (await store.finish('video/webm')).text(), 'firstsecond');
  await assert.rejects(store.append(new Blob(['too late'])));
  await store.dispose();
});
test('OPFS writes are serialized, close before reopen, and remove only the owned temporary file', async () => {
  const events = []; let openedName, finished = '';
  const writer = { async write(chunk) { events.push('write-start'); await new Promise(r => setTimeout(r, 2)); finished += await chunk.text(); events.push('write-end'); }, async close() { events.push('close'); }, async abort() { events.push('abort'); } };
  useStorage({ estimate: async () => ({ quota: 256 * 1048576, usage: 16 * 1048576 }), getDirectory: async () => ({ getDirectoryHandle: async () => ({ getFileHandle: async name => { openedName = name; return { createWritable: async () => writer, getFile: async () => { events.push('reopen'); return new Blob([finished]); } }; }, removeEntry: async name => { assert.equal(name, openedName); events.push('remove'); } }) }) });
  const store = await createChunkStore(); assert.equal(store.mode, 'disk');
  assert.equal(store.budget, 232 * 1048576);
  const a = store.append(new Blob(['a'])), b = store.append(new Blob(['b']));
  const file = await store.finish('video/mp4'); await Promise.all([a, b]);
  assert.equal(await file.text(), 'ab');
  assert.deepEqual(events, ['write-start', 'write-end', 'write-start', 'write-end', 'close', 'reopen']);
  await store.dispose(); assert.equal(events.at(-1), 'remove');
});
test('write failure rejects finalization instead of exposing a truncated original', async () => {
  let removed = false;
  useStorage({ getDirectory: async () => ({ getDirectoryHandle: async () => ({ getFileHandle: async () => ({ createWritable: async () => ({ write: async () => { throw new DOMException('full', 'QuotaExceededError'); }, abort: async () => {} }) }), removeEntry: async () => { removed = true; } }) }) });
  const store = await createChunkStore();
  await assert.rejects(store.append(new Blob(['data'])), { name: 'QuotaExceededError' });
  await assert.rejects(store.finish('video/webm'), { name: 'QuotaExceededError' });
  await store.dispose(); assert.ok(removed);
});
test('an oversized or delayed chunk cannot produce a downloadable truncated prefix', async () => {
  useStorage({}); const store = await createChunkStore();
  await store.append(new Blob(['prefix']));
  await assert.rejects(store.append({ size: LIMITS.memoryBytes + 1 }), /Limite de espaço/);
  await assert.rejects(store.finish('video/webm'), /Limite de espaço/);
  await store.dispose();
});
