import {
  MAX_BODY,
  MAX_AUDIO,
  MAX_DURATION_SEC,
  MAX_PROMPT,
  MAX_LYRICS,
  DAILY_GLOBAL,
  PER_IP_HOUR,
  API_BASE,
  DEFAULT_MODEL,
  NOTICE,
  corsOrigin,
  corsHeaders,
  json,
  clientIp,
  hashIp,
  recifeStamp,
  limitGet,
  limitAdd,
  cleanText,
  blockedArtistRequest,
  normalizeMime,
  wavDurationSeconds,
  parsePurpose,
  parseFidelidade,
  parseDireitos,
  composeFidelityPrompt,
  parseModo,
  parseTrackType,
  filenameForMime,
  mapUpstreamError,
  allowedAudioUrl,
  openAudioToken,
  publicTask
} from './lib.js';

export default {
  async fetch(request, env) {
    const origin = corsOrigin(request);
    if (request.method === 'OPTIONS') {
      if (origin === null) return new Response(null, { status: 403 });
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    if ((path === '/' || path === '/saude') && request.method === 'GET') {
      return json({ ok: true, service: 'aps-arranjo', notice: NOTICE, dailyCap: DAILY_GLOBAL }, 200, origin || '');
    }

    if (path === '/audio' && request.method === 'GET') {
      if (origin === null) return new Response('Origem não permitida', { status: 403 });
      return proxyAudio(url.searchParams.get('t') || url.searchParams.get('u') || '', env, origin || '');
    }

    if (path === '/enviar') {
      if (request.method !== 'POST') return json({ ok: false, error: 'Use POST.' }, 405, origin || '');
      if (origin === null) return json({ ok: false, error: 'Origem não permitida.' }, 403, '');
      return enviar(request, env, origin || '');
    }

    if (path === '/gerar') {
      if (request.method !== 'POST') return json({ ok: false, error: 'Use POST.' }, 405, origin || '');
      if (origin === null) return json({ ok: false, error: 'Origem não permitida.' }, 403, '');
      return gerar(request, env, origin || '', url);
    }

    if (path.startsWith('/tarefa/') && request.method === 'GET') {
      if (origin === null) return json({ ok: false, error: 'Origem não permitida.' }, 403, '');
      const id = path.slice('/tarefa/'.length);
      const tipo = url.searchParams.get('tipo') || 'musica';
      return tarefa(request, env, origin || '', id, tipo, url);
    }

    return json({ ok: false, error: 'Caminho não encontrado.' }, 404, origin || '');
  }
};

function authHeaders(env) {
  return { Authorization: `Bearer ${env.MUREKA_API_KEY}`, Accept: 'application/json' };
}

function requireKey(env, origin) {
  if (env?.MUREKA_API_KEY) return null;
  return json({ ok: false, error: 'O serviço de arranjo ainda não está configurado.' }, 503, origin);
}

async function upstream(env, method, path, { jsonBody, form } = {}) {
  const headers = authHeaders(env);
  let body;
  if (jsonBody !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(jsonBody);
  } else if (form) {
    body = form;
  }
  const res = await fetch(API_BASE + path, { method, headers, body });
  let data = {};
  try {
    data = await res.json();
  } catch { /* ignore */ }
  if (!res.ok) {
    const mapped = mapUpstreamError(res.status, data);
    const err = new Error(mapped.error);
    err.http = mapped.status;
    err.mapped = true;
    throw err;
  }
  return data;
}

async function enforceLimits(request, env, origin) {
  const stamp = recifeStamp();
  const ipHash = await hashIp(clientIp(request));
  const dayKey = `arr:${stamp.day}`;
  const ipKey = `arrip:${ipHash}:${stamp.hour}`;
  const usedDay = await limitGet(env, dayKey);
  const usedIp = await limitGet(env, ipKey);
  if (usedDay >= DAILY_GLOBAL) {
    return { error: json({ ok: false, error: `Limite diário de ${DAILY_GLOBAL} arranjos atingido. Tente amanhã.` }, 429, origin) };
  }
  if (usedIp >= PER_IP_HOUR) {
    return { error: json({ ok: false, error: 'Muitos arranjos neste período. Espere um pouco e tente de novo.' }, 429, origin) };
  }
  await limitAdd(env, dayKey, 1, 60 * 60 * 48);
  await limitAdd(env, ipKey, 1, 60 * 60 * 3);
  return {
    async rollback() {
      await limitAdd(env, dayKey, -1, 60 * 60 * 48);
      await limitAdd(env, ipKey, -1, 60 * 60 * 3);
    }
  };
}

async function enviar(request, env, origin) {
  const missing = requireKey(env, origin);
  if (missing) return missing;

  const rawLen = Number(request.headers.get('Content-Length') || 0);
  if (rawLen > MAX_AUDIO + 64 * 1024) {
    return json({ ok: false, error: 'O arquivo é grande demais. Envie um áudio de até 10 MB.' }, 413, origin);
  }

  let parsed;
  try {
    parsed = await readUpload(request);
  } catch (err) {
    return json({ ok: false, error: err.message || 'Não foi possível ler o áudio.' }, err.http || 400, origin);
  }

  try {
    const form = new FormData();
    form.append('purpose', parsed.purpose);
    form.append('file', new Blob([parsed.bytes], { type: parsed.mime }), parsed.filename);
    const file = await upstream(env, 'POST', '/v1/files/upload', { form });
    return json({
      ok: true,
      arquivoId: String(file.id || ''),
      finalidade: parsed.purpose,
      bytes: file.bytes || parsed.bytes.length,
      notice: NOTICE
    }, 200, origin);
  } catch (err) {
    if (err?.mapped) return json({ ok: false, error: err.message }, err.http || 502, origin);
    return json({ ok: false, error: 'Não foi possível enviar o áudio agora. Tente novamente.' }, 502, origin);
  }
}

async function readUpload(request) {
  const ctype = request.headers.get('Content-Type') || '';
  if (!ctype.toLowerCase().includes('multipart/form-data')) {
    const err = new Error('Envie o áudio em um formulário com o arquivo.');
    err.http = 400;
    throw err;
  }
  const form = await request.formData();
  const file = form.get('file') || form.get('audio') || form.get('arquivo');
  if (!file || typeof file === 'string' || !file.arrayBuffer) {
    const err = new Error('Envie um arquivo de áudio.');
    err.http = 400;
    throw err;
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!bytes.length) {
    const err = new Error('O arquivo de áudio veio vazio.');
    err.http = 400;
    throw err;
  }
  if (bytes.length > MAX_AUDIO) {
    const err = new Error('O arquivo é grande demais. Envie um áudio de até 10 MB.');
    err.http = 413;
    throw err;
  }
  const mime = normalizeMime(file.type, file.name);
  if (!mime) {
    const err = new Error('Use um áudio em MP3, M4A ou WAV.');
    err.http = 400;
    throw err;
  }
  const duration = wavDurationSeconds(bytes);
  if (duration && duration > MAX_DURATION_SEC) {
    const err = new Error('O áudio pode ter no máximo 8 minutos.');
    err.http = 400;
    throw err;
  }
  return {
    bytes,
    mime,
    filename: filenameForMime(mime, file.name),
    purpose: parsePurpose(form.get('finalidade') || form.get('purpose') || 'audio')
  };
}

async function gerar(request, env, origin, url) {
  const missing = requireKey(env, origin);
  if (missing) return missing;

  const rawLen = Number(request.headers.get('Content-Length') || 0);
  if (rawLen > MAX_BODY) return json({ ok: false, error: 'Pedido grande demais.' }, 413, origin);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'Envie um JSON válido.' }, 400, origin);
  }

  const modo = parseModo(body.modo);
  if (!modo) {
    return json({ ok: false, error: 'Escolha se quer uma música nova, um acompanhamento, um instrumento ou estender o áudio.' }, 400, origin);
  }

  const pedido = cleanText(body.pedido || body.prompt || '', MAX_PROMPT);
  const letra = String(body.letra || body.lyrics || '').replace(/\r\n/g, '\n').trim().slice(0, MAX_LYRICS);
  const estilo = cleanText(body.estilo || '', 80);
  const arquivoId = cleanText(body.arquivoId || body.arquivo_id || '', 80);
  const finalidade = parsePurpose(body.finalidade || body.purpose || '', 'audio');
  const tipoPista = parseTrackType(body.tipoPista || body.tipo_pista || '');
  const hasFid = body.fidelidade != null && String(body.fidelidade).trim() !== '';
  const hasRights = body.direitos != null && String(body.direitos).trim() !== '';
  const fidelidade = hasFid ? parseFidelidade(body.fidelidade) : null;
  if (hasFid && !fidelidade) {
    return json({ ok: false, error: 'Nível de fidelidade inválido. Use bem livre, no meio ou parecido com o original.' }, 400, origin);
  }
  const direitos = parseDireitos(body.direitos);
  if (arquivoId && (hasFid || hasRights) && !direitos) {
    return json({ ok: false, error: 'Para usar uma gravação, confirme que ela é sua ou que você tem o direito de usá-la.' }, 400, origin);
  }
  if (blockedArtistRequest(`${pedido} ${estilo} ${letra}`)) {
    return json({ ok: false, error: 'Não geramos imitações da voz ou do estilo de artistas reais. Descreva o ritmo, os instrumentos e o clima, sem citar cantores.' }, 400, origin);
  }

  let built;
  try {
    built = buildUpstream(modo, { pedido, letra, estilo, arquivoId, finalidade, tipoPista, extendEm: body.extendEm ?? body.extend_em, direcao: body.direcao, fidelidade });
  } catch (err) {
    return json({ ok: false, error: err.message }, 400, origin);
  }

  const limit = await enforceLimits(request, env, origin);
  if (limit.error) return limit.error;
  try {
    const task = await upstream(env, 'POST', built.path, { jsonBody: built.payload });
    return json({
      ok: true,
      id: String(task.id || ''),
      tipo: built.kind,
      status: 'preparando',
      notice: NOTICE
    }, 200, origin);
  } catch (err) {
    await limit.rollback();
    if (err?.mapped) return json({ ok: false, error: err.message }, err.http || 502, origin);
    return json({ ok: false, error: 'Não foi possível criar o arranjo agora. Tente novamente.' }, 502, origin);
  }
}

function defaultPrompt(pedido, estilo) {
  const parts = [pedido, estilo, 'natural accompaniment matching the style and tempo of the uploaded audio'].filter(Boolean);
  return cleanText(parts.join(', '), MAX_PROMPT) || 'natural musical accompaniment';
}

function buildUpstream(modo, { pedido, letra, estilo, arquivoId, finalidade, tipoPista, extendEm, direcao, fidelidade }) {
  const hasFid = fidelidade != null && String(fidelidade).trim() !== '';
  let level = null;
  if (hasFid) {
    level = parseFidelidade(fidelidade);
    if (!level) throw new Error('Nível de fidelidade inválido. Use bem livre, no meio ou parecido com o original.');
  }

  if (modo === 'nova') {
    if (letra) {
      const payload = { lyrics: letra, model: DEFAULT_MODEL, n: 1 };
      if (level) {
        applySongAudioControl(payload, { arquivoId, finalidade, level, pedido, estilo });
      } else if (arquivoId) {
        payload.reference_id = arquivoId;
      } else {
        payload.prompt = defaultPrompt(pedido, estilo);
      }
      return { path: '/v1/song/generate', payload, kind: 'musica' };
    }
    if (arquivoId && finalidade !== 'instrumental') {
      // Sem fidelidade: caminho legado (easy-generate). Com fidelidade, fica no
      // instrumental econômico e aplica referência / prompt conforme o nível.
      if (level) {
        const payload = { model: DEFAULT_MODEL, n: 1 };
        applyInstrumentalControl(payload, { arquivoId, finalidade, level, pedido, estilo });
        return { path: '/v1/instrumental/generate', payload, kind: 'instrumental' };
      }
      const payload = { model: DEFAULT_MODEL, n: 1, reference_id: arquivoId };
      if (pedido || estilo) payload.prompt = defaultPrompt(pedido, estilo);
      return { path: '/v1/song/easy-generate', payload, kind: 'musica' };
    }
    const payload = { model: DEFAULT_MODEL, n: 1 };
    if (level) {
      applyInstrumentalControl(payload, { arquivoId, finalidade, level, pedido, estilo });
    } else if (arquivoId) {
      payload.instrumental_id = arquivoId;
    } else {
      payload.prompt = defaultPrompt(pedido, estilo);
    }
    if (!payload.instrumental_id && !payload.prompt) {
      throw new Error('Envie um áudio ou descreva o que você quer ouvir.');
    }
    return { path: '/v1/instrumental/generate', payload, kind: 'instrumental' };
  }

  if (modo === 'acompanhar' || modo === 'instrumento') {
    if (!arquivoId) throw new Error('Envie um áudio para o arranjo partir da sua gravação.');
    const generateType = modo === 'instrumento'
      ? (tipoPista || 'Guitar')
      : (letra ? 'Vocals' : 'Instrumental');
    const payload = {
      generate_type: generateType,
      upload_audio_id: arquivoId,
      prompt: level ? composeFidelityPrompt(pedido, estilo, level) : defaultPrompt(pedido, estilo)
    };
    if (letra && generateType === 'Vocals') payload.lyrics = letra;
    return { path: '/v1/track/generate', payload, kind: 'musica' };
  }

  if (modo === 'estender') {
    if (!arquivoId) throw new Error('Envie um áudio para estender.');
    if (!letra) throw new Error('Para estender, escreva a letra que deve continuar a música.');
    const seconds = Number(extendEm);
    const extendAt = Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds * 1000) : 30000;
    if (extendAt < 8000) throw new Error('Para estender, use um ponto a partir de 8 segundos.');
    const payload = {
      upload_audio_id: arquivoId,
      lyrics: letra,
      extend_at: extendAt,
      model: DEFAULT_MODEL
    };
    if (level) payload.prompt = composeFidelityPrompt(pedido, estilo, level);
    if (String(direcao || '').toLowerCase() === 'inicio') {
      payload.model = 'mureka-8';
      payload.extend_type = 'head';
    }
    return { path: '/v1/song/extend', payload, kind: 'musica' };
  }

  throw new Error('Escolha um tipo de arranjo.');
}

/** Alta: melody_id (purpose=melody) ou reference_id. Média: reference_id. Baixa: só o prompt.
 *  prompt e reference_id/melody_id são mutuamente exclusivos no provedor. */
function applySongAudioControl(payload, { arquivoId, finalidade, level, pedido, estilo }) {
  if (!arquivoId || level === 'baixa') {
    payload.prompt = composeFidelityPrompt(pedido, estilo, level || 'baixa');
    delete payload.reference_id;
    delete payload.melody_id;
    return;
  }
  if (level === 'alta' && finalidade === 'melody') {
    delete payload.prompt;
    payload.melody_id = arquivoId;
    delete payload.reference_id;
    return;
  }
  if (finalidade === 'reference') {
    delete payload.prompt;
    payload.reference_id = arquivoId;
    delete payload.melody_id;
    return;
  }
  // Áudio curto ou finalidade genérica: só o prompt, para não pedir referência de um arquivo incompatível.
  payload.prompt = composeFidelityPrompt(pedido, estilo, level);
  delete payload.reference_id;
  delete payload.melody_id;
}

function applyInstrumentalControl(payload, { arquivoId, finalidade, level, pedido, estilo }) {
  if (!arquivoId || level === 'baixa' || finalidade !== 'instrumental') {
    payload.prompt = composeFidelityPrompt(pedido, estilo, level || 'baixa');
    delete payload.instrumental_id;
    return;
  }
  payload.instrumental_id = arquivoId;
  delete payload.prompt;
}

async function tarefa(request, env, origin, id, tipo, url) {
  const missing = requireKey(env, origin);
  if (missing) return missing;
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(id)) {
    return json({ ok: false, error: 'Pedido não encontrado.' }, 404, origin);
  }
  const kind = tipo === 'instrumental' ? 'instrumental' : 'musica';
  const path = kind === 'instrumental' ? `/v1/instrumental/query/${id}` : `/v1/song/query/${id}`;
  try {
    const task = await upstream(env, 'GET', path);
    task.id = task.id || id;
    return json(await publicTask(task, kind, url, env.MUREKA_API_KEY), 200, origin);
  } catch (err) {
    if (err?.mapped) return json({ ok: false, error: err.message }, err.http || 502, origin);
    return json({ ok: false, error: 'Não foi possível consultar o arranjo agora.' }, 502, origin);
  }
}

async function proxyAudio(raw, env, origin) {
  const safe = (await openAudioToken(raw, env?.MUREKA_API_KEY)) || allowedAudioUrl(raw);
  if (!safe) return new Response('Não encontrado', { status: 404, headers: corsHeaders(origin) });
  const res = await fetch(safe.toString());
  if (!res.ok) return new Response('Não encontrado', { status: 404, headers: corsHeaders(origin) });
  const headers = corsHeaders(origin);
  headers['Content-Type'] = res.headers.get('Content-Type') || 'audio/mpeg';
  headers['Cache-Control'] = 'private, max-age=3600';
  return new Response(res.body, { status: 200, headers });
}

export { buildUpstream, enforceLimits, applySongAudioControl, applyInstrumentalControl };
