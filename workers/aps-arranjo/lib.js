/**
 * APS Arranjo — proxy de servidor para criação de arranjos a partir de áudio.
 * A chave fica só no secret do worker. Nunca registre o valor.
 * Mensagens ao cliente não citam o provedor de geração.
 */
const MAX_BODY = 32 * 1024;
const MAX_AUDIO = 10 * 1024 * 1024;
const MAX_DURATION_SEC = 480;
const MAX_PROMPT = 1024;
const MAX_LYRICS = 5000;
const DAILY_GLOBAL = 8;
const PER_IP_HOUR = 2;
const API_BASE = 'https://api.mureka.ai';
const DEFAULT_MODEL = 'mureka-7.6';
const NOTICE = 'APS Arranjo: áudio gerado por IA. É uma criação nova, não a sua gravação original.';
const ALLOWED_HOSTS = new Set(['apsaudio.com.br', 'www.apsaudio.com.br']);
const AUDIO_HOSTS = new Set(['cdn.mureka.ai']);
const MEMORY_LIMITS = new Map();

const PURPOSES = {
  referencia: 'reference',
  reference: 'reference',
  melodia: 'melody',
  melody: 'melody',
  instrumento: 'instrumental',
  instrumental: 'instrumental',
  audio: 'audio'
};

const TRACK_TYPES = {
  vocais: 'Vocals',
  voz: 'Vocals',
  vocals: 'Vocals',
  acompanhamento: 'Instrumental',
  instrumental: 'Instrumental',
  bateria: 'Drums',
  drums: 'Drums',
  baixo: 'Bass',
  bass: 'Bass',
  guitarra: 'Guitar',
  guitar: 'Guitar',
  teclado: 'Keyboard',
  keyboard: 'Keyboard',
  percussao: 'Percussion',
  percussion: 'Percussion',
  cordas: 'Strings',
  strings: 'Strings',
  sintetizador: 'Synth',
  synth: 'Synth',
  efeitos: 'FX',
  fx: 'FX',
  metais: 'Brass',
  brass: 'Brass',
  sopros: 'Woodwinds',
  woodwinds: 'Woodwinds'
};

const MIME_MAP = {
  'audio/mpeg': 'audio/mpeg',
  'audio/mp3': 'audio/mpeg',
  'audio/mp4': 'audio/mp4',
  'audio/m4a': 'audio/mp4',
  'audio/x-m4a': 'audio/mp4',
  'audio/aac': 'audio/mp4',
  'audio/wav': 'audio/wav',
  'audio/x-wav': 'audio/wav',
  'audio/wave': 'audio/wav'
};

const EXT_MAP = {
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  mp4: 'audio/mp4',
  aac: 'audio/mp4',
  wav: 'audio/wav'
};

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

async function limitGet(env, key) {
  if (env?.LIMITS) {
    const n = Number(await env.LIMITS.get(key));
    return Number.isFinite(n) ? n : 0;
  }
  const row = MEMORY_LIMITS.get(key);
  if (!row) return 0;
  if (row.exp && row.exp < Date.now()) {
    MEMORY_LIMITS.delete(key);
    return 0;
  }
  return row.n || 0;
}

async function limitAdd(env, key, delta, ttlSec) {
  const next = Math.max(0, (await limitGet(env, key)) + delta);
  if (env?.LIMITS) {
    await env.LIMITS.put(key, String(next), { expirationTtl: ttlSec });
    return next;
  }
  MEMORY_LIMITS.set(key, { n: next, exp: Date.now() + ttlSec * 1000 });
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

function wavDurationSeconds(bytes) {
  if (!bytes || bytes.length < 44) return null;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (dv.getUint32(0, false) !== 0x52494646 || dv.getUint32(8, false) !== 0x57415645) return null;
  let off = 12;
  while (off + 8 <= bytes.length) {
    const id = String.fromCharCode(bytes[off], bytes[off + 1], bytes[off + 2], bytes[off + 3]);
    const size = dv.getUint32(off + 4, true);
    if (id === 'fmt ' && off + 24 <= bytes.length) {
      const rate = dv.getUint32(off + 12, true);
      let dataSize = bytes.length - 44;
      let dataOff = off + 8;
      while (dataOff + 8 <= bytes.length) {
        const did = String.fromCharCode(bytes[dataOff], bytes[dataOff + 1], bytes[dataOff + 2], bytes[dataOff + 3]);
        const dsz = dv.getUint32(dataOff + 4, true);
        if (did === 'data') { dataSize = dsz; break; }
        dataOff += 8 + dsz + (dsz % 2);
      }
      const ch = dv.getUint16(off + 10, true);
      const bits = dv.getUint16(off + 22, true);
      const bps = rate * Math.max(1, ch) * Math.max(1, bits / 8);
      return bps ? dataSize / bps : null;
    }
    off += 8 + size + (size % 2);
  }
  return null;
}

function parsePurpose(value, fallback = 'audio') {
  const key = String(value || '').trim().toLowerCase();
  return PURPOSES[key] || PURPOSES[fallback] || 'audio';
}

function parseModo(value) {
  const modo = String(value || '').trim().toLowerCase();
  if (['nova', 'acompanhar', 'instrumento', 'estender'].includes(modo)) return modo;
  return '';
}

function parseTrackType(value) {
  const key = String(value || '').trim().toLowerCase();
  return TRACK_TYPES[key] || '';
}

function filenameForMime(mime, name) {
  const ext = mime === 'audio/wav' ? 'wav' : mime === 'audio/mpeg' ? 'mp3' : 'm4a';
  const base = String(name || 'audio').replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 60) || 'audio';
  return base.includes('.') ? base : `${base}.${ext}`;
}

function mapUpstreamError(status, payload) {
  const raw = String(payload?.error?.message || payload?.message || '');
  const low = raw.toLowerCase();
  if (status === 401 || status === 403) {
    return { status: 503, error: 'O serviço de arranjo ainda não está disponível.' };
  }
  if (status === 402 || /balance|credit|insufficient|billing/.test(low)) {
    return { status: 402, error: 'Os créditos do arranjo acabaram. Fale com o estúdio.' };
  }
  if (status === 429) {
    return { status: 429, error: 'Muitos pedidos neste período. Espere um pouco e tente de novo.' };
  }
  if (status === 413 || /too large|size limit/.test(low)) {
    return { status: 413, error: 'O arquivo é grande demais. Envie um áudio de até 10 MB.' };
  }
  if (status >= 500) {
    return { status: 502, error: 'O serviço de arranjo está indisponível agora. Tente de novo em instantes.' };
  }
  return { status: status >= 400 ? status : 502, error: 'Não foi possível criar o arranjo agora. Tente novamente.' };
}

function allowedAudioUrl(raw) {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:') return null;
    if (AUDIO_HOSTS.has(u.hostname) || u.hostname.endsWith('.mureka.ai')) return u;
  } catch { /* ignore */ }
  return null;
}


function b64url(bytes) {
  let bin = '';
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
  return btoa(bin).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function unb64url(text) {
  const pad = '='.repeat((4 - (text.length % 4)) % 4);
  const b64 = text.replaceAll('-', '+').replaceAll('_', '/') + pad;
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function audioKey(secret) {
  const raw = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(secret || 'aps-arranjo') + ':audio-proxy'));
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

async function sealAudioUrl(url, secret) {
  const key = await audioKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(url)));
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv, 0);
  out.set(ct, iv.length);
  return b64url(out);
}

async function openAudioToken(token, secret) {
  if (!token) return null;
  try {
    const raw = unb64url(token);
    if (raw.length < 29) return null;
    const key = await audioKey(secret);
    const iv = raw.slice(0, 12);
    const ct = raw.slice(12);
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
    return allowedAudioUrl(new TextDecoder().decode(pt));
  } catch {
    return null;
  }
}

async function publicChoice(choice, requestUrl, secret) {
  const src = choice.url || choice.wav_url || choice.flac_url || '';
  const safe = allowedAudioUrl(src);
  const id = String(choice.id || '');
  let audio = '';
  if (safe) {
    const base = new URL(requestUrl);
    const token = await sealAudioUrl(safe.toString(), secret);
    audio = `${base.origin}/audio?t=${encodeURIComponent(token)}`;
  }
  return {
    id,
    duracaoMs: Number(choice.duration) || null,
    url: audio,
    aviso: NOTICE
  };
}

async function publicTask(task, kind, requestUrl, secret) {
  const statusMap = {
    preparing: 'preparando',
    queued: 'fila',
    running: 'gerando',
    streaming: 'gerando',
    succeeded: 'pronto',
    failed: 'falhou',
    timeouted: 'falhou',
    cancelled: 'falhou'
  };
  const status = statusMap[task.status] || 'gerando';
  const payload = {
    ok: status !== 'falhou',
    id: String(task.id || ''),
    tipo: kind,
    status,
    notice: NOTICE
  };
  if (status === 'falhou') {
    payload.error = 'Não foi possível criar o arranjo agora. Tente novamente.';
  }
  if (status === 'pronto') {
    const choices = Array.isArray(task.choices) ? task.choices : [];
    payload.resultados = [];
    for (const c of choices) payload.resultados.push(await publicChoice(c, requestUrl, secret));
    payload.aviso = 'Este áudio foi gerado por IA. Não é a sua gravação original.';
  }
  return payload;
}

export {
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
  ALLOWED_HOSTS,
  AUDIO_HOSTS,
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
  parseModo,
  parseTrackType,
  filenameForMime,
  mapUpstreamError,
  allowedAudioUrl,
  sealAudioUrl,
  openAudioToken,
  publicTask
};
