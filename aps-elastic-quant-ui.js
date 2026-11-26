/* APS Quant Pro v2 — quantização elástica SEM CORTES (editor de marcadores de warp).
 * O áudio é esticado/comprimido de forma contínua entre os ataques; nada é cortado,
 * não há buracos nem trechos dobrados. Proteção de ataque mantém o "tapa" da bateria.
 * Uso: APSElasticQuantUI.mount(host, adapter)
 *   adapter.getSource() -> {id, buffer}  (pista/arquivo atual)
 *   adapter.bpm() -> número (opcional; senão mostra campo BPM)
 *   adapter.apply(buffer, info)          (coloca o resultado na pista / prévia)
 *   adapter.restore(buffer)              (volta o original)
 *   adapter.onChange?()                  */
(function (root) {
'use strict';
const C = () => root.APSElasticCore;
const CSS = `.aps-eq2{background:linear-gradient(150deg,#121a29,#111723);border:1px solid #8a6d3b;border-radius:15px;padding:14px;color:#e8ebf1;margin:10px 0}
.aps-eq2 h3{margin:0;color:#f0cd8c;font-size:16px}.aps-eq2 .sub{font-size:12px;color:#bfc9db;margin:3px 0 10px}
.aps-eq2 .row{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:8px 0}
.aps-eq2 label{font-size:12px;color:#cdd5e2;display:inline-flex;gap:6px;align-items:center}
.aps-eq2 select,.aps-eq2 input[type=number]{background:#0c1422;color:#eef;border:1px solid #56647a;border-radius:8px;padding:7px;min-height:38px;font:inherit;font-size:13px}
.aps-eq2 input[type=range]{accent-color:#e2bc76;width:110px}
.aps-eq2 button{min-height:40px;border-radius:10px;border:1px solid #9b7a41;background:#e2bc76;color:#17202b;font-weight:800;padding:8px 12px;cursor:pointer;font-size:13px}
.aps-eq2 button.alt{background:#223047;color:#f1d5a5;border-color:#7d6847}.aps-eq2 button.on{background:#59cde6;color:#0d1a24;border-color:#59cde6}
.aps-eq2 button:disabled{opacity:.42;cursor:not-allowed}
.aps-eq2 canvas{display:block;width:100%;height:240px;background:#0a1322;border:1px solid #384456;border-radius:10px;touch-action:none;margin-top:6px}
.aps-eq2 .tools{display:flex;gap:6px;flex-wrap:wrap}.aps-eq2 .tools button{min-height:36px;padding:6px 10px}
.aps-eq2 .status{font-size:12px;color:#d4e1ed;background:#1b283b;border:1px solid #3d5068;border-radius:9px;padding:8px 10px;margin-top:8px;min-height:20px}
.aps-eq2 .status[data-kind=ok]{background:#173230;border-color:#4f8f80;color:#c4f0e2}.aps-eq2 .status[data-kind=err]{background:#3a2125;border-color:#a86a6a;color:#ffd7d7}
.aps-eq2 .warn{font-size:12px;color:#ffb3a1;min-height:16px;margin-top:4px}.aps-eq2 .legend{font-size:11px;color:#aebbd0;margin-top:4px}`;
function injectCss() { if (document.getElementById('apsEq2Css')) return; const s = document.createElement('style'); s.id = 'apsEq2Css'; s.textContent = CSS; document.head.appendChild(s); }

function mount(host, adapter) {
  injectCss();
  const P = adapter.idPrefix || 'apsEq2';
  const id = s => P + s;
  host.innerHTML = `<div class="aps-eq2" data-aps-quant-v2>
 <h3>▥ APS Quant Pro v2 · Quantização elástica sem cortes</h3>
 <p class="sub">Puxa cada ataque suavemente para a grade, esticando o áudio de forma contínua entre os marcadores. Sem cortes, sem buracos, sem trechos dobrados. O original fica guardado (A/B e Desfazer).</p>
 <div class="row">${adapter.bpm ? '' : `<label>BPM <input id="${id('Bpm')}" type="number" min="40" max="240" value="100" style="width:80px"></label>`}
  <label>Grade <select id="${id('Grid')}"><option value="4">1/4</option><option value="8">1/8</option><option value="16" selected>1/16</option><option value="32">1/32</option><option value="12">1/8 tercina</option><option value="24">1/16 tercina</option></select></label>
  <label>Força <input id="${id('Strength')}" type="range" min="0" max="100" value="${adapter.defaultStrength ?? 100}"><b id="${id('StrengthV')}"></b></label>
  <label>Proteção de ataque <input id="${id('Protect')}" type="range" min="0" max="40" value="25"><b id="${id('ProtectV')}"></b></label>
  <label>Motor <select id="${id('Engine')}"><option value="poly" selected>Polifônico/Rítmico (bateria, violão, mix)</option><option value="mono">Monofônico (voz, baixo, solo)</option></select></label></div>
 <div class="row"><button type="button" id="${id('Analyze')}">⌁ Analisar ataques</button><button type="button" id="${id('Apply')}" disabled>✦ Quantizar sem cortes</button><button type="button" class="alt" id="${id('AB')}" disabled>A/B: ouvindo B (quantizado)</button><button type="button" class="alt" id="${id('Undo')}" disabled>↶ Desfazer</button><button type="button" class="alt" id="${id('Reset')}" disabled>↺ Limpar ajustes</button></div>
 <div class="row"><span style="font-size:12px;color:#cdd5e2">Ferramenta:</span><div class="tools" role="group" aria-label="Ferramenta do editor"><button type="button" class="alt on" data-tool="move">✋ Mover</button><button type="button" class="alt" data-tool="add">＋ Adicionar</button><button type="button" class="alt" data-tool="del">🗑 Apagar</button><button type="button" class="alt" data-tool="lock">🔒 Travar</button></div>
  <label>Janela <select id="${id('Zoom')}"><option value="2">2 s</option><option value="4">4 s</option><option value="8" selected>8 s</option><option value="16">16 s</option><option value="0">Tudo</option></select></label></div>
 <canvas id="${id('Canvas')}" aria-label="Forma de onda, grade e marcadores de warp"></canvas>
 <input id="${id('Scroll')}" type="range" min="0" max="1000" value="0" aria-label="Deslocar janela" style="width:100%;accent-color:#e2bc76">
 <div class="legend">Em cima: original com ataques (branco). Embaixo: prévia elástica com os marcadores (dourado = vai para a grade, azul = travado, rosa = ajustado à mão). Vermelho = trecho esticado fora de 0,75×–1,5×.</div>
 <div class="warn" id="${id('Warn')}"></div>
 <div class="status" id="${id('Status')}" role="status" aria-live="polite">Selecione o áudio e toque em ⌁ Analisar ataques.</div></div>`;
  const $ = s => document.getElementById(id(s));
  const cv = $('Canvas');
  const st = { srcId: null, original: null, onsets: null, edits: {}, removed: new Set(), added: [], plan: null, map: null, result: null, listening: 'B', tool: 'move', drag: null, addSeq: 0, busy: false };
  const say = (t, k) => { const e = $('Status'); e.textContent = t; e.dataset.kind = k || ''; };
  const bpm = () => adapter.bpm ? Number(adapter.bpm()) || 100 : Number($('Bpm').value) || 100;
  const opts = () => ({ duration: st.original.duration, bpm: bpm(), subdivision: Number($('Grid').value), strength: Number($('Strength').value), edits: st.edits, removed: [...st.removed], added: st.added });
  function labels() { $('StrengthV').textContent = $('Strength').value + '%'; $('ProtectV').textContent = $('Protect').value + ' ms'; }
  labels();
  function rebuild() {
    if (!st.onsets) return;
    st.plan = C().planWarp(st.onsets, opts());
    st.map = C().buildTimeMap(st.plan.markers, st.original.duration, { protectMs: Number($('Protect').value) });
    const w = st.map.warnings;
    $('Warn').textContent = w.length ? `⚠ ${w.length} trecho(s) fora de 0,75×–1,5× (ex.: ${w[0].from.toFixed(2)} s, ${w[0].ratio.toFixed(2)}×). Pode soar artificial: reduza a força, trave ou ajuste o marcador.` : '';
    draw();
  }
  function sourceChanged() {
    const s = adapter.getSource(); if (!s || !s.buffer) return true;
    return s.id !== st.srcId;
  }
  async function analyze() {
    const s = adapter.getSource(); if (!s || !s.buffer) throw Error('Selecione uma pista ou arquivo de áudio primeiro.');
    if (s.id !== st.srcId || !st.original) { st.srcId = s.id; st.original = (adapter.originalOf && adapter.originalOf(s.id)) || s.buffer; st.result = null; st.edits = {}; st.removed = new Set(); st.added = []; }
    say('Procurando ataques (fluxo espectral + energia)…');
    const r = await root.APSElastic.onsets(st.original);
    st.onsets = r.onsets;
    if (!st.onsets.length) { st.plan = null; draw(); throw Error('Não encontrei ataques definidos nesta gravação.'); }
    rebuild();
    $('Apply').disabled = false; $('Reset').disabled = false;
    say(`${st.onsets.length} ataques encontrados. Arraste os marcadores dourados se quiser e toque em ✦ Quantizar sem cortes.`, 'ok');
  }
  async function apply() {
    if (!st.plan) throw Error('Analise os ataques primeiro.');
    if (sourceChanged()) throw Error('A pista selecionada mudou. Toque em ⌁ Analisar ataques de novo.');
    st.busy = true; $('Apply').disabled = true;
    try {
      const engine = $('Engine').value;
      const r = await root.APSElastic.quantize(st.original, st.plan.markers, { engine, protectMs: Number($('Protect').value) }, (p, m) => say((m || 'Processando…') + ' ' + Math.round(p * 100) + '%'));
      st.result = r.buffer; st.listening = 'B';
      adapter.apply(r.buffer, { id: st.srcId, original: st.original, engine: r.engine, metrics: r.metrics });
      $('AB').disabled = false; $('Undo').disabled = false; abLabel();
      const moved = st.plan.markers.filter(m => Math.abs(m.dst - m.src) > 0.002).length;
      const eng = r.engine === 'poly' ? 'Signalsmith Stretch' : r.engine === 'mono' ? 'TD-PSOLA' : 'WSOLA (reserva)';
      say(`✓ ${moved} ataques puxados para a grade sem cortes (${eng}). Maior silêncio criado: ${r.metrics.longestSilentMs.toFixed(1)} ms · pico ${r.metrics.peak.toFixed(2)}. Toque A/B para comparar.`, 'ok');
      draw();
    } finally { st.busy = false; $('Apply').disabled = !st.plan; }
  }
  function abLabel() { $('AB').textContent = st.listening === 'B' ? 'A/B: ouvindo B (quantizado)' : 'A/B: ouvindo A (original)'; $('AB').classList.toggle('on', st.listening === 'A'); }
  function ab() { if (!st.result) return; st.listening = st.listening === 'B' ? 'A' : 'B'; if (st.listening === 'A') adapter.restore(st.original, { id: st.srcId, ab: true }); else adapter.apply(st.result, { id: st.srcId, ab: true, original: st.original }); abLabel(); draw(); }
  function undo() { if (!st.original) return; adapter.restore(st.original, { id: st.srcId, undo: true }); st.result = null; st.listening = 'B'; $('AB').disabled = true; $('Undo').disabled = true; abLabel(); say('Original de volta. Seus marcadores continuam aqui para tentar de novo.', 'ok'); draw(); }
  function reset() { st.edits = {}; st.removed = new Set(); st.added = []; rebuild(); say('Ajustes manuais limpos.'); }

  // ------- desenho -------
  function view() {
    const dur = st.original ? st.original.duration : 1, zoom = Number($('Zoom').value) || dur, w = Math.min(dur, zoom);
    const start = Math.max(0, (dur - w) * Number($('Scroll').value) / 1000);
    return { start, w, dur };
  }
  function draw() {
    const r = cv.getBoundingClientRect(), W = Math.max(280, Math.floor(r.width || 700)), H = 240, dpr = Math.min(2, root.devicePixelRatio || 1);
    if (cv.width !== Math.round(W * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
    g.fillStyle = '#0a1322'; g.fillRect(0, 0, W, H);
    if (!st.original) { g.fillStyle = '#b8c3d5'; g.font = '14px system-ui'; g.fillText('Selecione o áudio e toque em ⌁ Analisar ataques', 16, 40); return; }
    const v = view(), X = t => (t - v.start) / v.w * W, T = x => v.start + x / W * v.w, top = 14, mid = 118, bot = 226;
    st.view = { X, T, W, top, mid, bot };
    const ch0 = st.original.getChannelData(0), sr = st.original.sampleRate;
    const peakAt = (data, t0, t1) => { const a = Math.max(0, Math.floor(t0 * sr)), b = Math.min(data.length, Math.ceil(t1 * sr)); let p = 0; const step = Math.max(1, Math.floor((b - a) / 64)); for (let i = a; i < b; i += step) p = Math.max(p, Math.abs(data[i])); return p; };
    // grade
    const unit = st.plan ? st.plan.unit : 60 / bpm() * 4 / Number($('Grid').value);
    for (let k = Math.ceil(v.start / unit); k * unit <= v.start + v.w; k++) { const x = X(k * unit), beat = Math.abs((k * unit) / (60 / bpm()) - Math.round((k * unit) / (60 / bpm()))) < 1e-6; g.strokeStyle = beat ? 'rgba(229,189,114,.30)' : 'rgba(150,170,200,.12)'; g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }
    // faixas vermelhas (fora de 0,75–1,5)
    if (st.map) for (const s of st.map.segs) if (s.ratio < 0.75 || s.ratio > 1.5) { g.fillStyle = 'rgba(239,90,90,.20)'; g.fillRect(X(s.dst0), mid + 4, X(s.dst1) - X(s.dst0), bot - mid - 4); }
    // ondas
    g.fillStyle = '#4f86c6';
    for (let x = 0; x < W; x++) { const p = peakAt(ch0, T(x), T(x + 1)); const h = p * (mid - top - 10) / 2; g.fillRect(x, (top + mid) / 2 - h, 1, Math.max(1, 2 * h)); }
    const after = st.listening === 'B' && st.result ? st.result.getChannelData(0) : null;
    g.fillStyle = after ? '#d7ac62' : '#7a6a52';
    for (let x = 0; x < W; x++) {
      let p; if (after) p = peakAt(after, T(x), T(x + 1));
      else if (st.map) { const a = st.map.input(Math.max(0, T(x))), b = st.map.input(Math.min(v.dur, T(x + 1))); p = peakAt(ch0, a, Math.max(a + 1 / sr, b)); } else p = peakAt(ch0, T(x), T(x + 1));
      const h = p * (bot - mid - 14) / 2; g.fillRect(x, (mid + 8 + bot) / 2 - h, 1, Math.max(1, 2 * h));
    }
    g.fillStyle = '#9fb0c8'; g.font = '11px system-ui'; g.fillText('ORIGINAL', 6, 11); g.fillText(after ? 'DEPOIS · ÁUDIO QUANTIZADO' : 'DEPOIS · PRÉVIA ELÁSTICA', 6, mid + 2);
    g.strokeStyle = '#2b3b52'; g.beginPath(); g.moveTo(0, mid - 4); g.lineTo(W, mid - 4); g.stroke();
    // marcadores
    if (st.plan) for (const m of st.plan.markers) {
      const xs = X(m.src), xd = X(m.dst); if (Math.max(xs, xd) < -10 || Math.min(xs, xd) > W + 10) continue;
      g.strokeStyle = 'rgba(255,255,255,.75)'; g.beginPath(); g.moveTo(xs, top); g.lineTo(xs, mid - 6); g.stroke();
      g.strokeStyle = 'rgba(229,189,114,.45)'; g.beginPath(); g.moveTo(xs, mid - 6); g.lineTo(xd, mid + 10); g.stroke();
      const col = m.locked ? '#59cde6' : m.manual ? '#ff8fc8' : '#e5bd72';
      g.strokeStyle = col; g.lineWidth = 2; g.beginPath(); g.moveTo(xd, mid + 10); g.lineTo(xd, bot); g.stroke(); g.lineWidth = 1;
      g.fillStyle = col; g.beginPath(); g.arc(xd, mid + 14, st.drag && st.drag.id === m.id ? 8 : 6, 0, Math.PI * 2); g.fill();
      if (m.locked) { g.fillStyle = '#0a1322'; g.font = 'bold 9px system-ui'; g.fillText('T', xd - 3, mid + 17); }
    }
  }
  // ------- interação -------
  function hit(e) {
    if (!st.view || !st.plan) return null;
    const r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top, lower = y > st.view.mid - 6;
    let best = null, bd = 22;
    for (const m of st.plan.markers) { const d = Math.abs((lower ? st.view.X(m.dst) : st.view.X(m.src)) - x); if (d < bd) { bd = d; best = m; } }
    return { marker: best, time: st.view.T(x), lower };
  }
  cv.addEventListener('pointerdown', e => {
    const h = hit(e); if (!h) return;
    if (st.tool === 'move') { if (h.marker && h.lower) { st.drag = { id: h.marker.id }; try { cv.setPointerCapture(e.pointerId); } catch (_) {} e.preventDefault(); draw(); } return; }
    if (st.tool === 'add') { const t = Math.max(0.01, Math.min(st.original.duration - 0.01, h.lower && st.map ? st.map.input(h.time) : h.time)); st.added.push({ id: 'a' + (++st.addSeq), src: t }); rebuild(); say(`Marcador adicionado em ${t.toFixed(3)} s.`); return; }
    if (!h.marker) return;
    if (st.tool === 'del') { if (h.marker.id[0] === 'a') st.added = st.added.filter(a => a.id !== h.marker.id); else st.removed.add(h.marker.id); delete st.edits[h.marker.id]; rebuild(); say('Marcador apagado: esse trecho segue o vizinho, sem corte.'); return; }
    if (st.tool === 'lock') { const e2 = st.edits[h.marker.id] || {}; const locked = !e2.locked; st.edits[h.marker.id] = locked ? { locked: true } : {}; rebuild(); say(locked ? 'Marcador travado: esse ataque fica onde foi tocado.' : 'Marcador destravado.'); }
  });
  cv.addEventListener('pointermove', e => {
    if (!st.drag || !st.view) return; const r = cv.getBoundingClientRect(), t = st.view.T(e.clientX - r.left);
    st.edits[st.drag.id] = { dst: Math.max(0, Math.min(st.original.duration, t)) }; rebuild();
  });
  const endDrag = () => { if (st.drag) { const m = st.plan && st.plan.markers.find(m => m.id === st.drag.id); st.drag = null; draw(); if (m) say(`Marcador ajustado: ${m.src.toFixed(3)} s → ${m.dst.toFixed(3)} s. Toque ✦ Quantizar sem cortes para aplicar.`); } };
  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(n => cv.addEventListener(n, endDrag));
  host.querySelectorAll('[data-tool]').forEach(b => b.addEventListener('click', () => { st.tool = b.dataset.tool; host.querySelectorAll('[data-tool]').forEach(o => o.classList.toggle('on', o === b)); }));
  const guard = fn => () => Promise.resolve().then(fn).catch(e => say(e.message || String(e), 'err'));
  $('Analyze').addEventListener('click', guard(analyze));
  $('Apply').addEventListener('click', guard(apply));
  $('AB').addEventListener('click', guard(ab));
  $('Undo').addEventListener('click', guard(undo));
  $('Reset').addEventListener('click', guard(reset));
  ['Grid', 'Strength', 'Protect'].forEach(k => $(k).addEventListener('input', () => { labels(); rebuild(); }));
  if ($('Bpm')) $('Bpm').addEventListener('change', rebuild);
  $('Zoom').addEventListener('change', draw); $('Scroll').addEventListener('input', draw);
  root.addEventListener('resize', draw);
  draw();
  const api = { state: st, analyze: guard(analyze), apply: guard(apply), redraw: () => { if (st.onsets) rebuild(); else draw(); }, setBpm: v => { if ($('Bpm')) { $('Bpm').value = v; rebuild(); } } };
  host.__apsQuant = api; return api;
}
root.APSElasticQuantUI = { mount };
})(typeof window !== 'undefined' ? window : globalThis);
