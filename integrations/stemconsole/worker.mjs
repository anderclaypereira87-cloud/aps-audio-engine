// Mount in the EXISTING APS payments Worker, before its normal route handling.
// Neither this file nor the browser receives a committed provider credential.
const API = 'https://stemconsole.ai/api/v1';
const APS_STATUS = 'https://aps-pagamentos.aps-audio.workers.dev/status';
const PREFIX = '/stemconsole';
const MAX_BODY = 100 * 1024 * 1024 + 64 * 1024;
const NAMES = new Set(['vocals', 'instrumental', 'drums', 'bass', 'other', 'guitar', 'piano']);
const DEFAULT_ORIGINS = ['https://apsaudio.com.br', 'https://www.apsaudio.com.br'];

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), { status, headers: {
    'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra
  } });
}

function apiError(message, status, error) { return json({ error, message }, status); }

async function owner(request, fetchImpl) {
  const authorization = request.headers.get('Authorization');
  if (!authorization?.startsWith('Bearer ') || authorization.length > 8192) return false;
  const result = await fetchImpl(APS_STATUS, {
    headers: { Authorization: authorization, Accept: 'application/json' },
    redirect: 'error', signal: AbortSignal.timeout(15000)
  });
  if (!result.ok) return false;
  return (await result.json()).owner === true;
}

function redact(value, key) {
  if (typeof value === 'string') return key ? value.split(key).join('[redacted]') : value;
  if (Array.isArray(value)) return value.map(v => redact(v, key));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k,v]) => [k, redact(v, key)]));
  return value;
}

function allowedDownload(value, env) {
  const url = new URL(value);
  const hosts = ['stemconsole.ai', ...(env.STEMCONSOLE_DOWNLOAD_HOSTS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean)];
  if (url.protocol !== 'https:' || url.username || url.password || url.port && url.port !== '443' ||
      !hosts.includes(url.hostname.toLowerCase()) && !url.hostname.toLowerCase().endsWith('.stemconsole.ai')) {
    throw new Error('download_host_not_allowed');
  }
  return url.href;
}

function limitedStream(stream) {
  let size = 0;
  return stream.pipeThrough(new TransformStream({ transform(chunk, controller) {
    size += chunk.byteLength;
    if (size > MAX_BODY) throw new Error('body_too_large');
    controller.enqueue(chunk);
  } }));
}

async function provider(path, env, fetchImpl, options = {}) {
  const headers = new Headers(options.headers);
  headers.set('Authorization', 'Bearer ' + env.STEMCONSOLE_API_KEY);
  headers.set('Accept', 'application/json');
  return fetchImpl(API + path, { ...options, headers, redirect: 'error', signal: AbortSignal.timeout(120000) });
}

async function providerJson(response, env) {
  let data;
  try { data = await response.json(); }
  catch { return apiError('O StemConsole retornou uma resposta inválida.', 502, 'invalid_provider_response'); }
  if (!response.ok) {
    const status = [400, 402, 404, 413, 422, 429].includes(response.status) ? response.status : 502;
    const headers = {};
    if (response.headers.get('Retry-After')) headers['Retry-After'] = response.headers.get('Retry-After');
    return json({ error: /^[a-z0-9_]+$/i.test(data.error) ? data.error : 'provider_error',
      message: 'Não foi possível concluir a solicitação no StemConsole.' }, status, headers);
  }
  return json(redact(data, env.STEMCONSOLE_API_KEY), response.status);
}

async function download(id, name, env, fetchImpl) {
  // Resolve the link from the authenticated provider response, never from a client URL.
  const result = await provider('/splits/' + id, env, fetchImpl);
  if (!result.ok) return providerJson(result, env);
  const split = await result.json();
  if (split.status !== 'done') return apiError('A separação ainda não terminou.', 409, 'split_not_ready');
  const stem = split.stems?.find(s => s.name === name);
  if (!stem?.mp3_url) return apiError('A pista MP3 não está disponível.', 404, 'stem_not_found');
  let url = allowedDownload(stem.mp3_url, env);
  let audio;
  for (let hop = 0; hop < 4; hop++) {
    // Signed download links do not get the StemConsole API key or the APS token.
    audio = await fetchImpl(url, { redirect: 'manual', signal: AbortSignal.timeout(120000) });
    if (audio.status >= 300 && audio.status < 400) {
      const location = audio.headers.get('Location');
      if (!location) return apiError('Redirecionamento de áudio inválido.', 502, 'bad_audio_redirect');
      await audio.body?.cancel();
      url = allowedDownload(new URL(location, url).href, env);
    } else break;
  }
  if (!audio.ok) return apiError('Não foi possível baixar a pista.', 502, 'audio_unavailable');
  const type = (audio.headers.get('Content-Type') || '').split(';')[0].toLowerCase();
  if (!['audio/mpeg', 'audio/mp3', 'application/octet-stream'].includes(type)) {
    await audio.body?.cancel();
    return apiError('O serviço não retornou um arquivo MP3.', 502, 'invalid_audio');
  }
  return new Response(audio.body, { headers: {
    'Content-Type': 'audio/mpeg', 'Content-Disposition': 'attachment; filename="' + name + '.mp3"',
    'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff'
  } });
}

/** Returns null for unrelated routes, so the existing Worker continues normally. */
export async function handleStemConsole(request, env, { fetchImpl = globalThis.fetch, authorize } = {}) {
  const path = new URL(request.url).pathname;
  if (path !== PREFIX && !path.startsWith(PREFIX + '/')) return null;
  const origin = request.headers.get('Origin');
  const origins = (env.STEMCONSOLE_ALLOWED_ORIGINS || DEFAULT_ORIGINS.join(',')).split(',').map(s => s.trim());
  if (origin && !origins.includes(origin)) return apiError('Origem não autorizada.', 403, 'origin_not_allowed');
  const cors = response => {
    const headers = new Headers(response.headers);
    headers.set('Cache-Control', 'private, no-store');
    headers.set('Vary', 'Origin');
    if (origin) headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type, Idempotency-Key');
    headers.set('Access-Control-Expose-Headers', 'Retry-After, Content-Disposition');
    return new Response(response.body, { status: response.status, headers });
  };
  if (request.method === 'OPTIONS') return cors(new Response(null, { status: 204 }));
  const enabled = env.STEMCONSOLE_ENABLED === 'true' && !!env.STEMCONSOLE_API_KEY;
  if (path === PREFIX + '/config' && request.method === 'GET') {
    return cors(json({ enabled, provider: 'stemconsole', ownerOnly: true, maxUploadBytes: MAX_BODY - 64 * 1024, maxSeconds: 600 }));
  }
  if (!enabled) return cors(apiError('A conexão com o StemConsole aguarda ativação.', 503, 'not_configured'));
  if (!['GET','POST'].includes(request.method)) return cors(apiError('Método não permitido.', 405, 'method_not_allowed'));
  try {
    if (!await (authorize ? authorize(request) : owner(request, fetchImpl))) {
      return cors(apiError('Acesse com a conta do dono do APS para este teste.', 403, 'owner_required'));
    }
    if (path === PREFIX + '/account' && request.method === 'GET') {
      return cors(await providerJson(await provider('/me', env, fetchImpl), env));
    }
    if (path === PREFIX + '/splits' && request.method === 'POST') {
      const key = request.headers.get('Idempotency-Key') || '';
      if (!/^[a-zA-Z0-9_-]{16,64}$/.test(key)) return cors(apiError('Identificador de envio inválido.', 400, 'idempotency_key_required'));
      const type = request.headers.get('Content-Type') || '';
      if (!/^multipart\/form-data;\s*boundary=.+/i.test(type) || !request.body) {
        return cors(apiError('Envie um arquivo de áudio.', 400, 'file_required'));
      }
      if (Number(request.headers.get('Content-Length')) > MAX_BODY) {
        return cors(apiError('Arquivo acima de 100 MB.', 413, 'file_too_large'));
      }
      const response = await provider('/splits', env, fetchImpl, { method: 'POST',
        headers: { 'Content-Type': type, 'Idempotency-Key': key }, body: limitedStream(request.body), duplex: 'half' });
      return cors(await providerJson(response, env));
    }
    const stem = path.match(/^\/stemconsole\/splits\/([a-zA-Z0-9_-]{1,128})\/stems\/([a-z_]+)$/);
    if (stem && request.method === 'GET' && NAMES.has(stem[2])) return cors(await download(stem[1], stem[2], env, fetchImpl));
    const split = path.match(/^\/stemconsole\/splits\/([a-zA-Z0-9_-]{1,128})$/);
    if (split && request.method === 'GET') return cors(await providerJson(await provider('/splits/' + split[1], env, fetchImpl), env));
    return cors(apiError('Rota não encontrada.', 404, 'not_found'));
  } catch (error) {
    if (error.message === 'body_too_large' || error.cause?.message === 'body_too_large') {
      return cors(apiError('Arquivo acima de 100 MB.', 413, 'file_too_large'));
    }
    const code = error.message === 'download_host_not_allowed' ? 'download_host_not_allowed' : 'upstream_unavailable';
    return cors(apiError(code === 'download_host_not_allowed' ? 'O endereço de download precisa ser validado na configuração do servidor.' :
      'Não foi possível confirmar a resposta. Retome a mesma separação antes de reenviar.', 502, code));
  }
}
