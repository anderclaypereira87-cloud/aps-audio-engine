/* APS Afinação Natural — editor de notas com arraste (estilo Flex Pitch / Melodyne).
 * Arrastar uma nota desloca a CURVA inteira dela (vibrato e modulação continuam), com transição
 * em curva entre notas vizinhas e formantes preservados (TD-PSOLA). Sem voz robótica.
 * Uso: APSElasticTuneUI.mount(host, adapter)
 *   adapter.getSource() -> {id, buffer}; adapter.apply(buffer, info); adapter.restore(buffer, info)
 *   adapter.originalOf?(id) -> AudioBuffer original guardado */
(function (root) {
'use strict';
const C = () => root.APSElasticCore;
const CSS = `.aps-tn2{background:linear-gradient(150deg,#141a28,#10151f);border:1px solid #8a6d3b;border-radius:15px;padding:14px;color:#e8ebf1;margin:10px 0}
.aps-tn2 h3{margin:0;color:#f0cd8c;font-size:16px}.aps-tn2 .sub{font-size:12px;color:#bfc9db;margin:3px 0 10px}
.aps-tn2 .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px 12px}
.aps-tn2 label{font-size:12px;color:#cdd5e2;display:flex;flex-direction:column;gap:4px}
.aps-tn2 label b{color:#e5bd72;font-weight:700}
.aps-tn2 select{background:#0c1422;color:#eef;border:1px solid #56647a;border-radius:8px;padding:7px;min-height:38px;font:inherit;font-size:13px}
.aps-tn2 input[type=range]{accent-color:#e2bc76;width:100%}
.aps-tn2 .row{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:9px 0}
.aps-tn2 button{min-height:40px;border-radius:10px;border:1px solid #9b7a41;background:#e2bc76;color:#17202b;font-weight:800;padding:8px 12px;cursor:pointer;font-size:13px}
.aps-tn2 button.alt{background:#223047;color:#f1d5a5;border-color:#7d6847}.aps-tn2 button.on{background:#59cde6;color:#0d1a24;border-color:#59cde6}
.aps-tn2 button:disabled{opacity:.42;cursor:not-allowed}
.aps-tn2 canvas{display:block;width:100%;height:260px;background:#0f141d;border:1px solid #384456;border-radius:10px;touch-action:none}
.aps-tn2 .status{font-size:12px;color:#d4e1ed;background:#1b283b;border:1px solid #3d5068;border-radius:9px;padding:8px 10px;margin-top:8px;min-height:20px}
.aps-tn2 .status[data-kind=ok]{background:#173230;border-color:#4f8f80;color:#c4f0e2}.aps-tn2 .status[data-kind=err]{background:#3a2125;border-color:#a86a6a;color:#ffd7d7}
.aps-tn2 .legend{font-size:11px;color:#aebbd0;margin-top:4px}.aps-tn2 .chk{flex-direction:row;align-items:center}`;
function injectCss() { if (document.getElementById('apsTn2Css')) return; const s = document.createElement('style'); s.id = 'apsTn2Css'; s.textContent = CSS; document.head.appendChild(s); }

function mount(host, adapter) {
  injectCss();
  const P = adapter.idPrefix || 'apsTn2', id = s => P + s;
  const Cc = C();
  const keyOpts = '<option value="auto">Automático</option>' + Cc.NOTE.map((n, i) => `<option value="${i}">${n} (${Cc.NOTE_EN[i]})</option>`).join('');
  const scaleOpts = Object.entries(Cc.SCALE_NAMES).map(([k, v]) => `<option value="${k}">${v}</option>`).join('');
  host.innerHTML = `<div class="aps-tn2" data-aps-tune-v2>
 <h3>🎤 Afinação natural · arraste as notas</h3>
 <p class="sub">Toque e arraste cada nota para cima ou para baixo. A curva da nota inteira acompanha, então o vibrato e os floreios continuam naturais, a passagem entre notas é feita em curva e os formantes da voz são preservados. O original fica guardado (A/B e Desfazer).</p>
 <div class="grid">
  <label>Tom<select id="${id('Key')}">${keyOpts}</select></label>
  <label>Escala<select id="${id('Scale')}">${scaleOpts}</select></label>
  <label>Corrigir tudo (intensidade) <b id="${id('AmtV')}"></b><input id="${id('Amt')}" type="range" min="0" max="100" value="${adapter.defaultAmount ?? 80}"></label>
  <label>Manter vibrato <b id="${id('VibV')}"></b><input id="${id('Vib')}" type="range" min="0" max="150" value="100"></label>
  <label>Transição entre notas <b id="${id('TransV')}"></b><input id="${id('Trans')}" type="range" min="0" max="300" step="5" value="70"></label>
  <label>Formantes / Timbre <b id="${id('FormV')}"></b><input id="${id('Form')}" type="range" min="-6" max="6" step="0.5" value="0"></label>
  <label>Humanizar / Flex-tune <b id="${id('HumV')}"></b><input id="${id('Hum')}" type="range" min="0" max="100" value="30"></label>
  <label>Endireitar desvio <b id="${id('DriftV')}"></b><input id="${id('Drift')}" type="range" min="0" max="100" value="0"></label>
 </div>
 <div class="row"><button type="button" id="${id('Analyze')}">🔍 Analisar voz</button><button type="button" id="${id('Apply')}" disabled>✨ Aplicar afinação</button><button type="button" class="alt" id="${id('AB')}" disabled>A/B: ouvindo B (afinado)</button><button type="button" class="alt" id="${id('Undo')}" disabled>↶ Desfazer</button><button type="button" class="alt" id="${id('Reset')}" disabled>↺ Notas automáticas</button>
  <label class="chk"><input type="checkbox" id="${id('Fine')}"> Ajuste fino (10 cents)</label></div>
 <canvas id="${id('Canvas')}" aria-label="Notas da voz: arraste para afinar"></canvas>
 <div class="row"><label style="flex-direction:row;align-items:center">Janela <select id="${id('Zoom')}"><option value="4">4 s</option><option value="8">8 s</option><option value="16" selected>16 s</option><option value="0">Tudo</option></select></label><input id="${id('Scroll')}" type="range" min="0" max="1000" value="0" aria-label="Deslocar janela" style="flex:1;accent-color:#e2bc76"></div>
 <div class="row" id="${id('NoteBar')}" hidden><span id="${id('NoteInfo')}" style="font-size:12px">Toque numa nota.</span><button type="button" class="alt" id="${id('Up')}">▲ +1</button><button type="button" class="alt" id="${id('Down')}">▼ −1</button><button type="button" class="alt" id="${id('Off')}">⊘ Não corrigir</button><button type="button" class="alt" id="${id('Auto')}">↺ Automática</button></div>
 <div class="legend">Azul: voz original. Blocos dourados: notas (arraste). Linha dourada: como vai ficar. Faixas claras: notas da escala.</div>
 <div class="status" id="${id('Status')}" role="status" aria-live="polite">Selecione a pista de voz (uma voz por vez) e toque em 🔍 Analisar voz.</div></div>`;
  const $ = s => document.getElementById(id(s)), cv = $('Canvas');
  const st = { srcId: null, original: null, track: null, an: null, key: null, edits: {}, plan: null, result: null, listening: 'B', sel: -1, drag: null };
  const say = (t, k) => { const e = $('Status'); e.textContent = t; e.dataset.kind = k || ''; };
  function labels() {
    $('AmtV').textContent = $('Amt').value + '%'; $('VibV').textContent = $('Vib').value + '%'; $('TransV').textContent = $('Trans').value + ' ms';
    const f = Number($('Form').value); $('FormV').textContent = f === 0 ? 'preservados' : (f > 0 ? '+' : '') + f + ' st';
    $('HumV').textContent = $('Hum').value + '%'; $('DriftV').textContent = $('Drift').value + '%';
  }
  labels();
  const keyNow = () => $('Key').value === 'auto' ? (st.key ? st.key.key : 0) : Number($('Key').value);
  const options = () => ({ key: keyNow(), scale: $('Scale').value, amount: Number($('Amt').value), vibrato: Number($('Vib').value), transitionMs: Number($('Trans').value), formant: Number($('Form').value), humanize: Number($('Hum').value), drift: Number($('Drift').value), edits: st.edits });
  function replan() { if (!st.track) return; st.plan = Cc.pitchPlan(st.track, st.an, options()); draw(); noteInfo(); }
  async function analyze() {
    const s = adapter.getSource(); if (!s || !s.buffer) throw Error('Selecione uma pista de voz primeiro.');
    if (s.id !== st.srcId || !st.original) { st.srcId = s.id; st.original = (adapter.originalOf && adapter.originalOf(s.id)) || s.buffer; st.result = null; st.edits = {}; st.sel = -1; }
    if (st.original.duration > 600) throw Error('Use trechos de até 10 minutos.');
    const r = await root.APSElastic.analyzePitch(st.original, (p, m) => say((m || 'Analisando…') + ' ' + Math.round(p * 100) + '%'));
    st.track = r.track; st.an = Cc.analyzeNotes(st.track); st.key = r.key;
    if (!st.an.notes.length) { draw(); throw Error('Não encontrei notas cantadas. Use a voz isolada (passe pelo Separador antes, se precisar).'); }
    if ($('Key').value === 'auto') $('Scale').value = r.key.scale;
    replan();
    $('Apply').disabled = false; $('Reset').disabled = false;
    const src = r.track.source === 'mpm' ? 'MPM (reserva)' : r.track.source === 'swiftf0+mpm' ? 'SwiftF0 + MPM nos graves' : 'SwiftF0';
    say(`${st.an.notes.length} notas encontradas (${src}). Tom provável: ${Cc.NOTE[r.key.key]} ${Cc.SCALE_NAMES[r.key.scale]}. Arraste as notas ou toque ✨ Aplicar afinação.${r.swiftError ? ' (SwiftF0 indisponível: usei MPM.)' : ''}`, 'ok');
  }
  async function apply() {
    if (!st.track) throw Error('Analise a voz primeiro.');
    const s = adapter.getSource(); if (!s || s.id !== st.srcId) throw Error('A pista selecionada mudou. Toque em 🔍 Analisar voz de novo.');
    $('Apply').disabled = true;
    try {
      const r = await root.APSElastic.tune(st.original, st.track, options(), (p, m) => say((m || 'Afinando…') + ' ' + Math.round(p * 100) + '%'));
      st.result = r.buffer; st.listening = 'B'; adapter.apply(r.buffer, { id: st.srcId, original: st.original, metrics: r.metrics });
      $('AB').disabled = false; $('Undo').disabled = false; abLabel();
      const manual = Object.values(st.edits).filter(e => Number.isFinite(e.target)).length;
      say(`✓ Voz afinada em ${Cc.NOTE[keyNow()]} ${Cc.SCALE_NAMES[$('Scale').value]}${manual ? ` · ${manual} nota(s) puxada(s) à mão` : ''}. Formantes ${Number($('Form').value) ? 'deslocados ' + $('Form').value + ' st' : 'preservados'}. Toque ▶ para ouvir e A/B para comparar.`, 'ok');
    } finally { $('Apply').disabled = false; }
  }
  function abLabel() { $('AB').textContent = st.listening === 'B' ? 'A/B: ouvindo B (afinado)' : 'A/B: ouvindo A (original)'; $('AB').classList.toggle('on', st.listening === 'A'); }
  function ab() { if (!st.result) return; st.listening = st.listening === 'B' ? 'A' : 'B'; if (st.listening === 'A') adapter.restore(st.original, { id: st.srcId, ab: true }); else adapter.apply(st.result, { id: st.srcId, ab: true, original: st.original }); abLabel(); }
  function undo() { if (!st.original) return; adapter.restore(st.original, { id: st.srcId, undo: true }); st.result = null; st.listening = 'B'; $('AB').disabled = true; $('Undo').disabled = true; abLabel(); say('Gravação original de volta. Suas edições de nota continuam no gráfico.', 'ok'); }
  function resetNotes() { st.edits = {}; replan(); say('Notas voltaram para a correção automática.'); }
  // ------- desenho -------
  function view() { const dur = st.original ? st.original.duration : 1, z = Number($('Zoom').value) || dur, w = Math.min(dur, z); return { start: Math.max(0, (dur - w) * Number($('Scroll').value) / 1000), w, dur }; }
  function range() {
    const ns = st.plan ? st.plan.notes : []; if (!ns.length) return [48, 72];
    let lo = 1e9, hi = -1e9; for (const n of ns) { lo = Math.min(lo, n.center, n.target); hi = Math.max(hi, n.center, n.target); }
    return [Math.floor(lo) - 3, Math.ceil(hi) + 3];
  }
  function draw() {
    const r = cv.getBoundingClientRect(), W = Math.max(280, Math.floor(r.width || 700)), H = 260, dpr = Math.min(2, root.devicePixelRatio || 1);
    if (cv.width !== Math.round(W * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.fillStyle = '#0f141d'; g.fillRect(0, 0, W, H);
    if (!st.plan) { g.fillStyle = '#b8c3d5'; g.font = '14px system-ui'; g.fillText('Selecione a pista de voz e toque em 🔍 Analisar voz', 16, 40); return; }
    const v = view(), [lo, hi] = range(), padL = 34, X = t => padL + (t - v.start) / v.w * (W - padL), T = x => v.start + (x - padL) / (W - padL) * v.w;
    const Y = m => H - 8 - (m - lo) / (hi - lo) * (H - 16), rowH = (H - 16) / (hi - lo);
    st.view = { X, T, Y, rowH, padL };
    const key = keyNow(), sc = Cc.SCALES[$('Scale').value];
    for (let m = lo; m <= hi; m++) {
      const inS = sc.includes(((m - key) % 12 + 12) % 12);
      g.fillStyle = inS ? 'rgba(229,189,114,.09)' : 'rgba(255,255,255,.02)'; g.fillRect(padL, Y(m + 0.5), W - padL, rowH);
      if (inS) { g.fillStyle = '#8a7650'; g.font = '10px system-ui'; g.fillText(Cc.noteName(m), 2, Y(m) + 3); }
    }
    const hop = st.track.hopSec, f0 = st.track.f0, i0 = Math.max(0, Math.floor(v.start / hop)), i1 = Math.min(f0.length, Math.ceil((v.start + v.w) / hop));
    // notas
    st.plan.notes.forEach((n, k) => {
      if (n.t1 < v.start || n.t0 > v.start + v.w) return;
      const x0 = X(n.t0), x1 = X(n.t1);
      g.fillStyle = 'rgba(160,170,190,.18)'; g.fillRect(x0, Y(n.center) - 2, x1 - x0, 4);
      g.fillStyle = n.off ? 'rgba(140,140,140,.35)' : k === st.sel ? 'rgba(97,220,196,.55)' : n.manual ? 'rgba(255,143,200,.45)' : 'rgba(229,189,114,.38)';
      const y = Y(n.off ? n.center : n.target);
      g.fillRect(x0, y - rowH * 0.42, Math.max(3, x1 - x0), rowH * 0.84);
      if (x1 - x0 > 26) { g.fillStyle = '#f4e3c0'; g.font = '10px system-ui'; g.fillText(Cc.noteName(n.off ? n.center : n.target), x0 + 3, y + 3); }
    });
    // curva original
    g.fillStyle = '#6f9be0'; for (let i = i0; i < i1; i++) if (f0[i] > 0) g.fillRect(X(i * hop), Y(Cc.midiOf(f0[i])) - 1, 1.6, 2);
    // curva resultante
    g.strokeStyle = '#f1c66e'; g.lineWidth = 1.6; g.beginPath(); let pen = false;
    for (let i = i0; i < i1; i++) { const m = st.plan.outMidi[i]; if (!m) { pen = false; continue; } const x = X(i * hop), y = Y(m); if (!pen) { g.moveTo(x, y); pen = true; } else g.lineTo(x, y); }
    g.stroke(); g.lineWidth = 1;
  }
  function noteInfo() {
    const bar = $('NoteBar'); if (!st.plan || st.sel < 0 || !st.plan.notes[st.sel]) { bar.hidden = true; return; }
    const n = st.plan.notes[st.sel]; bar.hidden = false;
    const cents = Math.round((n.center - Math.round(n.center)) * 100);
    $('NoteInfo').textContent = `Nota ${st.sel + 1}: cantada ${Cc.noteName(n.center)} (${cents >= 0 ? '+' : ''}${cents} cents) → ${n.off ? 'sem correção' : Cc.noteName(n.target) + (Math.abs(n.target - Math.round(n.target)) > 0.01 ? ` ${Math.round((n.target - Math.round(n.target)) * 100)}c` : '')}${n.manual ? ' (à mão)' : ''}`;
    $('Off').textContent = n.off ? '✓ Corrigir esta nota' : '⊘ Não corrigir';
  }
  function setTarget(k, target) { const n = st.plan.notes[k]; st.edits[n.id] = { ...(st.edits[n.id] || {}), target, off: false }; replan(); }
  function hit(e) {
    if (!st.view || !st.plan) return -1; const r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top, t = st.view.T(x);
    let best = -1, bd = 1e9;
    st.plan.notes.forEach((n, k) => { if (t < n.t0 - 0.03 || t > n.t1 + 0.03) return; const d = Math.abs(st.view.Y(n.off ? n.center : n.target) - y); if (d < bd) { bd = d; best = k; } });
    return bd < Math.max(26, st.view.rowH * 2.5) ? best : -1;
  }
  cv.addEventListener('pointerdown', e => {
    const k = hit(e); st.sel = k; noteInfo(); draw(); if (k < 0) return;
    const n = st.plan.notes[k]; st.drag = { k, y0: e.clientY, t0: n.off ? n.center : n.target, moved: false };
    try { cv.setPointerCapture(e.pointerId); } catch (_) {} e.preventDefault();
  });
  cv.addEventListener('pointermove', e => {
    if (!st.drag) return; const dy = (st.drag.y0 - e.clientY) / st.view.rowH; if (Math.abs(dy) < 0.25 && !st.drag.moved) return;
    st.drag.moved = true; const fine = $('Fine').checked, raw = st.drag.t0 + dy, target = fine ? Math.round(raw * 10) / 10 : Math.round(raw);
    const cur = st.plan.notes[st.drag.k]; if (cur.target !== target || cur.off) setTarget(st.drag.k, target);
  });
  const end = () => { if (st.drag && st.drag.moved) { const n = st.plan.notes[st.drag.k]; say(`Nota ${st.drag.k + 1} puxada para ${Cc.noteName(n.target)}. Toque ✨ Aplicar afinação para ouvir.`); } st.drag = null; };
  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(n => cv.addEventListener(n, end));
  const guard = fn => () => Promise.resolve().then(fn).catch(e => say(e.message || String(e), 'err'));
  $('Analyze').addEventListener('click', guard(analyze)); $('Apply').addEventListener('click', guard(apply));
  $('AB').addEventListener('click', guard(ab)); $('Undo').addEventListener('click', guard(undo)); $('Reset').addEventListener('click', guard(resetNotes));
  $('Up').addEventListener('click', () => { if (st.sel >= 0) setTarget(st.sel, Math.round(st.plan.notes[st.sel].target) + 1); });
  $('Down').addEventListener('click', () => { if (st.sel >= 0) setTarget(st.sel, Math.round(st.plan.notes[st.sel].target) - 1); });
  $('Off').addEventListener('click', () => { if (st.sel < 0) return; const n = st.plan.notes[st.sel]; st.edits[n.id] = { ...(st.edits[n.id] || {}), off: !n.off }; replan(); });
  $('Auto').addEventListener('click', () => { if (st.sel < 0) return; delete st.edits[st.plan.notes[st.sel].id]; replan(); });
  ['Amt', 'Vib', 'Trans', 'Form', 'Hum', 'Drift'].forEach(k => $(k).addEventListener('input', () => { labels(); replan(); }));
  ['Key', 'Scale'].forEach(k => $(k).addEventListener('change', replan));
  $('Zoom').addEventListener('change', draw); $('Scroll').addEventListener('input', draw); root.addEventListener('resize', draw);
  draw();
  const api = { state: st, analyze: guard(analyze), apply: guard(apply), redraw: draw }; host.__apsTune = api; return api;
}
root.APSElasticTuneUI = { mount };
})(typeof window !== 'undefined' ? window : globalThis);
