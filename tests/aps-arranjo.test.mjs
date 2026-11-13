import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import worker, { buildUpstream } from '../workers/aps-arranjo/index.js';
import {
  NOTICE,
  mapUpstreamError,
  allowedAudioUrl,
  publicTask,
  parseModo,
  parseTrackType,
  blockedArtistRequest
} from '../workers/aps-arranjo/lib.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const userFiles = [
  'arranjo.html',
  'aps-arranjo.js',
  'aps-arranjo-daw.js',
  'musica-ia.html',
  'aps-lyria.js',
  'painel.html',
  'aps-ia-comandos.js'
];

function env(extra = {}) {
  return { MUREKA_API_KEY: extra.key ?? 'test-key', LIMITS: extra.LIMITS };
}

async function call(path, { method = 'GET', origin = 'https://apsaudio.com.br', body, headers = {}, env: e } = {}) {
  const reqHeaders = new Headers(headers);
  if (origin) reqHeaders.set('Origin', origin);
  if (body && !reqHeaders.has('Content-Type') && typeof body === 'string') {
    reqHeaders.set('Content-Type', 'application/json');
  }
  const req = new Request('https://aps-arranjo.example' + path, { method, headers: reqHeaders, body });
  return worker.fetch(req, e || env());
}

test('saude responde sem citar provedor', async () => {
  const res = await call('/saude', { origin: '' });
  const data = await res.json();
  assert.equal(res.status, 200);
  assert.equal(data.ok, true);
  assert.equal(data.service, 'aps-arranjo');
  assert.equal('provider' in data, false);
  const blob = JSON.stringify(data);
  assert.doesNotMatch(blob, /mureka|gemini|lyria|openai|google/i);
  assert.match(data.notice, /APS Arranjo/);
  assert.match(data.notice, /não a sua gravação original/);
});

test('CORS libera o site e recusa origem desconhecida', async () => {
  const ok = await call('/saude', { method: 'OPTIONS', origin: 'https://apsaudio.com.br' });
  assert.equal(ok.status, 204);
  assert.equal(ok.headers.get('Access-Control-Allow-Origin'), 'https://apsaudio.com.br');
  const bad = await call('/saude', { method: 'OPTIONS', origin: 'https://evil.example' });
  assert.equal(bad.status, 403);
});

test('gerar sem chave não denuncia o provedor', async () => {
  const res = await call('/gerar', { method: 'POST', body: JSON.stringify({ modo: 'nova', pedido: 'forró instrumental' }), env: {} });
  const data = await res.json();
  assert.equal(res.status, 503);
  assert.match(data.error, /não está configurado/i);
  assert.doesNotMatch(JSON.stringify(data), /mureka|gemini|lyria|openai|google/i);
});

test('buildUpstream nunca pede mais de um resultado e usa o modelo econômico', () => {
  const nova = buildUpstream('nova', { pedido: 'forró com sanfona', letra: '', estilo: '', arquivoId: '', finalidade: 'audio' });
  assert.equal(nova.path, '/v1/instrumental/generate');
  assert.equal(nova.payload.n, 1);
  assert.equal(nova.payload.model, 'mureka-7.6');
  assert.equal(nova.kind, 'instrumental');

  const song = buildUpstream('nova', { pedido: '', letra: '[Verse]\nOi', estilo: 'forró', arquivoId: '42', finalidade: 'reference' });
  assert.equal(song.path, '/v1/song/generate');
  assert.equal(song.payload.n, 1);
  assert.equal(song.payload.reference_id, '42');
  assert.equal('prompt' in song.payload, false);

  const easy = buildUpstream('nova', { pedido: 'mais sanfona', letra: '', estilo: '', arquivoId: '99', finalidade: 'reference' });
  assert.equal(easy.path, '/v1/song/easy-generate');
  assert.equal(easy.payload.reference_id, '99');
  assert.equal(easy.payload.n, 1);

  const acc = buildUpstream('acompanhar', { pedido: 'bass', letra: '', estilo: '', arquivoId: '7', finalidade: 'audio' });
  assert.equal(acc.path, '/v1/track/generate');
  assert.equal(acc.payload.generate_type, 'Instrumental');
  assert.equal(acc.payload.upload_audio_id, '7');

  const inst = buildUpstream('instrumento', { pedido: 'solo', letra: '', estilo: '', arquivoId: '7', finalidade: 'audio', tipoPista: 'Guitar' });
  assert.equal(inst.payload.generate_type, 'Guitar');

  const ext = buildUpstream('estender', { pedido: '', letra: '[Verse]\nsegue', estilo: '', arquivoId: '8', finalidade: 'audio', extendEm: 20 });
  assert.equal(ext.path, '/v1/song/extend');
  assert.equal(ext.payload.extend_at, 20000);
  assert.equal(ext.payload.model, 'mureka-7.6');
});

test('buildUpstream exige áudio ou letra nos modos certos', () => {
  assert.throws(() => buildUpstream('acompanhar', { pedido: 'x', letra: '', arquivoId: '', finalidade: 'audio' }), /Envie um áudio/);
  assert.throws(() => buildUpstream('estender', { pedido: '', letra: '', arquivoId: '1', finalidade: 'audio' }), /letra/);
});

test('gerar chama o endpoint certo e devolve só o id da tarefa', async () => {
  const calls = [];
  const prev = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    calls.push({ url: String(url), body: opts?.body, method: opts?.method });
    return new Response(JSON.stringify({ id: 'task-1', status: 'preparing' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    const res = await call('/gerar', { method: 'POST', body: JSON.stringify({ modo: 'nova', pedido: 'violão suave' }) });
    const data = await res.json();
    assert.equal(res.status, 200);
    assert.equal(data.ok, true);
    assert.equal(data.id, 'task-1');
    assert.equal(data.tipo, 'instrumental');
    assert.doesNotMatch(JSON.stringify(data), /mureka|preparing/);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://api.mureka.ai/v1/instrumental/generate');
    const sent = JSON.parse(calls[0].body);
    assert.equal(sent.n, 1);
    assert.equal(sent.model, 'mureka-7.6');
  } finally {
    globalThis.fetch = prev;
  }
});

test('erros do provedor chegam genéricos ao cliente', () => {
  const a = mapUpstreamError(401, { error: { message: 'Invalid Authentication' } });
  const b = mapUpstreamError(402, { error: { message: 'Insufficient balance' } });
  const c = mapUpstreamError(500, { error: { message: 'upstream boom' } });
  for (const row of [a, b, c]) {
    assert.doesNotMatch(row.error, /mureka|gemini|lyria|openai|google/i);
  }
  assert.equal(b.status, 402);
});

test('tarefa pronta devolve proxy e avisa que é IA', async () => {
  const out = await publicTask({
    id: 't1',
    status: 'succeeded',
    choices: [{ id: 'c1', url: 'https://cdn.mureka.ai/x.mp3', duration: 12000 }]
  }, 'instrumental', 'https://aps-arranjo.example/tarefa/t1', 'test-key');
  assert.equal(out.status, 'pronto');
  assert.equal(out.resultados.length, 1);
  assert.match(out.resultados[0].url, /^https:\/\/aps-arranjo\.example\/audio\?t=/);
  assert.doesNotMatch(JSON.stringify(out), /cdn\.mureka\.ai|mureka/i);
  assert.match(out.aviso, /gerado por IA/i);
  assert.match(out.aviso, /Não é a sua gravação original/);
});

test('proxy só aceita o host de áudio esperado', () => {
  assert.ok(allowedAudioUrl('https://cdn.mureka.ai/a.mp3'));
  assert.equal(allowedAudioUrl('https://evil.example/a.mp3'), null);
  assert.equal(allowedAudioUrl('http://cdn.mureka.ai/a.mp3'), null);
});

test('parse e bloqueio de imitação', () => {
  assert.equal(parseModo('acompanhar'), 'acompanhar');
  assert.equal(parseModo('foo'), '');
  assert.equal(parseTrackType('guitarra'), 'Guitar');
  assert.equal(blockedArtistRequest('imite a voz do cantor'), true);
  assert.equal(blockedArtistRequest('forró com sanfona e zabumba'), false);
});

test('interface visível não cita o provedor e separa Maestro de Arranjo', () => {
  const leak = /Gemini|Lyria|Mureka|OpenAI|SynthID|\bGoogle\b/;
  for (const file of userFiles) {
    const txt = readFileSync(join(root, file), 'utf8');
    const hit = leak.exec(txt);
    assert.equal(hit, null, `${file} ainda mostra ${hit && hit[0]}`);
  }
  const painel = readFileSync(join(root, 'painel.html'), 'utf8');
  assert.match(painel, /href="\.\/musica-ia\.html"/);
  assert.match(painel, /href="\.\/arranjo\.html"/);
  assert.match(painel, /<strong>APS Maestro<\/strong>/);
  assert.match(painel, /<strong>APS Arranjo<\/strong>/);
  const maestro = readFileSync(join(root, 'musica-ia.html'), 'utf8');
  assert.match(maestro, /<h1>APS Maestro<\/h1>/);
  assert.match(maestro, /href="\.\/arranjo\.html"/);
  const arranjo = readFileSync(join(root, 'arranjo.html'), 'utf8');
  assert.match(arranjo, /<h1>APS Arranjo<\/h1>/);
  assert.match(arranjo, /href="\.\/musica-ia\.html"/);
  assert.match(arranjo, /não substitui/i);
  const dawJs = readFileSync(join(root, 'aps-arranjo-daw.js'), 'utf8');
  assert.match(dawJs, /APS Arranjo/);
  assert.match(dawJs, /A gravação original não é editada/);
  const cmd = readFileSync(join(root, 'aps-ia-comandos.js'), 'utf8');
  assert.match(cmd, /APS Maestro · comando de mixagem/);
  assert.match(NOTICE, /não a sua gravação original/);
});

test('pedido grande demais é recusado', async () => {
  const res = await call('/gerar', { method: 'POST', body: 'x'.repeat(40 * 1024), headers: { 'Content-Length': String(40 * 1024) } });
  assert.equal(res.status, 413);
});
