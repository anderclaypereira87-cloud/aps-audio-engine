/* APS Quantização · Ritmo: botão giratório de compasso, metrônomo com agendamento preciso (lookahead)
 * e "Auto (BPM + Compasso)". Usado na DAW (daw.html) e na página solo (quantizacao.html).
 * Criado para o APS Audio Engine por Anderclay Pereira Silva. Sem dependências externas. */
(function (root) {
'use strict';
const C = () => root.APSElasticCore;
const METERS = ['4/4', '3/4', '2/4', '6/8', '5/4', '7/8', '12/8'];
const CSS = `.aps-qr{display:flex;flex-wrap:wrap;gap:14px;align-items:center;background:linear-gradient(150deg,#141d2e,#0f1522);border:1px solid #8a6d3b;border-radius:15px;padding:12px 14px;color:#e8ebf1;margin:10px 0}
.aps-qr .knobwrap{display:flex;flex-direction:column;align-items:center;gap:2px}
.aps-qr .knob{width:150px;height:150px;touch-action:none;cursor:grab;outline:none;border-radius:50%;user-select:none;-webkit-user-select:none}
.aps-qr .knob:focus-visible{box-shadow:0 0 0 3px #59cde6}
.aps-qr .knob .opt{font:700 11px system-ui;fill:#9fb0c8;cursor:pointer}.aps-qr .knob .opt.sel{fill:#ffe0a3;font-size:13px}
.aps-qr .knob .dot{fill:#3a4a62}.aps-qr .knob .dot.sel{fill:#f0cd8c}
.aps-qr .knob .rot{transition:transform .16s ease-out}
.aps-qr .knob .cap{font:900 22px system-ui;fill:#fff2d6}.aps-qr .knob .capsub{font:700 9px system-ui;fill:#c7b48f;letter-spacing:.12em}
.aps-qr .col{display:flex;flex-direction:column;gap:8px;min-width:0;flex:1}
.aps-qr .row{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.aps-qr label{font-size:12px;color:#cdd5e2;display:inline-flex;gap:6px;align-items:center}
.aps-qr input[type=number]{background:#0c1422;color:#eef;border:1px solid #56647a;border-radius:8px;padding:7px;min-height:40px;width:78px;font:inherit;font-size:15px;font-weight:800}
.aps-qr input[type=range]{accent-color:#e2bc76;width:100px}
.aps-qr button{min-height:40px;border-radius:10px;border:1px solid #9b7a41;background:#e2bc76;color:#17202b;font-weight:800;padding:8px 12px;cursor:pointer;font-size:13px}
.aps-qr button.alt{background:#223047;color:#f1d5a5;border-color:#7d6847}.aps-qr button.on{background:#59cde6;color:#0d1a24;border-color:#59cde6}
.aps-qr button.mini{min-height:34px;padding:4px 9px;font-size:12px}
.aps-qr button:disabled{opacity:.42;cursor:not-allowed}
.aps-qr .beats{display:flex;gap:5px}.aps-qr .beats span{width:14px;height:14px;border-radius:50%;background:#2a3850;border:1px solid #4b5d78}
.aps-qr .beats span.acc{border-color:#f0cd8c}.aps-qr .beats span.lit{background:#59cde6}.aps-qr .beats span.acc.lit{background:#f0cd8c}
.aps-qr .rstatus{font-size:12px;color:#d4e1ed;background:#1b283b;border:1px solid #3d5068;border-radius:9px;padding:7px 10px;min-height:18px}
.aps-qr .col{min-width:240px}
@media(max-width:560px){.aps-qr{flex-direction:column;align-items:stretch}.aps-qr .knobwrap{align-self:center}.aps-qr .col{min-width:0}}
.aps-qr .rstatus[data-kind=ok]{background:#173230;border-color:#4f8f80;color:#c4f0e2}.aps-qr .rstatus[data-kind=err]{background:#3a2125;border-color:#a86a6a;color:#ffd7d7}`;
function injectCss() { if (document.getElementById('apsQrCss')) return; const s = document.createElement('style'); s.id = 'apsQrCss'; s.textContent = CSS; document.head.appendChild(s); }

// ---------- Botão giratório de compasso ----------
function Knob(host, opt = {}) {
  const opts = opt.options || METERS, N = opts.length, A0 = -135, A1 = 135, step = (A1 - A0) / (N - 1), R = 58, cx = 75, cy = 75;
  let idx = Math.max(0, opts.indexOf(opt.value || '4/4'));
  const ang = i => A0 + i * step, rad = a => (a - 90) * Math.PI / 180;
  const ticks = opts.map((o, i) => { const a = rad(ang(i)), tx = cx + Math.cos(a) * (R + 9), ty = cy + Math.sin(a) * (R + 9) + 4, dx = cx + Math.cos(a) * (R - 13), dy = cy + Math.sin(a) * (R - 13);
    return `<circle class="dot" data-i="${i}" cx="${dx.toFixed(1)}" cy="${dy.toFixed(1)}" r="2.6"/><text class="opt" data-i="${i}" x="${tx.toFixed(1)}" y="${ty.toFixed(1)}" text-anchor="middle">${o}</text>`; }).join('');
  host.innerHTML = `<svg class="knob" viewBox="-8 -8 166 166" role="slider" tabindex="0" aria-label="${opt.label || 'Compasso'} (gire o botão)" aria-valuemin="0" aria-valuemax="${N - 1}">
 <defs><radialGradient id="${opt.id}G" cx="40%" cy="35%" r="70%"><stop offset="0" stop-color="#3b4a66"/><stop offset="1" stop-color="#121a29"/></radialGradient></defs>
 <circle cx="${cx}" cy="${cy}" r="${R + 17}" fill="#0b111c" stroke="#3a4a62"/>
 ${ticks}
 <g class="rot"><circle cx="${cx}" cy="${cy}" r="${R - 20}" fill="url(#${opt.id}G)" stroke="#9b7a41" stroke-width="2"/><line x1="${cx}" y1="${cy - R + 22}" x2="${cx}" y2="${cy - R + 34}" stroke="#f0cd8c" stroke-width="4" stroke-linecap="round"/></g>
 <text class="cap" x="${cx}" y="${cy + 6}" text-anchor="middle"></text><text class="capsub" x="${cx}" y="${cy + 19}" text-anchor="middle">COMPASSO</text></svg>`;
  const svg = host.querySelector('svg'), rot = svg.querySelector('.rot'), cap = svg.querySelector('.cap');
  function paint() {
    rot.style.transform = `rotate(${ang(idx)}deg)`; rot.style.transformOrigin = `${cx}px ${cy}px`; rot.setAttribute('data-angle', String(ang(idx)));
    cap.textContent = opts[idx]; svg.setAttribute('aria-valuenow', String(idx)); svg.setAttribute('aria-valuetext', opts[idx]); svg.dataset.value = opts[idx];
    svg.querySelectorAll('[data-i]').forEach(e => e.classList.toggle('sel', Number(e.dataset.i) === idx));
  }
  function set(v, silent) { const i = typeof v === 'number' ? v : opts.indexOf(v); if (i < 0 || i >= N) return; const ch = i !== idx; idx = i; paint(); if (ch && !silent && opt.onChange) opt.onChange(opts[idx]); }
  const fromPointer = e => { const r = svg.getBoundingClientRect(), x = e.clientX - (r.left + r.width / 2), y = e.clientY - (r.top + r.height / 2); let a = Math.atan2(x, -y) * 180 / Math.PI; a = Math.max(A0, Math.min(A1, a)); return Math.round((a - A0) / step); };
  let drag = false;
  svg.addEventListener('pointerdown', e => { const t = e.target.closest('[data-i]'); if (t) { set(Number(t.dataset.i)); return; } drag = true; svg.style.cursor = 'grabbing'; try { svg.setPointerCapture(e.pointerId); } catch (_) {} set(fromPointer(e)); e.preventDefault(); });
  svg.addEventListener('pointermove', e => { if (drag) set(fromPointer(e)); });
  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(n => svg.addEventListener(n, () => { drag = false; svg.style.cursor = ''; }));
  svg.addEventListener('wheel', e => { e.preventDefault(); set(Math.max(0, Math.min(N - 1, idx + (e.deltaY > 0 ? 1 : -1)))); }, { passive: false });
  svg.addEventListener('keydown', e => { const k = e.key; let i = idx; if (k === 'ArrowRight' || k === 'ArrowUp') i++; else if (k === 'ArrowLeft' || k === 'ArrowDown') i--; else if (k === 'Home') i = 0; else if (k === 'End') i = N - 1; else return; e.preventDefault(); set(Math.max(0, Math.min(N - 1, i))); });
  paint();
  return { el: svg, value: () => opts[idx], set, options: opts.slice(), angle: () => ang(idx) };
}

// ---------- Metrônomo (agendamento WebAudio com lookahead) ----------
// Mantém 120 ms agendados à frente do relógio do áudio; o temporizador só "acorda" o agendador.
// Os cliques usam o mesmo AudioContext e o mesmo instante de partida das pistas: sincronia exata.
function Metronome() {
  const m = { volume: 0.35, enabled: false, log: [], timer: null, nodes: [], running: false, lookahead: 0.12, interval: 25 };
  m.start = (ctx, o) => {
    m.stop(); if (!ctx) return;
    const mi = C().meterInfo(o.sig, o.bpm), zero = o.gridZero || 0, from = o.from || 0, t0 = o.when;
    let k = Math.ceil((from - zero) / mi.click - 1e-9);
    const out = o.destination || ctx.destination; m.running = true; m.log = []; m.info = { t0, from, zero, click: mi.click, num: mi.num, sig: mi.sig, bpm: o.bpm };
    const tick = () => {
      const now = ctx.currentTime, horizon = now + m.lookahead;
      for (;;) {
        const s = zero + k * mi.click, at = t0 + (s - from); if (at > horizon) break;
        const pos = ((k % mi.num) + mi.num) % mi.num, acc = mi.accents[pos];
        if (at >= now - 0.002 && (o.until == null || s <= o.until)) {
          const osc = ctx.createOscillator(), g = ctx.createGain(), vol = m.volume * (acc === 2 ? 1 : acc === 1 ? 0.72 : 0.5);
          osc.type = acc === 2 ? 'square' : 'sine'; osc.frequency.value = acc === 2 ? 1760 : acc === 1 ? 1320 : 990;
          g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol * 0.6), at + 0.002); g.gain.exponentialRampToValueAtTime(0.0001, at + 0.05);
          osc.connect(g); g.connect(out); osc.start(at); osc.stop(at + 0.06); m.nodes.push(osc); osc.onended = () => { const i = m.nodes.indexOf(osc); if (i >= 0) m.nodes.splice(i, 1); try { g.disconnect(); } catch (_) {} };
          if (m.log.length < 2048) m.log.push({ at, session: s, beat: pos + 1, bar: Math.floor(k / mi.num) + 1, accent: acc });
          if (m.onBeat) { const delay = Math.max(0, (at - now) * 1000); setTimeout(() => m.running && m.onBeat(pos, mi), delay); }
        }
        k++;
      }
    };
    tick(); m.timer = setInterval(tick, m.interval);
  };
  m.stop = () => { if (m.timer) clearInterval(m.timer); m.timer = null; m.running = false; for (const n of m.nodes.splice(0)) { try { n.stop(); } catch (_) {} } };
  return m;
}

// ---------- Barra de ritmo (knob + BPM + Auto + metrônomo + ▶ ouvir com metrônomo) ----------
// adapter: idPrefix, getBpm(), setBpm(v), getSig(), setSig(s), getGridZero?(), setGridZero?(t),
//          analyze() -> Promise<{bpm,sig,downbeat,confidence,...}>, audio() -> {ctx, from, items:[{buffer, start}]}
function mountBar(host, adapter) {
  injectCss();
  const P = adapter.idPrefix || 'apsQr', id = s => P + s;
  host.innerHTML = `<div class="aps-qr" data-aps-quant-rhythm>
 <div class="knobwrap"><div id="${id('Knob')}"></div></div>
 <div class="col">
  <div class="row"><label>BPM <input id="${id('Bpm')}" type="number" min="40" max="240" step="0.1" value="100"></label>
   <button type="button" class="alt mini" id="${id('Half')}" title="Metade do BPM">½ Metade</button><button type="button" class="alt mini" id="${id('Double')}" title="Dobro do BPM">2× Dobro</button>
   <button type="button" id="${id('Auto')}" title="Detecta BPM e compasso no áudio">⚡ Auto (BPM + Compasso)</button></div>
  <div class="row"><button type="button" class="alt" id="${id('Metro')}" aria-pressed="false">♩ Metrônomo: desligado</button>
   <label>🔊 Clique <input id="${id('Vol')}" type="range" min="0" max="100" value="35" aria-label="Volume do clique"></label>
   <button type="button" class="alt" id="${id('Play')}">▶ Ouvir com metrônomo</button>
   <div class="beats" id="${id('Beats')}" aria-hidden="true"></div></div>
  <div class="rstatus" id="${id('Status')}" role="status" aria-live="polite">Gire o botão para escolher o compasso, ou toque em ⚡ Auto para detectar BPM e compasso.</div>
 </div></div>`;
  const $ = s => document.getElementById(id(s)), say = (t, k) => { const e = $('Status'); e.textContent = t; e.dataset.kind = k || ''; };
  const metro = Metronome();
  const knob = Knob($('Knob'), { id: id('KnobSvg'), value: adapter.getSig() || '4/4', onChange: s => { adapter.setSig(s); beats(); say(`Compasso ${s}: a grade destaca o tempo 1 de cada compasso${metro.running ? ' e o metrônomo já segue o novo compasso' : ''}.`); if (metro.running) restart(); } });
  knob.el.id = id('KnobSvg');
  function beats() { const mi = C().meterInfo(knob.value(), 100); $('Beats').innerHTML = mi.accents.map(a => `<span class="${a ? 'acc' : ''}"></span>`).join(''); }
  metro.onBeat = pos => { const b = $('Beats').children; for (let i = 0; i < b.length; i++) b[i].classList.toggle('lit', i === pos); };
  function sync() { $('Bpm').value = +(+adapter.getBpm() || 100).toFixed(1); knob.set(adapter.getSig() || '4/4', true); beats(); }
  sync();
  const setBpm = v => { v = Math.max(40, Math.min(240, Math.round(v * 10) / 10)); $('Bpm').value = v; adapter.setBpm(v); if (metro.running) restart(); };
  $('Bpm').addEventListener('change', () => setBpm(Number($('Bpm').value) || 100));
  $('Half').addEventListener('click', () => setBpm((Number($('Bpm').value) || 100) / 2));
  $('Double').addEventListener('click', () => setBpm((Number($('Bpm').value) || 100) * 2));
  $('Vol').addEventListener('input', () => { metro.volume = Number($('Vol').value) / 100; });
  metro.volume = Number($('Vol').value) / 100;
  function metroLabel() { $('Metro').textContent = metro.enabled ? '♩ Metrônomo: ligado' : '♩ Metrônomo: desligado'; $('Metro').classList.toggle('on', metro.enabled); $('Metro').setAttribute('aria-pressed', String(metro.enabled)); $('Play').textContent = playing ? '■ Parar' : (metro.enabled ? '▶ Ouvir com metrônomo' : '▶ Ouvir'); if (adapter.onState) adapter.onState(!!playing); }
  $('Metro').addEventListener('click', () => { metro.enabled = !metro.enabled; metroLabel(); if (playing) { if (metro.enabled) startMetro(); else metro.stop(); } });
  let playing = null;
  function startMetro() { if (!playing) return; metro.start(playing.ctx, { when: playing.t0, from: playing.from, gridZero: adapter.getGridZero ? adapter.getGridZero() : 0, bpm: Number($('Bpm').value) || 100, sig: knob.value(), until: playing.until }); }
  function stop() { if (playing) { for (const s of playing.srcs) { try { s.stop(); } catch (_) {} } playing = null; say('Parado. Toque ▶ para ouvir de novo' + (metro.enabled ? ' com o metrônomo.' : '.')); } metro.stop(); Array.from($('Beats').children).forEach(b => b.classList.remove('lit')); metroLabel(); }
  async function play() {
    if (playing) { stop(); return; }
    const a = adapter.audio && adapter.audio(); if (!a || !a.ctx || !a.items || !a.items.length) throw Error('Escolha/analise o áudio primeiro.');
    await a.ctx.resume(); const t0 = a.ctx.currentTime + 0.08, srcs = []; let until = a.from;
    for (const it of a.items) {
      if (!it.buffer) continue; const local = a.from - it.start, src = a.ctx.createBufferSource(); src.buffer = it.buffer; src.connect(a.destination || a.ctx.destination);
      if (local >= 0) { if (local >= it.buffer.duration) continue; src.start(t0, local); } else src.start(t0 - local, 0);
      srcs.push(src); until = Math.max(until, it.start + it.buffer.duration);
    }
    if (!srcs.length) throw Error('Nada para tocar nesta posição.');
    playing = { ctx: a.ctx, t0, from: a.from, srcs, until };
    let ended = 0; srcs.forEach(s => s.onended = () => { if (++ended >= srcs.length && playing && playing.srcs === srcs) stop(); });
    if (metro.enabled) startMetro();
    metroLabel(); say((metro.enabled ? 'Tocando com o metrônomo em sincronia (acento no tempo 1). ' : 'Tocando. ') + (a.label || ''), 'ok');
    root.__apsQuantPreview = { t0, from: a.from, ctx: a.ctx, items: a.items.length };
  }
  function restart() { if (playing && metro.enabled) startMetro(); }
  const guard = fn => () => Promise.resolve().then(fn).catch(e => say(e.message || String(e), 'err'));
  $('Play').addEventListener('click', guard(play));
  $('Auto').addEventListener('click', guard(async () => {
    $('Auto').disabled = true; say('Analisando ataques, tempo e acentuação…');
    try {
      const r = await adapter.analyze();
      if (!r || !r.bpm) throw Error('Não encontrei pulso rítmico suficiente para detectar o tempo. Ajuste o BPM e o compasso à mão.');
      setBpm(r.bpm); knob.set(r.sig, true); adapter.setSig(r.sig); beats();
      if (adapter.setGridZero && Number.isFinite(r.downbeat)) adapter.setGridZero(r.downbeat);
      const pc = v => Math.round(100 * (v || 0)) + '%';
      say(`⚡ Detectado: ${Math.round(r.bpm * 10) / 10} BPM · compasso ${r.sig} · tempo 1 em ${(r.downbeat || 0).toFixed(3)} s · confiança ${pc(r.confidence)} (tempo ${pc(r.bpmConfidence)}, compasso ${pc(r.meterConfidence)}). Confira de ouvido com o metrônomo; se soar na metade ou no dobro, use ½ Metade ou 2× Dobro.`, r.confidence >= 0.5 ? 'ok' : '');
      root.__apsQuantAuto = r;
      if (playing) restart();
    } finally { $('Auto').disabled = false; }
  }));
  metroLabel();
  const api = { knob, metro, sync, stop, play: guard(play), isPlaying: () => !!playing, setSig: s => { knob.set(s, true); beats(); }, say, setMetronome: on => { if (metro.enabled !== !!on) $('Metro').click(); } };
  host.__apsRhythm = api; return api;
}
root.APSQuantRhythm = { Knob, Metronome, mountBar, METERS };
})(typeof window !== 'undefined' ? window : globalThis);
