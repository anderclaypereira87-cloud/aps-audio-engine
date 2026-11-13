/* APS — painel de EQ gráfico/paramétrico por pista, com curvas A/B da IA.
 * Usa o processador eq já existente (hpf/graves/médios/agudos) e soma 8 bandas.
 * Não envia o áudio bruto: só um resumo de espectro. */
(function () {
  'use strict';
  const C = () => window.APSEqGraficoCore;
  const ENDPOINT = 'https://aps-ia.aps-audio.workers.dev/eq';
  const B = () => window.APSMixBridge;
  const $ = (id) => document.getElementById(id);
  const clip = (x, a, b) => Math.min(b, Math.max(a, x));

  let mountedFor = null;
  let panelEl = null;
  let preview = null; // { kind:'A'|'B', bands }
  let pending = null; // { curveA, curveB, reason }
  let undoSnap = null;
  let drag = null;
  let selectedBand = 3;

  function coreOrThrow() {
    const k = C();
    if (!k) throw new Error('Núcleo do EQ gráfico ausente.');
    return k;
  }

  function trackOf(t) {
    return t || B()?.current?.() || null;
  }

  function ensure(t) {
    const k = coreOrThrow();
    if (!t) return null;
    t.graphicEq = k.sanitize(t.graphicEq);
    return t.graphicEq;
  }

  function snapGraphic(t) {
    const k = coreOrThrow();
    return {
      id: t.id,
      graphicEq: k.sanitize(t.graphicEq),
      bass: t.bass, mid: t.mid, midFreq: t.midFreq, treble: t.treble, hpf: t.hpf
    };
  }

  function pushUndo(t) {
    if (!t) return;
    undoSnap = snapGraphic(t);
    const u = $('apsGeqUndo');
    if (u) u.disabled = false;
  }

  function restoreUndo() {
    const t = trackOf();
    if (!t || !undoSnap || undoSnap.id !== t.id) return;
    t.graphicEq = coreOrThrow().sanitize(undoSnap.graphicEq);
    t.bass = undoSnap.bass; t.mid = undoSnap.mid; t.midFreq = undoSnap.midFreq;
    t.treble = undoSnap.treble; t.hpf = undoSnap.hpf;
    undoSnap = null;
    const u = $('apsGeqUndo');
    if (u) u.disabled = true;
    pending = null; preview = null;
    B()?.commit?.() || B()?.refresh?.();
    draw();
    say('EQ desfeito. Os valores voltaram ao que eram antes.', 'ok');
  }

  function say(text, kind) {
    const box = $('apsGeqMsg');
    if (!box) return;
    box.textContent = text;
    box.dataset.kind = kind || 'info';
  }

  function applyBands(t, bands, opts) {
    const k = coreOrThrow();
    if (!opts || !opts.silentUndo) pushUndo(t);
    t.graphicEq = k.sanitize({ bypass: false, bands });
    B()?.commit?.() || B()?.refresh?.();
    draw();
  }

  function xToFreq(x, w) {
    const a = Math.log(20), b = Math.log(20000);
    return Math.exp(a + (b - a) * clip(x / Math.max(1, w), 0, 1));
  }
  function freqToX(f, w) {
    const a = Math.log(20), b = Math.log(20000);
    return w * (Math.log(clip(f, 20, 20000)) - a) / (b - a);
  }
  function gToY(g, h) {
    return h * (0.5 - g / 36);
  }
  function yToG(y, h) {
    return clip(18 - (y / Math.max(1, h)) * 36, -18, 18);
  }

  function draw() {
    const canvas = $('apsGeqCanvas');
    const t = trackOf();
    const k = C();
    if (!canvas || !t || !k) return;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth || 320;
    const h = canvas.clientHeight || 120;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#111620';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#2a3348';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, h / 2);
    ctx.lineTo(w, h / 2);
    ctx.stroke();
    [100, 1000, 10000].forEach((f) => {
      const x = freqToX(f, w);
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
      ctx.fillStyle = '#667';
      ctx.font = '10px sans-serif';
      ctx.fillText(f >= 1000 ? f / 1000 + 'k' : String(f), x + 3, h - 4);
    });

    const freqs = k.logFreqs(160, 20, 20000);
    const plot = (dbs, color, width) => {
      ctx.beginPath();
      freqs.forEach((f, i) => {
        const x = freqToX(f, w);
        const y = gToY(clip(dbs[i], -18, 18), h);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.stroke();
    };

    const geq = ensure(t);
    const currentBands = preview ? preview.bands : geq.bands;
    const currentGeq = { bypass: preview ? false : geq.bypass, bands: currentBands };
    plot(k.combinedResponse({ bass: t.bass, mid: t.mid, midFreq: t.midFreq, treble: t.treble, hpf: t.hpf }, currentGeq, freqs), '#9edac0', 2);

    if (pending) {
      plot(k.graphicResponse({ bypass: false, bands: pending.curveA.bands }, freqs), '#7eb6ff', 1.5);
      plot(k.graphicResponse({ bypass: false, bands: pending.curveB.bands }, freqs), '#f0b07a', 1.5);
    }

    currentBands.forEach((b, i) => {
      const x = freqToX(b.f, w);
      const y = gToY(b.g, h);
      ctx.beginPath();
      ctx.arc(x, y, i === selectedBand ? 8 : 6, 0, Math.PI * 2);
      ctx.fillStyle = i === selectedBand ? '#e8f6ee' : '#6a8f7a';
      ctx.fill();
      ctx.strokeStyle = '#0d1218';
      ctx.stroke();
    });
  }

  function hitBand(t, ev) {
    const canvas = $('apsGeqCanvas');
    const r = canvas.getBoundingClientRect();
    const x = ev.clientX - r.left;
    const y = ev.clientY - r.top;
    const w = r.width, h = r.height;
    const geq = ensure(t);
    let best = 0, dist = 1e9;
    geq.bands.forEach((b, i) => {
      const dx = freqToX(b.f, w) - x;
      const dy = gToY(b.g, h) - y;
      const d = dx * dx + dy * dy;
      if (d < dist) { dist = d; best = i; }
    });
    return { index: best, x, y, w, h, close: dist < 22 * 22 };
  }

  function onPointerDown(ev) {
    const t = trackOf();
    if (!t) return;
    ev.preventDefault();
    const hit = hitBand(t, ev);
    selectedBand = hit.index;
    if (!hit.close && hit.w) {
      // still select nearest and start drag
    }
    pushUndo(t);
    drag = { index: selectedBand, pointer: ev.pointerId };
    ev.target.setPointerCapture(ev.pointerId);
    syncInspect();
    draw();
  }

  function onPointerMove(ev) {
    if (!drag) return;
    const t = trackOf();
    const canvas = $('apsGeqCanvas');
    const r = canvas.getBoundingClientRect();
    const k = coreOrThrow();
    const geq = ensure(t);
    const b = geq.bands[drag.index];
    if (!b) return;
    b.g = k.clamp(yToG(ev.clientY - r.top, r.height), k.GAIN_MIN, k.GAIN_MAX);
    // horizontal drag changes frequency, snapped lightly
    const f = xToFreq(ev.clientX - r.left, r.width);
    b.f = k.clamp(f, k.F_MIN, k.F_MAX);
    selectedBand = drag.index;
    preview = null;
    const live = t.live && t.live.geq && t.live.geq[drag.index];
    if (live && !geq.bypass) {
      live.gain.value = b.g;
      live.frequency.value = b.f;
    }
    syncInspect();
    draw();
  }

  function onPointerUp(ev) {
    if (!drag) return;
    drag = null;
    try { ev.target.releasePointerCapture(ev.pointerId); } catch { /* ignore */ }
    B()?.commit?.() || B()?.refresh?.();
    draw();
  }

  function syncInspect() {
    const t = trackOf();
    if (!t) return;
    const geq = ensure(t);
    const b = geq.bands[selectedBand];
    if (!b) return;
    const freq = $('apsGeqFreq'), gain = $('apsGeqGain'), q = $('apsGeqQ'), lab = $('apsGeqBandLab');
    if (freq) freq.value = Math.round(b.f);
    if (gain) gain.value = Math.round(b.g * 10) / 10;
    if (q) q.value = Math.round(b.q * 10) / 10;
    if (lab) lab.textContent = 'Banda ' + (selectedBand + 1) + ' · ' + b.type;
    const by = $('apsGeqBypass');
    if (by) by.checked = !!geq.bypass;
  }

  function setBandField(field, value) {
    const t = trackOf();
    const k = coreOrThrow();
    if (!t) return;
    const geq = ensure(t);
    const b = geq.bands[selectedBand];
    if (!b) return;
    if (!undoSnap) pushUndo(t);
    if (field === 'f') b.f = k.clamp(value, k.F_MIN, k.F_MAX);
    if (field === 'g') b.g = k.clamp(value, k.GAIN_MIN, k.GAIN_MAX);
    if (field === 'q') b.q = k.clamp(value, k.Q_MIN, k.Q_MAX);
    B()?.commit?.() || B()?.refresh?.();
    draw();
  }

  function reset() {
    const t = trackOf();
    if (!t) return;
    pushUndo(t);
    t.graphicEq = { bypass: false, bands: coreOrThrow().defaultBands() };
    pending = null; preview = null;
    B()?.commit?.() || B()?.refresh?.();
    draw();
    say('EQ gráfico zerado. Graves, médios e agudos do canal foram mantidos.', 'ok');
  }

  function toggleBypass(on) {
    const t = trackOf();
    if (!t) return;
    pushUndo(t);
    const geq = ensure(t);
    geq.bypass = !!on;
    B()?.commit?.() || B()?.refresh?.();
    draw();
    say(geq.bypass ? 'EQ gráfico em bypass.' : 'EQ gráfico ligado.', 'ok');
  }

  function spectrumOf(t) {
    const k = coreOrThrow();
    try {
      const buf = t.buf || B()?.buffer?.(t.id);
      if (!buf) return k.FREQS.map((f) => ({ f, db: 0, energy: 0 }));
      const ch = buf.getChannelData(0);
      const start = Math.floor((t.trimIn || 0) * buf.sampleRate);
      const end = Math.floor((t.trimOut || buf.duration) * buf.sampleRate);
      const slice = ch.subarray(Math.max(0, start), Math.min(ch.length, end));
      return k.spectrumSummary(slice, buf.sampleRate, k.FREQS);
    } catch {
      return k.FREQS.map((f) => ({ f, db: 0, energy: 0 }));
    }
  }

  async function askAI() {
    const t = trackOf();
    const text = $('apsGeqInput')?.value.trim() || '';
    if (!t) { say('Selecione uma pista primeiro.', 'error'); return; }
    if (text.length < 4) { say('Descreva o que quer no som, em português.', 'error'); return; }
    $('apsGeqAsk').disabled = true;
    say('Consultando a IA… o áudio não é enviado, só um resumo do espectro.', 'info');
    try {
      const geq = ensure(t);
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          comando: text,
          estado: {
            track: {
              id: t.id, name: t.name, type: t.type,
              params: {
                bass: t.bass, mid: t.mid, midFreq: t.midFreq, treble: t.treble, hpf: t.hpf,
                graphicEq: geq
              }
            },
            spectrum: { bands: spectrumOf(t) }
          }
        })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || ('Falha HTTP ' + res.status));
      const k = coreOrThrow();
      pending = {
        curveA: { bands: k.sanitize(data.curveA || data.a || data.pedido).bands },
        curveB: { bands: k.sanitize(data.curveB || data.b || data.sugestao).bands },
        reason: String(data.curveB?.reason || data.reason || data.summary || '')
      };
      pushUndo(t);
      preview = null;
      $('apsGeqAB').hidden = false;
      say(
        (data.summary ? data.summary + '\n' : '') +
        (pending.reason ? 'Sugestão da IA: ' + pending.reason + '\n' : '') +
        'A curva azul é o seu pedido. A laranja é a sugestão da IA. Ouça A e B e escolha qual usar.',
        'ok'
      );
      draw();
    } catch (e) {
      pending = null;
      $('apsGeqAB').hidden = true;
      say(e.message || 'Não foi possível consultar a IA.', 'error');
    } finally {
      $('apsGeqAsk').disabled = false;
    }
  }

  function listen(kind) {
    const t = trackOf();
    if (!t || !pending) return;
    if (!undoSnap) pushUndo(t);
    const bands = kind === 'B' ? pending.curveB.bands : pending.curveA.bands;
    preview = { kind, bands };
    const k = coreOrThrow();
    t.graphicEq = k.sanitize({ bypass: false, bands });
    B()?.commit?.() || B()?.refresh?.();
    draw();
    say(kind === 'B' ? 'Ouvindo a sugestão da IA (B).' : 'Ouvindo o seu pedido (A).', 'ok');
  }

  function choose(kind) {
    const t = trackOf();
    if (!t || !pending) return;
    if (!undoSnap) pushUndo(t);
    const bands = kind === 'B' ? pending.curveB.bands : pending.curveA.bands;
    preview = null;
    applyBands(t, bands, { silentUndo: true });
    $('apsGeqAB').hidden = true;
    pending = null;
    say(kind === 'B' ? 'Apliquei a sugestão da IA. Você pode desfazer.' : 'Apliquei o seu pedido. Você pode desfazer.', 'ok');
  }

  function cancelAB() {
    const t = trackOf();
    preview = null;
    pending = null;
    $('apsGeqAB').hidden = true;
    if (undoSnap && t && undoSnap.id === t.id) {
      t.graphicEq = coreOrThrow().sanitize(undoSnap.graphicEq);
    }
    B()?.commit?.() || B()?.refresh?.();
    draw();
    say('Nenhuma curva da IA foi aplicada.', 'info');
  }

  function mount(root, t) {
    const k = C();
    if (!root || !t || !k) return false;
    ensure(t);
    if (!panelEl) {
      const box = document.createElement('section');
      panelEl = box;
      box.id = 'apsGeqBox';
      box.className = 'aps-geq';
      box.innerHTML =
        '<h3>EQ gráfico · 8 bandas</h3>' +
        '<p class="aps-geq-sub">Arraste os pontos no gráfico (ganho e frequência). Graves, médios e agudos do canal continuam valendo. O áudio original não é alterado até você aplicar.</p>' +
        '<canvas id="apsGeqCanvas" width="640" height="200" aria-label="Resposta de frequência do EQ"></canvas>' +
        '<div class="aps-geq-inspect"><span id="apsGeqBandLab">Banda</span>' +
        '<label>Hz <input id="apsGeqFreq" type="number" min="20" max="20000" step="1"></label>' +
        '<label>dB <input id="apsGeqGain" type="number" min="-18" max="18" step="0.1"></label>' +
        '<label>Q <input id="apsGeqQ" type="number" min="0.1" max="18" step="0.1"></label></div>' +
        '<div class="aps-geq-row">' +
        '<label class="aps-geq-check"><input id="apsGeqBypass" type="checkbox"> Bypass</label>' +
        '<button type="button" id="apsGeqReset">Zerar bandas</button>' +
        '<button type="button" id="apsGeqUndo" disabled>↩ Desfazer</button>' +
        '</div>' +
        '<h4>Pedido em português · IA</h4>' +
        '<textarea id="apsGeqInput" maxlength="800" rows="2" placeholder="Ex.: mais brilho na voz, ou tirar o embolado do baixo em 300 Hz"></textarea>' +
        '<div class="aps-geq-row"><button type="button" id="apsGeqAsk">✦ Sugerir curvas A e B</button></div>' +
        '<div id="apsGeqAB" hidden>' +
        '<p class="aps-geq-q">Usar a sua ou a da IA?</p>' +
        '<div class="aps-geq-row">' +
        '<button type="button" id="apsGeqListenA">Ouvir A (seu pedido)</button>' +
        '<button type="button" id="apsGeqListenB">Ouvir B (sugestão da IA)</button>' +
        '</div>' +
        '<div class="aps-geq-row">' +
        '<button type="button" id="apsGeqUseA">Usar a minha (A)</button>' +
        '<button type="button" id="apsGeqUseB">Usar a da IA (B)</button>' +
        '<button type="button" id="apsGeqCancel">Cancelar</button>' +
        '</div></div>' +
        '<p id="apsGeqMsg" class="aps-geq-msg" role="status"></p>';
      root.append(box);
      const canvas = $('apsGeqCanvas');
      canvas.addEventListener('pointerdown', onPointerDown);
      canvas.addEventListener('pointermove', onPointerMove);
      canvas.addEventListener('pointerup', onPointerUp);
      canvas.addEventListener('pointercancel', onPointerUp);
      $('apsGeqFreq').onchange = (e) => setBandField('f', Number(e.target.value));
      $('apsGeqGain').onchange = (e) => setBandField('g', Number(e.target.value));
      $('apsGeqQ').onchange = (e) => setBandField('q', Number(e.target.value));
      $('apsGeqBypass').onchange = (e) => toggleBypass(e.target.checked);
      $('apsGeqReset').onclick = reset;
      $('apsGeqUndo').onclick = restoreUndo;
      $('apsGeqAsk').onclick = askAI;
      $('apsGeqListenA').onclick = () => listen('A');
      $('apsGeqListenB').onclick = () => listen('B');
      $('apsGeqUseA').onclick = () => choose('A');
      $('apsGeqUseB').onclick = () => choose('B');
      $('apsGeqCancel').onclick = cancelAB;
    }
    if (panelEl.parentNode !== root) root.append(panelEl);
    if (mountedFor && mountedFor !== t.id) {
      preview = null;
      pending = null;
      if (undoSnap && undoSnap.id !== t.id) undoSnap = null;
    }
    mountedFor = t.id;
    if ($('apsGeqAB')) $('apsGeqAB').hidden = !pending;
    if ($('apsGeqUndo')) $('apsGeqUndo').disabled = !(undoSnap && undoSnap.id === t.id);
    syncInspect();
    requestAnimationFrame(draw);
    return true;
  }

  const css = document.createElement('style');
  css.textContent =
    '.aps-geq{background:#151a26;border:1px solid #6a8f7a;border-radius:14px;padding:8px 10px;margin:8px 0}' +
    '.aps-geq h3,.aps-geq h4{margin:0 0 4px;color:#9edac0;font-size:15px}' +
    '.aps-geq h4{margin-top:10px}' +
    '.aps-geq-sub,.aps-geq-q{font-size:12px;color:#aab;margin:0 0 8px}' +
    '.aps-geq-q{color:#e8f6ee;font-weight:700}' +
    '#apsGeqCanvas{width:100%;height:120px;background:#111620;border-radius:10px;touch-action:none;display:block}' +
    '.aps-geq-inspect,.aps-geq-row{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px;align-items:center}' +
    '.aps-geq-inspect label,.aps-geq-check{font-size:12px;color:#cde}' +
    '.aps-geq input[type=number]{width:88px;border-radius:8px;border:1px solid #55586b;background:#111620;color:#fff;padding:6px}' +
    '.aps-geq textarea{width:100%;min-height:44px;border-radius:10px;border:1px solid #55586b;background:#111620;color:#fff;padding:8px;box-sizing:border-box}' +
    '.aps-geq-row button{background:#232a3a;color:#e8f6ee;border:1px solid #3d5c4c;border-radius:8px;padding:8px 12px;font-weight:700}' +
    '.aps-geq-row button:disabled{opacity:.45}' +
    '.aps-geq-msg{font-size:12px;color:#b4e4ba;margin:8px 0 0;white-space:pre-wrap}' +
    '.aps-geq-msg[data-kind=error]{color:#f0b4b0}';
  document.head.append(css);

  window.APSEqGrafico = {
    endpoint: ENDPOINT,
    mount,
    draw,
    ensure,
    applyBands,
    askAI,
    listen,
    choose,
    reset,
    undo: restoreUndo,
    pending: () => pending,
    preview: () => preview
  };

  document.addEventListener('aps:change', () => { if ($('apsGeqCanvas')) draw(); });
})();
