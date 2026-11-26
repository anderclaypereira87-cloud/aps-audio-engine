// Testes do Worker aps-voice-vault (APS Voz Studio). Rodar: node --test tests/voice-cloning-worker.test.mjs
// Todo acesso a provedores é feito com fetch mockado — zero chamadas reais, zero gasto.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../workers/aps-voice-vault.js';
import * as L from '../workers/aps-voice-vault/lib.js';

const BASE = 'https://aps-voice-vault.aps-audio.workers.dev';
const SITE = 'https://apsaudio.com.br';
const TEAM = 'https://sparkling-sunset-889c.cloudflareaccess.com';
const AUD = 'aud-test-123';

// ---------- mocks ----------
class KV { constructor() { this.m = new Map(); } async get(k) { return this.m.has(k) ? this.m.get(k) : null; } async put(k, v) { this.m.set(k, String(v)); } async delete(k) { this.m.delete(k); } }
class R2 {
  constructor() { this.m = new Map(); }
  async put(k, v, o = {}) { const buf = v instanceof ArrayBuffer ? new Uint8Array(v) : v instanceof Uint8Array ? v : new Uint8Array(await new Response(v).arrayBuffer()); this.m.set(k, { buf, o }); }
  async get(k) { const x = this.m.get(k); if (!x) return null; return { size: x.buf.length, body: new Response(x.buf).body, httpMetadata: x.o.httpMetadata || {}, customMetadata: x.o.customMetadata || {} }; }
  async head(k) { return this.m.has(k) ? { size: this.m.get(k).buf.length } : null; }
  async delete(k) { this.m.delete(k); }
}

let keyPair, jwk, calls, routes, realFetch;
const b64u = (u8) => Buffer.from(u8).toString('base64url');
async function makeJwt(claims = {}) {
  const h = { alg: 'RS256', kid: 'k1', typ: 'JWT' };
  const c = { aud: [AUD], iss: TEAM, exp: Math.floor(Date.now() / 1000) + 600, email: 'dono@apsaudio.com.br', ...claims };
  const data = b64u(Buffer.from(JSON.stringify(h))) + '.' + b64u(Buffer.from(JSON.stringify(c)));
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', keyPair.privateKey, new TextEncoder().encode(data));
  return data + '.' + b64u(new Uint8Array(sig));
}

function mockFetch() {
  calls = [];
  routes = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    const method = (init.method || 'GET').toUpperCase();
    if (url === TEAM + '/cdn-cgi/access/certs') return Response.json({ keys: [jwk] });
    calls.push({ url, method, headers: init.headers || {}, body: init.body });
    for (const r of routes) if (r.method === method && (typeof r.url === 'string' ? url === r.url : r.url.test(url))) return r.respond(url, init);
    throw new Error('fetch não mockado: ' + method + ' ' + url);
  };
}
const on = (method, url, respond) => routes.push({ method, url, respond });
const providerCalls = () => calls.filter(c => !c.url.startsWith(TEAM));

function makeEnv(extra = {}) {
  return { CF_ACCESS_AUD: AUD, CF_ACCESS_TEAM_DOMAIN: TEAM, REPLICATE_API_TOKEN: 'r8_fake_SEGREDO', KITS_API_KEY: 'kits_fake_SEGREDO', VOICE_KV: new KV(), VOICE_AUDIO: new R2(), ...extra };
}
async function req(env, path, { method = 'GET', body, headers = {}, auth = true, origin = SITE } = {}) {
  const h = { ...headers };
  if (origin) h.Origin = origin;
  if (auth) h['Cf-Access-Jwt-Assertion'] = await makeJwt();
  const r = await worker.fetch(new Request(BASE + path, { method, headers: h, body }), env);
  const text = await r.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { r, data, text };
}

function wav(seconds, rate = 16000) {
  const n = Math.round(seconds * rate), b = new Uint8Array(44 + n * 2), dv = new DataView(b.buffer);
  const s = (p, x) => [...x].forEach((c, i) => dv.setUint8(p + i, c.charCodeAt(0)));
  s(0, 'RIFF'); dv.setUint32(4, 36 + n * 2, true); s(8, 'WAVE'); s(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
  dv.setUint32(24, rate, true); dv.setUint32(28, rate * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true); s(36, 'data'); dv.setUint32(40, n * 2, true);
  return b;
}
function zipStore(files) {
  const parts = [], central = []; let off = 0; const enc = new TextEncoder();
  for (const [name, data] of files) {
    const n = enc.encode(name), h = new Uint8Array(30 + n.length), dv = new DataView(h.buffer);
    dv.setUint32(0, 0x04034b50, true); dv.setUint16(4, 20, true); dv.setUint32(18, data.length, true); dv.setUint32(22, data.length, true); dv.setUint16(26, n.length, true); h.set(n, 30);
    const c = new Uint8Array(46 + n.length), cv = new DataView(c.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint32(20, data.length, true); cv.setUint32(24, data.length, true); cv.setUint16(28, n.length, true); cv.setUint32(42, off, true); c.set(n, 46);
    parts.push(h, data); central.push(c); off += h.length + data.length;
  }
  const csz = central.reduce((a, c) => a + c.length, 0), e = new Uint8Array(22), ev = new DataView(e.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, files.length, true); ev.setUint16(10, files.length, true); ev.setUint32(12, csz, true); ev.setUint32(16, off, true);
  const all = [...parts, ...central, e], out = new Uint8Array(all.reduce((a, x) => a + x.length, 0)); let p = 0; for (const x of all) { out.set(x, p); p += x.length; }
  return out;
}

async function uploadDataset(env, seconds = 150) {
  const z = zipStore(Array.from({ length: 3 }, (_, i) => [`dataset/voz/split_${i}.wav`, wav(1)]));
  return req(env, '/api/uploads?kind=dataset', { method: 'POST', body: z, headers: { 'content-type': 'application/zip', 'x-aps-duration': String(seconds), 'x-aps-filename': 'voz.zip' } });
}
async function uploadGuide(env) {
  return req(env, '/api/uploads?kind=guide', { method: 'POST', body: wav(3), headers: { 'content-type': 'audio/wav', 'x-aps-filename': 'guia.wav' } });
}
function mockReplicateHappy() {
  let n = 0;
  on('POST', 'https://api.replicate.com/v1/files', () => Response.json({ id: 'f' + (++n), urls: { get: 'https://api.replicate.com/v1/files/f' + n + '/download' } }, { status: 201 }));
  on('POST', 'https://api.replicate.com/v1/predictions', (u, init) => { const b = JSON.parse(init.body); return Response.json({ id: b.input.dataset_zip ? 'trainpred01' : 'convpred01', status: 'starting' }, { status: 201 }); });
}

beforeEach(async () => {
  keyPair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  jwk = { ...(await crypto.subtle.exportKey('jwk', keyPair.publicKey)), kid: 'k1' };
  L._resetCertCache();
  realFetch = globalThis.fetch;
  mockFetch();
});
afterEach(() => { globalThis.fetch = realFetch; });

// ---------- health / CORS / Access ----------
test('/api/health informa motores e armazenamento sem vazar segredos', async () => {
  const env = makeEnv();
  const { r, data, text } = await req(env, '/api/health', { auth: false });
  assert.equal(r.status, 200);
  assert.equal(data.service, 'aps-voice-vault');
  assert.deepEqual(data.engines.treino, { label: 'Motor Treino', configured: true });
  assert.deepEqual(data.engines.rapido, { label: 'Motor Rápido', configured: true });
  assert.equal(data.storage.ok, true);
  assert.equal(data.authenticated, false);
  assert.ok(!text.includes('SEGREDO') && !text.includes('r8_'), 'não pode vazar valor de segredo');
  assert.equal(data.limits, undefined, 'detalhes só para usuário autenticado');
});

test('/api/health sem bindings e sem chaves → configured false e storage.ok false', async () => {
  const { data } = await req({ CF_ACCESS_AUD: AUD, CF_ACCESS_TEAM_DOMAIN: TEAM }, '/api/health');
  assert.equal(data.engines.treino.configured, false);
  assert.equal(data.engines.rapido.configured, false);
  assert.deepEqual(data.storage, { kv: false, r2: false, ok: false });
  assert.equal(data.authenticated, true);
});

test('/api/health?deep=1 faz só checagens GET de leitura e mapeia saldo/chave', async () => {
  on('GET', 'https://api.replicate.com/v1/account', () => Response.json({ username: 'x' }));
  on('GET', /arpeggi\.io\/api\/kits\/v1\/voice-models/, () => new Response('{"message":"Unauthorized"}', { status: 401 }));
  const { data, text } = await req(makeEnv(), '/api/health?deep=1');
  assert.equal(data.checks.treino.ok, true);
  assert.equal(data.checks.rapido.ok, false);
  assert.equal(data.checks.rapido.reason, 'auth');
  assert.ok(providerCalls().every(c => c.method === 'GET'), 'nenhum POST (nada pago) no health');
  assert.ok(!/replicate|kits|rvc/i.test(JSON.stringify(data.checks)), 'mensagens sem nome de provedor');
  assert.ok(!text.includes('SEGREDO'));
});

test('CORS: preflight para apsaudio.com.br e localhost com credenciais; origem estranha bloqueada', async () => {
  for (const origin of [SITE, 'https://www.apsaudio.com.br', 'http://localhost:8080', 'http://127.0.0.1:5173']) {
    const r = await worker.fetch(new Request(BASE + '/api/uploads', { method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'POST' } }), makeEnv());
    assert.equal(r.status, 204);
    assert.equal(r.headers.get('access-control-allow-origin'), origin);
    assert.equal(r.headers.get('access-control-allow-credentials'), 'true');
    assert.match(r.headers.get('access-control-allow-headers'), /x-aps-filename/);
  }
  const bad = await worker.fetch(new Request(BASE + '/api/health', { headers: { Origin: 'https://evil.example' } }), makeEnv());
  assert.equal(bad.status, 403);
  assert.equal(bad.headers.get('access-control-allow-origin'), null);
  const extra = await worker.fetch(new Request(BASE + '/api/health', { headers: { Origin: 'https://staging.apsaudio.com.br' } }), makeEnv({ EXTRA_ORIGINS: 'https://staging.apsaudio.com.br' }));
  assert.equal(extra.headers.get('access-control-allow-origin'), 'https://staging.apsaudio.com.br');
});

test('Access: sem JWT → 401 com code login; JWT inválido/expirado/aud errada → 401', async () => {
  const env = makeEnv();
  let x = await req(env, '/api/voices', { auth: false });
  assert.equal(x.r.status, 401); assert.equal(x.data.code, 'login');
  assert.equal(x.r.headers.get('access-control-allow-origin'), SITE);
  for (const claims of [{ exp: 10 }, { aud: ['outra'] }, { iss: 'https://x.cloudflareaccess.com' }]) {
    const t = await makeJwt(claims);
    const r = await worker.fetch(new Request(BASE + '/api/voices', { headers: { Origin: SITE, 'Cf-Access-Jwt-Assertion': t } }), env);
    assert.equal(r.status, 401);
  }
  const t = (await makeJwt()).slice(0, -4) + 'AAAA';
  assert.equal((await worker.fetch(new Request(BASE + '/api/voices', { headers: { 'Cf-Access-Jwt-Assertion': t } }), env)).status, 401);
});

test('Access: ALLOWED_EMAILS restringe e login redireciona só para origem permitida', async () => {
  const env = makeEnv({ ALLOWED_EMAILS: 'outro@x.com' });
  assert.equal((await req(env, '/api/voices')).r.status, 401);
  const env2 = makeEnv();
  const ok = await worker.fetch(new Request(BASE + '/api/auth/login?return=' + encodeURIComponent(SITE + '/voice-singer.html'), { headers: { 'Cf-Access-Jwt-Assertion': await makeJwt() } }), env2);
  assert.equal(ok.status, 302); assert.equal(ok.headers.get('location'), SITE + '/voice-singer.html');
  const evil = await worker.fetch(new Request(BASE + '/api/auth/login?return=' + encodeURIComponent('https://evil.example/x'), { headers: { 'Cf-Access-Jwt-Assertion': await makeJwt() } }), env2);
  assert.equal(evil.status, 200); assert.match(await evil.text(), /Acesso confirmado/);
});

test('sem bindings de armazenamento → 503 explicando VOICE_KV/VOICE_AUDIO', async () => {
  const { r, data } = await req({ CF_ACCESS_AUD: AUD, CF_ACCESS_TEAM_DOMAIN: TEAM, REPLICATE_API_TOKEN: 'x' }, '/api/voices');
  assert.equal(r.status, 503); assert.match(data.error, /VOICE_KV/);
});

// ---------- upload ----------
test('upload: valida tipo, tamanho, duração e formato', async () => {
  const env = makeEnv();
  let x = await req(env, '/api/uploads?kind=sample', { method: 'POST', body: wav(5), headers: { 'content-type': 'audio/wav' } });
  assert.equal(x.r.status, 400); assert.match(x.data.error, /curto demais/);
  x = await req(env, '/api/uploads?kind=sample', { method: 'POST', body: new TextEncoder().encode('não é áudio nenhum aqui'), headers: { 'content-type': 'audio/wav' } });
  assert.equal(x.r.status, 400); assert.match(x.data.error, /Formato não suportado/);
  x = await req(env, '/api/uploads?kind=xyz', { method: 'POST', body: wav(1) });
  assert.equal(x.r.status, 400);
  x = await req(env, '/api/uploads?kind=guide', { method: 'POST', body: new Uint8Array(0) });
  assert.equal(x.r.status, 400); assert.match(x.data.error, /vazio/);
  x = await req(env, '/api/uploads?kind=guide', { method: 'POST', body: wav(1), headers: { 'content-length': String(60 * 1024 * 1024) } });
  assert.equal(x.r.status, 413);
  x = await req(env, '/api/uploads?kind=dataset', { method: 'POST', body: zipStore([['outra/coisa.txt', new Uint8Array(4)]]), headers: { 'x-aps-duration': '150' } });
  assert.equal(x.r.status, 400); assert.match(x.data.error, /Pacote de treino inválido/);
  x = await req(env, '/api/uploads?kind=dataset', { method: 'POST', body: zipStore([['dataset/v/split_0.wav', wav(1)]]), headers: { 'x-aps-duration': '1200' } });
  assert.equal(x.r.status, 400); assert.match(x.data.error, /longo demais/);
  assert.equal(L.validateUpload({ kind: 'guide', size: 60 * 1024 * 1024, sniff: { ext: 'wav' } }).includes('grande'), true);
  assert.deepEqual(L.sniffAudio(new Uint8Array([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 0, 0, 0]).buffer).ext, 'mp3');
  const m4a = new Uint8Array(16); m4a.set(new TextEncoder().encode('ftypM4A '), 4);
  assert.equal(L.sniffAudio(m4a.buffer).ext, 'm4a');
  assert.ok(providerCalls().length === 0, 'upload não chama provedor');
});

test('upload: guia WAV válida vai para R2 + KV e pode ser baixada com CORS', async () => {
  const env = makeEnv();
  const { r, data } = await uploadGuide(env);
  assert.equal(r.status, 201); assert.match(data.id, /^up_[a-f0-9]{20}$/);
  assert.ok(Math.abs(data.duration - 3) < 0.01);
  assert.ok(env.VOICE_AUDIO.m.has('uploads/' + data.id));
  const a = await worker.fetch(new Request(BASE + data.audioUrl, { headers: { Origin: SITE, 'Cf-Access-Jwt-Assertion': await makeJwt() } }), env);
  assert.equal(a.status, 200); assert.equal(a.headers.get('content-type'), 'audio/wav');
  assert.equal(a.headers.get('access-control-allow-origin'), SITE);
  const bad = await req(env, '/api/audio/models/voz_x.zip'); // modelos nunca são servidos
  assert.equal(bad.r.status, 400);
});

// ---------- treino ----------
test('treino: exige consentimento e confirmação; inicia job com versão fixa; polling salva modelo', async () => {
  const env = makeEnv();
  mockReplicateHappy();
  const ds = (await uploadDataset(env)).data;
  assert.equal(ds.entries, 3);
  let x = await req(env, '/api/voices', { method: 'POST', body: JSON.stringify({ name: 'Minha Voz', datasetId: ds.id, confirmCost: true }) });
  assert.equal(x.r.status, 400); assert.equal(x.data.code, 'consentimento');
  x = await req(env, '/api/voices', { method: 'POST', body: JSON.stringify({ name: 'Minha Voz', datasetId: ds.id, consent: true }) });
  assert.equal(x.data.code, 'confirmacao');
  assert.equal(providerCalls().length, 0, 'nada enviado ao provedor sem confirmação');
  x = await req(env, '/api/voices', { method: 'POST', body: JSON.stringify({ name: 'Minha Voz', datasetId: ds.id, consent: true, confirmCost: true }) });
  assert.equal(x.r.status, 202);
  const { voice, job } = x.data;
  assert.equal(voice.status, 'treinando'); assert.equal(job.type, 'train'); assert.equal(job.engineLabel, 'Motor Treino');
  const pred = providerCalls().find(c => c.url.endsWith('/predictions'));
  const body = JSON.parse(pred.body);
  assert.equal(body.version, L.TRAIN_VERSION);
  assert.match(body.input.dataset_zip, /^https:\/\/api\.replicate\.com\/v1\/files\//);
  assert.equal(pred.headers.Authorization, 'Bearer r8_fake_SEGREDO');
  // segunda voz em treino é bloqueada
  const busy = await req(env, '/api/voices', { method: 'POST', body: JSON.stringify({ name: 'Outra', datasetId: ds.id, consent: true, confirmCost: true }) });
  assert.equal(busy.r.status, 409);
  // polling: processando → pronto (modelo copiado para R2)
  let state = 'processing';
  on('GET', 'https://api.replicate.com/v1/predictions/trainpred01', () => Response.json({ id: 'trainpred01', status: state, output: state === 'succeeded' ? 'https://replicate.delivery/x/model.zip' : null }));
  on('GET', 'https://replicate.delivery/x/model.zip', () => new Response(new Uint8Array([0x50, 0x4b, 3, 4, 9, 9]), { headers: { 'content-length': '6' } }));
  x = await req(env, '/api/jobs/' + job.id);
  assert.equal(x.data.job.status, 'processando');
  state = 'succeeded';
  x = await req(env, '/api/jobs/' + job.id);
  assert.equal(x.data.job.status, 'pronto');
  assert.ok(env.VOICE_AUDIO.m.has('models/' + voice.id + '.zip'));
  const list = await req(env, '/api/voices');
  assert.equal(list.data.voices[0].status, 'pronta');
  assert.ok(list.data.voices[0].engines.treino.modelKey);
  const hist = await req(env, '/api/jobs');
  assert.equal(hist.data.jobs.length, 1);
});

test('treino: falha do provedor marca voz com erro em português', async () => {
  const env = makeEnv({ KITS_API_KEY: '' });
  mockReplicateHappy();
  const ds = (await uploadDataset(env)).data;
  const { job, voice } = (await req(env, '/api/voices', { method: 'POST', body: JSON.stringify({ name: 'Voz X', datasetId: ds.id, consent: true, confirmCost: true }) })).data;
  on('GET', /predictions\/trainpred01$/, () => Response.json({ id: 'trainpred01', status: 'failed', error: 'CUDA OOM interno' }));
  const x = await req(env, '/api/jobs/' + job.id);
  assert.equal(x.data.job.status, 'erro');
  assert.match(x.data.job.error, /treino da voz falhou/);
  assert.ok(!JSON.stringify(x.data).includes('CUDA'), 'detalhe técnico do provedor fica interno');
  const v = (await req(env, '/api/voices')).data.voices.find(y => y.id === voice.id);
  assert.equal(v.status, 'erro');
});

test('erro de saldo (402) e chave recusada (401) viram mensagens claras sem nome do provedor', async () => {
  const env = makeEnv({ KITS_API_KEY: '' });
  on('POST', 'https://api.replicate.com/v1/files', () => Response.json({ id: 'f', urls: { get: 'https://api.replicate.com/v1/files/f/download' } }));
  on('POST', 'https://api.replicate.com/v1/predictions', () => Response.json({ detail: 'You have insufficient credit to run this model.' }, { status: 402 }));
  const ds = (await uploadDataset(env)).data;
  let x = await req(env, '/api/voices', { method: 'POST', body: JSON.stringify({ name: 'Voz', datasetId: ds.id, consent: true, confirmCost: true }) });
  assert.equal(x.r.status, 402); assert.equal(x.data.code, 'saldo');
  assert.match(x.data.error, /Sem saldo na conta do Motor Treino/);
  assert.ok(!/replicate/i.test(x.data.error));
  assert.equal(await L.usage(env, 'train'), 0, 'falha não consome o limite diário');
  routes.length = 0;
  on('POST', 'https://api.replicate.com/v1/files', () => new Response('{"detail":"Unauthenticated"}', { status: 401 }));
  x = await req(env, '/api/voices', { method: 'POST', body: JSON.stringify({ name: 'Voz', datasetId: ds.id, consent: true, confirmCost: true }) });
  assert.equal(x.data.code, 'auth'); assert.match(x.data.error, /chave do Motor Treino foi recusada/);
  x = await req(makeEnv({ REPLICATE_API_TOKEN: '' }), '/api/voices', { method: 'POST', body: JSON.stringify({ name: 'Voz', datasetId: ds.id, consent: true, confirmCost: true }) });
  assert.equal(x.r.status, 424); assert.equal(x.data.code, 'chave_ausente');
});

// ---------- limites diários ----------
test('limite diário de treino e conversão protege contra gasto acidental; PAID_JOBS_ENABLED=false pausa', async () => {
  const env = makeEnv({ TRAIN_DAILY_LIMIT: '1', KITS_API_KEY: '' });
  mockReplicateHappy();
  const ds = (await uploadDataset(env)).data;
  const day = L.recifeDay();
  await env.VOICE_KV.put(`count:${day}:train`, '1');
  let x = await req(env, '/api/voices', { method: 'POST', body: JSON.stringify({ name: 'Voz', datasetId: ds.id, consent: true, confirmCost: true }) });
  assert.equal(x.r.status, 429); assert.equal(x.data.code, 'limite_diario'); assert.match(x.data.error, /1\/dia/);
  assert.equal(providerCalls().length, 0);
  const env2 = makeEnv({ PAID_JOBS_ENABLED: 'false', KITS_API_KEY: '' });
  const ds2 = (await uploadDataset(env2)).data;
  x = await req(env2, '/api/voices', { method: 'POST', body: JSON.stringify({ name: 'Voz', datasetId: ds2.id, consent: true, confirmCost: true }) });
  assert.equal(x.r.status, 423);
  assert.equal(L.recifeDay(Date.UTC(2026, 10, 27, 2, 0)), '2026-11-26', 'dia segue America/Recife');
});

// ---------- conversão ----------
async function readyVoice(env, engines) {
  const v = { id: L.newId('voz'), name: 'Voz Pronta', status: 'pronta', engines, createdAt: Date.now() };
  await env.VOICE_KV.put('voices', JSON.stringify([v]));
  if (engines.treino) await env.VOICE_AUDIO.put(engines.treino.modelKey, new Uint8Array([0x50, 0x4b, 3, 4]));
  return v;
}

test('conversão Motor Treino: transposição limitada a ±12, fidelidade, polling e resultado em R2 com aviso de IA', async () => {
  const env = makeEnv({ KITS_API_KEY: '' });
  mockReplicateHappy();
  const v = await readyVoice(env, { treino: { modelKey: 'models/x.zip' } });
  const g = (await uploadGuide(env)).data;
  let x = await req(env, '/api/convert', { method: 'POST', body: JSON.stringify({ voiceId: v.id, guideId: g.id, pitch: 30, fidelity: 1 }) });
  assert.equal(x.data.code, 'confirmacao');
  x = await req(env, '/api/convert', { method: 'POST', body: JSON.stringify({ voiceId: v.id, guideId: g.id, pitch: 30, fidelity: 1, confirmCost: true }) });
  assert.equal(x.r.status, 202);
  const pred = JSON.parse(providerCalls().find(c => c.url.endsWith('/predictions')).body);
  assert.equal(pred.version, L.INFER_VERSION);
  assert.equal(pred.input.pitch, 12);
  assert.equal(pred.input.index_rate, 0.9);
  assert.equal(x.data.job.pitch, 12);
  on('GET', /predictions\/convpred01$/, () => Response.json({ id: 'convpred01', status: 'succeeded', output: 'https://replicate.delivery/y/out.mp3' }));
  on('GET', 'https://replicate.delivery/y/out.mp3', () => new Response(new Uint8Array([0x49, 0x44, 0x33, 1]), { headers: { 'content-type': 'audio/mpeg', 'content-length': '4' } }));
  const done = (await req(env, '/api/jobs/' + x.data.job.id)).data.job;
  assert.equal(done.status, 'pronto');
  assert.match(done.resultUrl, /^\/api\/audio\/results\/job_[a-f0-9]{20}\.mp3$/);
  assert.match(done.originalUrl, /^\/api\/audio\/uploads\//);
  assert.match(done.notice, /Voz gerada por IA/);
  const a = await worker.fetch(new Request(BASE + done.resultUrl, { headers: { Origin: SITE, 'Cf-Access-Jwt-Assertion': await makeJwt() } }), env);
  assert.equal(a.status, 200); assert.equal(a.headers.get('content-type'), 'audio/mpeg');
  assert.equal(await L.usage(env, 'convert'), 1);
});

test('conversão Motor Rápido (multipart) com fallback limpo para Motor Treino quando falta saldo', async () => {
  const env = makeEnv();
  mockReplicateHappy();
  on('POST', 'https://arpeggi.io/api/kits/v1/voice-conversions', () => new Response('{"message":"Payment required"}', { status: 402 }));
  const v = await readyVoice(env, { rapido: { modelId: '123' }, treino: { modelKey: 'models/y.zip' } });
  const g = (await uploadGuide(env)).data;
  const x = await req(env, '/api/convert', { method: 'POST', body: JSON.stringify({ voiceId: v.id, guideId: g.id, pitch: -3, fidelity: 0.5, engine: 'auto', confirmCost: true }) });
  assert.equal(x.r.status, 202);
  assert.equal(x.data.job.engine, 'treino');
  assert.deepEqual(x.data.job.fallbackFrom, ['rapido']);
  const kits = providerCalls().find(c => c.url.includes('voice-conversions'));
  assert.match(kits.headers['content-type'], /^multipart\/form-data; boundary=/);
  const sent = new TextDecoder().decode(new Uint8Array(await new Response(kits.body).arrayBuffer()));
  assert.match(sent, /name="voiceModelId"\r\n\r\n123/);
  assert.match(sent, /name="pitchShift"\r\n\r\n-3/);
  assert.match(sent, /name="soundFile"; filename="guia.wav"/);
});

test('conversão Motor Rápido: sucesso e polling do status do provedor', async () => {
  const env = makeEnv({ REPLICATE_API_TOKEN: '' });
  on('POST', 'https://arpeggi.io/api/kits/v1/voice-conversions', () => Response.json({ id: 777, status: 'running' }, { status: 201 }));
  on('GET', 'https://arpeggi.io/api/kits/v1/voice-conversions/777', () => Response.json({ id: 777, status: 'success', outputFileUrl: 'https://s3.example.com/out.wav' }));
  on('GET', 'https://s3.example.com/out.wav', () => new Response(wav(1), { headers: { 'content-type': 'audio/wav', 'content-length': String(wav(1).length) } }));
  const v = await readyVoice(env, { rapido: { modelId: '55' } });
  const g = (await uploadGuide(env)).data;
  const x = await req(env, '/api/convert', { method: 'POST', body: JSON.stringify({ voiceId: v.id, guideId: g.id, pitch: 2, fidelity: 0.8, confirmCost: true }) });
  assert.equal(x.data.job.engine, 'rapido'); assert.equal(x.data.job.engineLabel, 'Motor Rápido');
  const done = (await req(env, '/api/jobs/' + x.data.job.id)).data.job;
  assert.equal(done.status, 'pronto'); assert.match(done.resultUrl, /\.wav$/);
});

test('conversão: erros de entrada (sem voz, sem guia, voz em treino, motor ausente)', async () => {
  const env = makeEnv({ KITS_API_KEY: '', REPLICATE_API_TOKEN: '' });
  let x = await req(env, '/api/convert', { method: 'POST', body: JSON.stringify({ voiceId: 'voz_x', guideId: 'up_x', confirmCost: true }) });
  assert.equal(x.r.status, 404);
  const v = await readyVoice(env, { treino: { modelKey: 'models/z.zip' } });
  x = await req(env, '/api/convert', { method: 'POST', body: JSON.stringify({ voiceId: v.id, guideId: 'up_x', confirmCost: true }) });
  assert.equal(x.data.code, 'guia');
  const g = (await uploadGuide(env)).data;
  x = await req(env, '/api/convert', { method: 'POST', body: JSON.stringify({ voiceId: v.id, guideId: g.id, confirmCost: true }) });
  assert.equal(x.r.status, 424); assert.equal(x.data.code, 'sem_motor');
  assert.equal(providerCalls().length, 0);
});

test('vozes: registrar modelo do Motor Rápido, vincular e excluir', async () => {
  const env = makeEnv();
  on('GET', /voice-models\?myModels=true/, () => Response.json({ data: [{ id: 42, title: 'Anderclay <script>' }] }));
  let x = await req(env, '/api/voices');
  assert.deepEqual(x.data.rapidoModels, [{ id: '42', title: 'Anderclay script' }]);
  x = await req(env, '/api/voices', { method: 'POST', body: JSON.stringify({ name: 'Voz Kits', engine: 'rapido', rapidoModelId: '42', consent: true }) });
  assert.equal(x.r.status, 201); assert.equal(x.data.voice.status, 'pronta');
  const id = x.data.voice.id;
  x = await req(env, `/api/voices/${id}/rapido`, { method: 'POST', body: JSON.stringify({ rapidoModelId: '43' }) });
  assert.equal(x.data.voice.engines.rapido.modelId, '43');
  x = await req(env, '/api/voices/' + id, { method: 'DELETE' });
  assert.equal(x.data.deleted, id);
  assert.equal((await req(env, '/api/voices')).data.voices.length, 0);
});

test('jobs: id inválido, inexistente e rota desconhecida', async () => {
  const env = makeEnv();
  assert.equal((await req(env, '/api/jobs/xyz')).r.status, 400);
  assert.equal((await req(env, '/api/jobs/job_' + 'a'.repeat(20))).r.status, 404);
  assert.equal((await req(env, '/api/nada')).r.status, 404);
  const root = await worker.fetch(new Request(BASE + '/'), env);
  assert.equal(root.status, 302);
});

test('multipartBody monta corpo correto (fallback sem FixedLengthStream)', async () => {
  const mp = await L.multipartBody({ a: '1' }, { field: 'f', name: 'x.wav', type: 'audio/wav', size: 3, bytes: new Uint8Array([1, 2, 3]) });
  const buf = new Uint8Array(await new Response(mp.body).arrayBuffer());
  assert.equal(buf.length, mp.length);
  assert.match(new TextDecoder().decode(buf), /name="a"\r\n\r\n1\r\n.*name="f"; filename="x.wav"/s);
});
