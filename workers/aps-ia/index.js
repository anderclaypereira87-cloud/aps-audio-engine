/**
 * APS IA — backend de comandos de mixagem (Gemini).
 * A OpenAI permanece no código, mas só entra se IA_PROVIDER=openai.
 * Não processa áudio; só devolve ajustes validados contra o que a DAW realmente tem.
 * POST /comando — ações de mixagem. POST /eq — duas curvas de EQ gráfico (A = pedido, B = sugestão).
 */
const MAX_BODY = 48 * 1024;
const RATE_PER_HOUR = 15;
const DAILY_CAP_USD = 2;

const GEMINI_MODEL = 'gemini-3.5-flash-lite';
const GEMINI_PRICE_IN = 0.30 / 1_000_000;
const GEMINI_PRICE_OUT = 2.50 / 1_000_000;

const OPENAI_MODEL = 'gpt-4o-mini';
const OPENAI_PRICE_IN = 0.15 / 1_000_000;
const OPENAI_PRICE_OUT = 0.60 / 1_000_000;

const ALLOWED_HOSTS = new Set(['apsaudio.com.br', 'www.apsaudio.com.br']);

const RANGES = {
  gain: [0, 150],
  pan: [-100, 100],
  bass: [-12, 12],
  mid: [-12, 12],
  midFreq: [200, 3000],
  treble: [-12, 12],
  hpf: [20, 500],
  reverb: [0, 40],
  delay: [0, 35],
  drive: [0, 50],
  ratio: [1, 8],
  masterGain: [0, 125]
};

const BOOL_PARAMS = new Set(['comp', 'masterComp']);
const ENUM_PARAMS = { amp: ['clean', 'warm', 'bright'] };

const PROCESSOR_PARAMS = {
  volume: ['gain'],
  eq: ['bass', 'mid', 'midFreq', 'treble', 'hpf'],
  compressor: ['comp', 'ratio'],
  reverb: ['reverb'],
  delay: ['delay'],
  distortion: ['drive'],
  pan: ['pan'],
  amp: ['amp'],
  master: ['masterGain', 'masterComp']
};

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['actions', 'cannot', 'summary'],
  properties: {
    actions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['target_type', 'target_id', 'processor', 'param', 'value'],
        properties: {
          target_type: { type: 'string', enum: ['track', 'bus', 'master', 'region'] },
          target_id: { type: 'string' },
          processor: {
            type: 'string',
            enum: ['volume', 'eq', 'compressor', 'reverb', 'delay', 'distortion', 'pan', 'amp', 'master']
          },
          param: { type: 'string' },
          value: { type: 'number' }
        }
      }
    },
    cannot: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' }
  }
};

const EQ_TYPES = ['peaking', 'lowshelf', 'highshelf', 'highpass', 'lowpass'];
const EQ_BAND = {
  type: 'object',
  additionalProperties: false,
  required: ['type', 'f', 'g', 'q'],
  properties: {
    type: { type: 'string', enum: EQ_TYPES },
    f: { type: 'number' },
    g: { type: 'number' },
    q: { type: 'number' }
  }
};
const EQ_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['curveA', 'curveB', 'summary'],
  properties: {
    curveA: {
      type: 'object',
      additionalProperties: false,
      required: ['label', 'bands'],
      properties: {
        label: { type: 'string' },
        bands: { type: 'array', items: EQ_BAND }
      }
    },
    curveB: {
      type: 'object',
      additionalProperties: false,
      required: ['label', 'bands', 'reason'],
      properties: {
        label: { type: 'string' },
        bands: { type: 'array', items: EQ_BAND },
        reason: { type: 'string' }
      }
    },
    summary: { type: 'string' }
  }
};

function clampNum(n, lo, hi) {
  const v = Number(n);
  if (!Number.isFinite(v)) return lo;
  return Math.min(hi, Math.max(lo, v));
}

function sanitizeEqBands(raw) {
  const src = Array.isArray(raw) ? raw : (Array.isArray(raw?.bands) ? raw.bands : []);
  return src.slice(0, 10).map((b) => {
    if (!b || !Number.isFinite(Number(b.f))) return null;
    return {
      type: EQ_TYPES.includes(b.type) ? b.type : 'peaking',
      f: clampNum(b.f, 20, 20000),
      g: clampNum(b.g == null ? 0 : b.g, -18, 18),
      q: clampNum(b.q == null ? 1 : b.q, 0.1, 18)
    };
  }).filter(Boolean);
}

function eqSystemPrompt() {
  return [
    'Você é o assistente de equalização do APS Audio Engine.',
    'Responda sempre em português do Brasil, de forma curta e clara.',
    'Você NÃO gera áudio e NÃO recebe o áudio bruto, só um resumo de espectro (energias relativas por banda) e os parâmetros atuais da pista.',
    'Devolva exatamente duas curvas de EQ gráfico/paramétrico, cada uma com 6 a 10 bandas.',
    'Bandas padrão sugeridas: lowshelf 60 Hz, peaking em 125, 250, 500, 1000, 2000 e 4000 Hz, highshelf 8000 Hz. Você pode deslocar a frequência se o pedido citar um Hz específico (ex.: 300 Hz).',
    'Cada banda tem type (peaking, lowshelf, highshelf, highpass ou lowpass), f (20-20000), g (-18 a 18 dB) e q (0.1 a 18).',
    'curveA: tradução literal do pedido do usuário, mesmo que seja agressiva. label curto.',
    'curveB: a curva que VOCÊ recomenda, com prática de mixagem (ganhos mais suaves, preservar corpo, evitar estridência). reason: 1 frase em PT-BR. label curto.',
    'summary: 1 ou 2 frases dizendo o que cada curva faz.',
    'Os graves/médios/agudos clássicos da pista já estão aplicados; estas curvas são o EQ gráfico extra, em dB de ganho por banda.',
    'Use o espectro (db relativo ao pico) para não empilhar boost onde a pista já está cheia, e para justificar cortes de "embolado".',
    'Não invente stems nem altere volume, reverb, compressão ou outros processadores.'
  ].join(' ');
}

function summarizeEqEstado(estado) {
  const track = estado?.track || estado?.tracks?.[0] || {};
  const spectrum = estado?.spectrum || {};
  const bands = Array.isArray(spectrum.bands) ? spectrum.bands.slice(0, 16).map((b) => ({
    f: Number(b.f) || 0,
    db: Number(b.db) || 0
  })) : [];
  return {
    track: {
      id: track.id,
      name: track.name,
      type: track.type,
      params: track.params || track
    },
    spectrum: { bands }
  };
}

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
    'Access-Control-Allow-Methods': 'POST,OPTIONS',
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

function utcDay(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

function utcHour(d = new Date()) {
  return d.toISOString().slice(0, 13);
}

async function kvGetNum(env, key) {
  if (!env.LIMITS) return 0;
  const v = await env.LIMITS.get(key);
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

async function kvAdd(env, key, delta, ttl) {
  if (!env.LIMITS) return;
  const next = (await kvGetNum(env, key)) + delta;
  await env.LIMITS.put(key, String(next), { expirationTtl: ttl });
  return next;
}

function collectWhitelist(estado) {
  const byTarget = new Map();
  const tracks = Array.isArray(estado?.tracks) ? estado.tracks : [];
  for (const t of tracks) {
    if (!t || typeof t.id !== 'string') continue;
    const procs = new Set(Array.isArray(t.processors) ? t.processors : Object.keys(PROCESSOR_PARAMS));
    byTarget.set(t.id, { kind: 'track', processors: procs, name: String(t.name || t.id) });
  }
  const master = estado?.master;
  if (master) {
    byTarget.set('master', {
      kind: 'master',
      processors: new Set(Array.isArray(master.processors) ? master.processors : ['master']),
      name: 'master'
    });
  } else {
    byTarget.set('master', { kind: 'master', processors: new Set(['master']), name: 'master' });
  }
  return byTarget;
}

function normalizeValue(param, raw) {
  if (BOOL_PARAMS.has(param)) return raw ? 1 : 0;
  if (ENUM_PARAMS[param]) {
    const s = String(raw);
    return ENUM_PARAMS[param].includes(s) ? s : null;
  }
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  if (RANGES[param]) {
    const [lo, hi] = RANGES[param];
    return Math.min(hi, Math.max(lo, n));
  }
  return n;
}

function validateActions(rawActions, whitelist) {
  const actions = [];
  const dropped = [];
  if (!Array.isArray(rawActions)) return { actions, dropped: ['resposta sem lista de ações'] };
  for (const a of rawActions) {
    if (!a || typeof a !== 'object') continue;
    const processor = String(a.processor || '');
    const param = String(a.param || '');
    const allowedParams = PROCESSOR_PARAMS[processor];
    if (!allowedParams || !allowedParams.includes(param)) {
      dropped.push(`${processor}.${param} não existe neste motor`);
      continue;
    }
    let targetType = String(a.target_type || 'track');
    let targetId = String(a.target_id || '');
    if (processor === 'master' || targetType === 'master' || targetType === 'bus') {
      targetType = 'master';
      targetId = 'master';
    }
    const target = whitelist.get(targetId);
    if (!target) {
      dropped.push(`alvo ${targetId || '(vazio)'} não está na sessão`);
      continue;
    }
    if (!target.processors.has(processor)) {
      dropped.push(`${processor} não está disponível em ${target.name}`);
      continue;
    }
    const value = ENUM_PARAMS[param]
      ? (ENUM_PARAMS[param].includes(String(a.value)) ? String(a.value) : null)
      : normalizeValue(param, a.value);
    if (value === null) {
      dropped.push(`valor inválido para ${param}`);
      continue;
    }
    actions.push({
      target_type: targetType === 'region' ? 'track' : targetType,
      target_id: targetId,
      processor,
      param,
      value: BOOL_PARAMS.has(param) ? Boolean(Number(value)) : value
    });
  }
  return { actions, dropped };
}

function summarizeEstado(estado) {
  const tracks = Array.isArray(estado?.tracks) ? estado.tracks : [];
  return {
    bpm: Number(estado?.bpm) || null,
    sections: Array.isArray(estado?.sections) ? estado.sections.slice(0, 24) : [],
    master: estado?.master || { processors: ['master'], params: { masterGain: 85, masterComp: true } },
    tracks: tracks.slice(0, 32).map((t) => ({
      id: t.id,
      name: t.name,
      type: t.type,
      instrument: t.instrument || t.type,
      processors: t.processors,
      params: t.params
    }))
  };
}

function systemPrompt() {
  return [
    'Você é o assistente de mixagem do APS Audio Engine.',
    'Responda sempre em português do Brasil, de forma curta e clara.',
    'Você NÃO gera áudio. Você só escolhe ajustes dos processadores que a sessão listar.',
    'Cada ação precisa de: target_type, target_id (id exato da pista ou "master"), processor, param e value numérico.',
    'Parâmetros booleanos (comp, masterComp): use 1 para ligado e 0 para desligado.',
    'amp: 0=clean não se aplica; use apenas se o processador amp existir — neste schema value é número, então NÃO use amp.',
    'Faixas: gain 0-150, pan -100-100 (negativo = esquerda), bass/mid/treble -12 a 12 dB, midFreq 200-3000 Hz, hpf 20-500 Hz, reverb 0-40, delay 0-35, drive 0-50, ratio 1-8, masterGain 0-125.',
    'No master só existem masterGain e masterComp (liga/desliga). Não existe ratio no master.',
    'gain é uma escala 0-150, não é dB. Se pedirem +3 dB no volume, aumente o gain proporcionalmente (cerca de 1,41 vezes o valor atual, sem sair da faixa), em vez de somar 3.',
    'Se o pedido for desfazer ou undo, deixe actions vazio e explique em cannot que o desfazer é o botão da DAW, porque você não guarda o estado anterior.',
    'Se o pedido pedir algo que estes processadores não fazem (gerar instrumento, separar stems, afinar, quantizar, criar MIDI, trocar arranjo, guitarra isolada que não existe na sessão), coloque em "cannot".',
    'Combine o pedido com o estilo musical quando houver (forró, piseiro, samba etc.), mas só altere pistas existentes.',
    'Não invente target_id. Se não houver pista correspondente (ex.: pediu sanfona e não há), explique em cannot.',
    'summary: 1 a 3 frases sobre o que será aplicado.'
  ].join(' ');
}

function preferredProvider(env) {
  const forced = String(env.IA_PROVIDER || '').toLowerCase();
  if (forced === 'openai') return env.OPENAI_API_KEY ? 'openai' : null;
  if (forced === 'gemini') return env.GEMINI_API_KEY ? 'gemini' : null;
  // Padrão: só Gemini. A OpenAI fica inativa até alguém pedir IA_PROVIDER=openai.
  if (env.GEMINI_API_KEY) return 'gemini';
  return null;
}

async function callOpenAI(env, comando, estado) {
  if (!env.OPENAI_API_KEY) {
    const err = new Error('O serviço de comandos ainda não está configurado.');
    err.status = 503;
    throw err;
  }
  const body = {
    model: OPENAI_MODEL,
    temperature: 0.3,
    response_format: {
      type: 'json_schema',
      json_schema: { name: 'aps_mix_command', strict: true, schema: SCHEMA }
    },
    messages: [
      { role: 'system', content: systemPrompt() },
      {
        role: 'user',
        content: JSON.stringify({ comando, estado: summarizeEstado(estado) })
      }
    ]
  };
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = 'Não foi possível consultar o comando agora.';
    const err = new Error(msg);
    err.status = res.status === 429 ? 429 : 502;
    throw err;
  }
  const text = data?.choices?.[0]?.message?.content;
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    const err = new Error('A IA devolveu um formato inválido');
    err.status = 502;
    throw err;
  }
  const usage = data.usage || {};
  const prompt = Number(usage.prompt_tokens) || 0;
  const completion = Number(usage.completion_tokens) || 0;
  const total = Number(usage.total_tokens) || prompt + completion;
  const cost = prompt * OPENAI_PRICE_IN + completion * OPENAI_PRICE_OUT;
  return { parsed, usage: { prompt, completion, total, cost, model: OPENAI_MODEL } };
}

async function callGemini(env, comando, estado) {
  if (!env.GEMINI_API_KEY) {
    const err = new Error('O serviço de comandos ainda não está configurado.');
    err.status = 503;
    throw err;
  }
  const body = {
    systemInstruction: { parts: [{ text: systemPrompt() }] },
    contents: [{
      role: 'user',
      parts: [{ text: JSON.stringify({ comando, estado: summarizeEstado(estado) }) }]
    }],
    generationConfig: {
      temperature: 0.3,
      responseMimeType: 'application/json',
      responseJsonSchema: SCHEMA,
      thinkingConfig: { thinkingLevel: 'MINIMAL' }
    }
  };
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': env.GEMINI_API_KEY
      },
      body: JSON.stringify(body)
    }
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = 'Não foi possível consultar o comando agora.';
    const err = new Error(msg);
    err.status = res.status === 429 ? 429 : 502;
    throw err;
  }
  const parts = data?.candidates?.[0]?.content?.parts || [];
  const text = parts.map((p) => p.text || '').join('');
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    const err = new Error('A IA devolveu um formato inválido');
    err.status = 502;
    throw err;
  }
  const um = data.usageMetadata || {};
  const prompt = Number(um.promptTokenCount) || 0;
  const completion = Number(um.candidatesTokenCount) || 0;
  const thoughts = Number(um.thoughtsTokenCount) || 0;
  const total = Number(um.totalTokenCount) || prompt + completion + thoughts;
  const cost = prompt * GEMINI_PRICE_IN + (completion + thoughts) * GEMINI_PRICE_OUT;
  return { parsed, usage: { prompt, completion: completion + thoughts, total, cost, model: GEMINI_MODEL } };
}

async function callModel(env, comando, estado) {
  const first = preferredProvider(env);
  if (!first) {
    const err = new Error('Nenhuma chave de IA configurada no servidor');
    err.status = 503;
    throw err;
  }
  return first === 'gemini'
    ? await callGemini(env, comando, estado)
    : await callOpenAI(env, comando, estado);
}

async function callOpenAIJson(env, { system, user, schema, name, temperature }) {
  if (!env.OPENAI_API_KEY) {
    const err = new Error('O serviço de comandos ainda não está configurado.');
    err.status = 503;
    throw err;
  }
  const body = {
    model: OPENAI_MODEL,
    temperature: temperature ?? 0.3,
    response_format: {
      type: 'json_schema',
      json_schema: { name: name || 'aps_json', strict: true, schema }
    },
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user }
    ]
  };
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = 'Não foi possível consultar o comando agora.';
    const err = new Error(msg);
    err.status = res.status === 429 ? 429 : 502;
    throw err;
  }
  const textResp = data?.choices?.[0]?.message?.content;
  let parsed;
  try {
    parsed = JSON.parse(textResp);
  } catch {
    const err = new Error('A IA devolveu um formato inválido');
    err.status = 502;
    throw err;
  }
  const usage = data.usage || {};
  const prompt = Number(usage.prompt_tokens) || 0;
  const completion = Number(usage.completion_tokens) || 0;
  const total = Number(usage.total_tokens) || prompt + completion;
  const cost = prompt * OPENAI_PRICE_IN + completion * OPENAI_PRICE_OUT;
  return { parsed, usage: { prompt, completion, total, cost, model: OPENAI_MODEL } };
}

async function callGeminiJson(env, { system, user, schema, temperature }) {
  if (!env.GEMINI_API_KEY) {
    const err = new Error('O serviço de comandos ainda não está configurado.');
    err.status = 503;
    throw err;
  }
  const body = {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: 'user', parts: [{ text: user }] }],
    generationConfig: {
      temperature: temperature ?? 0.4,
      responseMimeType: 'application/json',
      responseJsonSchema: schema,
      thinkingConfig: { thinkingLevel: 'MINIMAL' }
    }
  };
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': env.GEMINI_API_KEY
      },
      body: JSON.stringify(body)
    }
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = 'Não foi possível consultar o comando agora.';
    const err = new Error(msg);
    err.status = res.status === 429 ? 429 : 502;
    throw err;
  }
  const parts = data?.candidates?.[0]?.content?.parts || [];
  const textResp = parts.map((p) => p.text || '').join('');
  let parsed;
  try {
    parsed = JSON.parse(textResp);
  } catch {
    const err = new Error('A IA devolveu um formato inválido');
    err.status = 502;
    throw err;
  }
  const um = data.usageMetadata || {};
  const prompt = Number(um.promptTokenCount) || 0;
  const completion = Number(um.candidatesTokenCount) || 0;
  const thoughts = Number(um.thoughtsTokenCount) || 0;
  const total = Number(um.totalTokenCount) || prompt + completion + thoughts;
  const cost = prompt * GEMINI_PRICE_IN + (completion + thoughts) * GEMINI_PRICE_OUT;
  return { parsed, usage: { prompt, completion: completion + thoughts, total, cost, model: GEMINI_MODEL } };
}

async function callModelJson(env, opts) {
  const first = preferredProvider(env);
  if (!first) {
    const err = new Error('Nenhuma chave de IA configurada no servidor');
    err.status = 503;
    throw err;
  }
  return first === 'gemini' ? await callGeminiJson(env, opts) : await callOpenAIJson(env, opts);
}

async function callEqModel(env, comando, estado) {
  return callModelJson(env, {
    system: eqSystemPrompt(),
    user: JSON.stringify({ comando, estado: summarizeEqEstado(estado) }),
    schema: EQ_SCHEMA,
    name: 'aps_eq_curves',
    temperature: 0.4
  });
}

function usagePayload(usage) {
  return {
    model: usage.model,
    prompt_tokens: usage.prompt,
    completion_tokens: usage.completion,
    total_tokens: usage.total,
    estimated_usd: Number(usage.cost.toFixed(6))
  };
}

export default {
  async fetch(request, env) {
    const origin = corsOrigin(request);
    if (request.method === 'OPTIONS') {
      if (origin === null) return new Response('Origem não permitida', { status: 403 });
      return new Response(null, { status: 204, headers: corsHeaders(origin || '*') });
    }

    const url = new URL(request.url);
    if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/health')) {
      return json({
        ok: true,
        service: 'aps-ia',
        route: '/comando',
        routes: ['/comando', '/eq'],
        provider: preferredProvider(env) || 'none'
      }, 200, origin || '');
    }

    const isComando = url.pathname === '/comando' && request.method === 'POST';
    const isEq = url.pathname === '/eq' && request.method === 'POST';
    if (!isComando && !isEq) {
      return json({ error: 'Use POST /comando ou POST /eq' }, 404, origin || '');
    }
    if (origin === null) return json({ error: 'Origem não permitida' }, 403, '');

    const len = Number(request.headers.get('Content-Length') || 0);
    if (len > MAX_BODY) return json({ error: 'Pedido grande demais' }, 413, origin);

    const raw = await request.text();
    if (raw.length > MAX_BODY) return json({ error: 'Pedido grande demais' }, 413, origin);

    let payload;
    try {
      payload = JSON.parse(raw);
    } catch {
      return json({ error: 'JSON inválido' }, 400, origin);
    }

    const comando = String(payload.comando || payload.command || '').trim();
    if (comando.length < 4) return json({ error: isEq ? 'Descreva o que quer no som, em português.' : 'Escreva um comando de mixagem.' }, 400, origin);
    if (comando.length > 2000) return json({ error: 'Comando longo demais.' }, 400, origin);

    const estado = payload.estado || payload.state || {};
    const ip = clientIp(request);
    const hourKey = `rl:${ip}:${utcHour()}`;
    const costKey = `cost:${utcDay()}`;

    const usedHour = await kvGetNum(env, hourKey);
    if (usedHour >= RATE_PER_HOUR) {
      return json({ error: 'Muitos pedidos desta rede. Tente de novo em alguns minutos.' }, 429, origin);
    }
    const spent = await kvGetNum(env, costKey);
    if (spent >= DAILY_CAP_USD) {
      return json({ error: 'Limite diário de uso da IA atingido. Tente amanhã.' }, 429, origin);
    }

    if (isEq) {
      try {
        const { parsed, usage } = await callEqModel(env, comando, estado);
        const curveABands = sanitizeEqBands(parsed.curveA);
        const curveBBands = sanitizeEqBands(parsed.curveB);
        if (!curveABands.length || !curveBBands.length) {
          return json({ error: 'A IA devolveu curvas incompletas.' }, 502, origin);
        }
        await kvAdd(env, hourKey, 1, 2 * 3600);
        await kvAdd(env, costKey, usage.cost, 3 * 24 * 3600);
        return json({
          ok: true,
          curveA: {
            label: String(parsed.curveA?.label || 'Seu pedido').slice(0, 80),
            bands: curveABands
          },
          curveB: {
            label: String(parsed.curveB?.label || 'Sugestão da IA').slice(0, 80),
            bands: curveBBands,
            reason: String(parsed.curveB?.reason || '').slice(0, 280)
          },
          summary: String(parsed.summary || 'Duas curvas prontas para ouvir e escolher.').slice(0, 500),
          usage: usagePayload(usage),
          limits: { daily_cap_usd: DAILY_CAP_USD, rate_per_hour: RATE_PER_HOUR }
        }, 200, origin);
      } catch (e) {
        return json({ error: e.message || 'Falha ao consultar a IA' }, e.status || 500, origin);
      }
    }

    try {
      const { parsed, usage } = await callModel(env, comando, estado);
      const whitelist = collectWhitelist(estado);
      const { actions, dropped } = validateActions(parsed.actions, whitelist);
      const cannot = [...(Array.isArray(parsed.cannot) ? parsed.cannot : []), ...dropped]
        .map((s) => String(s).slice(0, 240))
        .filter(Boolean)
        .slice(0, 20);
      const summary = String(parsed.summary || 'Ajustes prontos para revisar.').slice(0, 500);

      await kvAdd(env, hourKey, 1, 2 * 3600);
      await kvAdd(env, costKey, usage.cost, 3 * 24 * 3600);

      return json({
        ok: true,
        actions,
        cannot,
        summary,
        usage: {
          model: usage.model,
          prompt_tokens: usage.prompt,
          completion_tokens: usage.completion,
          total_tokens: usage.total,
          estimated_usd: Number(usage.cost.toFixed(6))
        },
        limits: { daily_cap_usd: DAILY_CAP_USD, rate_per_hour: RATE_PER_HOUR }
      }, 200, origin);
    } catch (e) {
      return json({ error: e.message || 'Falha ao consultar a IA' }, e.status || 500, origin);
    }
  }
};
