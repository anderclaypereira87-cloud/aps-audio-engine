import {
  MAX_AUDIO,
  MAX_DURATION_SEC,
  MAX_BODY,
  REF_DAILY,
  REF_PER_IP_HOUR,
  DAILY_GLOBAL,
  PER_IP_HOUR,
  ANALYZE_MODEL,
  NOTICE,
  REF_NOTICE,
  corsOrigin,
  corsHeaders,
  json,
  clientIp,
  hashIp,
  recifeStamp,
  kvGetNum,
  kvAdd,
  cleanText,
  blockedArtistRequest,
  normalizeMime,
  uint8ToBase64,
  wavDurationSeconds,
  sanitizeDesc,
  parseFidelidade,
  parseDireitos,
  composeReferenceUserPrompt,
  buildPrompt,
  pickModel,
  extractAudio,
  extractJsonText,
  mapGeminiError,
  validId,
  parseModo,
  parseEstilo,
  readGenerationFields,
  referenceReady,
  ANALYZE_PROMPT
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
      return json({ ok: true, service: 'aps-lyria', notice: NOTICE, dailyCap: DAILY_GLOBAL, referenciaCap: REF_DAILY }, 200, origin || '');
    }

    if (path.startsWith('/audio/') && request.method === 'GET') {
      if (origin === null) return new Response('Origem não permitida', { status: 403 });
      const id = path.slice('/audio/'.length);
      if (!validId(id) || !env.AUDIO) return new Response('Não encontrado', { status: 404, headers: corsHeaders(origin || '') });
      const obj = await env.AUDIO.get(id);
      if (!obj) return new Response('Não encontrado', { status: 404, headers: corsHeaders(origin || '') });
      const headers = corsHeaders(origin || '');
      headers['Content-Type'] = obj.httpMetadata?.contentType || 'audio/mpeg';
      headers['Cache-Control'] = 'public, max-age=3600';
      return new Response(obj.body, { status: 200, headers });
    }

    if (path === '/gerar') {
      if (request.method !== 'POST') return json({ ok: false, error: 'Use POST.' }, 405, origin || '');
      if (origin === null) return json({ ok: false, error: 'Origem não permitida.' }, 403, '');
      return gerar(request, env, origin || '');
    }

    if (path === '/referencia') {
      if (request.method !== 'POST') return json({ ok: false, error: 'Use POST.' }, 405, origin || '');
      if (origin === null) return json({ ok: false, error: 'Origem não permitida.' }, 403, '');
      return referencia(request, env, origin || '');
    }

    return json({ ok: false, error: 'Caminho não encontrado.' }, 404, origin || '');
  }
};

async function gerar(request, env, origin) {
  const rawLen = Number(request.headers.get('Content-Length') || 0);
  if (rawLen > MAX_BODY) return json({ ok: false, error: 'Pedido grande demais.' }, 413, origin);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'Envie um JSON válido.' }, 400, origin);
  }

  const extras = readGenerationFields(body);
  if (extras.error) return json({ ok: false, error: extras.error }, 400, origin);
  const hasFidelityField = body.fidelidade != null && String(body.fidelidade).trim() !== '';
  const hasRightsField = body.direitos != null && String(body.direitos).trim() !== '';
  const fidelidade = hasFidelityField ? parseFidelidade(body.fidelidade) : null;
  if (hasFidelityField && !fidelidade) {
    return json({ ok: false, error: 'Nível de fidelidade inválido. Use bem livre, no meio ou parecido com o original.' }, 400, origin);
  }
  const direitos = parseDireitos(body.direitos);
  const newClient = hasFidelityField || hasRightsField;

  let prompt = extras.prompt;
  let fromRef = false;
  if (body.referencia) {
    if (newClient && !direitos) {
      return json({ ok: false, error: 'Para usar uma gravação de referência, confirme que ela é sua ou que você tem o direito de usá-la.' }, 400, origin);
    }
    const desc = sanitizeDesc(body.referencia);
    const ready = referenceReady(desc);
    if (ready) return json({ ok: false, error: ready }, 400, origin);
    prompt = composeReferenceUserPrompt(desc, extras.prompt, fidelidade);
    fromRef = true;
  }
  if (!prompt || prompt.length < 8) {
    return json({ ok: false, error: 'Escreva um pedido de música com pelo menos algumas palavras.' }, 400, origin);
  }
  if (blockedArtistRequest(`${prompt} ${extras.estilo} ${extras.letra}`)) {
    return json({ ok: false, error: 'Não geramos imitações da voz ou do estilo de artistas reais. Descreva o ritmo, os instrumentos e o clima, sem citar cantores.' }, 400, origin);
  }

  return generateLyria(request, env, origin, {
    prompt,
    estilo: extras.estilo,
    letra: extras.letra,
    modo: extras.modo,
    fromRef
  });
}



async function referencia(request, env, origin) {
  if (!env.GEMINI_API_KEY) {
    return json({ ok: false, error: 'O servidor de música ainda não está configurado.' }, 503, origin);
  }

  const rawLen = Number(request.headers.get('Content-Length') || 0);
  if (rawLen > MAX_AUDIO + 64 * 1024) return json({ ok: false, error: 'O arquivo é grande demais. Envie um áudio de até 10 MB e 2 minutos.' }, 413, origin);

  let parsed;
  try {
    parsed = await readReferenciaBody(request);
  } catch (err) {
    return json({ ok: false, error: err.message || 'Não foi possível ler o áudio.' }, err.http || 400, origin);
  }

  if (blockedArtistRequest(`${parsed.prompt} ${parsed.estilo} ${parsed.letra}`)) {
    return json({ ok: false, error: 'Não geramos imitações da voz ou do estilo de artistas reais. Descreva o ritmo, os instrumentos e o clima, sem citar cantores.' }, 400, origin);
  }
  if (parsed.newClient && !parsed.direitos) {
    return json({ ok: false, error: 'Para usar uma gravação de referência, confirme que ela é sua ou que você tem o direito de usá-la.' }, 400, origin);
  }

  const stamp = recifeStamp();
  const ipHash = await hashIp(clientIp(request));
  const refDayKey = `ref:${stamp.day}`;
  const refIpKey = `refip:${ipHash}:${stamp.hour}`;
  const usedRefDay = await kvGetNum(env, refDayKey);
  const usedRefIp = await kvGetNum(env, refIpKey);
  if (usedRefDay >= REF_DAILY) {
    return json({ ok: false, error: `Limite diário de ${REF_DAILY} análises de gravação atingido. Tente amanhã.` }, 429, origin);
  }
  if (usedRefIp >= REF_PER_IP_HOUR) {
    return json({ ok: false, error: 'Muitas análises neste período. Espere um pouco e tente de novo.' }, 429, origin);
  }

  await kvAdd(env, refDayKey, 1, 60 * 60 * 48);
  await kvAdd(env, refIpKey, 1, 60 * 60 * 3);
  let reservedRef = true;
  try {
    const desc = await analyzeAudio(env, parsed.bytes, parsed.mime);
    reservedRef = false;
    const ready = referenceReady(desc);
    if (ready) return json({ ok: false, error: ready, descricao: desc }, 400, origin);

    const payload = {
      ok: true,
      descricao: desc,
      notice: REF_NOTICE,
      aviso: 'Isto é só uma descrição de estilo para criar uma música nova com IA. Não é uma edição da sua gravação.'
    };
    if (!parsed.gerar) return json(payload, 200, origin);

    const prompt = composeReferenceUserPrompt(desc, parsed.prompt, parsed.fidelidade);
    const generated = await generateLyria(request, env, origin, {
      prompt,
      estilo: parsed.estilo,
      letra: parsed.letra,
      modo: parsed.modo,
      fromRef: true
    });
    const data = await generated.json();
    return json({ ...data, descricao: desc, notice: data.notice || REF_NOTICE }, generated.status, origin);
  } catch (err) {
    if (reservedRef) {
      await kvAdd(env, refDayKey, -1, 60 * 60 * 48);
      await kvAdd(env, refIpKey, -1, 60 * 60 * 3);
    }
    if (err?.mapped) return json({ ok: false, error: err.message }, err.http || 502, origin);
    return json({ ok: false, error: err.message || 'Não foi possível analisar a gravação agora. Tente novamente.' }, err.http || 502, origin);
  }
}

async function readReferenciaBody(request) {
  const ctype = request.headers.get('Content-Type') || '';
  let bytes;
  let mime = '';
  let name = '';
  let prompt = '';
  let estilo = '';
  let letra = '';
  let modo = 'clip';
  let gerar = false;
  let duration = NaN;
  let fidelidade = null;
  let direitos = false;
  let newClient = false;

  if (ctype.includes('multipart/form-data')) {
    const form = await request.formData();
    const file = form.get('audio');
    if (!file || typeof file === 'string' || typeof file.arrayBuffer !== 'function') {
      throw Object.assign(new Error('Envie um arquivo de áudio no campo audio.'), { http: 400 });
    }
    bytes = new Uint8Array(await file.arrayBuffer());
    name = file.name || '';
    mime = normalizeMime(file.type, name);
    const fields = readGenerationFields({
      prompt: form.get('prompt'),
      estilo: form.get('estilo'),
      letra: form.get('letra'),
      modo: form.get('modo')
    });
    if (fields.error) throw Object.assign(new Error(fields.error), { http: 400 });
    prompt = fields.prompt;
    estilo = fields.estilo;
    letra = fields.letra;
    modo = fields.modo;
    const fidRaw = form.get('fidelidade');
    const dirRaw = form.get('direitos');
    const hasFid = fidRaw != null && String(fidRaw).trim() !== '';
    const hasDir = dirRaw != null && String(dirRaw).trim() !== '';
    newClient = hasFid || hasDir;
    if (hasFid) {
      fidelidade = parseFidelidade(fidRaw);
      if (!fidelidade) {
        throw Object.assign(new Error('Nível de fidelidade inválido. Use bem livre, no meio ou parecido com o original.'), { http: 400 });
      }
    }
    direitos = parseDireitos(dirRaw);
    const flag = String(form.get('gerar') || '').toLowerCase();
    gerar = flag === '1' || flag === 'true';
    duration = Number(form.get('duracao'));
  } else {
    let body;
    try {
      body = await request.json();
    } catch {
      throw Object.assign(new Error('Envie o áudio em multipart ou um JSON com audioBase64.'), { http: 400 });
    }
    const b64 = String(body.audioBase64 || '').replace(/\s+/g, '');
    if (!b64) throw Object.assign(new Error('Envie um arquivo de áudio no campo audio.'), { http: 400 });
    try {
      const bin = atob(b64);
      bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    } catch {
      throw Object.assign(new Error('O áudio enviado não pôde ser lido.'), { http: 400 });
    }
    name = cleanText(body.nome || body.name, 80);
    mime = normalizeMime(body.mime, name);
    const fields = readGenerationFields(body);
    if (fields.error) throw Object.assign(new Error(fields.error), { http: 400 });
    prompt = fields.prompt;
    estilo = fields.estilo;
    letra = fields.letra;
    modo = fields.modo;
    const hasFid = body.fidelidade != null && String(body.fidelidade).trim() !== '';
    const hasDir = body.direitos != null && String(body.direitos).trim() !== '';
    newClient = hasFid || hasDir;
    if (hasFid) {
      fidelidade = parseFidelidade(body.fidelidade);
      if (!fidelidade) {
        throw Object.assign(new Error('Nível de fidelidade inválido. Use bem livre, no meio ou parecido com o original.'), { http: 400 });
      }
    }
    direitos = parseDireitos(body.direitos);
    gerar = body.gerar === true || body.gerar === 1 || body.gerar === '1';
    duration = Number(body.duracao);
  }

  if (!bytes?.byteLength) throw Object.assign(new Error('O arquivo de áudio veio vazio.'), { http: 400 });
  if (bytes.byteLength > MAX_AUDIO) {
    throw Object.assign(new Error('O arquivo é grande demais. Envie um áudio de até 10 MB e 2 minutos.'), { http: 413 });
  }
  if (!mime) {
    throw Object.assign(new Error('Formato não aceito. Envie MP3, WAV, M4A, OGG ou FLAC.'), { http: 400 });
  }

  const wavDur = wavDurationSeconds(bytes);
  if (Number.isFinite(wavDur)) duration = wavDur;
  if (!Number.isFinite(duration) || duration <= 0) {
    throw Object.assign(new Error('Não foi possível conferir a duração. Envie um arquivo de 1 segundo até 2 minutos.'), { http: 400 });
  }
  if (duration < 1) {
    throw Object.assign(new Error('O áudio é curto demais. Envie uma gravação de pelo menos 1 segundo.'), { http: 400 });
  }
  if (duration > MAX_DURATION_SEC) {
    throw Object.assign(new Error('A gravação pode ter no máximo 2 minutos.'), { http: 400 });
  }

  return { bytes, mime, name, prompt, estilo, letra, modo, gerar, duration, fidelidade, direitos, newClient };
}

async function analyzeAudio(env, bytes, mime) {
  const upstream = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${ANALYZE_MODEL}:generateContent`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': env.GEMINI_API_KEY
      },
      body: JSON.stringify({
        contents: [{
          parts: [
            { inline_data: { mime_type: mime, data: uint8ToBase64(bytes) } },
            { text: ANALYZE_PROMPT }
          ]
        }],
        generationConfig: { responseMimeType: 'application/json', temperature: 0.2 }
      })
    }
  );
  const payload = await upstream.json().catch(() => ({}));
  if (!upstream.ok) {
    const gMsg = String(payload?.error?.message || payload?.error?.status || '');
    console.error(JSON.stringify({ googleStatus: upstream.status, googleMsg: gMsg.slice(0, 240), step: 'analise' }));
    const mapped = mapGeminiError(upstream.status, payload.error || payload);
    throw Object.assign(new Error(mapped.error), { http: mapped.status, mapped: true });
  }
  if (payload.promptFeedback?.blockReason) {
    throw Object.assign(new Error('O filtro de segurança do Google bloqueou esta gravação. Tente outro áudio, sem imitar artistas reais.'), { http: 400, mapped: true });
  }
  let parsed;
  try {
    parsed = JSON.parse(extractJsonText(payload));
  } catch {
    throw Object.assign(new Error('A análise da gravação não veio em um formato utilizável. Tente de novo.'), { http: 502, mapped: true });
  }
  return sanitizeDesc(parsed);
}

async function generateLyria(request, env, origin, { prompt, estilo, letra, modo, fromRef }) {
  if (!env.GEMINI_API_KEY) {
    return json({ ok: false, error: 'O servidor de música ainda não está configurado.' }, 503, origin);
  }

  const stamp = recifeStamp();
  const ipHash = await hashIp(clientIp(request));
  const dayKey = `global:${stamp.day}`;
  const ipKey = `ip:${ipHash}:${stamp.hour}`;
  const usedDay = await kvGetNum(env, dayKey);
  const usedIp = await kvGetNum(env, ipKey);
  if (usedDay >= DAILY_GLOBAL) {
    return json({ ok: false, error: `Limite diário de ${DAILY_GLOBAL} músicas atingido. Tente amanhã.` }, 429, origin);
  }
  if (usedIp >= PER_IP_HOUR) {
    return json({ ok: false, error: 'Muitas gerações neste período. Espere um pouco e tente de novo.' }, 429, origin);
  }

  await kvAdd(env, dayKey, 1, 60 * 60 * 48);
  await kvAdd(env, ipKey, 1, 60 * 60 * 3);

  const model = pickModel(modo);
  const text = buildPrompt(prompt, estilo, letra, modo);
  let reserved = true;
  try {
    const upstream = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': env.GEMINI_API_KEY
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text }] }],
          generationConfig: { responseModalities: ['AUDIO', 'TEXT'] }
        })
      }
    );

    const payload = await upstream.json().catch(() => ({}));
    if (!upstream.ok) {
      const gMsg = String(payload?.error?.message || payload?.error?.status || '');
      console.error(JSON.stringify({ googleStatus: upstream.status, googleMsg: gMsg.slice(0, 240), step: 'gerar' }));
      const mapped = mapGeminiError(upstream.status, payload.error || payload);
      throw Object.assign(new Error(mapped.error), { http: mapped.status, mapped: true, refund: true });
    }
    if (payload.promptFeedback?.blockReason) {
      throw Object.assign(new Error('O filtro de segurança do Google bloqueou este pedido. Evite imitar artistas reais ou letras protegidas.'), { http: 400, mapped: true, refund: true });
    }

    const { lyrics, mime, b64 } = extractAudio(payload);
    if (!b64) {
      throw Object.assign(new Error('O Google não devolveu áudio neste pedido. Tente outro texto.'), { http: 502, mapped: true, refund: true });
    }

    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    if (bytes.byteLength < 1000 || bytes.byteLength > 15 * 1024 * 1024) {
      throw Object.assign(new Error('O áudio gerado veio em um tamanho inesperado.'), { http: 502, mapped: true, refund: true });
    }

    const id = crypto.randomUUID();
    let url = '';
    if (env.AUDIO) {
      await env.AUDIO.put(id, bytes, { httpMetadata: { contentType: mime || 'audio/mpeg' } });
      url = new URL(`/audio/${id}`, request.url).toString();
    }

    reserved = false;
    return json({
      ok: true,
      id,
      url: url || null,
      mime: mime || 'audio/mpeg',
      size: bytes.byteLength,
      mode: modo,
      model,
      lyrics,
      fromRef: !!fromRef,
      notice: fromRef ? REF_NOTICE : NOTICE,
      audioBase64: url ? undefined : b64
    }, 200, origin);
  } catch (err) {
    if (reserved) {
      await kvAdd(env, dayKey, -1, 60 * 60 * 48);
      await kvAdd(env, ipKey, -1, 60 * 60 * 3);
    }
    if (err?.mapped) return json({ ok: false, error: err.message }, err.http || 502, origin);
    return json({ ok: false, error: 'Não foi possível gerar a música agora. Tente novamente.' }, 502, origin);
  }
}
