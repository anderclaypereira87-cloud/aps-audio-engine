/* APS MIDI na DAW — envia a pista selecionada para "MIDI e Sampler" (transcrição, quantização,
   timbres e reverb por convolução). A pista original nunca é alterada: o resultado volta como pista NOVA. */
(function () {
  const $ = (id) => document.getElementById(id);
  const B = () => window.APSMixBridge;
  function wavBlob(buf) {
    const ch = Math.min(2, buf.numberOfChannels), n = buf.length, sr = buf.sampleRate, out = new DataView(new ArrayBuffer(44 + n * ch * 2));
    const w = (o, s) => { for (let i = 0; i < s.length; i++) out.setUint8(o + i, s.charCodeAt(i)); };
    w(0, 'RIFF'); out.setUint32(4, 36 + n * ch * 2, true); w(8, 'WAVEfmt '); out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, ch, true);
    out.setUint32(24, sr, true); out.setUint32(28, sr * ch * 2, true); out.setUint16(32, ch * 2, true); out.setUint16(34, 16, true); w(36, 'data'); out.setUint32(40, n * ch * 2, true);
    const d = []; for (let c = 0; c < ch; c++) d.push(buf.getChannelData(c));
    let o = 44; for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) { const v = Math.max(-1, Math.min(1, d[c][i])); out.setInt16(o, v < 0 ? v * 0x8000 : v * 0x7fff, true); o += 2; }
    return new Blob([out], { type: 'audio/wav' });
  }
  function say(m) { const e = $('apsMidiMsg'); if (e) e.textContent = m; }
  async function send() {
    try {
      const b = B(); const id = b?.selectedId?.(); const buf = id && b.buffer?.(id); const row = id && (b.all?.() || []).find((t) => t.id === id);
      if (!buf) { say('Selecione uma pista com áudio primeiro.'); return; }
      say('Preparando a pista…');
      const blob = wavBlob(buf);
      const db = await new Promise((ok, no) => { const r = indexedDB.open('aps-midi-handoff-v1', 1); r.onupgradeneeded = () => r.result.createObjectStore('sessions'); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); });
      await new Promise((ok, no) => { const tx = db.transaction('sessions', 'readwrite'); tx.objectStore('sessions').put({ name: row?.name || 'Pista', blob, kind: $('apsMidiKind').value, bpm: window.APSMixBridge?.bpm?.() || 0, createdAt: Date.now() }, 'latest'); tx.oncomplete = ok; tx.onerror = () => no(tx.error); });
      db.close();
      window.open('./midi-sampler.html?import=1', '_blank');
      say('Aberto em outra aba. Edite as notas, escolha o timbre e use "Abrir no Estúdio" para trazer o resultado como pista nova.');
    } catch (e) { say('Não foi possível enviar a pista: ' + (e.message || e)); }
  }
  function mount() {
    if ($('apsMidiBox')) return true;
    const host = $('apsMasterPanel') || $('export')?.parentElement || $('apsBandMixer');
    if (!host || !B()) return false;
    const box = document.createElement('section');
    box.id = 'apsMidiBox'; box.className = 'aps-arranjo-box';
    box.innerHTML = '<h3>🎹 Transformar em MIDI</h3><p class="aps-arranjo-sub">Converte a pista selecionada em notas MIDI (no aparelho, sem custo), com quantização e timbres de piano, sanfona, bateria e suas próprias amostras. A pista original não é alterada.</p>' +
      '<label>Tipo de pista<select id="apsMidiKind"><option value="mono">Uma nota por vez (voz, baixo, sopro)</option><option value="poly">Várias notas juntas (piano, violão)</option><option value="drums">Bateria / percussão</option></select></label>' +
      '<div class="aps-arranjo-row"><button type="button" id="apsMidiGo">🎹 Transformar a pista em MIDI</button> <a href="./midi-sampler.html" target="_blank" rel="noopener" style="margin-left:8px">ou gravar um instrumento ao vivo →</a></div><p id="apsMidiMsg" class="aps-arranjo-msg" role="status"></p>';
    const ref = $('apsArranjoBox'); if (ref && ref.parentElement === host) ref.after(box); else host.append(box);
    $('apsMidiGo').addEventListener('click', send);
    return true;
  }
  let n = 0; const iv = setInterval(() => { if (mount() || ++n > 80) clearInterval(iv); }, 500);
})();
