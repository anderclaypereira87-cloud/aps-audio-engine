/* APS Arranjo — cria um áudio novo a partir de uma gravação.
   Aviso obrigatório: nunca apresentar o resultado como a gravação original. */
const PROD_API = 'https://aps-arranjo.aps-audio.workers.dev';
const API_BASE = (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
  ? `${location.protocol}//${location.hostname}:8788`
  : PROD_API;
const NOTICE = 'APS Arranjo: áudio gerado por IA. É uma criação nova, não a sua gravação original.';
const MAX_AUDIO = 10 * 1024 * 1024;
const MAX_DURATION_SEC = 480;

const $ = (id) => document.getElementById(id);

let current = null;
let objectUrl = null;
let origPreviewUrl = null;
let audioFile = null;
let audioDuration = null;
let busy = false;
let transferring = false;

function setStatus(msg, isError) {
  const el = $('status');
  el.textContent = msg;
  el.classList.toggle('err', !!isError);
}

function revokeUrl() {
  if (objectUrl) {
    URL.revokeObjectURL(objectUrl);
    objectUrl = null;
  }
}

function revokeOrig() {
  if (origPreviewUrl) {
    URL.revokeObjectURL(origPreviewUrl);
    origPreviewUrl = null;
  }
}

function formatDuration(seconds) {
  const total = Math.max(0, Math.round(seconds));
  const m = Math.floor(total / 60);
  const s = String(total % 60).padStart(2, '0');
  return m + ' min ' + s + ' s';
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function selectedModo() {
  return document.querySelector('input[name="modo"]:checked')?.value || 'nova';
}

function syncModo() {
  const modo = selectedModo();
  $('tipoField').hidden = modo !== 'instrumento';
}

function decodeDuration(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const audio = new Audio();
    audio.preload = 'metadata';
    const done = (val) => {
      audio.src = '';
      URL.revokeObjectURL(url);
      resolve(val);
    };
    audio.onloadedmetadata = () => done(Number.isFinite(audio.duration) ? audio.duration : null);
    audio.onerror = () => done(null);
    audio.src = url;
  });
}

async function fileToMp3(file) {
  const mime = (file.type || '').toLowerCase();
  const name = (file.name || '').toLowerCase();
  if (mime.includes('mpeg') || mime.includes('mp3') || name.endsWith('.mp3') || mime.includes('mp4') || name.endsWith('.m4a')) {
    return file;
  }
  if (!window.APSShare?.mp3) throw Error('Este áudio precisa estar em MP3 ou M4A. Converta no aparelho ou use outro arquivo.');
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const buf = await ctx.decodeAudioData(await file.arrayBuffer());
  try { await ctx.close(); } catch { /* ignore */ }
  const blob = await window.APSShare.mp3(buf, { kbps: 192 });
  return new File([blob], (file.name || 'audio').replace(/\.[^.]+$/, '') + '.mp3', { type: 'audio/mpeg' });
}

async function loadFile(file) {
  audioFile = null;
  audioDuration = null;
  $('fileInfo').hidden = true;
  $('origPreview').hidden = true;
  $('origPreview').removeAttribute('src');
  revokeOrig();
  if (!file) return;
  if (file.size > MAX_AUDIO) {
    setStatus('O arquivo é grande demais. Envie um áudio de até 10 MB.', true);
    $('audioFile').value = '';
    return;
  }
  audioDuration = await decodeDuration(file);
  if (audioDuration && audioDuration > MAX_DURATION_SEC) {
    setStatus('O áudio pode ter no máximo 8 minutos.', true);
    $('audioFile').value = '';
    return;
  }
  audioFile = file;
  origPreviewUrl = URL.createObjectURL(file);
  $('origPreview').src = origPreviewUrl;
  $('origPreview').hidden = false;
  const dur = audioDuration ? ' · ' + formatDuration(audioDuration) : '';
  $('fileInfo').hidden = false;
  $('fileInfo').textContent = 'Original: ' + (file.name || 'áudio') + ' · ' + formatSize(file.size) + dur + '. Este arquivo não será alterado.';
  setStatus('Áudio original carregado. Escolha o tipo de arranjo e crie uma versão nova com IA.');
}

async function pollTask(id, tipo) {
  const start = Date.now();
  while (Date.now() - start < 10 * 60 * 1000) {
    const res = await fetch(API_BASE + '/tarefa/' + encodeURIComponent(id) + '?tipo=' + encodeURIComponent(tipo));
    const data = await res.json().catch(() => ({}));
    if (!res.ok && data.status !== 'gerando' && data.status !== 'preparando' && data.status !== 'fila') {
      throw Error(data.error || 'Não foi possível consultar o arranjo agora.');
    }
    if (data.status === 'pronto' && data.resultados?.length) return data;
    if (data.status === 'falhou') throw Error(data.error || 'Não foi possível criar o arranjo agora.');
    const elapsed = Math.round((Date.now() - start) / 1000);
    setStatus('A IA está criando um áudio novo… ' + elapsed + ' s. A sua gravação original permanece como está.');
    await new Promise((r) => setTimeout(r, 4000));
  }
  throw Error('O arranjo demorou demais. Tente novamente em instantes.');
}

async function gerar() {
  if (busy) return;
  const modo = selectedModo();
  const pedido = $('pedido').value.trim();
  const letra = $('letra').value.trim();
  if (modo === 'estender' && !letra) {
    setStatus('Para estender a música, escreva a letra que deve continuar.', true);
    return;
  }
  if ((modo === 'acompanhar' || modo === 'instrumento' || modo === 'estender' || modo === 'nova') && !audioFile && !pedido) {
    setStatus('Envie um áudio ou descreva o que você quer ouvir.', true);
    return;
  }
  if ((modo === 'acompanhar' || modo === 'instrumento' || modo === 'estender') && !audioFile) {
    setStatus('Envie o áudio de partida para este tipo de arranjo.', true);
    return;
  }

  busy = true;
  $('gerar').disabled = true;
  $('baixar').disabled = true;
  $('abrirDaw').disabled = true;
  $('audioFile').disabled = true;
  setStatus('Enviando o áudio e pedindo um arranjo novo…');
  try {
    let arquivoId = '';
    let finalidade = 'audio';
    if (audioFile) {
      if (modo === 'nova' && !letra) finalidade = 'instrumental';
      if (modo === 'nova' && letra) finalidade = 'referencia';
      const encoded = await fileToMp3(audioFile);
      const form = new FormData();
      form.append('file', encoded, encoded.name);
      form.append('finalidade', finalidade === 'referencia' ? 'referencia' : finalidade);
      const up = await fetch(API_BASE + '/enviar', { method: 'POST', body: form });
      const upData = await up.json().catch(() => ({}));
      if (!up.ok || !upData.ok) throw Error(upData.error || 'Não foi possível enviar o áudio.');
      arquivoId = upData.arquivoId;
    }
    const body = { modo, pedido, letra, arquivoId, finalidade };
    if (modo === 'instrumento') body.tipoPista = $('tipoPista').value;
    if (modo === 'estender' && audioDuration) body.extendEm = Math.max(8, audioDuration - 2);
    const gen = await fetch(API_BASE + '/gerar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const genData = await gen.json().catch(() => ({}));
    if (!gen.ok || !genData.ok) throw Error(genData.error || 'Não foi possível criar o arranjo agora.');
    const done = await pollTask(genData.id, genData.tipo || 'musica');
    const first = done.resultados[0];
    if (!first?.url) throw Error('A resposta não trouxe o áudio gerado.');
    const res = await fetch(first.url);
    if (!res.ok) throw Error('Não foi possível baixar o áudio gerado.');
    const blob = await res.blob();
    if (!blob.size) throw Error('O áudio gerado veio vazio.');
    revokeUrl();
    objectUrl = URL.createObjectURL(blob);
    current = {
      blob,
      url: objectUrl,
      name: 'APS Arranjo IA',
      mime: blob.type || 'audio/mpeg',
      notice: done.notice || NOTICE
    };
    $('player').src = objectUrl;
    $('player').hidden = false;
    $('baixar').disabled = false;
    $('abrirDaw').disabled = false;
    setStatus('Arranjo pronto. Isto é um áudio novo, gerado por IA — não é a sua gravação original.');
  } catch (e) {
    setStatus(e.message || 'Não foi possível criar o arranjo agora.', true);
  } finally {
    busy = false;
    $('gerar').disabled = false;
    $('audioFile').disabled = false;
  }
}

function baixar() {
  if (!current?.blob) {
    setStatus('Crie um arranjo primeiro.', true);
    return;
  }
  const ext = (current.mime || '').includes('wav') ? 'wav' : 'mp3';
  const a = document.createElement('a');
  const href = URL.createObjectURL(current.blob);
  a.href = href;
  a.download = 'APS-Arranjo-IA.' + ext;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 2000);
  setStatus('Download iniciado. Lembrete: este arquivo é uma criação de IA, não a sua gravação original.');
}

async function abrirDaw() {
  if (transferring || !current?.blob) return;
  transferring = true;
  $('abrirDaw').disabled = true;
  $('baixar').disabled = true;
  setStatus('Abrindo o arranjo na DAW como uma pista nova…');
  let db;
  try {
    if (!window.indexedDB) throw Error('Este navegador não permite a transferência automática.');
    const ext = (current.mime || '').includes('wav') ? 'wav' : 'mp3';
    const stems = [{
      id: 'other',
      name: 'APS Arranjo IA.' + ext,
      type: current.mime || 'audio/mpeg',
      blob: current.blob
    }];
    db = await new Promise((resolve, reject) => {
      const r = indexedDB.open('aps-stems-transfer-v1', 1);
      r.onupgradeneeded = () => {
        if (!r.result.objectStoreNames.contains('sessions')) r.result.createObjectStore('sessions');
      };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    const row = {
      id: Date.now() + '-' + Math.random().toString(36).slice(2),
      name: 'APS Arranjo IA',
      stems,
      createdAt: Date.now()
    };
    await new Promise((resolve, reject) => {
      const tx = db.transaction('sessions', 'readwrite');
      tx.objectStore('sessions').put(row, 'latest');
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || Error('Não foi possível salvar o arranjo para abrir no estúdio.'));
    });
    location.href = './daw.html?modulo=gravacao&importStems=1&v=363';
  } catch (e) {
    setStatus('Não foi possível abrir na DAW: ' + (e.message || 'tente novamente. Você ainda pode baixar o arquivo.'), true);
    transferring = false;
    $('abrirDaw').disabled = false;
    $('baixar').disabled = false;
  } finally {
    db?.close();
  }
}

function init() {
  $('notice').textContent = NOTICE;
  document.querySelectorAll('input[name="modo"]').forEach((el) => el.addEventListener('change', syncModo));
  syncModo();
  $('audioFile').addEventListener('change', (ev) => loadFile(ev.target.files?.[0] || null));
  $('gerar').addEventListener('click', gerar);
  $('baixar').addEventListener('click', baixar);
  $('abrirDaw').addEventListener('click', abrirDaw);
}

init();
