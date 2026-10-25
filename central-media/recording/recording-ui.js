import { LIMITS, supportedMimeTypes, extensionForMime, transition, stopReason, signalLevel, captureConstraints } from './recording-core.mjs';
import { createChunkStore } from './chunk-store.js';

const $ = id => document.getElementById(`rec-${id}`), panel = $('panel');
let phase = 'idle', stream = null, recorder = null, store = null, savedStore = null, editorStore = null, opening = false;
let savedFile = null, savedUrl = null, verification = null, meter = null;
let generation = 0, startedAt = 0, timer = null, deadline = null, idleTimer = null;
let discard = false, failure = null, stopMessage = '', deviceAccess = false, permissionCleanup = [];
const labels = { time: 'Limite de 10 minutos alcançado.', size: 'Gravação interrompida antes do limite de espaço disponível.' };
const status = (message, bad = false) => { $('status').textContent = message; $('status').classList.toggle('bad', bad); };
function setPhase(next) {
  phase = transition(phase, next); panel.dataset.state = phase;
  const busy = opening || ['requesting', 'preparing', 'recording', 'stopping', 'verifying'].includes(phase);
  $('activate').disabled = opening || !['idle', 'error', 'recorded'].includes(phase);
  $('start').disabled = opening || phase !== 'preview';
  $('stop').disabled = phase !== 'recording';
  $('off').disabled = !['requesting', 'preview'].includes(phase);
  $('cancel').disabled = !['preparing', 'recording'].includes(phase);
  $('camera').disabled = busy; $('microphone').disabled = busy;
  $('refresh').disabled = busy || !deviceAccess;
  $('play').disabled = !savedFile || busy; $('download').hidden = !savedFile || busy;
  $('open').disabled = !savedFile || busy || !verification?.withinLimits;
  $('discard').disabled = !savedFile || busy;
}
function messageFor(error) {
  return ({ NotAllowedError: 'Permissão bloqueada. Libere câmera e microfone nas configurações do navegador e toque em ativar novamente.',
    NotFoundError: 'Câmera ou entrada de áudio não encontrada. Conecte os dispositivos e selecione novamente.',
    NotReadableError: 'O dispositivo está ocupado ou indisponível. Feche outros aplicativos que usam a câmera ou o microfone.',
    OverconstrainedError: 'O dispositivo selecionado não está mais disponível. Escolha outra câmera ou entrada de áudio.',
    QuotaExceededError: 'O armazenamento local ficou sem espaço. Libere espaço no aparelho e grave um trecho menor.',
    SecurityError: 'O navegador bloqueou a captura. Abra esta página diretamente por HTTPS.',
  })[error?.name] || error?.message || 'Falha na gravação. Tente um trecho menor.';
}
function clearTimers() { clearInterval(timer); clearTimeout(deadline); clearTimeout(idleTimer); timer = deadline = idleTimer = null; }
function releaseDevices() {
  clearTimeout(idleTimer); idleTimer = null;
  const old = stream; stream = null; old?.getTracks().forEach(track => track.stop());
  $('live').pause(); $('live').srcObject = null;
  permissionCleanup.splice(0).forEach(fn => fn());
  if (meter) { cancelAnimationFrame(meter.frame); meter.source?.disconnect(); meter.analyser?.disconnect(); meter.ctx.close().catch(() => {}); meter = null; }
  $('meter').value = 0; $('level').textContent = 'Desligado';
}
function idleTimeout() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (phase !== 'preview') return;
    releaseDevices(); setPhase(savedFile ? 'recorded' : 'idle');
    status('Câmera e áudio desligados após 90 segundos sem iniciar. Toque em ativar para continuar.');
  }, 90000);
}
function startMeter(context) {
  if (!context || !stream) return;
  try {
    const source = context.createMediaStreamSource(stream), analyser = context.createAnalyser(); analyser.fftSize = 2048;
    source.connect(analyser); // Analyser output is deliberately NOT connected to speakers.
    meter = { ctx: context, source, analyser, frame: null };
    const data = new Float32Array(analyser.fftSize); let clipUntil = 0;
    const update = () => {
      if (!meter || meter.ctx !== context) return;
      analyser.getFloatTimeDomainData(data); const level = signalLevel(data);
      if (level.clip) clipUntil = performance.now() + 1000;
      $('meter').value = Math.min(1, level.rms);
      $('level').textContent = context.state !== 'running' ? 'Medidor pausado' : performance.now() < clipUntil ? 'CLIP · reduza' : `${Number.isFinite(level.db) ? level.db.toFixed(0) : '−∞'} dBFS`;
      $('level').classList.toggle('bad', performance.now() < clipUntil);
      meter.frame = requestAnimationFrame(update);
    }; update();
  } catch { context.close().catch(() => {}); $('level').textContent = 'Indisponível'; }
}
async function enumerateDevices() {
  if (!deviceAccess) return; // Labels and IDs are requested only after a user enabled capture.
  const devices = await navigator.mediaDevices.enumerateDevices();
  for (const [kind, select, defaults] of [
    ['videoinput', $('camera'), [['', 'Câmera automática'], ['user', 'Câmera frontal'], ['environment', 'Câmera traseira']]],
    ['audioinput', $('microphone'), [['', 'Entrada de áudio padrão']]],
  ]) {
    const selected = select.value;
    select.replaceChildren(...defaults.map(([value, label]) => new Option(label, value)));
    devices.filter(device => device.kind === kind && device.deviceId).forEach((device, i) => select.add(new Option(device.label || `${kind === 'videoinput' ? 'Câmera' : 'Entrada de áudio'} ${i + 1}`, `device:${device.deviceId}`)));
    select.value = [...select.options].some(option => option.value === selected) ? selected : '';
  }
  return devices;
}
async function watchPermissions(current) {
  for (const name of ['camera', 'microphone']) {
    try {
      const permission = await navigator.permissions.query({ name });
      if (stream !== current) return;
      const handler = () => { if (permission.state === 'denied' && stream === current) interrupted('A permissão de câmera ou microfone foi revogada.'); };
      permission.addEventListener('change', handler); permissionCleanup.push(() => permission.removeEventListener('change', handler)); handler();
    } catch { /* Safari may expose track events instead of Permissions API. */ }
  }
}
async function activate() {
  if (!['idle', 'error', 'recorded'].includes(phase)) return;
  const token = ++generation; setPhase('requesting'); status('Aguardando permissão de câmera e microfone…');
  let context;
  try {
    if (!isSecureContext || !navigator.mediaDevices?.getUserMedia) throw Error('Abra a Central de Mídia por HTTPS para usar câmera e áudio.');
    if (typeof MediaRecorder === 'undefined' || !supportedMimeTypes(type => MediaRecorder.isTypeSupported(type)).length) throw Error('Este navegador não oferece gravação MP4/WebM com câmera e áudio. Use um navegador atualizado.');
    // Resume in the click gesture. This graph never sends sound to the destination.
    try { context = new (window.AudioContext || window.webkitAudioContext)(); context.resume().catch(() => {}); } catch { /* The recorder works without a meter. */ }
    const received = await navigator.mediaDevices.getUserMedia(captureConstraints($('camera').value, $('microphone').value));
    if (token !== generation || document.hidden) { received.getTracks().forEach(track => track.stop()); await context?.close(); return; }
    if (!received.getAudioTracks().length || !received.getVideoTracks().length) { received.getTracks().forEach(track => track.stop()); throw Error('Selecione uma câmera e uma entrada de áudio válidas.'); }
    stream = received; deviceAccess = true;
    for (const track of stream.getTracks()) {
      track.addEventListener('ended', () => { if (stream === received) interrupted('Câmera ou áudio desconectado, ou permissão revogada.'); });
      track.addEventListener('mute', () => { if (stream === received) interrupted('O navegador suspendeu uma das entradas. A captura foi encerrada.'); });
    }
    $('playback').pause();
    document.dispatchEvent(new CustomEvent('aps-recording-preview'));
    $('live').muted = true; $('live').srcObject = stream;
    await $('live').play();
    if (token !== generation || stream !== received) { await context?.close().catch(() => {}); return; }
    startMeter(context); await enumerateDevices();
    if (token !== generation || stream !== received) return;
    setPhase('preview'); idleTimeout(); watchPermissions(received);
    const camera = stream.getVideoTracks()[0], mic = stream.getAudioTracks()[0];
    status(`Prévia ativa · ${camera.label || 'câmera'} · ${mic.label || 'entrada de áudio'}. Confira o nível e toque em Iniciar.`);
  } catch (error) {
    await context?.close().catch(() => {});
    if (token !== generation) return;
    releaseDevices(); setPhase('error'); status(messageFor(error), true);
  }
}
async function forgetSaved() {
  $('playback').pause(); $('playback').removeAttribute('src'); $('playback').load();
  if (savedUrl) URL.revokeObjectURL(savedUrl);
  savedFile = savedUrl = verification = null; $('result').hidden = true;
  $('download').removeAttribute('href');
  // The editor may still be reading this disk-backed File after recorder discard.
  const old = savedStore; savedStore = null; if (old !== editorStore) await old?.dispose();
}
function tick() {
  if (phase !== 'recording') return;
  const elapsed = performance.now() - startedAt, seconds = Math.floor(elapsed / 1000);
  $('counter').textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')} / 10:00 · ${((store?.bytes || 0) / 1048576).toFixed(1)} MB`;
  const reason = stopReason(elapsed, store?.bytes || 0, store?.budget);
  if (reason) stop(labels[reason]);
}
async function start() {
  if (phase !== 'preview' || !stream) return;
  const token = ++generation; clearTimeout(idleTimer); setPhase('preparing'); status('Preparando espaço local para a gravação…');
  const current = stream;
  try {
    const nextStore = await createChunkStore();
    if (token !== generation || stream !== current) { await nextStore.dispose(); return; }
    store = nextStore;
    const candidates = supportedMimeTypes(type => MediaRecorder.isTypeSupported(type));
    let selected;
    for (const mimeType of candidates) {
      try { selected = new MediaRecorder(current, { mimeType, videoBitsPerSecond: 3000000, audioBitsPerSecond: 128000 }); break; }
      catch { /* A supported container may still fail with this device configuration. */ }
    }
    if (!selected) throw Error('Não foi possível iniciar os codecs oferecidos pelo navegador. Selecione outro dispositivo ou navegador.');
    recorder = selected; discard = false; failure = null; stopMessage = '';
    recorder.ondataavailable = event => {
      if (!event.data.size || discard) return;
      store.append(event.data).catch(error => { failure = error; if (phase === 'recording') stop('O armazenamento foi interrompido.'); });
      const reason = stopReason(performance.now() - startedAt, store.bytes, store.budget);
      if (reason && phase === 'recording') stop(labels[reason]);
    };
    recorder.onerror = event => { failure = event.error || Error('O navegador interrompeu a codificação.'); if (phase === 'recording') stop('Falha no gravador.'); };
    recorder.onstop = () => { finish().catch(error => { releaseDevices(); if (phase !== 'error') setPhase('error'); status(messageFor(error), true); }); };
    await forgetSaved();
    if (token !== generation || stream !== current) return;
    // One MediaRecorder records the ORIGINAL combined stream. No independent A/V clocks.
    recorder.start(LIMITS.chunkMs); startedAt = performance.now();
    setPhase('recording');
    $('format').textContent = `${recorder.mimeType || candidates[0]} · ${store.mode === 'disk' ? 'armazenamento local' : 'memória temporária, limite de 96 MB'} · teto ${(store.budget / 1048576).toFixed(0)} MB`;
    status('Gravando câmera e áudio. Mantenha esta tela aberta. A prévia permanece sem som para evitar microfonia.');
    timer = setInterval(tick, 200); deadline = setTimeout(() => stop(labels.time), LIMITS.stopAfterMs); tick();
  } catch (error) {
    if (token !== generation) return;
    releaseDevices(); await store?.dispose(); store = null; recorder = null;
    setPhase('error'); status(messageFor(error), true);
  }
}
function stop(message = 'Gravação encerrada.') {
  if (phase !== 'recording') return;
  stopMessage = message; clearTimers(); setPhase('stopping'); status('Finalizando os blocos da gravação…');
  try { if (recorder.state !== 'inactive') recorder.stop(); }
  catch (error) { failure = error; }
  releaseDevices(); // Release camera, microphone and RMS graph immediately.
}
async function finish() {
  if (phase === 'recording') { stopMessage = 'O navegador encerrou a gravação.'; clearTimers(); setPhase('stopping'); releaseDevices(); }
  const completed = store; store = null; const mime = recorder?.mimeType; recorder = null;
  try {
    if (discard) { await completed?.dispose(); setPhase('idle'); status('Gravação cancelada e descartada. Câmera e áudio desligados.'); return; }
    if (failure) throw failure;
    const blob = await completed.finish(mime);
    if (!blob.size) throw Error('O navegador gerou um arquivo vazio. Grave um trecho maior.');
    const extension = extensionForMime(mime), stamp = new Date().toISOString().replace(/[:.]/g, '-');
    savedFile = new File([blob], `APS-gravacao-${stamp}.${extension}`, { type: mime }); savedStore = completed;
    savedUrl = URL.createObjectURL(savedFile); $('playback').src = savedUrl; $('playback').load();
    $('download').href = savedUrl; $('download').download = savedFile.name;
    $('file').textContent = `${savedFile.name} · ${(savedFile.size / 1048576).toFixed(2)} MB`;
    $('result').hidden = false; setPhase('verifying'); status('Reabrindo o arquivo gravado para conferir vídeo e áudio…');
    try {
      const { verifyRecording } = await import('./verify-recording.js');
      verification = await verifyRecording(savedFile);
      $('verify').textContent = `${verification.duration.toFixed(2)} s · vídeo ${verification.videoCodec} · áudio ${verification.audioCodec}\nArquivo reaberto: imagem ${verification.decodedVideo ? 'decodificada' : 'sem decodificação disponível'}, áudio ${verification.decodedAudio ? 'decodificado' : 'sem decodificação disponível'}. Diferença entre os inícios das faixas: ${verification.startDifferenceMs.toFixed(1)} ms.\n${verification.decodedAudio && verification.rms < 0.0001 ? 'O início contém silêncio ou sinal muito baixo. Confira o som completo.' : 'Reproduza e confira a imagem e o som no início, meio e final.'}${!verification.withinLimits ? '\nDuração acima de 10 minutos: baixe o original e recorte antes de editar.' : ''}\nA medição dos timestamps não verifica o sincronismo da execução musical.`;
    } catch (error) {
      verification = null; $('verify').textContent = `${messageFor(error)} O original continua disponível para download. A edição só é liberada após a leitura das duas faixas.`;
    }
    setPhase('recorded'); status(`${stopMessage} Original pronto. Confira a reprodução e baixe sua cópia.`);
  } catch (error) {
    await completed?.dispose(); setPhase('error'); status(messageFor(error), true);
  }
}
function interrupted(message) {
  if (phase === 'recording') { stop(message); return; }
  if (['stopping', 'verifying'].includes(phase)) return;
  ++generation; releaseDevices();
  const pending = store; store = null; pending?.dispose();
  setPhase(savedFile ? 'idle' : 'error'); status(message, true);
}
function cancel() {
  if (phase === 'recording') { discard = true; stop('Gravação cancelada.'); }
  else if (phase === 'preparing') { ++generation; releaseDevices(); store?.dispose(); store = null; recorder = null; setPhase('idle'); status('Gravação cancelada.'); }
}
function turnOff() {
  ++generation; releaseDevices(); setPhase('idle'); status('Câmera e áudio desligados.');
}
$('activate').addEventListener('click', activate);
$('start').addEventListener('click', start);
$('stop').addEventListener('click', () => stop());
$('cancel').addEventListener('click', cancel);
$('off').addEventListener('click', turnOff);
$('refresh').addEventListener('click', () => enumerateDevices().catch(error => status(messageFor(error), true)));
for (const id of ['camera', 'microphone']) $(id).addEventListener('change', () => { if (stream) { turnOff(); status('Seleção alterada. Toque em Ativar câmera e áudio para usar os dispositivos escolhidos.'); } });
$('play').addEventListener('click', () => { $('playback').currentTime = 0; $('playback').play().catch(error => status(messageFor(error), true)); });
$('playback').addEventListener('play', () => { if (phase === 'preview') { releaseDevices(); setPhase('recorded'); } document.dispatchEvent(new CustomEvent('aps-recording-preview')); });
$('discard').addEventListener('click', async () => { await forgetSaved(); if (phase === 'recorded') setPhase('idle'); else setPhase(phase); status('Gravação descartada.'); });
$('open').addEventListener('click', async () => {
  if (!savedFile || !verification?.withinLimits) return;
  if (stream) { releaseDevices(); setPhase('recorded'); }
  $('playback').pause(); opening = true; setPhase(phase); status('Abrindo a gravação no editor…');
  const previousStore = editorStore; editorStore = savedStore;
  try {
    const { importRecording } = await import('../media-ui.js?v=live-recording-20261025');
    await importRecording(savedFile);
    if (previousStore && previousStore !== editorStore) await previousStore.dispose();
    status('Gravação aberta no editor com o áudio original.');
    document.getElementById('media-editor').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) { editorStore = previousStore; status(`Não foi possível abrir no editor: ${messageFor(error)} Baixe o original para preservar sua gravação.`, true); }
  finally { opening = false; setPhase(phase); }
});
navigator.mediaDevices?.addEventListener?.('devicechange', async () => {
  if (!deviceAccess) return;
  try {
    const devices = await enumerateDevices();
    if (stream && devices.length) {
      const lost = stream.getTracks().some(track => { const id = track.getSettings().deviceId; return id && !devices.some(device => device.deviceId === id); });
      if (lost) interrupted('O dispositivo em uso foi desconectado. Selecione outra entrada e ative novamente.');
    }
  } catch { if (stream) interrupted('Não foi possível consultar os dispositivos em uso. Ative novamente.'); }
});
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) return;
  if (phase === 'recording') stop('Captura encerrada porque a tela foi ocultada.');
  else if (phase === 'preparing') cancel();
  else if (['requesting', 'preview'].includes(phase)) turnOff();
});
window.addEventListener('pagehide', () => {
  ++generation; discard = true;
  if (phase === 'recording') stop('Página fechada.');
  clearTimers(); releaseDevices(); store?.dispose(); savedStore?.dispose(); editorStore?.dispose();
  if (savedUrl) URL.revokeObjectURL(savedUrl);
});
window.addEventListener('pageshow', event => {
  if (!event.persisted) return;
  editorStore = null; opening = false;
  forgetSaved().then(() => { setPhase('idle'); status('Captura desligada ao sair da página. Ative novamente para gravar.'); });
});
setPhase('idle');
if (!isSecureContext || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
  $('activate').disabled = true; status('Captura indisponível neste navegador. Abra a página por HTTPS em um navegador com MediaRecorder.', true);
}
