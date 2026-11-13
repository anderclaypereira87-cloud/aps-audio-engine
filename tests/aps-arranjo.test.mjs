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
  blockedArtistRequest,
  parseFidelidade,
  parseDireitos,
  composeFidelityPrompt
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

test('fidelidade alta com letra usa a melodia e não mistura com o prompt', () => {
  const alta = buildUpstream('nova', {
    pedido: 'mais sanfona', letra: '[Verse]\nOi', estilo: '', arquivoId: 'm1',
    finalidade: 'melody', fidelidade: 'alta'
  });
  assert.equal(alta.path, '/v1/song/generate');
  assert.equal(alta.payload.melody_id, 'm1');
  assert.equal('prompt' in alta.payload, false);
  assert.equal('reference_id' in alta.payload, false);
  assert.equal(alta.payload.n, 1);
  assert.equal(alta.payload.model, 'mureka-7.6');

  const media = buildUpstream('nova', {
    pedido: 'varia o arranjo', letra: '[Verse]\nOi', estilo: '', arquivoId: 'r1',
    finalidade: 'reference', fidelidade: 'media'
  });
  assert.equal(media.payload.reference_id, 'r1');
  assert.equal('prompt' in media.payload, false);
  assert.equal('melody_id' in media.payload, false);

  const baixa = buildUpstream('nova', {
    pedido: 'clima de forró', letra: '[Verse]\nOi', estilo: '', arquivoId: 'x1',
    finalidade: 'reference', fidelidade: 'baixa'
  });
  assert.equal('reference_id' in baixa.payload, false);
  assert.equal('melody_id' in baixa.payload, false);
  assert.match(baixa.payload.prompt, /inspired|invent freely|livre|inspir/i);
  assert.match(baixa.payload.prompt, /forró|forro/i);
});

test('fidelidade no instrumental: alta envia o áudio, baixa só o prompt', () => {
  const alta = buildUpstream('nova', {
    pedido: '', letra: '', estilo: '', arquivoId: 'i1',
    finalidade: 'instrumental', fidelidade: 'alta'
  });
  assert.equal(alta.path, '/v1/instrumental/generate');
  assert.equal(alta.payload.instrumental_id, 'i1');
  assert.equal('prompt' in alta.payload, false);
  assert.equal(alta.payload.n, 1);

  const baixa = buildUpstream('nova', {
    pedido: 'invente um clima novo', letra: '', estilo: '', arquivoId: 'i2',
    finalidade: 'instrumental', fidelidade: 'baixa'
  });
  assert.equal(baixa.path, '/v1/instrumental/generate');
  assert.equal('instrumental_id' in baixa.payload, false);
  assert.match(baixa.payload.prompt, /invente um clima novo/i);
  assert.equal(baixa.payload.model, 'mureka-7.6');
  assert.equal(baixa.payload.n, 1);
});

test('fidelidade no acompanhamento vai no prompt e mantém o áudio de partida', () => {
  const alta = buildUpstream('acompanhar', {
    pedido: 'bass', letra: '', estilo: '', arquivoId: '7',
    finalidade: 'audio', fidelidade: 'alta'
  });
  assert.equal(alta.path, '/v1/track/generate');
  assert.equal(alta.payload.upload_audio_id, '7');
  assert.match(alta.payload.prompt, /closely follows|tempo|key/i);
});

test('gerar com áudio exige a confirmação de direitos', async () => {
  const res = await call('/gerar', {
    method: 'POST',
    body: JSON.stringify({
      modo: 'nova', pedido: 'forró', arquivoId: 'abc', finalidade: 'instrumental',
      fidelidade: 'alta', direitos: false
    })
  });
  const data = await res.json();
  assert.equal(res.status, 400);
  assert.match(data.error, /direito/i);
  assert.doesNotMatch(JSON.stringify(data), /mureka|gemini|lyria|openai|google/i);
});

test('gerar rejeita fidelidade inválida', async () => {
  const res = await call('/gerar', {
    method: 'POST',
    body: JSON.stringify({ modo: 'nova', pedido: 'forró instrumental', fidelidade: 'xyz' })
  });
  const data = await res.json();
  assert.equal(res.status, 400);
  assert.match(data.error, /fidelidade inválido/i);
});

test('parse de fidelidade e direitos', () => {
  assert.equal(parseFidelidade('alta'), 'alta');
  assert.equal(parseFidelidade('parecido com o original'), 'alta');
  assert.equal(parseFidelidade(3), 'alta');
  assert.equal(parseFidelidade('bem livre'), 'baixa');
  assert.equal(parseFidelidade('no meio'), 'media');
  assert.equal(parseFidelidade('foo'), null);
  assert.equal(parseDireitos('1'), true);
  assert.equal(parseDireitos('0'), false);
  const p = composeFidelityPrompt('sanfona', 'forró', 'alta');
  assert.match(p, /sanfona/);
  assert.match(p, /closely follows|tempo/i);
});

test('página inicial tem o card do APS Arranjo e a interface pede direitos', () => {
  const index = readFileSync(join(root, 'index.html'), 'utf8');
  assert.match(index, /href="\.\/arranjo\.html"/);
  assert.match(index, /<strong>APS Arranjo<\/strong>/);
  // O nome antigo no card do Maestro permanece até o dono autorizar a troca.
  assert.match(index, /Criar música com IA/);
  const arranjo = readFileSync(join(root, 'arranjo.html'), 'utf8');
  assert.match(arranjo, /id="fidelidade"/);
  assert.match(arranjo, /Bem livre/);
  assert.match(arranjo, /Parecido com o original/);
  assert.match(arranjo, /id="refDireitos"/);
  assert.match(arranjo, /id="abrirSeparador"/);
  assert.match(arranjo, /Abrir no Separador/);
  assert.match(arranjo, /Abrir no Estúdio \(DAW\)/);
  assert.match(arranjo, /aps-arranjo\.js\?v=370/);
  const js = readFileSync(join(root, 'aps-arranjo.js'), 'utf8');
  assert.match(js, /aps-separator-handoff-v1/);
  assert.match(js, /separador\.html\?importAudio=1/);
  assert.match(js, /fidelidade/);
  assert.match(js, /direitos/);
  const daw = readFileSync(join(root, 'aps-arranjo-daw.js'), 'utf8');
  assert.match(daw, /apsArranjoFidelidade/);
  assert.match(daw, /apsArranjoDireitos/);
});

test('áudio curto ou finalidade genérica não força referência incompatível', () => {
  const mediaCurto = buildUpstream('nova', {
    pedido: 'forró', letra: '[Verse]\nOi', estilo: '', arquivoId: 'a1',
    finalidade: 'audio', fidelidade: 'media'
  });
  assert.equal(mediaCurto.path, '/v1/song/generate');
  assert.equal('reference_id' in mediaCurto.payload, false);
  assert.equal('melody_id' in mediaCurto.payload, false);
  assert.ok(mediaCurto.payload.prompt);

  const instCurto = buildUpstream('nova', {
    pedido: 'baixo suave', letra: '', estilo: '', arquivoId: 'a2',
    finalidade: 'audio', fidelidade: 'alta'
  });
  assert.equal(instCurto.path, '/v1/instrumental/generate');
  assert.equal('instrumental_id' in instCurto.payload, false);
  assert.ok(instCurto.payload.prompt);
  assert.match(instCurto.payload.prompt, /closely follows|tempo/i);
});
