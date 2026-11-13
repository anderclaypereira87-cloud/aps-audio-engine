/* APS Audio Engine — criação de música com Google Lyria.
   Aviso obrigatório: nunca apresentar o resultado como gravação original. */
const PROD_API = 'https://aps-lyria.aps-audio.workers.dev';
const API_BASE = (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
  ? `${location.protocol}//${location.hostname}:8787`
  : PROD_API;
const NOTICE = 'Música gerada por IA (Google Lyria), com marca d\'água SynthID';
const REF_NOTICE = 'Música gerada por IA (Google Lyria), com marca d\'água SynthID. É uma criação nova inspirada na gravação, não uma edição do áudio original.';
const MAX_AUDIO = 10 * 1024 * 1024;
const MAX_DURATION_SEC = 120;

const $ = (id) => document.getElementById(id);

let current = null;
let objectUrl = null;
let transferring = false;
let refFile = null;
let refDuration = null;
let refDesc = null;
let refPreviewUrl = null;
let busy = false;

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

function revokeRefPreview() {
  if (refPreviewUrl) {
    URL.revokeObjectURL(refPreviewUrl);
    refPreviewUrl = null;
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

function setBusy(on) {
  busy = on;
  $('gerar').disabled = on;
  $('analisarRef').disabled = on || !refFile;
  $('limparRef').disabled = on;
  $('refFile').disabled = on;
  if ($('fidelidade')) $('fidelidade').disabled = on;
  if ($('refDireitos')) $('refDireitos').disabled = on;
  if (on) {
    $('baixar').disabled = true;
    $('abrirDaw').disabled = true;
    $('abrirSeparador').disabled = true;
  }
}

function clearReference(keepStatus) {
  refFile = null;
  refDuration = null;
  refDesc = null;
  $('refFile').value = '';
  $('refFileInfo').hidden = true;
  $('refPreview').hidden = true;
  $('refPreview').removeAttribute('src');
  $('refResult').hidden = true;
  $('refDesc').replaceChildren();
  $('analisarRef').disabled = true;
  revokeRefPreview();
  if (!keepStatus) setStatus('A referência foi removida. Você pode criar uma música só com o texto, ou enviar outro áudio.');
}

function showDescription(desc) {
  const rows = [
    ['Gênero', desc.genero],
    ['Andamento', desc.bpm ? desc.bpm + ' BPM' : ''],
    ['Tom ou clima', [desc.tom, desc.clima].filter(Boolean).join(' · ')],
    ['Instrumentos', Array.isArray(desc.instrumentos) ? desc.instrumentos.join(', ') : ''],
    ['Estrutura', desc.estrutura],
    ['Harmonia', desc.acordes],
    ['Groove', desc.groove],
    ['Mixagem', desc.caracterMix],
    ['Resumo', desc.resumo]
  ];
  const dl = $('refDesc');
  dl.replaceChildren();
  for (const [label, value] of rows) {
    if (!value) continue;
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    dd.textContent = value;
    dl.append(dt, dd);
  }
  $('refResult').hidden = false;
}

function loadRefFile(file) {
  refDesc = null;
  $('refResult').hidden = true;
  $('refDesc').replaceChildren();
  if (!file) {
    clearReference(true);
    setStatus('O limite do estúdio é de 20 músicas por dia. A referência, no plano premium, analisa no máximo 15 gravações por dia.');
    return;
  }
  if (file.size > MAX_AUDIO) {
    clearReference(true);
    setStatus('O arquivo passa de 10 MB. Exporte um MP3 ou um trecho de até 2 minutos.', true);
    return;
  }
  refFile = file;
  revokeRefPreview();
  refPreviewUrl = URL.createObjectURL(file);
  const preview = $('refPreview');
  preview.src = refPreviewUrl;
  preview.hidden = false;
  $('refFileInfo').hidden = false;
  $('refFileInfo').textContent = 'Carregando ' + file.name + ' (' + formatSize(file.size) + ')…';
  $('analisarRef').disabled = true;
  const done = () => {
    const dur = preview.duration;
    if (!Number.isFinite(dur) || dur <= 0) {
      clearReference(true);
      setStatus('Não foi possível ler a duração deste arquivo. Tente MP3 ou WAV de até 2 minutos.', true);
      return;
    }
    if (dur > MAX_DURATION_SEC) {
      clearReference(true);
      setStatus('A gravação tem ' + formatDuration(dur) + '. Envie um trecho de até 2 minutos.', true);
      return;
    }
    if (dur < 1) {
      clearReference(true);
      setStatus('O áudio é curto demais. Envie uma gravação de pelo menos 1 segundo.', true);
      return;
    }
    refDuration = dur;
    $('refFileInfo').textContent = file.name + ' · ' + formatDuration(dur) + ' · ' + formatSize(file.size) + '. A IA vai criar uma música nova inspirada nela, não uma edição.';
    $('analisarRef').disabled = busy;
    setStatus('Referência pronta. Você pode ouvir a descrição ou já criar a música inspirada.');
  };
  if (Number.isFinite(preview.duration) && preview.duration > 0) done();
  else preview.onloadedmetadata = done;
  preview.onerror = () => {
    clearReference(true);
    setStatus('Este arquivo de áudio não pôde ser lido. Tente MP3, WAV, M4A, OGG ou FLAC.', true);
  };
}

const FIDELIDADE_HINTS = {
  1: 'A IA usa a gravação só como inspiração e pode inventar bastante no arranjo.',
  2: 'A IA segue o estilo, um andamento próximo e os instrumentos principais, mas pode variar o arranjo.',
  3: 'A IA tenta seguir de perto o andamento, o tom, os instrumentos e a estrutura. Mesmo assim, o resultado é uma música nova, não a sua gravação editada.'
};

const FIDELIDADE_LEVEL = { 1: 'baixa', 2: 'media', 3: 'alta' };

function fidelidadeLevel() {
  const n = Number($('fidelidade')?.value || 3);
  return FIDELIDADE_LEVEL[n] || 'alta';
}

function updateFidelidadeHint() {
  const el = $('fidelidade');
  const hint = $('fidelidadeHint');
  if (!el || !hint) return;
  const n = Number(el.value || 3);
  el.setAttribute('aria-valuenow', String(n));
  hint.textContent = FIDELIDADE_HINTS[n] || FIDELIDADE_HINTS[3];
}

function formFields() {
  return {
    prompt: $('prompt').value.replace(/\s+/g, ' ').trim(),
    estilo: $('estilo').value,
    letra: $('letra').value.trim(),
    modo: $('modo').value === 'completa' ? 'completa' : 'clip',
    fidelidade: fidelidadeLevel(),
    direitos: !!$('refDireitos')?.checked
  };
}

async function analisar() {
  if (busy || transferring) return;
  if (!refFile) {
    setStatus('Escolha primeiro uma gravação de até 2 minutos.', true);
    return;
  }
  const fields = formFields();
  if (!fields.direitos) {
    setStatus('Para usar uma gravação de referência, confirme que ela é sua ou que você tem o direito de usá-la.', true);
    return;
  }
  setBusy(true);
  setStatus('A IA está ouvindo a sua gravação para descrever o estilo…');
  try {
    const body = new FormData();
    body.append('audio', refFile, refFile.name || 'referencia.wav');
    body.append('prompt', fields.prompt);
    body.append('estilo', fields.estilo);
    body.append('letra', fields.letra);
    body.append('modo', fields.modo);
    body.append('fidelidade', fields.fidelidade);
    body.append('direitos', fields.direitos ? '1' : '0');
    body.append('duracao', String(refDuration || ''));
    body.append('gerar', '0');
    const res = await fetch(API_BASE + '/referencia', { method: 'POST', body });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) throw Error(data.error || 'Não foi possível analisar a gravação.');
    refDesc = data.descricao;
    showDescription(refDesc);
    setStatus('Descrição pronta. Isto não altera a sua gravação. Se gostar, toque em Criar música para gerar uma música nova inspirada nela.');
  } catch (e) {
    setStatus(e.message || 'Não foi possível analisar a gravação.', true);
  } finally {
    setBusy(false);
  }
}

async function applyGenerated(data, fallbackName) {
  revokeUrl();
  const localBlob = blobFromResult(data);
  const fromRef = !!(data.fromRef || refDesc || refFile);
  current = {
    id: data.id,
    url: data.url || null,
    mime: data.mime || 'audio/mpeg',
    lyrics: data.lyrics || '',
    notice: data.notice || (fromRef ? REF_NOTICE : NOTICE),
    name: (fallbackName || 'musica-ia').replace(/[^\w À-ÿ.-]+/g, ' ').trim() || 'musica-ia',
    blob: localBlob,
    fromRef
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
  } else {
    $('lyricsBox').hidden = true;
  }
  $('baixar').disabled = false;
  $('abrirDaw').disabled = false;
  $('abrirSeparador').disabled = false;
  setStatus(fromRef
    ? 'Pronto. Isto é uma música nova gerada por IA, inspirada na sua gravação, e não a sua gravação editada.'
    : 'Pronto. Isto é uma música gerada por IA, não uma gravação original.');
}

async function gerar() {
  if (busy || transferring) return;
  const fields = formFields();
  const usingRef = !!(refFile || refDesc);
  if (!usingRef && fields.prompt.length < 8) {
    setStatus('Escreva o que você quer ouvir, com ritmo, instrumentos e clima.', true);
    return;
  }
  if (usingRef && !fields.direitos) {
    setStatus('Para usar uma gravação de referência, confirme que ela é sua ou que você tem o direito de usá-la.', true);
    return;
  }
  setBusy(true);
  const wait = fields.modo === 'completa'
    ? 'Criando a música completa… isso pode levar cerca de um minuto.'
    : 'Criando o clipe de 30 segundos…';
  setStatus(usingRef ? 'Criando uma música nova inspirada na sua gravação. Isto não edita o áudio original. ' + wait : wait);
  $('player').hidden = true;
  $('lyricsBox').hidden = true;
  try {
    let res;
    if (refDesc) {
      res = await fetch(API_BASE + '/gerar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...fields, referencia: refDesc, fidelidade: fields.fidelidade, direitos: fields.direitos })
      });
    } else if (refFile) {
      const body = new FormData();
      body.append('audio', refFile, refFile.name || 'referencia.wav');
      body.append('prompt', fields.prompt);
      body.append('estilo', fields.estilo);
      body.append('letra', fields.letra);
      body.append('modo', fields.modo);
      body.append('fidelidade', fields.fidelidade);
      body.append('direitos', fields.direitos ? '1' : '0');
      body.append('duracao', String(refDuration || ''));
      body.append('gerar', '1');
      res = await fetch(API_BASE + '/referencia', { method: 'POST', body });
    } else {
      res = await fetch(API_BASE + '/gerar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fields)
      });
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) throw Error(data.error || 'Não foi possível gerar a música.');
    if (data.descricao) {
      refDesc = data.descricao;
      showDescription(refDesc);
    }
    const nameSource = fields.prompt || refDesc?.genero || (refFile && refFile.name.replace(/\.[^.]+$/, '')) || 'musica-ia';
    await applyGenerated(data, nameSource.slice(0, 40));
  } catch (e) {
    setStatus(e.message || 'Não foi possível gerar a música.', true);
  } finally {
    setBusy(false);
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
    setStatus(current.fromRef
      ? 'Download iniciado. Lembrete: é uma música nova gerada por IA, inspirada na sua gravação, com marca d\'água SynthID.'
      : 'Download iniciado no aparelho. Lembrete: música gerada por IA, com marca d\'água SynthID.');
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
    const suffix = current.fromRef ? ' (IA inspirada)' : ' (IA Lyria)';
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
      name: current.name + suffix,
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
    location.href = './daw.html?modulo=gravacao&importStems=1&v=454';
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
      source: current.fromRef ? 'lyria-referencia' : 'lyria',
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
    location.href = './separador.html?importAudio=1&v=454';
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
  $('analisarRef').addEventListener('click', analisar);
  $('limparRef').addEventListener('click', () => clearReference(false));
  $('refFile').addEventListener('change', (ev) => loadRefFile(ev.target.files?.[0] || null));
  if ($('fidelidade')) {
    $('fidelidade').addEventListener('input', updateFidelidadeHint);
    updateFidelidadeHint();
  }
}

init();
