// Servidor local para E2E: roda o código REAL do Worker (workers/aps-voice-vault/lib.js) com KV/R2 em memória
// e provedores 100% mockados (nenhuma chamada externa, zero gasto).
// Uso: node tests/voice-cloning-mock-server.mjs <porta> [auth|ok] [origem-do-site]   (auth = exige login do Access → 401)
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { handle } from '../workers/aps-voice-vault/lib.js';
const studioHtml = readFileSync(new URL('../voice-singer.html', import.meta.url), 'utf8');

const port = Number(process.argv[2] || 8799);
const requireAuth = process.argv[3] === 'auth';
let mode = 'ok'; // ok | saldo
const providerLog = [];
const methods = [];

class KV { constructor() { this.m = new Map(); } async get(k) { return this.m.has(k) ? this.m.get(k) : null; } async put(k, v) { this.m.set(k, String(v)); } async delete(k) { this.m.delete(k); } }
class R2 {
  constructor() { this.m = new Map(); }
  async put(k, v, o = {}) { const buf = v instanceof ArrayBuffer ? new Uint8Array(v) : v instanceof Uint8Array ? v : new Uint8Array(await new Response(v).arrayBuffer()); this.m.set(k, { buf, o }); }
  async get(k) { const x = this.m.get(k); return x ? { size: x.buf.length, body: new Response(x.buf).body, httpMetadata: x.o.httpMetadata || {} } : null; }
  async head(k) { return this.m.has(k) ? {} : null; }
  async delete(k) { this.m.delete(k); }
}
const env = {
  REPLICATE_API_TOKEN: 'mock-token', KITS_API_KEY: 'mock-key', VOICE_KV: new KV(), VOICE_AUDIO: new R2(),
  DEV_ALLOW_NO_ACCESS: requireAuth ? 'false' : 'true', SITE_ORIGIN: process.argv[4] || 'https://apsaudio.com.br', EXTRA_ORIGINS: process.argv[4] || '', CF_ACCESS_AUD: 'x', CF_ACCESS_TEAM_DOMAIN: 'https://mock.cloudflareaccess.com'
};

function sineWav(seconds, freq, rate = 44100) {
  const n = Math.round(seconds * rate), b = new Uint8Array(44 + n * 2), v = new DataView(b.buffer);
  const s = (p, t) => [...t].forEach((c, i) => v.setUint8(p + i, c.charCodeAt(0)));
  s(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); s(8, 'WAVE'); s(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); s(36, 'data'); v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.round(0.4 * Math.sin(2 * Math.PI * freq * (1 + 0.01 * Math.sin(2 * Math.PI * 5 * i / rate)) * i / rate) * 32767), true);
  return b;
}

const polls = {};
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === 'string' ? input : input.url, method = (init.method || 'GET').toUpperCase();
  providerLog.push(method + ' ' + url.replace(/\?.*/, ''));
  if (url === 'https://api.replicate.com/v1/files' && method === 'POST') return Response.json({ id: 'f1', urls: { get: 'https://api.replicate.com/v1/files/f1/download' } }, { status: 201 });
  if (url === 'https://api.replicate.com/v1/predictions' && method === 'POST') {
    if (mode === 'saldo') return Response.json({ detail: 'You have insufficient credit' }, { status: 402 });
    const b = JSON.parse(init.body); const id = (b.input.dataset_zip ? 'train' : 'conv') + Date.now().toString(36);
    return Response.json({ id, status: 'starting' }, { status: 201 });
  }
  let m = url.match(/^https:\/\/api\.replicate\.com\/v1\/predictions\/(\w+)$/);
  if (m) {
    polls[m[1]] = (polls[m[1]] || 0) + 1;
    const done = polls[m[1]] >= 2, isTrain = m[1].startsWith('train');
    return Response.json({ id: m[1], status: done ? 'succeeded' : 'processing', output: done ? (isTrain ? 'https://mock.delivery/model.zip' : 'https://mock.delivery/out.wav') : null });
  }
  if (url === 'https://api.replicate.com/v1/account') return Response.json({ username: 'mock' });
  if (url.startsWith('https://arpeggi.io/api/kits/v1/voice-models')) return Response.json({ data: [{ id: 42, title: 'Voz Demo Rápida' }] });
  if (url === 'https://arpeggi.io/api/kits/v1/voice-conversions' && method === 'POST') {
    if (mode === 'saldo') return Response.json({ message: 'Payment required' }, { status: 402 });
    return Response.json({ id: 9001, status: 'running' }, { status: 201 });
  }
  if (url === 'https://arpeggi.io/api/kits/v1/voice-conversions/9001') {
    polls.k = (polls.k || 0) + 1;
    return Response.json({ id: 9001, status: polls.k >= 2 ? 'success' : 'running', outputFileUrl: polls.k >= 2 ? 'https://mock.delivery/out.wav' : null });
  }
  if (url === 'https://mock.delivery/model.zip') return new Response(new Uint8Array([0x50, 0x4b, 3, 4, 0, 0]), { headers: { 'content-length': '6', 'content-type': 'application/zip' } });
  if (url === 'https://mock.delivery/out.wav') { const w = sineWav(4, 330); return new Response(w, { headers: { 'content-type': 'audio/wav', 'content-length': String(w.length) } }); }
  return realFetch(input, init);
};

http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://127.0.0.1:${port}`);
  if (u.pathname === '/__mock/mode') { mode = u.searchParams.get('m') || 'ok'; res.writeHead(200, { 'access-control-allow-origin': '*' }); return res.end(mode); }
  if (u.pathname === '/__mock/log') { res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' }); return res.end(JSON.stringify(providerLog)); }
  methods.push(req.method + ' ' + u.pathname);
  if (u.pathname === '/__mock/methods') { res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' }); return res.end(JSON.stringify(methods)); }
  const chunks = []; for await (const c of req) chunks.push(c);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  const headers = new Headers(); for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
  const request = new Request(u.href, { method: req.method, headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : body });
  const r = await handle(request, env, { studioHtml });
  const out = Buffer.from(await r.arrayBuffer());
  const h = {}; r.headers.forEach((v, k) => { h[k] = v; });
  res.writeHead(r.status, h); res.end(out);
}).listen(port, '127.0.0.1', () => console.log('mock-worker pronto em', port, requireAuth ? '(auth)' : ''));
