/**
 * APS Lyria — gera música com Google Lyria (Gemini API).
 * A chave fica só no secret GEMINI_API_KEY. Nunca registre o valor.
 */
const MAX_BODY = 32 * 1024;
const MAX_AUDIO = 10 * 1024 * 1024;
const MAX_DURATION_SEC = 120;
const MAX_PROMPT = 2000;
const MAX_LYRICS = 4000;
const MAX_STYLE = 80;
const DAILY_GLOBAL = 20;
const PER_IP_HOUR = 5;
const REF_DAILY = 15;
const REF_PER_IP_HOUR = 3;
const ANALYZE_MODEL = 'gemini-3.5-flash-lite';
const NOTICE = 'Música gerada por IA (Google Lyria), com marca d\'água SynthID';
const REF_NOTICE = 'Música gerada por IA (Google Lyria), com marca d\'água SynthID. É uma criação nova inspirada na gravação, não uma edição do áudio original.';
const ALLOWED_HOSTS = new Set(['apsaudio.com.br', 'www.apsaudio.com.br']);
const STYLES = new Set([
  'forró', 'forro', 'piseiro', 'sertanejo', 'pagode', 'axé', 'axe', 'arrocha',
  'mpb', 'gospel', 'samba', 'frevo', 'xote', 'baião', 'baiao', 'rock', 'jazz',
  'instrumental', 'brega', 'bossa nova', 'coco', 'maracatu'
]);
const ARTIST_BLOCK = /\b(imite|imitando|clone|clonar|voz do|voz da|voice of|in the style of|no estilo d[oa] cantor|no estilo d[oa] cantora|como o cantor|como a cantora)\b/i;
const MIME_MAP = {
  'audio/wav': 'audio/wav',
  'audio/x-wav': 'audio/wav',
  'audio/wave': 'audio/wav',
  'audio/mpeg': 'audio/mp3',
  'audio/mp3': 'audio/mp3',
  'audio/aiff': 'audio/aiff',
  'audio/x-aiff': 'audio/aiff',
  'audio/aac': 'audio/aac',
  'audio/ogg': 'audio/ogg',
  'audio/flac': 'audio/flac',
  'audio/x-flac': 'audio/flac',
  'audio/m4a': 'audio/m4a',
  'audio/x-m4a': 'audio/m4a',
  'audio/mp4': 'audio/m4a',
  'audio/webm': 'audio/webm',
  'audio/opus': 'audio/opus',
  'audio/l16': 'audio/l16',
  'audio/alaw': 'audio/alaw',
  'audio/mulaw': 'audio/mulaw'
};
const EXT_MAP = {
  wav: 'audio/wav',
  mp3: 'audio/mp3',
  aiff: 'audio/aiff',
  aif: 'audio/aiff',
  aac: 'audio/aac',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  flac: 'audio/flac',
  m4a: 'audio/m4a',
  mp4: 'audio/m4a',
  webm: 'audio/webm',
  opus: 'audio/opus'
};
const ANALYZE_PROMPT = [
  'Ouça este áudio. Pode ser uma gravação ou uma exportação de estúdio.',
  'Descreva só o estilo musical com o máximo de precisão técnica.',
  'Não transcreva nem cite letra. Não nomeie nem imite artistas reais.',
  'Não identifique obras protegidas de terceiros nem recites melodias reconhecíveis de hits.',
  'Responda APENAS um JSON com estas chaves:',
  '{"genero": string|null, "bpm": number|null, "tom": string|null, "clima": string|null, "instrumentos": string[], "estrutura": string|null, "acordes": string|null, "groove": string|null, "contornoMelodia": string|null, "caracterMix": string|null, "resumo": string, "eMusica": boolean}',
  'bpm: andamento numérico o mais exato possível (40 a 300).',
  'tom: tonalidade e modo no formato musical, por exemplo "G major" ou "D minor".',
  'estrutura: seções com tempos aproximados, por exemplo "intro 0:00-0:12, verso 0:12-0:40, refrão 0:40-1:05".',
  'acordes: progressão harmônica se for reconhecível, sem citar obra alheia.',
  'groove: compassos, síncope, batida e caráter rítmico.',
  'contornoMelodia: descreva o formato (ascendente, repetitivo, falas curtas), sem transcrever notas ou frases de obras de terceiros.',
  'caracterMix: graves, agudos, espaço, compressão e caráter da mixagem.',
  'resumo: 2 a 4 frases com ritmo, instrumentos, clima e arranjo, servindo de pedido para criar uma MÚSICA ORIGINAL NOVA.',
  'Se o áudio não for música, eMusica=false e explique em resumo.'
].join('\n');

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

function normalizeMime(type, name) {
  const raw = String(type || '').toLowerCase().split(';')[0].trim();
  if (MIME_MAP[raw]) return MIME_MAP[raw];
  const ext = String(name || '').toLowerCase().split('.').pop();
  return EXT_MAP[ext] || '';
}

function uint8ToBase64(bytes) {
  const chunks = [];
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    chunks.push(String.fromCharCode(...bytes.subarray(i, i + step)));
  }
  return btoa(chunks.join(''));
}

function wavDurationSeconds(bytes) {
  if (!bytes || bytes.length < 44) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (i) => String.fromCharCode(bytes[i], bytes[i + 1], bytes[i + 2], bytes[i + 3]);
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') return null;
  let offset = 12;
  let sampleRate = 0;
  let blockAlign = 0;
  let dataSize = 0;
  while (offset + 8 <= bytes.length) {
    const id = tag(offset);
    const size = view.getUint32(offset + 4, true);
    if (id === 'fmt ' && size >= 16 && offset + 22 <= bytes.length) {
      sampleRate = view.getUint32(offset + 12, true);
      blockAlign = view.getUint16(offset + 20, true);
    } else if (id === 'data') {
      dataSize = size;
      break;
    }
    const next = offset + 8 + size + (size % 2);
    if (next <= offset) break;
    offset = next;
  }
  if (sampleRate > 0 && blockAlign > 0 && dataSize > 0) return dataSize / (sampleRate * blockAlign);
  return null;
}

function sanitizeDesc(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const bpmN = Number(src.bpm);
  const bpm = Number.isFinite(bpmN) && bpmN >= 40 && bpmN <= 300 ? Math.round(bpmN) : null;
  const instrumentos = Array.isArray(src.instrumentos)
    ? src.instrumentos.filter((x) => typeof x === 'string').map((x) => cleanText(x, 40)).filter(Boolean).slice(0, 12)
    : [];
  return {
    genero: cleanText(src.genero, 80) || null,
    bpm,
    tom: cleanText(src.tom, 40) || null,
    clima: cleanText(src.clima, 80) || null,
    instrumentos,
    estrutura: cleanText(src.estrutura, 300) || null,
    acordes: cleanText(src.acordes, 200) || null,
    groove: cleanText(src.groove, 200) || null,
    contornoMelodia: cleanText(src.contornoMelodia, 240) || null,
    caracterMix: cleanText(src.caracterMix, 200) || null,
    resumo: cleanText(src.resumo, 800),
    eMusica: src.eMusica === false || src.eMusica === 'false' ? false : true
  };
}

function parseFidelidade(value) {
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw) return 'media';
  if (raw === 'alta' || raw === 'parecido' || raw === 'parecido com o original') return 'alta';
  if (raw === 'media' || raw === 'média' || raw === 'meio' || raw === 'equilibrado') return 'media';
  if (raw === 'baixa' || raw === 'livre' || raw === 'bem livre') return 'baixa';
  const n = Number(raw);
  if (n === 3 || n === 100) return 'alta';
  if (n === 2 || n === 50) return 'media';
  if (n === 1 || n === 0) return 'baixa';
  return null;
}

function parseDireitos(value) {
  const raw = String(value ?? '').trim().toLowerCase();
  return value === true || value === 1 || raw === '1' || raw === 'true' || raw === 'on' || raw === 'sim';
}

function composeReferenceUserPrompt(desc, userPrompt, fidelidade) {
  const omitted = arguments.length < 3 || fidelidade == null || fidelidade === '';
  const level = omitted ? 'baixa' : (parseFidelidade(fidelidade) || 'baixa');
  const parts = [];
  if (level === 'alta') {
    parts.push(
      'Crie uma música original nova bem parecida com a descrição desta gravação de referência.',
      'Trave com o máximo de fidelidade o andamento, o tom, a instrumentação, a estrutura e o groove descritos.',
      'Não mude o andamento nem o tom. Não acrescente instrumentos que não estavam na referência.',
      'Ainda assim, isto NÃO é uma edição, remix, restauração nem cópia da gravação, e não deve ser apresentado como o áudio original.',
      'Não reproduza letra protegida nem a melodia de uma obra de terceiros.'
    );
  } else if (level === 'media') {
    parts.push(
      'Crie uma música original nova, guiada por esta descrição de referência.',
      'Siga o mesmo gênero, um andamento próximo, um tom compatível, o clima e os instrumentos principais, mas pode variar o arranjo e inventar detalhes.',
      'Não é uma edição, remix, restauração nem cópia da gravação de referência.',
      'Não reproduza letra protegida nem a melodia de uma obra de terceiros.'
    );
  } else {
    parts.push(
      'Crie uma música original nova, apenas inspirada nesta descrição de estilo.',
      'Pode inventar bastante no arranjo, desde que mantenha um clima reconhecível.',
      'Não é uma edição, remix, restauração nem cópia da gravação de referência.',
      'Não reproduza letra, melodia ou trechos reconhecíveis da gravação.'
    );
  }
  if (desc?.genero) parts.push(`Gênero: ${desc.genero}.`);
  if (desc?.bpm) {
    parts.push(level === 'alta' ? `Andamento exato: ${desc.bpm} BPM.` : `Andamento aproximado: ${desc.bpm} BPM.`);
  }
  if (desc?.tom) {
    parts.push(level === 'alta' ? `Tom ou escala (mantenha): ${desc.tom}.` : `Tom ou modo: ${desc.tom}.`);
  }
  if (desc?.clima) parts.push(`Clima: ${desc.clima}.`);
  if (desc?.instrumentos?.length) {
    const inst = desc.instrumentos.join(', ');
    parts.push(level === 'alta' ? `Instrumentação travada: ${inst}.` : `Instrumentos: ${inst}.`);
  }
  if (desc?.estrutura) parts.push(`Estrutura: ${desc.estrutura}.`);
  if (desc?.acordes && level !== 'baixa') parts.push(`Harmonia: ${desc.acordes}.`);
  if (desc?.groove) parts.push(level === 'alta' ? `Groove (siga de perto): ${desc.groove}.` : `Groove: ${desc.groove}.`);
  if (desc?.contornoMelodia && level === 'alta') parts.push(`Caráter melódico (sem copiar obra de terceiros): ${desc.contornoMelodia}.`);
  if (desc?.caracterMix && level !== 'baixa') parts.push(`Caráter da mixagem: ${desc.caracterMix}.`);
  if (desc?.resumo) parts.push(`Descrição do estilo: ${desc.resumo}`);
  const extra = cleanText(userPrompt, MAX_PROMPT);
  if (extra) parts.push(`Pedido extra de quem criou: ${extra}`);
  return parts.join(' ');
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

function extractJsonText(payload) {
  const parts = payload?.candidates?.[0]?.content?.parts || [];
  let text = '';
  for (const part of parts) {
    if (part.text) text += part.text;
  }
  text = text.trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) text = fenced[1].trim();
  return text;
}

function mapGeminiError(status, err) {
  const msg = String(err?.message || err?.status || '');
  const low = msg.toLowerCase();
  if (status === 429 || low.includes('quota') || low.includes('resource_exhausted') || low.includes('billing')) {
    return { status: 429, error: 'A cota ou o faturamento do Google recusou este pedido. Tente mais tarde.' };
  }
  if (status === 400 && (low.includes('safety') || low.includes('blocked') || low.includes('prohibited'))) {
    return { status: 400, error: 'O filtro de segurança do Google bloqueou este pedido. Evite imitar artistas reais ou letras protegidas.' };
  }
  if (status >= 500) return { status: 502, error: 'O serviço do Google está indisponível agora. Tente de novo em instantes.' };
  return { status: 502, error: 'Não foi possível concluir este pedido agora. Tente novamente.' };
}

function validId(id) {
  return typeof id === 'string' && /^[a-f0-9-]{16,64}$/i.test(id);
}

function parseModo(value) {
  if (value === 'completa') return 'completa';
  if (value === 'clip' || !value) return 'clip';
  return null;
}

function parseEstilo(value) {
  const estiloRaw = cleanText(value, MAX_STYLE).toLowerCase();
  return !estiloRaw || estiloRaw === 'livre' ? '' : estiloRaw;
}

function readGenerationFields(body) {
  const prompt = cleanText(body?.prompt, MAX_PROMPT);
  const estilo = parseEstilo(body?.estilo);
  const letra = cleanText(body?.letra, MAX_LYRICS);
  const modo = parseModo(body?.modo);
  if (modo === null) return { error: 'Modo inválido. Use clip ou completa.' };
  if (estilo && !STYLES.has(estilo)) {
    return { error: 'Estilo não reconhecido. Escolha um estilo da lista ou Livre.' };
  }
  return { prompt, estilo, letra, modo };
}

function referenceReady(desc) {
  if (!desc?.eMusica) {
    return 'Este áudio não parece uma música que dê para usar de referência. Envie uma gravação musical de até 2 minutos.';
  }
  if (!desc.resumo || desc.resumo.length < 20) {
    return 'A descrição da gravação não deu para usar. Tente outro áudio ou descreva o que você quer ouvir.';
  }
  return null;
}

export {
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
  ALLOWED_HOSTS,
  STYLES,
  ARTIST_BLOCK,
  MIME_MAP,
  EXT_MAP,
  ANALYZE_PROMPT,
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
  referenceReady
};
