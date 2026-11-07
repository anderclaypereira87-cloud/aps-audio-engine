// Only APS session tokens belong in this client. The StemConsole key stays on the server.
export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
export const MAX_AUDIO_SECONDS = 600;
export const MODELS = {
  vocals: ['vocals', 'instrumental'],
  fast: ['vocals', 'drums', 'bass', 'other'],
  full: ['vocals', 'drums', 'bass', 'guitar', 'piano', 'other']
};
export const LABELS = {
  vocals: 'Voz', instrumental: 'Instrumental', drums: 'Bateria', bass: 'Baixo',
  guitar: 'Guitarra', piano: 'Teclado / Piano', other: 'Outros'
};

export class StemConsoleError extends Error {
  constructor(message, { status = 0, code = '', retryAfter = null } = {}) {
    super(message);
    this.name = 'StemConsoleError';
    Object.assign(this, { status, code, retryAfter });
  }
}

export function validateFile(file) {
  if (!file || !file.size) throw new Error('Escolha uma música antes de separar.');
  if (file.size > MAX_UPLOAD_BYTES) throw new Error('O envio ao StemConsole aceita arquivos de até 100 MB nesta integração.');
  if (!/\.(mp3|wav|flac|ogg|m4a|aac|wma)$/i.test(file.name)) {
    throw new Error('Escolha MP3, WAV, FLAC, OGG, M4A, AAC ou WMA.');
  }
}

export function verifySplit(data, model) {
  if (!data || typeof data.id !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(data.id)) {
    throw new Error('O StemConsole não retornou um identificador válido.');
  }
  if (data.status === 'done') {
    const expected = MODELS[model];
    const names = Array.isArray(data.stems) ? data.stems.map(s => s.name) : [];
    if (!expected || names.length !== expected.length || !expected.every(n => names.includes(n))) {
      throw new Error('As pistas recebidas não correspondem ao modo solicitado. Nenhuma pista foi inventada.');
    }
  }
  return data;
}

export function retryDelay(value) {
  if (!value) return 3000;
  const seconds = Number(value);
  const delay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - Date.now();
  return Number.isFinite(delay) ? Math.max(1000, delay) : 3000;
}

export function abortableDelay(ms, signal) {
  return new Promise((resolve, reject) => {
    const aborted = () => { clearTimeout(timer); reject(signal.reason || new DOMException('Cancelado', 'AbortError')); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', aborted); resolve(); }, ms);
    if (signal?.aborted) aborted();
    else signal?.addEventListener('abort', aborted, { once: true });
  });
}

export class StemConsoleClient {
  constructor({ baseUrl, getToken, fetchImpl = globalThis.fetch }) {
    const url = new URL(baseUrl, globalThis.location?.href);
    const local = ['localhost', '127.0.0.1'].includes(url.hostname);
    if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) throw new Error('A conexão deve usar HTTPS.');
    if (url.username || url.password || url.search || url.hash) throw new Error('Endereço de conexão inválido.');
    this.baseUrl = url.href.replace(/\/$/, '');
    this.getToken = getToken;
    this.fetchImpl = fetchImpl.bind(globalThis);
  }

  async request(path, { signal, anonymous = false, ...options } = {}) {
    const headers = new Headers(options.headers);
    if (!anonymous) {
      const token = await this.getToken();
      if (!token) throw new StemConsoleError('Entre na sua conta do APS para usar o StemConsole.', { status: 401 });
      headers.set('Authorization', 'Bearer ' + token);
    }
    const response = await this.fetchImpl(this.baseUrl + path, { ...options, headers, signal, cache: 'no-store' });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      const defaults = {
        401: 'Sua sessão expirou. Entre novamente no APS.',
        403: 'O StemConsole está liberado para teste pela conta do dono do APS.',
        402: 'O plano ou os créditos do StemConsole não permitem esta separação.',
        413: 'Arquivo acima do limite de envio de 100 MB.',
        429: 'Limite temporário do StemConsole. Aguarde antes de tentar novamente.',
        503: 'A conexão com o StemConsole aguarda ativação.'
      };
      throw new StemConsoleError(defaults[response.status] || data.message || 'Não foi possível acessar o StemConsole.', {
        status: response.status, code: data.error || '', retryAfter: response.headers.get('Retry-After')
      });
    }
    return response;
  }

  async config(signal) { return (await this.request('/config', { signal, anonymous: true })).json(); }
  async account(signal) { return (await this.request('/account', { signal })).json(); }

  async start(file, model, idempotencyKey, signal) {
    validateFile(file);
    if (!MODELS[model]) throw new Error('Modo de separação inválido.');
    const form = new FormData();
    form.set('file', file, file.name);
    form.set('model', model);
    form.set('name', file.name.replace(/\.[^.]+$/, '').slice(0,160));
    const response = await this.request('/splits', {
      method: 'POST', body: form, signal, headers: { 'Idempotency-Key': idempotencyKey }
    });
    return verifySplit(await response.json(), model);
  }

  async status(id, model, signal) {
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(id)) throw new Error('Identificador inválido.');
    return verifySplit(await (await this.request('/splits/' + encodeURIComponent(id), { signal })).json(), model);
  }

  async wait(id, model, { signal, onStatus, delay = abortableDelay, timeoutMs = 45 * 60 * 1000 } = {}) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      let split;
      try { split = await this.status(id, model, signal); }
      catch (error) {
        if (error.status !== 429) throw error;
        onStatus?.({ id, status: 'rate_limited' });
        await delay(Math.min(retryDelay(error.retryAfter), Math.max(0, deadline - Date.now())), signal);
        continue;
      }
      onStatus?.(split);
      if (split.status === 'done') return split;
      if (split.status === 'failed') throw new Error('O StemConsole não concluiu a separação. Acompanhe a música na sua conta antes de reenviar.');
      if (!['queued', 'processing'].includes(split.status)) throw new Error('Estado de separação desconhecido. Retome o acompanhamento antes de reenviar.');
      await delay(3000, signal);
    }
    throw new Error('O acompanhamento atingiu o tempo limite. Retome para consultar a mesma separação, sem enviar de novo.');
  }

  async stem(id, name, signal) {
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(id) || !Object.hasOwn(LABELS, name)) throw new Error('Pista inválida.');
    const response = await this.request('/splits/' + encodeURIComponent(id) + '/stems/' + name, { signal });
    const type = (response.headers.get('Content-Type') || '').split(';')[0];
    if (!['audio/mpeg', 'audio/mp3', 'application/octet-stream'].includes(type)) throw new Error('O serviço não retornou um arquivo de áudio MP3.');
    const blob = await response.blob();
    if (!blob.size) throw new Error('A pista recebida está vazia.');
    return new Blob([blob], { type: 'audio/mpeg' });
  }
}
