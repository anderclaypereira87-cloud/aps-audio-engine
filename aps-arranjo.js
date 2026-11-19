/* APS Arranjo — cria um áudio novo a partir de uma gravação.
   Aviso obrigatório: nunca apresentar o resultado como a gravação original. */
const PROD_API = 'https://aps-arranjo.aps-audio.workers.dev';
const API_BASE = (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
  ? `${location.protocol}//${location.hostname}:8788`
  : PROD_API;
const NOTICE = 'APS Arranjo: áudio gerado por IA. É uma criação nova, não a sua gravação original.';
const MAX_AUDIO = 10 * 1024 * 1024; // limite do ENVIO à IA (worker); o arquivo local pode ser bem maior
const MAX_DURATION_SEC = 480;      // limite do envio à IA (8 min): acima disso o app envia um MP3 do início
const MAX_UPLOAD_BYTES = Math.floor(9.5 * 1024 * 1024);
const SEPARATOR_MAX_SECONDS = 300;
const SCRIPT_V = '370';

const FIDELIDADE_HINTS = {
  1: 'A IA usa a gravação só como inspiração e pode inventar bastante no arranjo.',
  2: 'A IA segue o estilo, um andamento próximo e os instrumentos principais, mas pode variar o arranjo.',
  3: 'A IA tenta seguir de perto o andamento, o tom, os instrumentos e a estrutura. Mesmo assim, o resultado é um áudio novo, não a sua gravação editada.'
};

const FIDELIDADE_LEVEL = { 1: 'baixa', 2: 'media', 3: 'alta' };

const $ = (id) => document.getElementById(id);

let current = null;
let objectUrl = null;
let origPreviewUrl = null;
let audioFile = null;
let audioDuration = null;
let audioUsedSec = null;
let busy = false;
let transferring = false;
let acAn = null;       // análise (tom, andamento, acordes) do áudio original
let acAnPromise = null;
let acBuf = null;
let acBig = null;

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

function direitosOk() {
  return !!$('refDireitos')?.checked;
}

function isShortRef() {
  return audioDuration != null && audioDuration > 0 && audioDuration < 30;
}

function finalidadeForUpload(modo, letra, level) {
  const short = isShortRef();
  if (modo === 'acompanhar' || modo === 'instrumento' || modo === 'estender') return 'audio';
  if (letra) {
    if (level === 'alta') return 'melodia';
    return short ? 'audio' : 'referencia';
  }
  if (level === 'baixa' || short) return 'audio';
  return 'instrumental';
}

function setResultButtons(enabled) {
  const on = !!enabled && !busy && !transferring;
  if ($('baixar')) $('baixar').disabled = !on;
  if ($('abrirDaw')) $('abrirDaw').disabled = !on;
  if ($('abrirSeparador')) $('abrirSeparador').disabled = !on;
}

function setBusyUi(on) {
  busy = !!on;
  if ($('gerar')) $('gerar').disabled = !!on || transferring;
  if ($('audioFile')) $('audioFile').disabled = !!on || transferring;
  if ($('fidelidade')) $('fidelidade').disabled = !!on || transferring;
  if ($('refDireitos')) $('refDireitos').disabled = !!on || transferring;
  if (on) setResultButtons(false);
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

let aiNote = '';
async function fileToMp3(file) {
  // Prepara o arquivo para a IA: MP3/M4A pequenos vão como estão; o resto (WAV, FLAC, OGG, AIFF, arquivos grandes ou longos)
  // vira MP3 no aparelho, cortado em no máximo 8 min e ~9,5 MB. Nada é alterado no original.
  aiNote = '';
  const mime = (file.type || '').toLowerCase();
  const name = (file.name || '').toLowerCase();
  const isMp3 = mime.includes('mpeg') || mime.includes('mp3') || name.endsWith('.mp3');
  const isM4a = mime.includes('mp4') || name.endsWith('.m4a');
  const fits = file.size <= MAX_UPLOAD_BYTES && (!audioDuration || audioDuration <= MAX_DURATION_SEC);
  if ((isMp3 || isM4a) && fits) return file;
  if (!window.APSBigAudio) throw Error('O conversor de áudio não carregou. Recarregue a página.');
  const r = await window.APSBigAudio.toMp3(file, {
    maxSec: MAX_DURATION_SEC, maxBytes: MAX_UPLOAD_BYTES,
    onProgress: (p) => setStatus('Convertendo o áudio para MP3 no aparelho… ' + Math.round(p * 100) + '%')
  });
  if (r.trimmed) aiNote = 'Seu áudio tem ' + formatDuration(r.totalSec) + '; a IA recebeu o trecho inicial de ' + formatDuration(r.usedSec) + ' em MP3 (' + r.kbps + ' kbps, ' + formatSize(r.bytes) + '). O arquivo original não foi alterado.';
  else if (!(isMp3 || isM4a)) aiNote = 'Convertido para MP3 (' + r.kbps + ' kbps, ' + formatSize(r.bytes) + ') só para o envio; o original não foi alterado.';
  else aiNote = 'Reconvertido para MP3 (' + r.kbps + ' kbps, ' + formatSize(r.bytes) + ') para caber no limite de envio.';
  audioUsedSec = r.usedSec;
  return new File([r.blob], (file.name || 'audio').replace(/\.[^.]+$/, '') + '.mp3', { type: 'audio/mpeg' });
}

async function loadFile(file) {
  audioFile = null;
  audioDuration = null;
  $('fileInfo').hidden = true;
  $('origPreview').hidden = true;
  $('origPreview').removeAttribute('src');
  revokeOrig();
  if (!file) return;
  if (window.APSBigAudio && file.size > window.APSBigAudio.MAX_FILE) {
    setStatus('Este arquivo é grande demais para o navegador (limite de 3 GB). Envie um WAV/MP3 menor ou um trecho.', true);
    $('audioFile').value = '';
    return;
  }
  audioUsedSec = null;
  const bi = window.APSBigAudio ? await window.APSBigAudio.info(file) : { kind: 'other' };
  audioDuration = bi.kind === 'wav' ? bi.duration : await decodeDuration(file);
  audioFile = file;
  startAnalysis(file);
  origPreviewUrl = URL.createObjectURL(file);
  $('origPreview').src = origPreviewUrl;
  $('origPreview').hidden = false;
  const dur = audioDuration ? ' · ' + formatDuration(audioDuration) : '';
  $('fileInfo').hidden = false;
  $('fileInfo').textContent = 'Original: ' + (file.name || 'áudio') + ' · ' + formatSize(file.size) + dur + '. Este arquivo não será alterado.' + ((file.size > MAX_UPLOAD_BYTES || (audioDuration && audioDuration > MAX_DURATION_SEC)) ? ' Arquivo grande: o arranjo pelos acordes lê tudo no aparelho; para a IA, o app envia um MP3 de até 8 min (início do áudio).' : '');
  if (isShortRef()) {
    setStatus('Áudio original carregado (' + formatDuration(audioDuration) + '). Para ficar mais parecido com a gravação, envie um trecho de pelo menos 30 segundos. Você já pode criar o arranjo mesmo assim.');
  } else {
    setStatus('Áudio original carregado. Escolha o tipo de arranjo, a fidelidade e crie uma versão nova com IA.');
  }
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
  if (busy || transferring) return;
  const modo = selectedModo();
  const pedido = $('pedido').value.trim();
  const letra = $('letra').value.trim();
  const fidelidade = fidelidadeLevel();
  const direitos = direitosOk();
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
  if (audioFile && !direitos) {
    setStatus('Para usar uma gravação, confirme que ela é sua ou que você tem o direito de usá-la.', true);
    return;
  }

  setBusyUi(true);
  setStatus('Enviando o áudio e pedindo um arranjo novo…');
  try {
    let arquivoId = '';
    const finalidade = finalidadeForUpload(modo, letra, fidelidade);
    if (audioFile) {
      const encoded = await fileToMp3(audioFile);
      if (aiNote) setStatus(aiNote + ' Enviando…');
      const form = new FormData();
      form.append('file', encoded, encoded.name);
      form.append('finalidade', finalidade);
      const up = await fetch(API_BASE + '/enviar', { method: 'POST', body: form });
      const upData = await up.json().catch(() => ({}));
      if (!up.ok || !upData.ok) throw Error(upData.error || 'Não foi possível enviar o áudio.');
      arquivoId = upData.arquivoId;
    }
    if (audioFile && acAnPromise) { try { await Promise.race([acAnPromise, new Promise((r) => setTimeout(r, 8000))]); } catch { /* ignore */ } }
    const pedidoFull = (pedido + chordsHint()).slice(0, 1024);
    const body = { modo, pedido: pedidoFull, letra, arquivoId, finalidade, fidelidade, direitos };
    if (modo === 'instrumento') body.tipoPista = $('tipoPista').value;
    if (modo === 'estender' && audioDuration) body.extendEm = Math.max(8, Math.min(audioDuration, audioUsedSec || audioDuration) - 2);
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
    if ($('acPlayer')) $('acPlayer').hidden = true;
    if ($('acMixBaixar')) $('acMixBaixar').hidden = true;
    setStatus('Arranjo pronto. Isto é um áudio novo, gerado por IA — não é a sua gravação original.');
  } catch (e) {
    setStatus(e.message || 'Não foi possível criar o arranjo agora.', true);
  } finally {
    setBusyUi(false);
    if (current?.blob) setResultButtons(true);
  }
}


// ---- Arranjo pelos acordes: lê tom, andamento e acordes do original (no aparelho) ----
const BIG_BYTES = 40 * 1024 * 1024;
async function decodeFull(file, onProgress) {
  // arquivos grandes/longos: leitura em blocos, mono, 22,05 kHz (memória pequena). Pequenos: decodificação completa, como antes.
  if (window.APSBigAudio && (file.size > BIG_BYTES || (audioDuration && audioDuration > 480))) {
    const r = await window.APSBigAudio.monoForAnalysis(file, { targetSr: 22050, onProgress: (p) => (onProgress || setStatus)('Lendo o áudio no aparelho… ' + Math.round(p * 100) + '%') });
    acBig = r.info;
    return r.buffer;
  }
  acBig = null;
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  try { return await ctx.decodeAudioData(await file.arrayBuffer()); }
  catch (e) {
    // o navegador não decodifica (ex.: AIFF): tenta a leitura própria em blocos (WAV/AIFF PCM)
    if (window.APSBigAudio) {
      const r = await window.APSBigAudio.monoForAnalysis(file, { targetSr: 22050, onProgress: (p) => (onProgress || setStatus)('Lendo o áudio no aparelho… ' + Math.round(p * 100) + '%') });
      acBig = r.info;
      return r.buffer;
    }
    throw e;
  } finally { try { await ctx.close(); } catch { /* ignore */ } }
}

function startAnalysis(file) {
  acAn = null; acBuf = null; acAnPromise = null;
  if (!window.APSArranjoAcordes) return;
  const mine = file;
  acAnPromise = (async () => {
    try {
      const buf = await decodeFull(file);
      if (audioFile !== mine) return null;
      acBuf = buf;
      const an = await window.APSArranjoAcordes.analyze(buf, { bpm: Number($('acBpm')?.value) || 0 });
      if (audioFile === mine) acAn = an;
      if (acBig && audioFile === mine && !busy) setStatus('Áudio grande lido no aparelho e analisado (' + window.APSArranjoAcordes.describe(an) + '). Escolha o arranjo pelos acordes (sem IA) ou crie com IA (a IA recebe um MP3 de até 8 min do início).');
      return an;
    } catch (e) { console.warn('análise de acordes', e); return null; }
  })();
}

function chordsHint() {
  if (!acAn || !window.APSArranjoAcordes) return '';
  const A = window.APSArranjoAcordes;
  return ' Siga os acordes do original (' + A.describe(acAn).replace(/ \(andamento incerto[^)]*\)/, '') + '): ' + A.chordLine(acAn, 24) + '.';
}

async function gerarPorAcordes() {
  if (busy || transferring) return;
  const A = window.APSArranjoAcordes;
  if (!A) { setStatus('O módulo de acordes não carregou. Recarregue a página.', true); return; }
  if (!audioFile) { setStatus('Envie primeiro o áudio original acima.', true); return; }
  const btn = $('acGerar');
  btn.disabled = true;
  try {
    setStatus('Lendo o áudio e os acordes…');
    if (acAnPromise) await acAnPromise;
    if (!acBuf) acBuf = await decodeFull(audioFile);
    const hint = Number($('acBpm').value) || 0;
    const an = (acAn && !hint) ? acAn : await A.analyze(acBuf, { bpm: hint, onProgress: (m) => setStatus(m) });
    acAn = an;
    const inst = $('acInst').value;
    setStatus('Tocando os acordes em ' + A.INSTR[inst] + '…');
    await new Promise((r) => setTimeout(r, 30));
    const rsr = an.duration > 15 * 60 ? 22050 : 44100;
    const data = A.render(an, inst, { sr: rsr });
    const blob = A.wav(data, rsr);
    const mixData = A.mixWithOriginal(acBuf, data, { arrSr: rsr });
    const mixBlob = A.wav(mixData, rsr);
    revokeUrl();
    objectUrl = URL.createObjectURL(blob);
    current = { blob, url: objectUrl, name: 'Arranjo pelos acordes', mime: 'audio/wav', notice: '', fileName: 'APS-Arranjo-acordes-' + inst, stemName: 'Arranjo pelos acordes · ' + A.INSTR[inst], mixBlob };
    $('acPlayer').src = objectUrl; $('acPlayer').hidden = false;
    $('player').hidden = true;
    $('acInfo').hidden = false;
    $('acInfo').textContent = A.describe(an) + '. Acordes: ' + A.chordLine(an, 40);
    $('acMixBaixar').hidden = false;
    setStatus('Arranjo pronto: ' + A.INSTR[inst] + ' seguindo os acordes e o tempo do original. É uma pista gerada no seu aparelho, sem IA; confira de ouvido.');
    setResultButtons(true);
  } catch (e) {
    setStatus('Não foi possível criar o arranjo pelos acordes: ' + (e.message || e), true);
  } finally {
    btn.disabled = false;
  }
}

function baixarMix() {
  if (!current?.mixBlob) return;
  const a = document.createElement('a');
  const href = URL.createObjectURL(current.mixBlob);
  a.href = href; a.download = (current.fileName || 'APS-Arranjo') + '-com-original.wav';
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 2000);
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
  a.download = (current.fileName || 'APS-Arranjo-IA') + '.' + ext;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 2000);
  setStatus(current.mixBlob ? 'Download iniciado. Este arquivo é uma pista gerada no seu aparelho a partir dos acordes do original; não é a sua gravação.' : 'Download iniciado. Lembrete: este arquivo é uma criação de IA, não a sua gravação original.');
}

async function openIdb(name) {
  if (!window.indexedDB) throw Error('Este navegador não permite a transferência automática.');
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(name, 1);
    r.onupgradeneeded = () => {
      if (!r.result.objectStoreNames.contains('sessions')) r.result.createObjectStore('sessions');
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function putLatest(db, row) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('sessions', 'readwrite');
    tx.objectStore('sessions').put(row, 'latest');
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || Error('Não foi possível salvar o arranjo.'));
  });
}

function songDuration() {
  const dur = (current?.mixBlob ? $('acPlayer') : $('player'))?.duration;
  return Number.isFinite(dur) && dur > 0 ? dur : (audioDuration || null);
}

async function abrirDaw() {
  if (transferring || !current?.blob) return;
  transferring = true;
  setResultButtons(false);
  if ($('gerar')) $('gerar').disabled = true;
  setStatus('Abrindo o arranjo no Estúdio como uma pista nova…');
  let db;
  try {
    const ext = (current.mime || '').includes('wav') ? 'wav' : 'mp3';
    const stems = [{
      id: 'other',
      name: (current.stemName || 'APS Arranjo IA') + '.' + ext,
      type: current.mime || 'audio/mpeg',
      blob: current.blob
    }];
    db = await openIdb('aps-stems-transfer-v1');
    await putLatest(db, {
      id: Date.now() + '-' + Math.random().toString(36).slice(2),
      name: 'APS Arranjo IA',
      stems,
      createdAt: Date.now()
    });
    location.href = './daw.html?modulo=gravacao&importStems=1&v=' + SCRIPT_V;
  } catch (e) {
    setStatus('Não foi possível abrir no Estúdio: ' + (e.message || 'tente novamente. Você ainda pode baixar o arquivo.'), true);
    transferring = false;
    if ($('gerar')) $('gerar').disabled = false;
    setResultButtons(true);
  } finally {
    db?.close();
  }
}

async function abrirSeparador() {
  if (transferring || !current?.blob) return;
  transferring = true;
  setResultButtons(false);
  if ($('gerar')) $('gerar').disabled = true;
  setStatus('Abrindo o arranjo no Separador…');
  let db;
  try {
    const ext = (current.mime || '').includes('wav') ? 'wav' : 'mp3';
    const duration = songDuration();
    db = await openIdb('aps-separator-handoff-v1');
    await putLatest(db, {
      id: Date.now() + '-' + Math.random().toString(36).slice(2),
      name: current.name + '.' + ext,
      type: current.mime || 'audio/mpeg',
      blob: current.blob,
      url: current.url || null,
      duration,
      source: 'arranjo',
      createdAt: Date.now()
    });
    if (duration && duration > SEPARATOR_MAX_SECONDS) {
      setStatus('Este arranjo tem ' + formatDuration(duration) + '. O separador usa no máximo 5 minutos por vez. Abrindo mesmo assim para você escolher o trecho.');
    }
    location.href = './separador.html?importAudio=1&v=' + SCRIPT_V;
  } catch (e) {
    setStatus('Não foi possível abrir no Separador: ' + (e.message || 'tente novamente. Você ainda pode baixar o arquivo.'), true);
    transferring = false;
    if ($('gerar')) $('gerar').disabled = false;
    setResultButtons(true);
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
  if ($('acGerar')) $('acGerar').addEventListener('click', gerarPorAcordes);
  if ($('acMixBaixar')) $('acMixBaixar').addEventListener('click', baixarMix);
  if ($('acBpm')) $('acBpm').addEventListener('change', () => { if (audioFile) startAnalysis(audioFile); });
  $('abrirDaw').addEventListener('click', abrirDaw);
  if ($('abrirSeparador')) $('abrirSeparador').addEventListener('click', abrirSeparador);
  if ($('fidelidade')) {
    $('fidelidade').addEventListener('input', updateFidelidadeHint);
    updateFidelidadeHint();
  }
  if ($('refDireitos')) {
    $('refDireitos').addEventListener('change', () => {
      if ($('refDireitos').checked && $('status').classList.contains('err') && /direito/i.test($('status').textContent)) {
        setStatus('Direito confirmado. Você já pode criar o arranjo.');
      }
    });
  }
}

init();
