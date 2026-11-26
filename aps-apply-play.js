/* APS Aplicar + Ouvir — barra fixa logo abaixo do editor (Quantização e Afinação).
 * - Botão principal "✓ Aplicar … na música" (verde) + "↶ Desfazer" ao lado, selo "aplicada · original guardado"
 *   e aviso discreto "Alterações prontas para aplicar" quando há mudanças ainda não aplicadas.
 * - Play grande "▶ Ouvir …" / "⏹ Parar", seletor Ouvir: Editado | Original (A/B), Solo nesta pista | Música toda,
 *   Metrônomo e tempo/progresso sincronizados com o cursor (playhead) do gráfico.
 * O áudio original nunca é tocado/alterado aqui: o player só lê buffers. Mobile-first (botões ≥ 48 px).
 * Uso: APSApplyPlay.mount(host, opts) — opts: idPrefix, applyButton, undoButton, applyLabel, playLabel,
 *   scopes (bool), metronome ({get(), set(on), info()}), audio({listen, scope}) -> Promise<{ctx, from, items:[{buffer,start}], until?, label}>,
 *   onPlayhead(sessionTime|null), extras: [{id, label, onClick, cls}], record ({isRecording(), toggle(), onDone?()}),
 *   sticky (padrão true: a barra gruda no rodapé da área rolável enquanto o editor está na tela) */
(function (root) {
'use strict';
const CSS = `.aps-ap-host{position:sticky;bottom:0;z-index:6;margin-top:10px}.aps-ap-host.aps-ap-flow{position:relative}
.aps-ap{background:linear-gradient(180deg,rgba(13,19,30,.97),#0d131e);border:1px solid #3f8f6a;border-radius:14px;padding:10px;box-shadow:0 -8px 22px rgba(0,0,0,.45);color:#e8ebf1}
.aps-ap .aprow{display:flex;gap:8px;align-items:stretch;flex-wrap:wrap}.aps-ap .aprow+.aprow{margin-top:8px}
.aps-ap button{font:inherit;cursor:pointer;border-radius:12px!important;font-weight:800;line-height:1.15;min-height:46px!important}
.aps-ap button:disabled{opacity:.45;cursor:not-allowed}
.aps-ap .apply-main{flex:1 1 220px;min-height:52px!important;font-size:16px!important;padding:8px 14px!important;border:1px solid #2fae6f!important;background:linear-gradient(180deg,#38c77e,#25a463)!important;color:#06180e!important;box-shadow:0 2px 0 #1a7a49}
.aps-ap .apply-main.done{background:linear-gradient(180deg,#1f5a40,#184a35)!important;color:#c8f5dc!important;border-color:#3f8f6a!important;box-shadow:none}
.aps-ap .undo{flex:0 0 auto;min-height:52px!important;padding:8px 14px!important;font-size:14px!important;background:#223047!important;color:#f1d5a5!important;border:1px solid #7d6847!important}
.aps-ap .extra{flex:1 1 180px;padding:8px 12px!important;font-size:14px!important;background:#1d3a52!important;color:#d9f2ff!important;border:1px solid #3e7fa8!important}
.aps-ap .apmsg{font-size:12.5px;line-height:1.3;margin:6px 2px 0;color:#cfe0d6}.aps-ap .apmsg:empty{display:none}
.aps-ap .apmsg.dirty{color:#ffd58a}.aps-ap .apmsg.dirty::before{content:'● ';color:#ffb347}
.aps-ap .apmsg.ok{color:#9df0c2}
.aps-ap .apsep{height:1px;background:#263449;margin:8px 0}
.aps-ap .play{flex:1 1 260px;min-height:52px!important;font-size:16px!important;padding:8px 14px!important;border:1px solid #4aa3c4!important;background:linear-gradient(180deg,#5fd0ef,#36a9cf)!important;color:#04141c!important}
.aps-ap .play.on{background:linear-gradient(180deg,#ff8c7a,#e5604c)!important;border-color:#e5604c!important;color:#1d0703!important}
.aps-ap .seg{display:flex;flex:1 1 260px;border:1px solid #4b5d78;border-radius:12px;overflow:hidden}
.aps-ap .seg button{flex:1;border:0!important;border-radius:0!important;background:#18233a!important;color:#cfd8e6!important;font-size:13.5px!important;padding:5px 8px!important;box-shadow:none}
.aps-ap .seg button+button{border-left:1px solid #4b5d78!important}
.aps-ap .seg button.on{background:#e2bc76!important;color:#17202b!important}
.aps-ap .metro{flex:0 0 auto;padding:5px 12px!important;font-size:13.5px!important;background:#223047!important;color:#f1d5a5!important;border:1px solid #7d6847!important}.aps-ap .metro.on{background:#59cde6!important;color:#0d1a24!important;border-color:#59cde6!important}
.aps-ap .rec{flex:0 0 auto;padding:5px 14px!important;font-size:15px!important;background:#2a1418!important;color:#ff8f8f!important;border:1px solid #c0454f!important}
.aps-ap .rec.on{background:linear-gradient(180deg,#ff4d5e,#d92c3d)!important;color:#fff!important;border-color:#ff4d5e!important;animation:apsRecPulse 1.1s ease-in-out infinite}
@keyframes apsRecPulse{50%{box-shadow:0 0 0 5px rgba(255,77,94,.35)}}
.aps-ap .prog{display:flex;align-items:center;gap:8px;margin-top:8px;min-height:16px}.aps-ap .apbar,.aps-ap .apbar i{box-sizing:border-box}
.aps-ap .apbar{flex:1;height:8px;background:#1b283b;border-radius:6px;overflow:hidden;border:1px solid #33445c}.aps-ap .apbar i{display:block;height:100%;width:0;background:linear-gradient(90deg,#59cde6,#e2bc76)}
.aps-ap .aptime{font:700 12.5px ui-monospace,Menlo,monospace;color:#e6eefb;min-width:92px;text-align:right}
.aps-ap .plabel{font-size:12px;color:#aebbd0;margin-top:4px}.aps-ap .plabel:empty{display:none}
@media(max-width:560px){.aps-ap{padding:8px;border-radius:12px}.aps-ap .aprow{gap:6px;flex-wrap:nowrap}.aps-ap .aprow+.aprow{margin-top:6px}
 .aps-ap .apply-main{flex:1 1 auto;font-size:15px!important;padding:6px 10px!important}.aps-ap .undo{padding:6px 10px!important;font-size:13px!important}
 .aps-ap .play{flex:1 1 auto;font-size:14.5px!important;padding:6px 8px!important}.aps-ap .seg{flex:1 1 50%}.aps-ap .lt{display:none}.aps-ap .rec{padding:5px 10px!important;font-size:14px!important}.aps-ap .seg button{font-size:12.5px!important;padding:4px 5px!important}
 .aps-ap .r1{flex-wrap:wrap}.aps-ap .r1 .apply-main{flex-basis:60%}.aps-ap .extra{flex:1 1 100%}
 .aps-ap .metro{padding:4px 12px!important;font-size:16px!important}.aps-ap .plabel{display:none}.aps-ap .prog{margin-top:6px;padding-right:58px}}`;
function injectCss() { if (document.getElementById('apsApCss')) return; const s = document.createElement('style'); s.id = 'apsApCss'; s.textContent = CSS; document.head.appendChild(s); }
const fmt = s => { s = Math.max(0, s || 0); const m = Math.floor(s / 60), r = s - m * 60; return m + ':' + (r < 10 ? '0' : '') + r.toFixed(1); };

function mount(host, o) {
  injectCss();
  const P = o.idPrefix || 'apsAp', id = s => P + s;
  host.classList.add('aps-ap-host'); if (o.sticky === false) host.classList.add('aps-ap-flow');
  host.innerHTML = `<div class="aps-ap" data-aps-apply-play role="region" aria-label="Aplicar e ouvir">
 <div class="aprow r1" id="${id('ApplyRow')}"></div>
 <div class="apmsg" id="${id('Msg')}" role="status" aria-live="polite"></div>
 <div class="apsep"></div>
 <div class="aprow r2"><button type="button" class="play" id="${id('Play')}" aria-pressed="false">${o.playLabel || '▶ Ouvir o que está sendo feito'}</button>${o.record ? `<button type="button" class="rec" id="${id('Rec')}" aria-pressed="false" title="Gravar sem sair desta tela">● Gravar</button>` : ''}${o.metronome ? `<button type="button" class="metro" id="${id('Metro')}" aria-pressed="false" title="Metrônomo">♩<span class="lt"> Metrônomo</span></button>` : ''}</div>
 <div class="aprow r3" id="${id('ScopeRow')}"><div class="seg" role="group" aria-label="Ouvir: editado ou original (A/B)"><button type="button" id="${id('Edit')}" class="on" aria-pressed="true" title="Ouvir: com a edição">Editado</button><button type="button" id="${id('Orig')}" aria-pressed="false" title="Ouvir: gravação original (A/B)">Original (A/B)</button></div>${o.scopes === false ? '' : `<div class="seg" role="group" aria-label="Tocar só a pista ou a música toda"><button type="button" id="${id('Solo')}" class="on" aria-pressed="true">🎧 Solo nesta pista</button><button type="button" id="${id('All')}" aria-pressed="false">🎶 Música toda</button></div>`}</div>
 <div class="prog"><div class="apbar" aria-hidden="true"><i id="${id('Bar')}"></i></div><span class="aptime" id="${id('Time')}">0:00.0 / 0:00.0</span></div>
 <div class="plabel" id="${id('Label')}"></div></div>`;
  const $ = s => document.getElementById(id(s));
  const row = $('ApplyRow');
  if (o.applyButton) { o.applyButton.classList.add('apply-main'); if (o.applyLabel) o.applyButton.textContent = o.applyLabel; row.appendChild(o.applyButton); }
  if (o.undoButton) { o.undoButton.classList.add('undo'); o.undoButton.classList.remove('alt'); row.appendChild(o.undoButton); }
  const extras = {};
  for (const x of o.extras || []) { const b = document.createElement('button'); b.type = 'button'; b.className = 'extra' + (x.cls ? ' ' + x.cls : ''); b.id = x.id; b.textContent = x.label; b.hidden = !!x.hidden; b.addEventListener('click', () => Promise.resolve().then(() => x.onClick()).catch(e => msg(e.message || String(e)))); row.appendChild(b); extras[x.id] = b; }
  const st = { listen: 'edit', scope: 'solo', playing: null, raf: 0, msg: '', kind: '' };
  const metro = o.metronome && root.APSQuantRhythm ? root.APSQuantRhythm.Metronome() : null;
  function msg(t, kind) { const e = $('Msg'); e.textContent = t || ''; e.className = 'apmsg' + (kind ? ' ' + kind : ''); st.msg = t; st.kind = kind || ''; }
  function seg() {
    $('Edit').classList.toggle('on', st.listen === 'edit'); $('Orig').classList.toggle('on', st.listen === 'orig');
    $('Edit').setAttribute('aria-pressed', String(st.listen === 'edit')); $('Orig').setAttribute('aria-pressed', String(st.listen === 'orig'));
    if ($('Solo')) { $('Solo').classList.toggle('on', st.scope === 'solo'); $('All').classList.toggle('on', st.scope === 'all');
      $('Solo').setAttribute('aria-pressed', String(st.scope === 'solo')); $('All').setAttribute('aria-pressed', String(st.scope === 'all')); }
    if ($('Metro')) { const on = !!(o.metronome && o.metronome.get()); $('Metro').classList.toggle('on', on); $('Metro').setAttribute('aria-pressed', String(on)); $('Metro').innerHTML = on ? '♩<span class="lt"> Metrônomo: ligado</span>' : '♩<span class="lt"> Metrônomo</span>'; }
    if ($('Rec')) { const r = !!st.rec; $('Rec').classList.toggle('on', r); $('Rec').setAttribute('aria-pressed', String(r)); $('Rec').textContent = r ? '⏹ Parar' : '● Gravar'; }
    const p = $('Play'); p.classList.toggle('on', !!st.playing); p.setAttribute('aria-pressed', String(!!st.playing)); p.textContent = st.playing ? '⏹ Parar' : (o.playLabel || '▶ Ouvir o que está sendo feito');
  }
  function tick() {
    const pl = st.playing; if (!pl) return;
    const pos = Math.max(pl.from, pl.from + (pl.ctx.currentTime - pl.t0)), span = Math.max(0.001, pl.until - pl.start);
    $('Bar').style.width = Math.min(100, Math.max(0, (pos - pl.start) / span * 100)).toFixed(2) + '%';
    $('Time').textContent = fmt(pos - pl.start) + ' / ' + fmt(span);
    st.pos = pos; o.onPlayhead && o.onPlayhead(pos);
    st.raf = root.requestAnimationFrame(tick);
  }
  function stop(silent, why) {
    if (st.playing) { const L = root.__apsApplyPlayStops || (root.__apsApplyPlayStops = []); L.push({ prefix: P, why: why || (silent ? 'silent' : 'user'), at: st.playing.ctx.currentTime - st.playing.t0 }); if (L.length > 50) L.shift(); } // diagnóstico
    const pl = st.playing; st.playing = null; if (st.raf) root.cancelAnimationFrame(st.raf); st.raf = 0;
    if (pl) for (const s of pl.srcs) { try { s.onended = null; s.stop(); } catch (_) {} }
    if (metro) metro.stop();
    o.onPlayhead && o.onPlayhead(null); seg();
    if (pl && !silent) $('Label').textContent = 'Parado. Toque ▶ para ouvir de novo.';
  }
  async function start(fromOverride) {
    if (APSApplyPlay.current && APSApplyPlay.current !== api) APSApplyPlay.current.stop(true);
    const a = await o.audio({ listen: st.listen, scope: st.scope });
    if (!a || !a.ctx || !a.items || !a.items.length) throw Error('Carregue e analise o áudio primeiro.');
    await a.ctx.resume();
    const from = Math.max(0, fromOverride != null ? fromOverride : a.from || 0), t0 = a.ctx.currentTime + 0.06, srcs = [];
    let until = from, s0 = Infinity;
    for (const it of a.items) {
      if (!it.buffer) continue; s0 = Math.min(s0, it.start); until = Math.max(until, it.start + it.buffer.duration);
      const local = from - it.start; if (local >= it.buffer.duration) continue;
      const src = a.ctx.createBufferSource(); src.buffer = it.buffer;
      let out = a.destination || a.ctx.destination; if (it.gain != null && it.gain !== 1) { const g = a.ctx.createGain(); g.gain.value = it.gain; g.connect(out); out = g; }
      src.connect(out); if (local >= 0) src.start(t0, local); else src.start(t0 - local, 0); srcs.push(src);
    }
    if (!srcs.length) throw Error('Nada para tocar nesta posição.');
    st.playing = { ctx: a.ctx, t0, from, srcs, until: a.until || until, start: Number.isFinite(a.start) ? a.start : Math.max(0, Math.min(s0, from)) };
    let ended = 0; srcs.forEach(s => s.onended = () => { if (++ended >= srcs.length && st.playing && st.playing.srcs === srcs) stop(false, 'ended'); });
    if (metro && o.metronome.get()) { const mi = o.metronome.info(); metro.volume = mi.volume ?? 0.35; metro.start(a.ctx, { when: t0, from, gridZero: mi.gridZero || 0, bpm: mi.bpm, sig: mi.sig, until: st.playing.until }); }
    APSApplyPlay.current = api;
    $('Label').textContent = (st.listen === 'edit' ? '▶ Editado' : '▶ Original (A)') + ' · ' + (st.scope === 'all' ? 'música toda' : 'solo nesta pista') + (metro && o.metronome.get() ? ' · com metrônomo' : '') + (a.label ? ' · ' + a.label : '');
    root.__apsApplyPlayLast = { prefix: P, listen: st.listen, scope: st.scope, items: srcs.length, from, t0, until: st.playing.until, buffers: a.items.map(i => i.buffer), spans: a.items.map(i => [i.start, i.buffer && i.buffer.duration]) };
    seg(); tick();
  }
  let busy = false;
  async function toggle() {
    if (st.playing) { stop(); return; }
    if (busy) return; busy = true; $('Play').disabled = true;
    try { $('Label').textContent = st.listen === 'edit' ? 'Preparando a prévia…' : 'Preparando…'; $('Play').textContent = '⏳ Preparando…'; await start(); }
    catch (e) { $('Label').textContent = e.message || String(e); msg('⚠ ' + (e.message || String(e))); }
    finally { busy = false; $('Play').disabled = false; seg(); }
  }
  // reinicia do mesmo ponto (troca A/B, solo/música toda ou prévia nova) sem o usuário perder o lugar
  async function restart() { if (!st.playing) return; const pos = st.pos != null ? st.pos : st.playing.from; stop(true); try { await start(pos); } catch (e) { $('Label').textContent = e.message || String(e); } }
  const choose = (k, v) => () => { if (st[k] === v) return; st[k] = v; seg(); restart(); o.onChoice && o.onChoice(k, v); };
  $('Play').addEventListener('click', toggle);
  $('Edit').addEventListener('click', choose('listen', 'edit')); $('Orig').addEventListener('click', choose('listen', 'orig'));
  if ($('Solo')) { $('Solo').addEventListener('click', choose('scope', 'solo')); $('All').addEventListener('click', choose('scope', 'all')); }
  // ● Gravar: grava sem sair da tela (DAW: o próprio gravador do estúdio; páginas solo: microfone)
  if (o.record) {
    st.rec = !!o.record.isRecording();
    $('Rec').addEventListener('click', () => Promise.resolve().then(async () => {
      if (!st.rec) { stop(true); msg('● Gravando… toque ⏹ Parar quando terminar.', 'dirty'); }
      await o.record.toggle(); poll();
    }).catch(e => msg('⚠ ' + (e.message || String(e)))));
    const poll = () => { const r = !!o.record.isRecording(); if (r === st.rec) return; st.rec = r; seg(); if (!r) Promise.resolve().then(async () => { const ok = o.record.onDone ? await o.record.onDone() : true; if (ok === false) msg('⏹ Gravação parada (sem nova tomada). Toque ● Gravar para tentar de novo.'); }).catch(e => msg('⚠ ' + (e.message || String(e)))); };
    setInterval(poll, 250);
  }
  if ($('Metro')) $('Metro').addEventListener('click', () => { o.metronome.set(!o.metronome.get()); seg(); restart(); });
  seg();
  const api = { el: host.firstElementChild, msg, stop, restart, toggle, play: () => st.playing ? Promise.resolve() : toggle(), isPlaying: () => !!st.playing, listen: () => st.listen, scope: () => st.scope,
    setListen: v => choose('listen', v)(), setScope: v => choose('scope', v)(), extras, sync: seg, state: st, metro };
  host.__apsApplyPlay = api; return api;
}
// Páginas solo (quantizacao.html / afinacao.html): envia o resultado para a DAW pelo mesmo canal do Separador
// (IndexedDB aps-stems-transfer-v1 → daw.html?importStems=1). O arquivo original continua intacto.
async function sendToDaw(buffer, name, stemId) {
  if (!buffer) throw Error('Aplique primeiro: depois envie para a DAW.');
  if (!root.indexedDB) throw Error('Este navegador não permite enviar para a DAW. Baixe o WAV e importe no estúdio.');
  const blob = root.APSElastic.wav16(buffer);
  const db = await new Promise((ok, no) => { const r = root.indexedDB.open('aps-stems-transfer-v1', 1); r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains('sessions')) r.result.createObjectStore('sessions'); }; r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); });
  await new Promise((ok, no) => { const tx = db.transaction('sessions', 'readwrite'); tx.objectStore('sessions').put({ id: Date.now() + '', name: 'APS ' + name, stems: [{ id: stemId || 'other', name: name + '.wav', type: 'audio/wav', blob }], createdAt: Date.now() }, 'latest'); tx.oncomplete = ok; tx.onerror = () => no(tx.error); });
  db.close();
  if (!root.__apsNoNavigate) root.location.href = './daw.html?modulo=gravacao&importStems=1';
  return true;
}
// Gravador simples de microfone para as páginas solo (MediaRecorder → AudioBuffer). Nada sai do aparelho.
function micRecorder(getCtx) {
  let rec = null, stream = null, chunks = [], done = null;
  return {
    isRecording: () => !!rec,
    async start() {
      if (!navigator.mediaDevices || !root.MediaRecorder) throw Error('Este navegador não permite gravar pelo microfone.');
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
      chunks = []; rec = new MediaRecorder(stream);
      done = new Promise(res => { rec.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); }; rec.onstop = () => res(new Blob(chunks, { type: rec && rec.mimeType || 'audio/webm' })); });
      rec.start(250);
    },
    async stop() {
      if (!rec) return null; const r = rec; r.stop(); const blob = await done; rec = null;
      if (stream) stream.getTracks().forEach(t => t.stop()); stream = null;
      if (!blob.size) throw Error('A gravação ficou vazia. Confira a permissão do microfone.');
      return getCtx().decodeAudioData(await blob.arrayBuffer());
    }
  };
}
// DAW: "● Gravar" aciona o gravador do próprio estúdio (#record) sem sair da aba; ao parar, a pista gravada
// (nova ou a pista pendente preenchida) fica selecionada e entregue a onNew(track) para quantizar/afinar ali mesmo.
function dawRecord(B, onNew) {
  let before = null;
  const recNow = () => !!(B.isRecording && B.isRecording());
  return {
    isRecording: recNow,
    toggle: () => {
      const btn = document.getElementById('record'); if (!btn) throw Error('O gravador da DAW não está disponível nesta tela.');
      if (!recNow()) { before = new Map((B.all() || []).map(t => [t.id, t.buf])); if (root.APSApplyPlay.current) root.APSApplyPlay.current.stop(true); }
      btn.click();
    },
    onDone: async () => {
      if (!before) return false; const prev = before; let t = null;
      for (let i = 0; i < 40 && !t; i++) { t = (B.all() || []).find(x => x && x.buf && (!prev.has(x.id) || prev.get(x.id) !== x.buf)) || null; if (!t) await new Promise(r => setTimeout(r, 100)); }
      before = null; if (!t) return false;
      B.focus(t.id); root.__apsLastRecorded = t.id; if (onNew) await onNew(t); return true;
    }
  };
}
const APSApplyPlay = { mount, current: null, fmt, sendToDaw, micRecorder, dawRecord };
root.APSApplyPlay = APSApplyPlay;
})(typeof window !== 'undefined' ? window : globalThis);
