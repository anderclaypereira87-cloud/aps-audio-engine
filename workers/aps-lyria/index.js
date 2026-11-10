/**
 * APS Lyria — gera música com Google Lyria (Gemini API).
 * A chave fica só no secret GEMINI_API_KEY. Nunca registre o valor.
 */
const MAX_BODY = 32 * 1024;
const MAX_PROMPT = 2000;
const MAX_LYRICS = 4000;
const MAX_STYLE = 80;
const DAILY_GLOBAL = 20;
const PER_IP_HOUR = 5;
const NOTICE = 'Música gerada por IA (Google Lyria), com marca d\'água SynthID';
const ALLOWED_HOSTS = new Set(['apsaudio.com.br', 'www.apsaudio.com.br']);
const STYLES = new Set([
  'forró', 'forro', 'piseiro', 'sertanejo', 'pagode', 'axé', 'axe', 'arrocha',
  'mpb', 'gospel', 'samba', 'frevo', 'xote', 'baião', 'baiao', 'rock', 'jazz',
  'instrumental', 'brega', 'bossa nova', 'coco', 'maracatu'
]);
const ARTIST_BLOCK = /\b(imite|imitando|clone|clonar|voz do|voz da|voice of|in the style of|no estilo d[oa] cantor|no estilo d[oa] cantora|como o cantor|como a cantora)\b/i;

function corsOrigin(request) {
  const origin = request.headers.get('Origin');
  if (!origin) return '';
  try {
    const u = new URL(origin);
    if (ALLOWED_HOSTS.has(u.hostname)) return origin;
    if (u.hostname === 'localhost' || u.hostname === '127.0.0.1') return origin;
  } catch { /* ignore */ }
  return null;
}

function corsHeaders(origin) {
  const h = {
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400'
  };
  if (origin) h['Access-Control-Allow-Origin'] = origin;
  return h;
}

function json(body, status, origin) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders(origin) }
  });
}

function clientIp(request) {
  return request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() || 'unknown';
}

async function hashIp(ip) {
  const data = new TextEncoder().encode(ip);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(buf)].slice(0, 8).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function recifeStamp(d = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Recife',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hour12: false
  });
  const parts = Object.fromEntries(fmt.formatToParts(d).map((p) => [p.type, p.value]));
  return { day: `${parts.year}-${parts.month}-${parts.day}`, hour: `${parts.year}-${parts.month}-${parts.day}T${parts.hour}` };
}

async function kvGetNum(env, key) {
  if (!env.LIMITS) return 0;
  const n = Number(await env.LIMITS.get(key));
  return Number.isFinite(n) ? n : 0;
}

async function kvAdd(env, key, delta, ttl) {
  if (!env.LIMITS) return 0;
  const next = (await kvGetNum(env, key)) + delta;
  await env.LIMITS.put(key, String(Math.max(0, next)), { expirationTtl: ttl });
  return next;
}

function cleanText(value, max) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function blockedArtistRequest(text) {
  return ARTIST_BLOCK.test(text);
}

function buildPrompt(prompt, estilo, letra, modo) {
  const parts = [];
  if (estilo) parts.push(`Estilo musical: ${estilo}.`);
  parts.push(prompt);
  if (letra) {
    parts.push('Use estas letras, com seções se estiverem marcadas:');
    parts.push(letra);
  } else if (/\binstrumental\b/i.test(prompt) || !letra) {
    if (!letra) parts.push('Se o pedido for instrumental, gere só instrumentos, sem vocais.');
  }
  if (modo === 'completa') {
    parts.push('Gere uma música completa, com começo, meio e fim.');
  } else {
    parts.push('Gere um clipe curto de cerca de 30 segundos.');
  }
  parts.push('Do not imitate or clone the voice, timbre or identifiable style of any real living or deceased artist, and do not reproduce copyrighted lyrics or melodies.');
  return parts.join('\n');
}

function pickModel(modo) {
  return modo === 'completa' ? 'lyria-3.5' : 'lyria-3-clip-preview';
}

function extractAudio(payload) {
  const parts = payload?.candidates?.[0]?.content?.parts || [];
  let lyrics = '';
  let mime = 'audio/mpeg';
  let b64 = '';
  for (const part of parts) {
    if (part.text) lyrics += (lyrics ? '\n' : '') + part.text;
    const inline = part.inlineData || part.inline_data;
    if (inline?.data) {
      b64 = inline.data;
      mime = inline.mimeType || inline.mime_type || mime;
    }
  }
  return { lyrics: lyrics.slice(0, 8000), mime, b64 };
}

function mapGeminiError(status, err) {
  const msg = String(err?.message || err?.status || '');
  const low = msg.toLowerCase();
  if (status === 429 || low.includes('quota') || low.includes('resource_exhausted') || low.includes('billing')) {
    return { status: 429, error: 'A cota ou o faturamento do Google recusou esta geração. Tente mais tarde.' };
  }
  if (status === 400 && (low.includes('safety') || low.includes('blocked') || low.includes('prohibited'))) {
    return { status: 400, error: 'O filtro de segurança do Google bloqueou este pedido. Evite imitar artistas reais ou letras protegidas.' };
  }
  if (status >= 500) return { status: 502, error: 'O serviço de música do Google está indisponível agora. Tente de novo em instantes.' };
  return { status: 502, error: 'Não foi possível gerar a música agora. Tente novamente.' };
}

function validId(id) {
  return typeof id === 'string' && /^[a-f0-9-]{16,64}$/i.test(id);
}

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
      return json({ ok: true, service: 'aps-lyria', notice: NOTICE, dailyCap: DAILY_GLOBAL }, 200, origin || '');
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

    return json({ ok: false, error: 'Caminho não encontrado.' }, 404, origin || '');
  }
};

async function gerar(request, env, origin) {
  if (!env.GEMINI_API_KEY) {
    return json({ ok: false, error: 'O servidor de música ainda não está configurado.' }, 503, origin);
  }

  const rawLen = Number(request.headers.get('Content-Length') || 0);
  if (rawLen > MAX_BODY) return json({ ok: false, error: 'Pedido grande demais.' }, 413, origin);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'Envie um JSON válido.' }, 400, origin);
  }

  const prompt = cleanText(body.prompt, MAX_PROMPT);
  const estiloRaw = cleanText(body.estilo, MAX_STYLE).toLowerCase();
  const estilo = !estiloRaw || estiloRaw === 'livre' ? '' : estiloRaw;
  const letra = cleanText(body.letra, MAX_LYRICS);
  const modo = body.modo === 'completa' ? 'completa' : (body.modo === 'clip' || !body.modo ? 'clip' : null);

  if (!prompt || prompt.length < 8) {
    return json({ ok: false, error: 'Escreva um pedido de música com pelo menos algumas palavras.' }, 400, origin);
  }
  if (modo === null) return json({ ok: false, error: 'Modo inválido. Use clip ou completa.' }, 400, origin);
  if (estilo && !STYLES.has(estilo)) {
    return json({ ok: false, error: 'Estilo não reconhecido. Escolha um estilo da lista ou Livre.' }, 400, origin);
  }
  if (blockedArtistRequest(`${prompt} ${estilo} ${letra}`)) {
    return json({ ok: false, error: 'Não geramos imitações da voz ou do estilo de artistas reais. Descreva o ritmo, os instrumentos e o clima, sem citar cantores.' }, 400, origin);
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
      console.error(JSON.stringify({ googleStatus: upstream.status, googleMsg: gMsg.slice(0, 240) }));
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
      notice: NOTICE,
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
