import { StemConsoleClient, LABELS, MAX_AUDIO_SECONDS, validateFile } from './client.mjs';
import { SOURCES, zipBlobs } from '../../aps-sep-core.js?v=400';

const $ = id => document.getElementById(id);
const panel = $('scPanel');
const STORE = 'aps-stemconsole-pending-v1';
const client = new StemConsoleClient({
  baseUrl: window.APS_STEMCONSOLE_URL || (window.APS_PAY_URL || 'https://aps-pagamentos.aps-audio.workers.dev') + '/stemconsole',
  getToken: async () => { await window.APSPay?.session(); return window.APSPay?.token(); }
});
let ready = false, busy = false, controller, completed, pending = loadPending();
const blobs = new Map(), objectUrls = new Set();

function loadPending() { try { return JSON.parse(sessionStorage.getItem(STORE)) || null; } catch { return null; } }
function savePending(value) { pending = value; try { sessionStorage.setItem(STORE, JSON.stringify(value)); } catch {} }
function message(text, error = false) { $('scStatus').textContent = text; $('scStatus').classList.toggle('sc-error', error); }
function buttons() {
  $('scStart').disabled = !ready || busy;
  $('scResume').hidden = !pending?.id || !!completed;
  $('scResume').disabled = !ready || busy;
  $('scStop').disabled = !busy;
  $('scRefresh').disabled = busy;
  $('scModel').disabled = busy;
  $('scZip').disabled = busy || !completed;
  $('scMixer').disabled = busy || !completed;
  $('scDrums').disabled = busy || !completed;
}
function setBusy(value) {
  busy = value;
  panel.setAttribute('aria-busy', String(value));
  buttons();
  const local = $('start');
  if (local && window.APS6Stem) local.disabled = value || !window.APS6Stem.limits().local;
  $('apsChooseSong').disabled = value;
  $('song').disabled = value;
}

async function connect() {
  ready = false;
  buttons();
  message('Verificando conexão com o StemConsole…');
  try {
    const config = await client.config(AbortSignal.timeout(15000));
    if (!config.enabled) { message('StemConsole aguardando ativação. O processamento no aparelho está disponível abaixo.'); return; }
    await client.account(AbortSignal.timeout(20000));
    ready = true;
    message(pending?.id ? 'Conexão pronta. Você pode retomar a separação anterior sem reenviar.' : 'StemConsole conectado. Escolha a música acima e o modo de separação.');
  } catch (error) {
    message(error.status === 404 ? 'StemConsole aguardando ativação. O processamento no aparelho está disponível abaixo.' :
      error.status ? error.message : 'Não foi possível verificar a conexão com o StemConsole. Tente novamente.', true);
  } finally { buttons(); }
}

function duration(file, signal) {
  return new Promise((resolve, reject) => {
    const audio = document.createElement('audio'), url = URL.createObjectURL(file);
    const cleanup = () => { clearTimeout(timer); audio.onloadedmetadata = audio.onerror = null; audio.removeAttribute('src'); audio.load(); URL.revokeObjectURL(url); signal.removeEventListener('abort', aborted); };
    const finish = (error, seconds) => { cleanup(); error ? reject(error) : resolve(seconds); };
    const aborted = () => finish(signal.reason || new DOMException('Cancelado', 'AbortError'));
    const timer = setTimeout(() => finish(new Error('Não foi possível ler a duração. Tente um arquivo MP3 ou WAV.')), 15000);
    audio.preload = 'metadata';
    audio.onloadedmetadata = () => {
      const seconds = audio.duration;
      audio.onloadedmetadata = audio.onerror = null;
      finish(!Number.isFinite(seconds) || seconds <= 0 ? new Error('Não foi possível ler a duração da música.') : null, seconds);
    };
    audio.onerror = () => { audio.onloadedmetadata = audio.onerror = null; finish(new Error('Este navegador não conseguiu ler o áudio. Use MP3 ou WAV.')); };
    signal.addEventListener('abort', aborted, { once: true });
    if (signal.aborted) aborted(); else audio.src = url;
  });
}

function resetResult() {
  completed = null; blobs.clear();
  for (const url of objectUrls) URL.revokeObjectURL(url);
  objectUrls.clear();
  $('scResults').hidden = true;
  $('scTracks').replaceChildren();
}

async function follow(signal) {
  const split = await client.wait(pending.id, pending.model, { signal, onStatus: data => {
    const labels = { queued: 'Música na fila do StemConsole…', processing: 'StemConsole separando os instrumentos…', rate_limited: 'Aguardando o intervalo indicado pelo StemConsole…', done: 'Separação concluída.' };
    message(labels[data.status] || 'Consultando separação…');
  } });
  completed = split;
  render(split);
  message('Separação concluída: ' + split.stems.length + ' pistas recebidas do StemConsole.');
}

async function start() {
  if (!ready || busy) return;
  if (window.APS6Stem?.state().working) { message('Aguarde ou cancele o processamento no aparelho antes de enviar.', true); return; }
  const file = $('song').files[0], model = $('scModel').value;
  controller = new AbortController();
  try { validateFile(file); } catch (error) { message(error.message, true); return; }
  setBusy(true);
  try {
    message('Verificando a duração da música…');
    const seconds = await duration(file, controller.signal);
    if (seconds > MAX_AUDIO_SECONDS + 0.05) throw new Error('O StemConsole no APS aceita a música inteira com até 10 minutos. Recorte um arquivo maior antes de enviar.');
    const signature = [file.name, file.size, file.lastModified, model].join(':');
    if (pending?.signature !== signature) savePending({ signature, model, name: file.name, key: crypto.randomUUID(), id: null });
    resetResult();
    if (!pending.id) {
      message('Enviando a música completa ao StemConsole…');
      const split = await client.start(file, model, pending.key, controller.signal);
      savePending({ ...pending, id: split.id });
    }
    await follow(controller.signal);
  } catch (error) {
    message(controller.signal.aborted ? 'Acompanhamento pausado. O StemConsole pode continuar processando. Retome antes de enviar novamente.' : error.message, !controller.signal.aborted);
  } finally { setBusy(false); }
}

async function resume() {
  if (!ready || busy || !pending?.id) return;
  if (window.APS6Stem?.state().working) { message('Aguarde o processamento no aparelho antes de retomar.', true); return; }
  controller = new AbortController();
  resetResult(); setBusy(true);
  try { await follow(controller.signal); }
  catch (error) { message(controller.signal.aborted ? 'Acompanhamento pausado. Você pode retomar a mesma separação.' : error.message, !controller.signal.aborted); }
  finally { setBusy(false); }
}

async function getBlob(name) {
  if (!completed) throw new Error('Conclua a separação primeiro.');
  if (!blobs.has(name)) blobs.set(name, await client.stem(completed.id, name, controller?.signal));
  return blobs.get(name);
}

function filename(name) {
  const prefix = (pending?.name || 'APS').replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0,60);
  return prefix + '_' + name;
}
function download(blob, name) {
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  objectUrls.add(url);
  link.href = url; link.download = name; document.body.append(link); link.click(); link.remove();
  setTimeout(() => { URL.revokeObjectURL(url); objectUrls.delete(url); }, 60000);
}

function render(split) {
  $('scTracks').replaceChildren();
  split.stems.forEach(stem => {
    const card = document.createElement('article'); card.className = 'resultcard';
    const title = document.createElement('h3'); title.textContent = LABELS[stem.name];
    const note = document.createElement('p'); note.className = 'notice'; note.textContent = 'Pista separada pelo StemConsole · MP3';
    const actions = document.createElement('div'); actions.className = 'buttons';
    const listen = document.createElement('button'); listen.type = 'button'; listen.className = 'alt'; listen.textContent = 'Ouvir';
    listen.addEventListener('click', async () => {
      listen.disabled = true;
      try {
        const audio = document.createElement('audio'), url = URL.createObjectURL(await getBlob(stem.name));
        objectUrls.add(url); audio.controls = true; audio.src = url; audio.style.width = '100%';
        card.querySelector('audio')?.remove(); card.append(audio); await audio.play();
      } catch (error) { message(error.message, true); }
      finally { listen.disabled = false; }
    });
    const save = document.createElement('button'); save.type = 'button'; save.textContent = 'Baixar MP3';
    save.addEventListener('click', async () => {
      save.disabled = true;
      try { download(await getBlob(stem.name), filename(stem.name) + '.mp3'); }
      catch (error) { message(error.message, true); }
      finally { save.disabled = false; }
    });
    actions.append(listen, save); card.append(title, note, actions); $('scTracks').append(card);
  });
  $('scDrums').hidden = !split.stems.some(s => s.name === 'drums');
  $('scMixer').textContent = 'Enviar ' + split.stems.length + ' pistas ao mixer';
  $('scResults').hidden = false;
  buttons();
}

async function storeTransfer(database, store, value) {
  const db = await new Promise((resolve, reject) => {
    const req = indexedDB.open(database, 1);
    req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(store)) req.result.createObjectStore(store); };
    req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
  });
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readwrite'); tx.objectStore(store).put(value, 'latest');
      tx.oncomplete = resolve; tx.onerror = tx.onabort = () => reject(tx.error || new Error('Armazenamento insuficiente. Baixe as pistas individualmente.'));
    });
  } finally { db.close(); }
}

async function exportTracks(kind) {
  if (!completed || busy) return;
  setBusy(true);
  try {
    if (kind === 'drums') {
      await storeTransfer('aps-drum-separated-v1', 'pending', { blob: await getBlob('drums'), name: filename('drums') + '.mp3', source: 'stemconsole' });
      location.href = './bateria.html?importar=separador#aps-drum-analyzer';
      return;
    }
    const files = [];
    for (const stem of completed.stems) {
      message('Baixando ' + LABELS[stem.name] + ' para ' + (kind === 'zip' ? 'o ZIP…' : 'o mixer…'));
      files.push({ name: filename(stem.name) + '.mp3', type: SOURCES.find(s => s.key === stem.name)?.id || 'outros', blob: await getBlob(stem.name) });
    }
    if (kind === 'zip') { download(await zipBlobs(files), filename('stems') + '.zip'); message('ZIP pronto com as pistas recebidas do StemConsole.'); }
    else {
      await storeTransfer('aps-stems-transfer-v1', 'sessions', { stems: files, savedAt: Date.now() });
      location.href = './daw.html?modulo=mixagem&importStems=1';
    }
  } catch (error) { message(error.message, true); }
  finally { setBusy(false); }
}

$('scStart').addEventListener('click', start);
$('scResume').addEventListener('click', resume);
$('scRefresh').addEventListener('click', connect);
$('scStop').addEventListener('click', () => controller?.abort());
$('scZip').addEventListener('click', () => exportTracks('zip'));
$('scMixer').addEventListener('click', () => exportTracks('mixer'));
$('scDrums').addEventListener('click', () => exportTracks('drums'));
window.addEventListener('pagehide', () => { controller?.abort(); for (const url of objectUrls) URL.revokeObjectURL(url); });
connect();
