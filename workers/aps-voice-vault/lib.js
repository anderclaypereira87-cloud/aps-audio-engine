// APS Voz Studio — lógica do Worker aps-voice-vault (sem dependências externas).
// Motores internos: "treino" (treino + conversão de modelo vocal hospedado em provedor de GPU)
// e "rapido" (conversão com modelo vocal já existente na conta do provedor de conversão rápida).
// Nenhum segredo é devolvido em respostas ou logs: só os NOMES de bindings configurados.

export const SERVICE = 'aps-voice-vault';
export const MB = 1024 * 1024;
export const MAX_UPLOAD = 50 * MB;            // limite por envio (amostra, guia ou pacote)
export const MAX_PROVIDER_FILE = 100 * MB;    // limite do envio para o provedor
export const MIN_SAMPLE_SEC = 20;             // amostra mínima aceitável
export const REC_SAMPLE_MIN_SEC = 120;        // recomendado: 2 a 10 minutos
export const MAX_SAMPLE_SEC = 15 * 60;
export const MAX_GUIDE_SEC = 10 * 60;
export const DEFAULT_TRAIN_DAILY = 2;
export const DEFAULT_CONVERT_DAILY = 20;
export const TRAIN_EPOCHS = 40;
// Versões fixadas (evita custo/variação por versão nova sem revisão). Podem ser trocadas por variável.
export const TRAIN_MODEL = 'replicate/train-rvc-model';
export const TRAIN_VERSION = '0397d5e28c9b54665e1e5d29d5cf4f722a7b89ec20e9dbf31487235305b1a101';
export const INFER_MODEL = 'meta-innovation/ultimate_rvc';
export const INFER_VERSION = '5598e8029cbd7e9268db84ce8c2a334eab6ebccbee67b78cf63c38e964379e15';
export const REPLICATE_API = 'https://api.replicate.com/v1';
export const KITS_API = 'https://arpeggi.io/api/kits/v1';
export const AI_NOTICE = 'Voz gerada por IA. Use apenas a sua própria voz ou vozes com autorização por escrito.';
export const ENGINE_LABEL = { treino: 'Motor Treino', rapido: 'Motor Rápido' };

const DEFAULT_ORIGINS = [
  'https://apsaudio.com.br',
  'https://www.apsaudio.com.br',
  'https://anderclaypereira87-cloud.github.io'
];

// ---------- utilidades HTTP / CORS ----------
export function allowedOrigin(origin, env = {}, requestOrigin = '') {
  if (!origin) return '';
  if (requestOrigin && origin === requestOrigin) return origin;
  const extra = String(env.EXTRA_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  if (DEFAULT_ORIGINS.includes(origin) || extra.includes(origin)) return origin;
  try {
    const u = new URL(origin);
    if (u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1')) return origin;
  } catch { /* inválido */ }
  return null; // origem presente mas não permitida
}

export function corsHeaders(origin) {
  if (!origin) return {};
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-credentials': 'true',
    'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
    'access-control-allow-headers': 'content-type, x-aps-filename, x-aps-duration, x-aps-kind',
    'access-control-expose-headers': 'content-type, content-length, x-aps-duration',
    'access-control-max-age': '600',
    vary: 'Origin'
  };
}

export function json(data, status = 200, origin = '') {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      ...corsHeaders(origin)
    }
  });
}

export const err = (status, error, extra = {}, origin = '') => json({ ok: false, error, ...extra }, status, origin);

// ---------- Cloudflare Access (JWT RS256) ----------
const b64u = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=')), c => c.charCodeAt(0));
let certCache = { at: 0, origin: '', keys: [] };
export function _resetCertCache() { certCache = { at: 0, origin: '', keys: [] }; }

export async function verifyAccessJwt(jwt, env, fetchImpl = fetch) {
  if (!jwt || !env.CF_ACCESS_AUD || !env.CF_ACCESS_TEAM_DOMAIN) return null;
  try {
    const p = jwt.split('.');
    if (p.length !== 3) return null;
    const h = JSON.parse(new TextDecoder().decode(b64u(p[0])));
    const c = JSON.parse(new TextDecoder().decode(b64u(p[1])));
    if (h.alg !== 'RS256' || !c.exp || c.exp * 1000 < Date.now()) return null;
    if (!(Array.isArray(c.aud) ? c.aud : [c.aud]).includes(env.CF_ACCESS_AUD)) return null;
    const origin = new URL(env.CF_ACCESS_TEAM_DOMAIN).origin;
    if (c.iss !== origin) return null;
    if (certCache.origin !== origin || Date.now() - certCache.at > 3600e3 || !certCache.keys.some(k => k.kid === h.kid)) {
      const r = await fetchImpl(origin + '/cdn-cgi/access/certs');
      const j = await r.json();
      certCache = { at: Date.now(), origin, keys: j.keys || [] };
    }
    const k = certCache.keys.find(x => x.kid === h.kid);
    if (!k) return null;
    const key = await crypto.subtle.importKey('jwk', k, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64u(p[2]), new TextEncoder().encode(p[0] + '.' + p[1]));
    if (!ok) return null;
    const allow = String(env.ALLOWED_EMAILS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    if (allow.length && !allow.includes(String(c.email || '').toLowerCase())) return null;
    return { email: c.email || null, sub: c.sub || null };
  } catch {
    return null;
  }
}

function devBypass(request, env) {
  if (env.DEV_ALLOW_NO_ACCESS !== 'true') return false;
  const host = new URL(request.url).hostname;
  return host === 'localhost' || host === '127.0.0.1';
}

// ---------- validação de áudio ----------
export function sniffAudio(buf) {
  const b = new Uint8Array(buf.slice ? buf.slice(0, 16) : buf);
  const s = (i, n) => String.fromCharCode(...b.slice(i, i + n));
  if (s(0, 4) === 'RIFF' && s(8, 4) === 'WAVE') return { ext: 'wav', type: 'audio/wav' };
  if (s(0, 3) === 'ID3' || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0 && (b[1] & 0x06) !== 0)) return { ext: 'mp3', type: 'audio/mpeg' };
  if (s(4, 4) === 'ftyp') return { ext: 'm4a', type: 'audio/mp4' };
  if (s(0, 4) === 'fLaC') return { ext: 'flac', type: 'audio/flac' };
  if (b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04) return { ext: 'zip', type: 'application/zip' };
  return null;
}

export function wavDurationSeconds(buf) {
  try {
    const dv = new DataView(buf instanceof ArrayBuffer ? buf : buf.buffer);
    if (dv.byteLength < 44) return null;
    let p = 12, byteRate = 0, dataLen = 0;
    while (p + 8 <= dv.byteLength) {
      const id = String.fromCharCode(dv.getUint8(p), dv.getUint8(p + 1), dv.getUint8(p + 2), dv.getUint8(p + 3));
      const len = dv.getUint32(p + 4, true);
      if (id === 'fmt ') byteRate = dv.getUint32(p + 16, true);
      if (id === 'data') { dataLen = Math.min(len, dv.byteLength - p - 8); break; }
      p += 8 + len + (len & 1);
    }
    return byteRate ? dataLen / byteRate : null;
  } catch { return null; }
}

// Conta entradas .wav dentro de um ZIP "store" gerado pelo APS (diretório central).
export function zipWavEntries(buf) {
  const u8 = new Uint8Array(buf), dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) {
    if (dv.getUint32(i, true) !== 0x06054b50) continue;
    const count = dv.getUint16(i + 10, true);
    let p = dv.getUint32(i + 16, true); const names = [];
    for (let n = 0; n < count && p + 46 <= u8.length; n++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      const nl = dv.getUint16(p + 28, true), el = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true);
      names.push(new TextDecoder().decode(u8.slice(p + 46, p + 46 + nl)));
      p += 46 + nl + el + cl;
    }
    return names.filter(x => /^dataset\/[^/]+\/[^/]+\.wav$/i.test(x));
  }
  return [];
}

export const KIND_RULES = {
  sample: { exts: ['wav', 'mp3', 'm4a', 'flac'], min: MIN_SAMPLE_SEC, max: MAX_SAMPLE_SEC },
  guide: { exts: ['wav', 'mp3', 'm4a', 'flac'], min: 1, max: MAX_GUIDE_SEC },
  dataset: { exts: ['zip'], min: MIN_SAMPLE_SEC, max: MAX_SAMPLE_SEC }
};

export function validateUpload({ kind, size, sniff, duration }) {
  const rule = KIND_RULES[kind];
  if (!rule) return 'Tipo de envio inválido. Use amostra, guia ou pacote de treino.';
  if (!size) return 'Arquivo vazio: nenhum dado chegou ao servidor.';
  if (size > MAX_UPLOAD) return `Arquivo grande demais (${(size / MB).toFixed(1)} MB). O limite é ${MAX_UPLOAD / MB} MB.`;
  if (!sniff || !rule.exts.includes(sniff.ext)) {
    return kind === 'dataset' ? 'Pacote de treino inválido. Volte ao passo 1 e prepare a amostra novamente.' : 'Formato não suportado. Envie WAV, MP3 ou M4A.';
  }
  if (Number.isFinite(duration) && duration > 0) {
    if (duration < rule.min) {
      return kind === 'guide' ? 'Áudio guia curto demais.' : `Áudio curto demais (${Math.round(duration)} s). Grave pelo menos ${rule.min} segundos — o ideal é de 2 a 10 minutos.`;
    }
    if (duration > rule.max) return `Áudio longo demais (${Math.round(duration / 60)} min). O máximo é ${Math.round(rule.max / 60)} minutos.`;
  }
  return null;
}

// ---------- utilidades ----------
export const newId = (p) => p + '_' + crypto.randomUUID().replace(/-/g, '').slice(0, 20);
export const validId = (id, p) => new RegExp('^' + p + '_[a-f0-9]{20}$').test(String(id || ''));
export function recifeDay(now = Date.now()) {
  return new Date(now - 3 * 3600e3).toISOString().slice(0, 10); // America/Recife (UTC-3, sem horário de verão)
}
export const clamp = (x, a, b, d) => { const n = Number(x); return Number.isFinite(n) ? Math.min(b, Math.max(a, n)) : d; };
export const cleanName = s => String(s || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 60);
const httpsUrl = x => { try { const u = new URL(x); return u.protocol === 'https:' && !u.username && !u.password; } catch { return false; } };

export function limits(env) {
  return {
    train: Math.max(0, parseInt(env.TRAIN_DAILY_LIMIT ?? DEFAULT_TRAIN_DAILY, 10) || 0),
    convert: Math.max(0, parseInt(env.CONVERT_DAILY_LIMIT ?? DEFAULT_CONVERT_DAILY, 10) || 0)
  };
}

export function engines(env) {
  return {
    treino: { label: ENGINE_LABEL.treino, configured: !!env.REPLICATE_API_TOKEN, canTrain: true, canConvert: true },
    rapido: { label: ENGINE_LABEL.rapido, configured: !!env.KITS_API_KEY, canTrain: false, canConvert: true }
  };
}

// ---------- armazenamento (KV + R2) ----------
async function kvGet(env, key, def) { const v = await env.VOICE_KV.get(key); if (v == null) return def; try { return JSON.parse(v); } catch { return def; } }
const kvPut = (env, key, val, opts) => env.VOICE_KV.put(key, JSON.stringify(val), opts);

export async function usage(env, kind, now = Date.now()) {
  return Number(await env.VOICE_KV.get(`count:${recifeDay(now)}:${kind}`)) || 0;
}
async function bumpUsage(env, kind, now = Date.now()) {
  const k = `count:${recifeDay(now)}:${kind}`;
  await env.VOICE_KV.put(k, String((Number(await env.VOICE_KV.get(k)) || 0) + 1), { expirationTtl: 3 * 86400 });
}
async function saveJob(env, job) {
  job.updatedAt = Date.now();
  await kvPut(env, 'job:' + job.id, job, { expirationTtl: 90 * 86400 });
  const idx = await kvGet(env, 'jobs:index', []);
  if (!idx.includes(job.id)) { idx.unshift(job.id); await kvPut(env, 'jobs:index', idx.slice(0, 60)); }
}
const getVoices = env => kvGet(env, 'voices', []);
const putVoices = (env, v) => kvPut(env, 'voices', v.slice(0, 100));

// ---------- erros de provedor → mensagens em português (sem nome de provedor) ----------
export function providerError(engine, status, detail = '') {
  const label = ENGINE_LABEL[engine] || 'Motor de voz';
  const d = String(detail || '').toLowerCase();
  if (status === 401 || status === 403) return { code: 'auth', http: 502, error: `A chave do ${label} foi recusada. Atualize o segredo no servidor e tente de novo.` };
  if (status === 402 || /insufficient|credit|billing|payment|saldo|balance/.test(d)) return { code: 'saldo', http: 402, error: `Sem saldo na conta do ${label}. Adicione créditos no painel do provedor e tente novamente. Nada foi cobrado agora.` };
  if (status === 429) return { code: 'limite_provedor', http: 429, error: `O ${label} está limitando pedidos agora. Aguarde um minuto e tente de novo.` };
  if (status === 413) return { code: 'tamanho', http: 413, error: `Arquivo grande demais para o ${label}.` };
  if (status === 404) return { code: 'nao_encontrado', http: 502, error: `O ${label} não encontrou o modelo ou o arquivo pedido.` };
  if (status === 422 || status === 400) return { code: 'entrada', http: 422, error: `O ${label} recusou os dados enviados. Verifique o áudio (formato e duração).` };
  return { code: 'provedor', http: 502, error: `O ${label} está indisponível no momento (${status || 'sem resposta'}). Tente mais tarde.` };
}

class ProviderErr extends Error {
  constructor(engine, status, detail) { const m = providerError(engine, status, detail); super(m.error); Object.assign(this, m, { engine, status }); }
}

// R2 exige tamanho conhecido para streams; sem content-length, lê em memória.
async function putFromResponse(env, key, r, opts) {
  const body = r.headers.get('content-length') ? r.body : await r.arrayBuffer();
  return env.VOICE_AUDIO.put(key, body, opts);
}

async function readJson(r) { try { return await r.json(); } catch { return {}; } }

// ---------- multipart em streaming (para arquivos grandes vindos do R2) ----------
export async function multipartBody(fields, file) {
  const boundary = '----apsvoz' + crypto.randomUUID().replace(/-/g, '');
  const enc = new TextEncoder();
  let head = '';
  for (const [k, v] of Object.entries(fields || {})) head += `--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`;
  head += `--${boundary}\r\nContent-Disposition: form-data; name="${file.field}"; filename="${file.name}"\r\nContent-Type: ${file.type}\r\n\r\n`;
  const pre = enc.encode(head), post = enc.encode(`\r\n--${boundary}--\r\n`);
  const total = pre.length + file.size + post.length;
  const contentType = 'multipart/form-data; boundary=' + boundary;
  if (typeof FixedLengthStream === 'function' && file.stream) {
    // eslint-disable-next-line no-undef
    const { readable, writable } = new FixedLengthStream(total);
    (async () => {
      const w = writable.getWriter();
      try { await w.write(pre); const rd = file.stream.getReader(); for (;;) { const { done, value } = await rd.read(); if (done) break; await w.write(value); } await w.write(post); await w.close(); }
      catch (e) { try { await w.abort(e); } catch { /* */ } }
    })();
    return { body: readable, contentType, length: total };
  }
  const bytes = file.bytes || new Uint8Array(await new Response(file.stream).arrayBuffer());
  return { body: new Blob([pre, bytes, post]), contentType, length: total };
}

// ---------- adaptador Motor Treino ----------
export const treino = {
  async call(env, path, init = {}) {
    const r = await fetch(REPLICATE_API + path, { ...init, headers: { Authorization: 'Bearer ' + env.REPLICATE_API_TOKEN, ...(init.headers || {}) } });
    const j = await readJson(r);
    if (!r.ok) throw new ProviderErr('treino', r.status, j.detail || j.error || j.title);
    return j;
  },
  async uploadFromR2(env, key, name, type) {
    const obj = await env.VOICE_AUDIO.get(key);
    if (!obj) throw Object.assign(new Error('Arquivo não encontrado no armazenamento do APS. Envie novamente.'), { http: 404, code: 'arquivo' });
    if (obj.size > MAX_PROVIDER_FILE) throw Object.assign(new Error('Arquivo acima de 100 MB para o Motor Treino.'), { http: 413, code: 'tamanho' });
    const mp = await multipartBody({}, { field: 'content', name, type, size: obj.size, stream: obj.body });
    const j = await this.call(env, '/files', { method: 'POST', headers: { 'content-type': mp.contentType, 'content-length': String(mp.length) }, body: mp.body });
    const url = j.urls?.get || j.url;
    if (!httpsUrl(url)) throw new ProviderErr('treino', 502, 'sem url');
    return url;
  },
  async startTraining(env, datasetUrl) {
    return this.call(env, '/predictions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'Cancel-After': '45m' },
      body: JSON.stringify({ version: env.TRAIN_VERSION || TRAIN_VERSION, input: { dataset_zip: datasetUrl, sample_rate: '40k', version: 'v2', f0method: 'rmvpe_gpu', epoch: TRAIN_EPOCHS } })
    });
  },
  async startConversion(env, { songUrl, modelUrl, pitch, fidelity }) {
    return this.call(env, '/predictions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'Cancel-After': '20m' },
      body: JSON.stringify({
        version: env.INFER_VERSION || INFER_VERSION,
        input: { song_input: songUrl, rvc_model: modelUrl, pitch, index_rate: +(0.2 + 0.7 * fidelity).toFixed(2), rms_mix_rate: 0.25, protect_rate: 0.33, f0_method: 'rmvpe', split_vocals: false, autotune_vocals: false, clean_vocals: false, output_format: 'mp3' }
      })
    });
  },
  async status(env, id) {
    const j = await this.call(env, '/predictions/' + encodeURIComponent(id));
    const out = typeof j.output === 'string' ? j.output : Array.isArray(j.output) ? j.output[0] : null;
    const map = { starting: 'na_fila', processing: 'processando', succeeded: 'pronto', failed: 'erro', canceled: 'cancelado' };
    return { status: map[j.status] || 'processando', outputUrl: httpsUrl(out) ? out : null, detail: j.error ? String(j.error).slice(0, 300) : null };
  },
  async check(env) { await this.call(env, '/account'); return true; }
};

// ---------- adaptador Motor Rápido ----------
export const rapido = {
  async call(env, path, init = {}) {
    const r = await fetch(KITS_API + path, { ...init, headers: { Authorization: 'Bearer ' + env.KITS_API_KEY, ...(init.headers || {}) } });
    const j = await readJson(r);
    if (!r.ok) throw new ProviderErr('rapido', r.status, j.message || j.error || JSON.stringify(j.errors || ''));
    return j;
  },
  async listModels(env) {
    const j = await this.call(env, '/voice-models?myModels=true&perPage=50&order=desc');
    return (j.data || []).map(m => ({ id: String(m.id), title: cleanName(m.title) || 'Voz ' + m.id }));
  },
  async startConversion(env, { key, name, type, modelId, pitch, fidelity }) {
    const obj = await env.VOICE_AUDIO.get(key);
    if (!obj) throw Object.assign(new Error('Áudio guia não encontrado. Envie novamente.'), { http: 404, code: 'arquivo' });
    const mp = await multipartBody(
      { voiceModelId: modelId, pitchShift: pitch, conversionStrength: fidelity.toFixed(2), modelVolumeMix: '0.5' },
      { field: 'soundFile', name, type, size: obj.size, stream: obj.body }
    );
    return this.call(env, '/voice-conversions', { method: 'POST', headers: { 'content-type': mp.contentType, 'content-length': String(mp.length) }, body: mp.body });
  },
  async status(env, id) {
    const j = await this.call(env, '/voice-conversions/' + encodeURIComponent(id));
    const map = { running: 'processando', success: 'pronto', error: 'erro', cancelled: 'cancelado' };
    const out = j.outputFileUrl || j.lossyOutputFileUrl;
    return { status: map[j.status] || 'processando', outputUrl: httpsUrl(out) ? out : null, detail: null };
  },
  async check(env) { await this.call(env, '/voice-models?myModels=true&perPage=1&order=desc'); return true; }
};

const ADAPTERS = { treino, rapido };

// ---------- rotas ----------
async function health(env, authed, deep, origin) {
  const storage = { kv: !!env.VOICE_KV, r2: !!env.VOICE_AUDIO, ok: false };
  if (storage.kv && storage.r2) {
    try { await env.VOICE_KV.get('health:ping'); await env.VOICE_AUDIO.head('health/ping'); storage.ok = true; } catch { storage.ok = false; }
  }
  const eng = engines(env);
  const out = {
    ok: true, service: SERVICE, brand: 'APS Voz Studio', authenticated: !!authed,
    engines: { treino: { label: eng.treino.label, configured: eng.treino.configured }, rapido: { label: eng.rapido.label, configured: eng.rapido.configured } },
    storage, paidJobsEnabled: env.PAID_JOBS_ENABLED !== 'false', notice: AI_NOTICE
  };
  if (authed) {
    out.limits = limits(env);
    if (storage.ok) out.usage = { train: await usage(env, 'train'), convert: await usage(env, 'convert') };
    if (deep) {
      // Checagens somente leitura (não criam jobs, não gastam créditos).
      const checks = {};
      for (const k of ['treino', 'rapido']) {
        if (!eng[k].configured) { checks[k] = { ok: false, reason: 'chave_ausente' }; continue; }
        try { await ADAPTERS[k].check(env); checks[k] = { ok: true }; }
        catch (e) { checks[k] = { ok: false, reason: e.code || 'erro', message: e.message }; }
      }
      out.checks = checks;
    }
  }
  return json(out, 200, origin);
}

function requireStorage(env, origin) {
  if (!env.VOICE_KV || !env.VOICE_AUDIO) return err(503, 'Armazenamento do APS Voz Studio não configurado no servidor (faltam os bindings VOICE_KV e VOICE_AUDIO).', { code: 'armazenamento' }, origin);
  return null;
}

async function guardPaid(env, kind, origin) {
  if (env.PAID_JOBS_ENABLED === 'false') return err(423, 'Processamento pausado pelo administrador (PAID_JOBS_ENABLED=false).', { code: 'pausado' }, origin);
  const lim = limits(env)[kind];
  const used = await usage(env, kind);
  if (used >= lim) {
    return err(429, kind === 'train'
      ? `Limite diário de criação de vozes atingido (${lim}/dia). Proteção contra gasto acidental — tente amanhã.`
      : `Limite diário de conversões atingido (${lim}/dia). Proteção contra gasto acidental — tente amanhã.`, { code: 'limite_diario', limit: lim, used }, origin);
  }
  return null;
}

async function upload(request, env, url, origin) {
  const kind = url.searchParams.get('kind') || request.headers.get('x-aps-kind') || '';
  if (!KIND_RULES[kind]) return err(400, 'Tipo de envio inválido. Use amostra, guia ou pacote de treino.', { code: 'tipo' }, origin);
  const len = Number(request.headers.get('content-length') || 0);
  if (len > MAX_UPLOAD) return err(413, `Arquivo grande demais (${(len / MB).toFixed(1)} MB). O limite é ${MAX_UPLOAD / MB} MB.`, { code: 'tamanho' }, origin);
  const buf = await request.arrayBuffer();
  const sniff = sniffAudio(buf);
  let duration = Number(request.headers.get('x-aps-duration') || url.searchParams.get('duration'));
  if (sniff?.ext === 'wav') duration = wavDurationSeconds(buf) ?? duration;
  let entries = 0;
  if (kind === 'dataset' && sniff?.ext === 'zip') {
    entries = zipWavEntries(buf).length;
    if (!entries) return err(400, 'Pacote de treino inválido: nenhum trecho de voz encontrado. Prepare a amostra novamente.', { code: 'pacote' }, origin);
  }
  const problem = validateUpload({ kind, size: buf.byteLength, sniff, duration: Number.isFinite(duration) ? duration : null });
  if (problem) return err(problem.includes('grande') ? 413 : 400, problem, { code: 'validacao' }, origin);
  const id = newId('up');
  const filename = cleanName(request.headers.get('x-aps-filename') || url.searchParams.get('filename') || `${kind}.${sniff.ext}`).replace(/[^\w.\- ]/g, '_') || `${kind}.${sniff.ext}`;
  await env.VOICE_AUDIO.put('uploads/' + id, buf, {
    httpMetadata: { contentType: sniff.type },
    customMetadata: { kind, ext: sniff.ext, filename, duration: Number.isFinite(duration) ? String(duration) : '' }
  });
  await kvPut(env, 'upload:' + id, { id, kind, ext: sniff.ext, type: sniff.type, filename, size: buf.byteLength, duration: Number.isFinite(duration) ? duration : null, entries, createdAt: Date.now() }, { expirationTtl: 30 * 86400 });
  return json({ ok: true, id, kind, size: buf.byteLength, duration: Number.isFinite(duration) ? duration : null, entries, audioUrl: kind === 'dataset' ? null : '/api/audio/uploads/' + id }, 201, origin);
}

async function listVoices(env, origin) {
  const voices = await getVoices(env);
  let remote = [], remoteError = null;
  if (env.KITS_API_KEY) {
    try { remote = await rapido.listModels(env); } catch (e) { remoteError = e.message; }
  }
  return json({ ok: true, voices, rapidoModels: remote, rapidoError: remoteError }, 200, origin);
}

async function createVoice(request, env, origin) {
  const body = await request.json().catch(() => ({}));
  const name = cleanName(body.name);
  if (name.length < 2) return err(400, 'Dê um nome à sua voz (2 a 60 caracteres).', { code: 'nome' }, origin);
  if (body.consent !== true) return err(400, 'Confirme que a voz é sua ou que você tem autorização para cloná-la.', { code: 'consentimento' }, origin);
  const voices = await getVoices(env);
  const mode = body.engine === 'rapido' ? 'rapido' : 'treino';

  if (mode === 'rapido') {
    if (!env.KITS_API_KEY) return err(424, 'Motor Rápido não configurado no servidor (chave ausente).', { code: 'chave_ausente' }, origin);
    const modelId = String(body.rapidoModelId || '');
    if (!/^\d{1,12}$/.test(modelId)) return err(400, 'Escolha um modelo de voz do Motor Rápido.', { code: 'modelo' }, origin);
    const v = { id: newId('voz'), name, status: 'pronta', engines: { rapido: { modelId } }, createdAt: Date.now() };
    voices.unshift(v); await putVoices(env, voices);
    return json({ ok: true, voice: v }, 201, origin);
  }

  if (!env.REPLICATE_API_TOKEN) return err(424, 'Motor Treino não configurado no servidor (chave ausente).', { code: 'chave_ausente' }, origin);
  if (body.confirmCost !== true) return err(400, 'Confirme o início do treino (pode consumir créditos da conta do motor).', { code: 'confirmacao' }, origin);
  if (voices.some(v => v.status === 'treinando')) return err(409, 'Já existe uma voz em treinamento. Aguarde terminar antes de criar outra.', { code: 'ocupado' }, origin);
  const up = await kvGet(env, 'upload:' + body.datasetId, null);
  if (!validId(body.datasetId, 'up') || !up || up.kind !== 'dataset') return err(400, 'Amostra de voz não encontrada. Volte ao passo 1 e envie sua voz.', { code: 'amostra' }, origin);
  const blocked = await guardPaid(env, 'train', origin); if (blocked) return blocked;

  const datasetUrl = await treino.uploadFromR2(env, 'uploads/' + up.id, 'dataset.zip', 'application/zip');
  const pred = await treino.startTraining(env, datasetUrl);
  await bumpUsage(env, 'train');
  const voice = { id: newId('voz'), name, status: 'treinando', engines: {}, sampleDuration: up.duration, createdAt: Date.now() };
  const job = { id: newId('job'), type: 'train', engine: 'treino', providerId: pred.id, status: 'na_fila', voiceId: voice.id, voiceName: name, createdAt: Date.now() };
  voice.jobId = job.id;
  voices.unshift(voice); await putVoices(env, voices); await saveJob(env, job);
  return json({ ok: true, voice, job: publicJob(job) }, 202, origin);
}

async function linkRapido(request, env, id, origin) {
  const body = await request.json().catch(() => ({}));
  const modelId = String(body.rapidoModelId || '');
  if (!/^\d{1,12}$/.test(modelId)) return err(400, 'Escolha um modelo de voz do Motor Rápido.', { code: 'modelo' }, origin);
  const voices = await getVoices(env), v = voices.find(x => x.id === id);
  if (!v) return err(404, 'Voz não encontrada.', { code: 'voz' }, origin);
  v.engines = { ...(v.engines || {}), rapido: { modelId } };
  if (v.status !== 'treinando') v.status = 'pronta';
  await putVoices(env, voices);
  return json({ ok: true, voice: v }, 200, origin);
}

async function deleteVoice(env, id, origin) {
  const voices = await getVoices(env), v = voices.find(x => x.id === id);
  if (!v) return err(404, 'Voz não encontrada.', { code: 'voz' }, origin);
  await putVoices(env, voices.filter(x => x.id !== id));
  if (v.engines?.treino?.modelKey) await env.VOICE_AUDIO.delete(v.engines.treino.modelKey);
  return json({ ok: true, deleted: id }, 200, origin);
}

export function pickEngine(voice, requested, env) {
  const avail = [];
  if (voice.engines?.rapido?.modelId && env.KITS_API_KEY) avail.push('rapido');
  if (voice.engines?.treino?.modelKey && env.REPLICATE_API_TOKEN) avail.push('treino');
  if (requested === 'rapido' || requested === 'treino') return avail.includes(requested) ? [requested, ...avail.filter(x => x !== requested)] : [];
  return avail; // auto: rápido primeiro, treino como alternativa
}

async function convert(request, env, origin) {
  const body = await request.json().catch(() => ({}));
  if (body.confirmCost !== true) return err(400, 'Confirme a conversão (pode consumir créditos da conta do motor).', { code: 'confirmacao' }, origin);
  const voices = await getVoices(env), voice = voices.find(v => v.id === body.voiceId);
  if (!voice) return err(404, 'Escolha uma voz salva antes de converter.', { code: 'voz' }, origin);
  if (voice.status === 'treinando') return err(409, 'Esta voz ainda está em treinamento. Aguarde ficar pronta.', { code: 'treinando' }, origin);
  const up = await kvGet(env, 'upload:' + body.guideId, null);
  if (!validId(body.guideId, 'up') || !up || up.kind !== 'guide') return err(400, 'Envie a guia cantada ou falada antes de converter.', { code: 'guia' }, origin);
  const order = pickEngine(voice, body.engine, env);
  if (!order.length) return err(424, 'Nenhum motor disponível para esta voz. Verifique a configuração do servidor.', { code: 'sem_motor' }, origin);
  const blocked = await guardPaid(env, 'convert', origin); if (blocked) return blocked;
  const pitch = Math.round(clamp(body.pitch, -12, 12, 0));
  const fidelity = clamp(body.fidelity, 0, 1, 0.7);
  const tried = [];
  for (const eng of order) {
    try {
      let pred;
      if (eng === 'rapido') {
        pred = await rapido.startConversion(env, { key: 'uploads/' + up.id, name: up.filename, type: up.type, modelId: voice.engines.rapido.modelId, pitch, fidelity });
      } else {
        const songUrl = await treino.uploadFromR2(env, 'uploads/' + up.id, up.filename, up.type);
        const modelUrl = await treino.uploadFromR2(env, voice.engines.treino.modelKey, 'modelo.zip', 'application/zip');
        pred = await treino.startConversion(env, { songUrl, modelUrl, pitch, fidelity });
      }
      await bumpUsage(env, 'convert');
      const job = { id: newId('job'), type: 'convert', engine: eng, providerId: String(pred.id), status: 'na_fila', voiceId: voice.id, voiceName: voice.name, guideId: up.id, pitch, fidelity, fallbackFrom: tried.length ? tried.map(t => t.engine) : undefined, createdAt: Date.now() };
      await saveJob(env, job);
      return json({ ok: true, job: publicJob(job) }, 202, origin);
    } catch (e) {
      tried.push({ engine: eng, code: e.code, message: e.message, http: e.http });
      // só tenta o outro motor quando a falha é do provedor (saldo, chave, limite, indisponível)
      if (!['saldo', 'auth', 'limite_provedor', 'provedor'].includes(e.code)) break;
    }
  }
  const last = tried[tried.length - 1];
  return err(last.http || 502, last.message, { code: last.code, tried: tried.map(t => ({ engine: ENGINE_LABEL[t.engine], code: t.code })) }, origin);
}

export function publicJob(job) {
  return {
    id: job.id, type: job.type, engine: job.engine, engineLabel: ENGINE_LABEL[job.engine], status: job.status,
    voiceId: job.voiceId, voiceName: job.voiceName, guideId: job.guideId || null, pitch: job.pitch, fidelity: job.fidelity,
    error: job.error || null, resultUrl: job.resultKey ? '/api/audio/' + job.resultKey : null,
    originalUrl: job.guideId ? '/api/audio/uploads/' + job.guideId : null, fallbackFrom: job.fallbackFrom || null,
    createdAt: job.createdAt, updatedAt: job.updatedAt, notice: job.type === 'convert' ? AI_NOTICE : undefined
  };
}

async function pollJob(env, id, origin) {
  if (!validId(id, 'job')) return err(400, 'ID de tarefa inválido.', { code: 'id' }, origin);
  const job = await kvGet(env, 'job:' + id, null);
  if (!job) return err(404, 'Tarefa não encontrada.', { code: 'tarefa' }, origin);
  if (['pronto', 'erro', 'cancelado'].includes(job.status)) return json({ ok: true, job: publicJob(job) }, 200, origin);
  let st;
  try { st = await ADAPTERS[job.engine].status(env, job.providerId); }
  catch (e) { return json({ ok: true, job: publicJob(job), warning: e.message }, 200, origin); }
  if (st.status === 'pronto') {
    if (!st.outputUrl) { job.status = 'erro'; job.error = 'O motor terminou sem devolver arquivo.'; }
    else {
      const r = await fetch(st.outputUrl);
      if (!r.ok) return json({ ok: true, job: publicJob(job), warning: 'Resultado pronto, mas ainda não foi possível copiá-lo. Tente atualizar.' }, 200, origin);
      if (job.type === 'train') {
        const key = 'models/' + job.voiceId + '.zip';
        await putFromResponse(env, key, r, { httpMetadata: { contentType: 'application/zip' } });
        const voices = await getVoices(env), v = voices.find(x => x.id === job.voiceId);
        if (v) { v.status = 'pronta'; v.engines = { ...(v.engines || {}), treino: { modelKey: key, trainedAt: Date.now() } }; await putVoices(env, voices); }
        job.status = 'pronto';
      } else {
        const ct = r.headers.get('content-type') || '';
        const ext = /wav/.test(ct) || /\.wav(\?|$)/i.test(st.outputUrl) ? 'wav' : /flac/.test(ct) ? 'flac' : 'mp3';
        const key = 'results/' + job.id + '.' + ext;
        await putFromResponse(env, key, r, { httpMetadata: { contentType: ext === 'wav' ? 'audio/wav' : ext === 'flac' ? 'audio/flac' : 'audio/mpeg' }, customMetadata: { ai: 'true', voice: job.voiceName || '' } });
        job.resultKey = key; job.status = 'pronto';
      }
    }
  } else if (st.status === 'erro' || st.status === 'cancelado') {
    job.status = st.status;
    job.error = job.type === 'train'
      ? 'O treino da voz falhou. Verifique se a amostra tem voz limpa, sem instrumental, com pelo menos 2 minutos.'
      : 'A conversão falhou. Use uma guia só com voz (sem instrumental) e tente de novo.';
    job.providerDetail = st.detail || undefined; // fica só no KV (interno)
    if (job.type === 'train') {
      const voices = await getVoices(env), v = voices.find(x => x.id === job.voiceId);
      if (v) { v.status = 'erro'; await putVoices(env, voices); }
    }
  } else job.status = st.status;
  await saveJob(env, job);
  return json({ ok: true, job: publicJob(job) }, 200, origin);
}

async function listJobs(env, origin) {
  const idx = await kvGet(env, 'jobs:index', []);
  const jobs = (await Promise.all(idx.slice(0, 30).map(id => kvGet(env, 'job:' + id, null)))).filter(Boolean).map(publicJob);
  return json({ ok: true, jobs }, 200, origin);
}

async function audio(env, key, origin) {
  if (!/^(uploads\/up_[a-f0-9]{20}|results\/job_[a-f0-9]{20}\.(mp3|wav|flac))$/.test(key)) return err(400, 'Arquivo inválido.', { code: 'arquivo' }, origin);
  const obj = await env.VOICE_AUDIO.get(key);
  if (!obj) return err(404, 'Arquivo não encontrado (pode ter expirado).', { code: 'arquivo' }, origin);
  return new Response(obj.body, {
    headers: {
      'content-type': obj.httpMetadata?.contentType || 'application/octet-stream',
      'cache-control': 'private, max-age=600',
      'x-content-type-options': 'nosniff',
      ...corsHeaders(origin)
    }
  });
}

function loginDone(url, env, origin) {
  const ret = url.searchParams.get('return') || '';
  try {
    const r = new URL(ret);
    if (allowedOrigin(r.origin, env)) return new Response(null, { status: 302, headers: { location: r.href, 'cache-control': 'no-store' } });
  } catch { /* sem retorno */ }
  return new Response('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>APS Voz Studio</title><body style="background:#0b0e17;color:#f5f0e6;font:16px system-ui;padding:24px"><h1 style="color:#e2bc76">APS Voz Studio</h1><p>Acesso confirmado. Volte para a página do APS Voz Studio e toque em “Testar conexão”.</p><p><a style="color:#e2bc76" href="https://apsaudio.com.br/voice-singer.html">Abrir APS Voz Studio</a></p></body>', { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', ...corsHeaders(origin) } });
}

// Página do estúdio servida pelo próprio Worker (mesma origem da API, atrás do Access):
// funciona no iPhone/Safari sem cookie de terceiros e sem preflight CORS.
export function studioPage(html, env = {}) {
  const site = String(env.SITE_ORIGIN || 'https://apsaudio.com.br').replace(/\/+$/, '');
  const inject = `<base href="${site}/"><script>window.APS_VOZ_API=location.origin;window.APS_VOZ_HOSTED=true;window.APS_VOZ_SITE=${JSON.stringify(site)};</script>`;
  return new Response(html.replace('<head>', '<head>' + inject), {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'strict-origin-when-cross-origin',
      'content-security-policy': `default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'; base-uri ${site}; form-action 'none'`
    }
  });
}

export async function handle(request, env = {}, opts = {}) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const origin = allowedOrigin(request.headers.get('Origin'), env, url.origin);
  if (origin === null) return new Response(JSON.stringify({ ok: false, error: 'Origem não permitida.' }), { status: 403, headers: { 'content-type': 'application/json' } });
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(origin) });

  const user = devBypass(request, env) ? { email: 'dev@localhost' } : await verifyAccessJwt(request.headers.get('Cf-Access-Jwt-Assertion'), env);

  if ((path === '/api/health' || path === '/health') && request.method === 'GET') return health(env, user, url.searchParams.get('deep') === '1', origin);
  if ((path === '/' || path === '/studio') && request.method === 'GET') {
    if (!opts.studioHtml) return new Response(null, { status: 302, headers: { location: 'https://apsaudio.com.br/voice-singer.html', 'cache-control': 'no-store' } });
    if (!user) return new Response('<!doctype html><meta charset="utf-8"><title>APS Voz Studio</title><p>Acesso restrito. Faça login pelo Cloudflare Access.</p>', { status: 401, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
    return studioPage(opts.studioHtml, env);
  }
  if (!user) return err(401, 'Faça login no APS Voz Studio para continuar.', { code: 'login', loginUrl: '/' }, origin);
  if (path === '/api/auth/login' && request.method === 'GET') return loginDone(url, env, origin);

  const missing = requireStorage(env, origin); if (missing) return missing;
  try {
    if (path === '/api/uploads' && request.method === 'POST') return await upload(request, env, url, origin);
    if (path === '/api/voices' && request.method === 'GET') return await listVoices(env, origin);
    if (path === '/api/voices' && request.method === 'POST') return await createVoice(request, env, origin);
    let m = path.match(/^\/api\/voices\/(voz_[a-f0-9]{20})$/);
    if (m && request.method === 'DELETE') return await deleteVoice(env, m[1], origin);
    m = path.match(/^\/api\/voices\/(voz_[a-f0-9]{20})\/delete$/); // POST simples (sem preflight CORS)
    if (m && request.method === 'POST') return await deleteVoice(env, m[1], origin);
    m = path.match(/^\/api\/voices\/(voz_[a-f0-9]{20})\/rapido$/);
    if (m && request.method === 'POST') return await linkRapido(request, env, m[1], origin);
    if (path === '/api/convert' && request.method === 'POST') return await convert(request, env, origin);
    if (path === '/api/jobs' && request.method === 'GET') return await listJobs(env, origin);
    m = path.match(/^\/api\/jobs\/([^/]+)$/);
    if (m && request.method === 'GET') return await pollJob(env, m[1], origin);
    if (path.startsWith('/api/audio/') && request.method === 'GET') return await audio(env, path.slice('/api/audio/'.length), origin);
    return err(404, 'Rota não encontrada.', { code: 'rota' }, origin);
  } catch (e) {
    if (e instanceof ProviderErr || e.http) return err(e.http || 502, e.message, { code: e.code || 'erro' }, origin);
    return err(500, 'Erro interno no APS Voz Studio. Tente de novo em instantes.', { code: 'interno' }, origin);
  }
}
