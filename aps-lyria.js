/* APS Audio Engine — criação de música com Google Lyria.
   Aviso obrigatório: nunca apresentar o resultado como gravação original. */
const API_BASE = 'https://aps-lyria.aps-audio.workers.dev';
const NOTICE = 'Música gerada por IA (Google Lyria), com marca d\'água SynthID';

const $ = (id) => document.getElementById(id);

let current = null;
let objectUrl = null;
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

function blobFromResult(data) {
  if (data.url) return null;
  if (!data.audioBase64) throw Error('A resposta não trouxe áudio.');
  const bin = atob(data.audioBase64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: data.mime || 'audio/mpeg' });
}

async function audioBlob() {
  if (!current) throw Error('Gere uma música primeiro.');
  if (current.blob) return current.blob;
  const res = await fetch(current.url);
  if (!res.ok) throw Error('Não foi possível baixar o áudio gerado.');
  const blob = await res.blob();
  if (!blob.size) throw Error('O áudio gerado veio vazio.');
  current.blob = blob;
  return blob;
}

async function gerar() {
  if (transferring) return;
  const prompt = $('prompt').value.replace(/\s+/g, ' ').trim();
  const estilo = $('estilo').value;
  const letra = $('letra').value.trim();
  const modo = $('modo').value === 'completa' ? 'completa' : 'clip';
  if (prompt.length < 8) {
    setStatus('Escreva o que você quer ouvir, com ritmo, instrumentos e clima.', true);
    return;
  }
  $('gerar').disabled = true;
  $('baixar').disabled = true;
  $('abrirDaw').disabled = true;
  $('abrirSeparador').disabled = true;
  setStatus(modo === 'completa' ? 'Criando a música completa… isso pode levar cerca de um minuto.' : 'Criando o clipe de 30 segundos…');
  $('player').hidden = true;
  $('lyricsBox').hidden = true;
  try {
    const res = await fetch(API_BASE + '/gerar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, estilo, letra, modo })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) throw Error(data.error || 'Não foi possível gerar a música.');
    revokeUrl();
    const localBlob = blobFromResult(data);
    current = {
      id: data.id,
      url: data.url || null,
      mime: data.mime || 'audio/mpeg',
      lyrics: data.lyrics || '',
      notice: data.notice || NOTICE,
      name: (prompt.slice(0, 40) || 'musica-ia').replace(/[^\w À-ÿ.-]+/g, ' ').trim() || 'musica-ia',
      blob: localBlob
    };
    if (!current.blob && current.url) {
      const fetched = await fetch(current.url);
      if (!fetched.ok) throw Error('A música foi criada, mas não deu para carregar o áudio.');
      current.blob = await fetched.blob();
    }
    if (current.blob) objectUrl = URL.createObjectURL(current.blob);
    const player = $('player');
    player.src = objectUrl || current.url;
    player.hidden = false;
    $('notice').textContent = current.notice;
    if (current.lyrics && current.lyrics !== '<instrumental>') {
      $('lyrics').textContent = current.lyrics;
      $('lyricsBox').hidden = false;
    }
    $('baixar').disabled = false;
    $('abrirDaw').disabled = false;
    $('abrirSeparador').disabled = false;
    setStatus('Pronto. Isto é uma música gerada por IA, não uma gravação original.');
  } catch (e) {
    setStatus(e.message || 'Não foi possível gerar a música.', true);
  } finally {
    $('gerar').disabled = false;
  }
}

async function baixar() {
  try {
    const blob = await audioBlob();
    const a = document.createElement('a');
    const href = URL.createObjectURL(blob);
    a.href = href;
    a.download = current.name + (blob.type.includes('wav') ? '.wav' : '.mp3');
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(href), 2000);
    setStatus('Download iniciado no aparelho. Lembrete: música gerada por IA, com marca d\'água SynthID.');
  } catch (e) {
    setStatus(e.message || 'Não foi possível baixar.', true);
  }
}

async function abrirDaw() {
  if (transferring) return;
  transferring = true;
  $('abrirDaw').disabled = true;
  $('baixar').disabled = true;
  $('abrirSeparador').disabled = true;
  setStatus('Abrindo a música na DAW de gravação…');
  let db;
  try {
    if (!window.indexedDB) throw Error('Este navegador não permite a transferência automática.');
    const blob = await audioBlob();
    const ext = (blob.type || '').includes('wav') ? 'wav' : 'mp3';
    const stems = [{
      id: 'other',
      name: current.name + '.' + ext,
      type: blob.type || 'audio/mpeg',
      blob
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
      name: current.name + ' (IA Lyria)',
      stems,
      createdAt: Date.now()
    };
    await new Promise((resolve, reject) => {
      const tx = db.transaction('sessions', 'readwrite');
      tx.objectStore('sessions').put(row, 'latest');
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || Error('Não foi possível salvar a música para abrir no estúdio.'));
    });
    location.href = './daw.html?modulo=gravacao&importStems=1&v=451';
  } catch (e) {
    setStatus('Não foi possível abrir na DAW: ' + (e.message || 'tente novamente. Você ainda pode baixar o arquivo.'), true);
    transferring = false;
    $('abrirDaw').disabled = false;
    $('baixar').disabled = false;
    $('abrirSeparador').disabled = false;
  } finally {
    db?.close();
  }
}


const SEPARATOR_MAX_SECONDS = 300;

function songDuration() {
  const dur = $('player')?.duration;
  return Number.isFinite(dur) && dur > 0 ? dur : null;
}

function formatDuration(seconds) {
  const total = Math.max(0, Math.round(seconds));
  const m = Math.floor(total / 60);
  const s = String(total % 60).padStart(2, '0');
  return m + ' min ' + s + ' s';
}

async function abrirSeparador() {
  if (transferring) return;
  transferring = true;
  $('abrirSeparador').disabled = true;
  $('abrirDaw').disabled = true;
  $('baixar').disabled = true;
  setStatus('Abrindo a música no separador…');
  let db;
  try {
    if (!window.indexedDB) throw Error('Este navegador não permite a transferência automática.');
    const blob = await audioBlob();
    const ext = (blob.type || '').includes('wav') ? 'wav' : 'mp3';
    const duration = songDuration();
    db = await new Promise((resolve, reject) => {
      const r = indexedDB.open('aps-separator-handoff-v1', 1);
      r.onupgradeneeded = () => {
        if (!r.result.objectStoreNames.contains('sessions')) r.result.createObjectStore('sessions');
      };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    const row = {
      id: Date.now() + '-' + Math.random().toString(36).slice(2),
      name: current.name + '.' + ext,
      type: blob.type || 'audio/mpeg',
      blob,
      url: current.url || null,
      duration,
      source: 'lyria',
      createdAt: Date.now()
    };
    await new Promise((resolve, reject) => {
      const tx = db.transaction('sessions', 'readwrite');
      tx.objectStore('sessions').put(row, 'latest');
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || Error('Não foi possível salvar a música para abrir no separador.'));
    });
    if (duration && duration > SEPARATOR_MAX_SECONDS) {
      setStatus('Esta música tem ' + formatDuration(duration) + '. O separador usa no máximo 5 minutos por vez. Abrindo mesmo assim para você escolher o trecho.');
    }
    location.href = './separador.html?importAudio=1&v=453';
  } catch (e) {
    setStatus('Não foi possível abrir no separador: ' + (e.message || 'tente novamente. Você ainda pode baixar o arquivo.'), true);
    transferring = false;
    $('abrirSeparador').disabled = false;
    $('abrirDaw').disabled = false;
    $('baixar').disabled = false;
  } finally {
    db?.close();
  }
}

function init() {
  $('notice').textContent = NOTICE;
  $('gerar').addEventListener('click', gerar);
  $('baixar').addEventListener('click', baixar);
  $('abrirDaw').addEventListener('click', abrirDaw);
  $('abrirSeparador').addEventListener('click', abrirSeparador);
}

init();
