import test from 'node:test';
import assert from 'node:assert/strict';
import { handleStemConsole } from '../integrations/stemconsole/worker.mjs';
import { StemConsoleClient, verifySplit, MAX_UPLOAD_BYTES } from '../integrations/stemconsole/client.mjs';

const secret = 'sc_live_test_only_not_a_real_key';
const env = { STEMCONSOLE_ENABLED: 'true', STEMCONSOLE_API_KEY: secret };
const origin = 'https://apsaudio.com.br';
const split = { id: 'test_split_123', status: 'done', model: 'full', stems:
  ['vocals','drums','bass','guitar','piano','other'].map(name => ({ name, filename: name + '.wav', mp3_url: 'https://stemconsole.ai/test/' + name + '.mp3?k=signed' })) };
const reply = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...headers } });
const request = (path, options = {}) => new Request('https://aps-pagamentos.aps-audio.workers.dev/stemconsole' + path, {
  ...options, headers: { Origin: origin, Authorization: 'Bearer APS_SESSION', ...options.headers }
});

test('unrelated routes are left to the existing Worker', async () => {
  assert.equal(await handleStemConsole(new Request('https://apsaudio.com.br/status'), env), null);
  assert.equal(await handleStemConsole(new Request('https://apsaudio.com.br/stemconsole-evil'), env), null);
});

test('disabled integration makes no authentication or provider requests', async () => {
  const fetchImpl = () => { throw new Error('must not call upstream'); };
  const config = await handleStemConsole(request('/config'), {}, { fetchImpl });
  assert.equal((await config.json()).enabled, false);
  assert.equal(config.headers.get('Access-Control-Allow-Origin'), origin);
  assert.equal((await handleStemConsole(request('/account'), {}, { fetchImpl })).status, 503);
});

test('CORS denies other origins and preflight does not use the provider key', async () => {
  const fetchImpl = () => { throw new Error('must not call upstream'); };
  const bad = await handleStemConsole(request('/config', { headers: { Origin: 'https://evil.example' } }), env, { fetchImpl });
  assert.equal(bad.status, 403);
  assert.equal(bad.headers.get('Access-Control-Allow-Origin'), null);
  const good = await handleStemConsole(request('/splits', { method: 'OPTIONS' }), env, { fetchImpl });
  assert.equal(good.status, 204);
  assert.match(good.headers.get('Access-Control-Allow-Headers'), /Idempotency-Key/);
});

test('a regular APS customer cannot use the owner provider allowance', async () => {
  let calls = 0;
  const result = await handleStemConsole(request('/account'), env, { fetchImpl: async (url, options) => {
    calls++;
    assert.equal(url, 'https://aps-pagamentos.aps-audio.workers.dev/status');
    assert.equal(options.headers.Authorization, 'Bearer APS_SESSION');
    assert.ok(!JSON.stringify(options).includes(secret));
    return reply({ owner: false, plan: 'pro' });
  } });
  assert.equal(result.status, 403);
  assert.equal(calls, 1);
});

test('owner authentication forwards only the provider credential to StemConsole', async () => {
  const result = await handleStemConsole(request('/account'), env, { fetchImpl: async (url, options) => {
    if (url.endsWith('/status')) return reply({ owner: true });
    assert.equal(url, 'https://stemconsole.ai/api/v1/me');
    assert.equal(options.headers.get('Authorization'), 'Bearer ' + secret);
    assert.ok(!JSON.stringify([...options.headers]).includes('APS_SESSION'));
    return reply({ plan: 'pro', accidentalEcho: secret });
  } });
  assert.deepEqual(await result.json(), { plan: 'pro', accidentalEcho: '[redacted]' });
});

test('upload is streamed with its original multipart boundary and idempotency key', async () => {
  const form = new FormData();
  form.set('file', new Blob(['RIFF:test-original-audio'], { type: 'audio/wav' }), 'song.wav');
  form.set('model', 'full');
  const upload = request('/splits', { method: 'POST', body: form, headers: { 'Idempotency-Key': 'repeated_request_key_12345' } });
  const type = upload.headers.get('Content-Type');
  const result = await handleStemConsole(upload, env, { authorize: async () => true, fetchImpl: async (url, options) => {
    assert.equal(url, 'https://stemconsole.ai/api/v1/splits');
    assert.equal(options.method, 'POST');
    assert.equal(options.headers.get('Content-Type'), type);
    assert.equal(options.headers.get('Idempotency-Key'), 'repeated_request_key_12345');
    const data = await new Request('https://stemconsole.ai/api/v1/splits', options).formData();
    assert.equal(data.get('model'), 'full');
    assert.equal(await data.get('file').text(), 'RIFF:test-original-audio');
    return reply({ id: split.id, status: 'queued' }, 202);
  } });
  assert.equal(result.status, 202);
  assert.equal((await result.json()).id, split.id);
});

test('invalid or oversized uploads stop before any provider submission', async () => {
  const opts = { authorize: async () => true, fetchImpl: () => { throw new Error('must not submit'); } };
  const noKey = await handleStemConsole(request('/splits', { method: 'POST', body: 'x' }), env, opts);
  assert.equal(noKey.status, 400);
  const large = request('/splits', { method: 'POST', body: 'x', headers: {
    'Idempotency-Key': 'large_upload_test_12345', 'Content-Type': 'multipart/form-data; boundary=abc', 'Content-Length': String(MAX_UPLOAD_BYTES + 70000)
  } });
  assert.equal((await handleStemConsole(large, env, opts)).status, 413);
});

test('provider payment and rate limits remain errors, without fallback or extra jobs', async () => {
  for (const status of [402, 429]) {
    let calls = 0;
    const response = await handleStemConsole(request('/splits/' + split.id), env, {
      authorize: async () => true, fetchImpl: async () => { calls++; return reply({ error: 'limit_reached', message: secret }, status, { 'Retry-After': '15' }); }
    });
    assert.equal(response.status, status);
    assert.equal(response.headers.get('Retry-After'), '15');
    assert.ok(!(await response.text()).includes(secret));
    assert.equal(calls, 1);
  }
});

test('chunked uploads cannot bypass the size limit by omitting Content-Length', async () => {
  const block = new Uint8Array(64 * 1024);
  let sent = 0;
  const upload = request('/splits', { method: 'POST', duplex: 'half', headers: {
    'Idempotency-Key': 'chunked_upload_test_12345', 'Content-Type': 'multipart/form-data; boundary=abc'
  }, body: new ReadableStream({ pull(controller) {
    if (sent++ < 1603) controller.enqueue(block); else controller.close();
  } }) });
  const response = await handleStemConsole(upload, env, { authorize: async () => true, fetchImpl: async (url, options) => {
    const reader = options.body.getReader();
    while (!(await reader.read()).done) { /* consume streaming upload */ }
    throw new Error('Oversized data should not finish uploading.');
  } });
  assert.equal(response.status, 413);
});

test('audio download uses a provider-returned link and sends neither credential to it', async () => {
  let calls = 0;
  const response = await handleStemConsole(request('/splits/' + split.id + '/stems/drums'), env, {
    authorize: async () => true, fetchImpl: async (url, options) => {
      calls++;
      if (url.startsWith('https://stemconsole.ai/api/v1/')) return reply(split);
      assert.equal(url, split.stems[1].mp3_url);
      assert.equal(options.headers, undefined);
      return new Response(new Uint8Array([73,68,51,4]), { headers: { 'Content-Type': 'audio/mpeg' } });
    }
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Content-Type'), 'audio/mpeg');
  assert.match(response.headers.get('Content-Disposition'), /drums.mp3/);
  assert.equal((await response.arrayBuffer()).byteLength, 4);
  assert.equal(calls, 2);
});

test('unapproved download hosts and redirects cannot make arbitrary requests', async () => {
  for (const target of ['http://127.0.0.1/private', 'https://evil.example/leak', 'https://stemconsole.ai@evil.example/leak']) {
    let calls = 0;
    const data = { ...split, stems: [{ name: 'drums', mp3_url: target }] };
    const response = await handleStemConsole(request('/splits/' + split.id + '/stems/drums'), env, {
      authorize: async () => true, fetchImpl: async () => { calls++; return reply(data); }
    });
    assert.equal(response.status, 502);
    assert.equal(calls, 1);
  }
  const response = await handleStemConsole(request('/splits/' + split.id + '/stems/drums'), env, {
    authorize: async () => true, fetchImpl: async url => url.includes('/api/v1/') ? reply(split) : new Response(null, { status: 302, headers: { Location: 'https://evil.example/private' } })
  });
  assert.equal(response.status, 502);
});

test('client sends full mode explicitly and does not turn a failed upload into a second job', async () => {
  let count = 0;
  const client = new StemConsoleClient({ baseUrl: 'https://apsaudio.com.br/stemconsole', getToken: () => 'APS_TOKEN', fetchImpl: async (url, options) => {
    count++;
    assert.equal(options.body.get('model'), 'full');
    assert.equal(options.headers.get('Idempotency-Key'), 'same_request_key_12345');
    assert.equal(options.headers.get('Authorization'), 'Bearer APS_TOKEN');
    return reply({ error: 'limit_reached' }, 402);
  } });
  await assert.rejects(client.start(new File(['test'], 'song.mp3'), 'full', 'same_request_key_12345'), { status: 402 });
  assert.equal(count, 1);
});

test('browser fetch keeps its global receiver when called through the client', async () => {
  const client = new StemConsoleClient({ baseUrl: 'https://apsaudio.com.br/stemconsole', getToken: () => null,
    fetchImpl: function () { assert.equal(this, globalThis); return Promise.resolve(reply({ enabled: false })); }
  });
  assert.deepEqual(await client.config(), { enabled: false });
});

test('polling follows the same job through a 429 without resubmitting audio', async () => {
  const states = [reply({ error: 'rate_limit' }, 429, { 'Retry-After': '2' }), reply({ id: split.id, status: 'queued' }), reply({ id: split.id, status: 'processing' }), reply(split)];
  const delays = [];
  const client = new StemConsoleClient({ baseUrl: 'https://apsaudio.com.br/stemconsole', getToken: () => 'APS_TOKEN', fetchImpl: async (url, options) => {
    assert.equal(url, 'https://apsaudio.com.br/stemconsole/splits/' + split.id);
    assert.equal(options.method, undefined);
    return states.shift();
  } });
  assert.deepEqual(await client.wait(split.id, 'full', { delay: async ms => delays.push(ms) }), split);
  assert.deepEqual(delays, [2000, 3000, 3000]);
});

test('missing instruments, empty downloads and HTML cannot become successful stems', async () => {
  assert.throws(() => verifySplit({ ...split, stems: split.stems.slice(0,4) }, 'full'), /não correspondem/);
  assert.throws(() => verifySplit({ ...split, id: '../private' }, 'full'), /identificador/);
  for (const response of [new Response('login', { headers: { 'Content-Type': 'text/html' } }), new Response('', { headers: { 'Content-Type': 'audio/mpeg' } })]) {
    const client = new StemConsoleClient({ baseUrl: 'https://apsaudio.com.br/stemconsole', getToken: () => 'APS_TOKEN', fetchImpl: async () => response });
    await assert.rejects(client.stem(split.id, 'drums'));
  }
});

test('pausing the wait aborts polling without deleting the song', async () => {
  const controller = new AbortController();
  let calls = 0;
  const client = new StemConsoleClient({ baseUrl: 'https://apsaudio.com.br/stemconsole', getToken: () => 'APS_TOKEN', fetchImpl: async () => { calls++; return reply({ id: split.id, status: 'processing' }); } });
  await assert.rejects(client.wait(split.id, 'full', { signal: controller.signal, onStatus: () => controller.abort() }), { name: 'AbortError' });
  assert.equal(calls, 1);
});
