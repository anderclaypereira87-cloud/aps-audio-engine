/* APS DAW — vídeo opcional na mesma tomada da pista. Sem acesso a servidor. */
(function(root) {
  'use strict';
  const $ = id => document.getElementById(id);
  const anchor = $('recordHelp');
  if (!anchor) return;
  const panel = document.createElement('div');
  panel.className = 'aps-video-take';
  panel.innerHTML =
    '<label class="check"><input id="apsCamTake" type="checkbox"> 📹 Gravar vídeo junto com a pista de áudio</label>' +
    '<p class="sub">A câmera será solicitada somente ao iniciar uma gravação. O microfone/interface é o mesmo da pista; use fones para ouvir a base.</p>' +
    '<label class="mut" for="apsCamDevice">Câmera</label> ' +
    '<select id="apsCamDevice" aria-label="Câmera da tomada"><option value="user">Frontal / webcam</option><option value="environment">Traseira</option></select>' +
    '<video id="apsCamPreview" playsinline muted autoplay hidden></video>' +
    '<p id="apsCamStatus" class="sub" role="status" aria-live="polite">Vídeo desativado.</p>' +
    '<div id="apsCamResult" hidden><p class="sub">Tomada em vídeo salva neste aparelho.</p>' +
    '<video id="apsCamPlayback" playsinline controls preload="metadata"></video>' +
    '<div class="actions"><a id="apsCamDownload" class="mini" download>⬇ Baixar vídeo original</a>' +
    '<button type="button" id="apsCamAttach" class="mini">Inserir vídeo na DAW</button></div></div>';
  const style = document.createElement('style');
  style.textContent = '.aps-video-take{margin:14px 0;padding:12px;border:1px solid #66583d;border-radius:12px;background:#1c1e28}' +
    '.aps-video-take .check{margin-bottom:6px}.aps-video-take select{max-width:100%;padding:7px;border-radius:7px;background:#242d39;color:#fff;border:1px solid #484e60}' +
    '.aps-video-take video{margin:10px 0;width:100%;max-height:270px;background:#080a10;border-radius:9px}' +
    '.aps-video-take .actions{display:flex;gap:10px;flex-wrap:wrap;align-items:center}' +
    '.aps-video-take a{display:inline-block;padding:8px 12px;color:#f6d9a5;border:1px solid #66583d;border-radius:8px;text-decoration:none}';
  document.head.append(style);
  anchor.after(panel);

  const choice = $('apsCamDevice'), enabled = $('apsCamTake'), preview = $('apsCamPreview');
  const playback = $('apsCamPlayback'), results = $('apsCamResult'), download = $('apsCamDownload');
  const status = (message, bad) => {
    const node = $('apsCamStatus');
    node.textContent = message;
    node.style.color = bad ? '#ffb1aa' : '';
  };
  let camera = null, recorder = null, storage = null, stopPromise = null, stopping = false;
  let error = null, lastFile = null, lastUrl = null, startOffset = 0, startedAt = 0;
  let requestedStop = false, stoppedByLimit = false, maxTimer = 0;
  const MAX_MS = 599000;
  const MAX_BYTES = 768 * 1048576;
  const formats = [
    'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
    'video/webm;codecs=vp8,opus',
    'video/webm;codecs=vp9,opus',
    'video/mp4',
    'video/webm'
  ];
  function releaseCamera() {
    if (camera) camera.getTracks().forEach(t => t.stop());
    camera = null;
    preview.pause();
    preview.srcObject = null;
    preview.hidden = true;
    choice.disabled = false;
  }
  function clearPrevious() {
    if (lastUrl) URL.revokeObjectURL(lastUrl);
    lastUrl = null; lastFile = null;
    playback.removeAttribute('src');
    playback.load();
    results.hidden = true;
  }
  async function listCameras() {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    const devices = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput');
    const value = choice.value;
    choice.replaceChildren();
    for (const [id, name] of [['user', 'Frontal / webcam'], ['environment', 'Traseira']]) {
      choice.add(new Option(name, id));
    }
    devices.forEach((d, i) => choice.add(new Option(d.label || 'Câmera ' + (i + 1), 'device:' + d.deviceId)));
    if ([...choice.options].some(o => o.value === value)) choice.value = value;
  }
  async function prepare() {
    if (!enabled.checked) return false;
    if (!root.isSecureContext || !navigator.mediaDevices?.getUserMedia || !root.MediaRecorder) {
      throw Error('Câmera indisponível. Abra a DAW pelo endereço HTTPS no Chrome ou Safari.');
    }
    if (recorder || camera) await cancel();
    clearPrevious();
    status('Solicitando câmera ao aparelho…');
    try {
      const video = {width: {ideal: 1280}, height: {ideal: 720}, frameRate: {ideal: 30, max: 30}};
      if (choice.value.startsWith('device:')) video.deviceId = {exact: choice.value.slice(7)};
      else video.facingMode = {ideal: choice.value};
      camera = await navigator.mediaDevices.getUserMedia({video, audio: false});
      const mod = await import('./central-media/recording/chunk-store.js');
      storage = await mod.createChunkStore();
      await listCameras().catch(() => {});
      choice.disabled = true;
      preview.srcObject = camera;
      preview.hidden = false;
      await preview.play().catch(() => {});
      camera.getVideoTracks()[0].addEventListener('ended', () => {
        error = Error('A câmera foi desconectada ou perdeu a permissão.');
        if (recorder?.state === 'recording') {
          try { recorder.stop(); } catch {}
        } else {
          releaseCamera(); status(error.message, true);
        }
      }, {once: true});
      status('Câmera pronta. A contagem da DAW será respeitada.');
      return true;
    } catch (e) {
      await cancel();
      status('Vídeo indisponível: ' + (e?.message || e) + '. A pista de áudio pode continuar.', true);
      throw e;
    }
  }
  function start({micStream, audioContext, recordStart, recordAt}) {
    if (!camera || !storage) return false;
    const videoTrack = camera.getVideoTracks()[0], audioTrack = micStream?.getAudioTracks()[0];
    if (!videoTrack?.readyState || videoTrack.readyState !== 'live' || audioTrack?.readyState !== 'live') {
      throw Error('Câmera ou microfone desconectado. Grave a pista de áudio normalmente.');
    }
    const media = new MediaStream([videoTrack, audioTrack]);
    const mime = formats.find(type => { try { return MediaRecorder.isTypeSupported(type); } catch { return false; } });
    if (!mime) throw Error('Nenhum formato de vídeo com áudio é suportado neste navegador.');
    let rec;
    try { rec = new MediaRecorder(media, {mimeType: mime, videoBitsPerSecond: 2500000}); }
    catch { rec = new MediaRecorder(media, {mimeType: mime}); }
    recorder = rec; stopping = false; requestedStop = false; stoppedByLimit = false; error = null;
    stopPromise = new Promise(resolve => {
      rec.addEventListener('stop', resolve, {once: true});
    });
    rec.addEventListener('stop', () => { if (!requestedStop && !stoppedByLimit && !error) error = Error('A câmera parou antes do término da tomada.'); }, {once: true});
    rec.addEventListener('error', e => {
      error = Error(e.error?.message || 'O navegador interrompeu a gravação de vídeo.');
      status(error.message, true);
    });
    rec.addEventListener('dataavailable', e => {
      if (e.data?.size) storage.append(e.data).catch(failure => {
        error = failure;
        status('Falha ao salvar vídeo: ' + failure.message + '. O áudio WAV será preservado.', true);
        if (rec.state === 'recording') { try { rec.stop(); } catch {} }
      });
      if (storage.bytes >= Math.min(storage.budget, MAX_BYTES) - 4 * 1048576) {
        stoppedByLimit = true;
        if (rec.state === 'recording') { try { rec.stop(); } catch {} }
      }
    });
    // Mesmo AudioContext do gravador de pistas. Estima a posição do primeiro frame na DAW.
    const at = audioContext.currentTime;
    rec.start(1000);
    startOffset = Math.max(-300, Math.min(300, recordAt + at - recordStart));
    startedAt = performance.now();
    maxTimer = setTimeout(() => {
      stoppedByLimit = true;
      if (rec.state === 'recording') { try { rec.stop(); } catch {} }
    }, MAX_MS);
    status('Gravando câmera e microfone juntos. O vídeo será sincronizado à posição da pista.');
    return true;
  }
  async function finish() {
    if (!recorder) { releaseCamera(); return null; }
    if (stopping) return null;
    stopping = true;
    const rec = recorder, sink = storage;
    requestedStop = true;
    clearTimeout(maxTimer);
    try {
      if (rec.state === 'recording') rec.stop();
      let timer;
      await Promise.race([
        stopPromise,
        new Promise((_, reject) => { timer = setTimeout(() => reject(Error('O navegador demorou para finalizar o vídeo.')), 10000); })
      ]).finally(() => clearTimeout(timer));
      if (error) throw error;
      if (stoppedByLimit) throw Error('O vídeo atingiu o limite de tempo ou armazenamento antes do fim da pista.');
      const blob = await sink.finish(rec.mimeType);
      if (blob.size < 1024) throw Error('O vídeo gerado está vazio ou incompleto.');
      const ext = (rec.mimeType || '').startsWith('video/mp4') ? 'mp4' : 'webm';
      const file = new File([blob], 'APS-tomada-DAW-' + Date.now() + '.' + ext, {type: rec.mimeType});
      lastFile = file;
      lastUrl = URL.createObjectURL(file);
      playback.src = lastUrl;
      results.hidden = false;
      download.href = lastUrl;
      download.download = file.name;
      try {
        const {verifyRecording} = await import('./central-media/recording/verify-recording.js');
        const check = await verifyRecording(file);
        status('Vídeo pronto (' + (file.size / 1048576).toFixed(1) + ' MB). ' +
          'Arquivo com vídeo ' + check.videoCodec + ' e áudio ' + check.audioCodec +
          '; início das faixas difere ' + check.startDifferenceMs.toFixed(1) +
          ' ms. Confira o som e o alinhamento na DAW.');
      } catch (verifyError) {
        status('Vídeo salvo para download, mas não foi possível conferir as duas faixas: ' +
          verifyError.message + '. Ouça o arquivo antes de compartilhar.', true);
      }
      return {file, offset: startOffset, startedAt};
    } catch (e) {
      status('O vídeo não foi salvo: ' + (e?.message || e) + '. A pista WAV continua independente.', true);
      await sink?.dispose().catch(() => {});
      throw e;
    } finally {
      recorder = null; storage = null; stopPromise = null; stopping = false;
      releaseCamera();
    }
  }
  async function cancel() {
    clearTimeout(maxTimer);
    const rec = recorder, sink = storage;
    recorder = null; storage = null;
    if (rec?.state === 'recording') { try { rec.stop(); } catch {} }
    if (rec && stopPromise) {
      await Promise.race([stopPromise, new Promise(resolve => setTimeout(resolve, 2500))]).catch(() => {});
    }
    await sink?.dispose().catch(() => {});
    stopPromise = null;
    releaseCamera();
    if (!lastFile) status('Câmera desligada.');
  }
  $('apsCamAttach').addEventListener('click', () => {
    if (!lastFile) return;
    root.dispatchEvent(new CustomEvent('aps:daw-video-ready', {detail: {file: lastFile, offset: startOffset}}));
  });
  enabled.addEventListener('change', () => {
    if (!enabled.checked && !recorder) { void cancel(); }
    status(enabled.checked ? 'A câmera será ligada ao iniciar a próxima gravação.' : 'Vídeo desativado.');
  });
  root.addEventListener('pagehide', () => { void cancel(); });
  root.APSDawVideo = {isEnabled: () => enabled.checked, prepare, start, finish, cancel};
})(window);
