/* APS Quantização Multitrack (DAW): lista as pistas da sessão, escolhe qual alinhar, mostra os pontos
 * (ataques) das outras pistas no gráfico e alinha sem cortes — na grade, pela pista guia ou em lote.
 * O original de cada pista fica guardado (A/B e Desfazer por pista). Nada sai do aparelho.
 * Criado para o APS Audio Engine por Anderclay Pereira Silva. */
(function (root) {
'use strict';
const C = () => root.APSElasticCore, EL = () => root.APSElastic;
const COLORS = ['#59cde6', '#ff8fc8', '#9be36d', '#c59bff', '#ffb35c', '#5cf2c4', '#ff6b6b', '#f2e35c', '#7fa8ff', '#e0a3ff'];
const CSS = `.aps-mt{background:linear-gradient(150deg,#121a29,#101622);border:1px solid #4f6582;border-radius:15px;padding:12px 14px;color:#e8ebf1;margin:10px 0}
.aps-mt h3{margin:0;color:#9fe3f2;font-size:15px}.aps-mt .sub{font-size:12px;color:#bfc9db;margin:3px 0 8px}
.aps-mt .tracks{display:flex;flex-direction:column;gap:6px;max-height:260px;overflow:auto}
.aps-mt .trk{display:grid;grid-template-columns:14px minmax(0,1fr) auto;gap:8px;align-items:center;background:#162236;border:1px solid #2f3f57;border-radius:10px;padding:6px 8px}
.aps-mt .trk.active{border-color:#e2bc76;background:#1f2a3f;box-shadow:inset 3px 0 0 #e2bc76}
.aps-mt .sw{width:14px;height:14px;border-radius:4px}.aps-mt .nm{font-size:13px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.aps-mt .nm small{display:block;font-weight:500;font-size:11px;color:#aebbd0}.aps-mt .nm small b{color:#ff8a8a}
.aps-mt .acts{display:flex;gap:5px;flex-wrap:wrap;justify-content:flex-end}
.aps-mt button{min-height:34px;border-radius:9px;border:1px solid #7d6847;background:#223047;color:#f1d5a5;font-weight:800;padding:5px 9px;cursor:pointer;font-size:12px}
.aps-mt button.on{background:#59cde6;color:#0d1a24;border-color:#59cde6}.aps-mt button.gold{background:#e2bc76;color:#17202b;border-color:#9b7a41}
.aps-mt button:disabled{opacity:.4;cursor:not-allowed}
.aps-mt label{font-size:12px;color:#cdd5e2;display:inline-flex;gap:5px;align-items:center}
.aps-mt select{background:#0c1422;color:#eef;border:1px solid #56647a;border-radius:8px;padding:6px;min-height:36px;font:inherit;font-size:13px}
.aps-mt .row{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:8px 0}
.aps-mt .seg{display:inline-flex;border:1px solid #56647a;border-radius:10px;overflow:hidden}.aps-mt .seg button{border:0;border-radius:0;min-height:38px}
.aps-mt .mtstatus{font-size:12px;color:#d4e1ed;background:#1b283b;border:1px solid #3d5068;border-radius:9px;padding:7px 10px;margin-top:6px}
.aps-mt .mtstatus[data-kind=ok]{background:#173230;border-color:#4f8f80;color:#c4f0e2}.aps-mt .mtstatus[data-kind=err]{background:#3a2125;border-color:#a86a6a;color:#ffd7d7}
.aps-mt input[type=checkbox]{width:18px;height:18px;accent-color:#e2bc76}`;
function injectCss() { if (document.getElementById('apsMtCss')) return; const s = document.createElement('style'); s.id = 'apsMtCss'; s.textContent = CSS; document.head.appendChild(s); }
const esc = s => String(s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]);

// opts: bridge, quant (API do editor elástico), originals Map, results Map, bpm(), sig(), gridZero(), onActive(id)
function mount(host, o) {
  injectCss();
  const B = o.bridge;
  host.innerHTML = `<div class="aps-mt" data-aps-quant-mt>
 <h3>🎛 Multitrack · alinhar com os outros instrumentos</h3>
 <p class="sub">O APS lê o BPM, o compasso e todas as pistas da DAW. Escolha a pista para editar (✎); os pontos 👁 das outras pistas aparecem no gráfico com a cor delas (em vermelho quando estão fora do tempo). Alinhe na grade, pela pista guia ou várias de uma vez — sem cortes, com A/B e Desfazer em cada pista.</p>
 <div class="tracks" id="apsMtList" role="list"></div>
 <div class="row"><span style="font-size:12px;color:#cdd5e2">Alinhar:</span>
  <div class="seg" role="group" aria-label="Modo de alinhamento"><button type="button" id="apsMtModeGrid" class="on" data-mode="grid">▦ Na grade</button><button type="button" id="apsMtModeGuide" data-mode="guide">🥁 Pela pista guia</button></div>
  <label>Guia <select id="apsMtGuide" aria-label="Pista guia"></select></label>
  <label title="Distância máxima para parear um ataque com a guia">Alcance <select id="apsMtReach"><option value="50">50 ms</option><option value="90" selected>90 ms</option><option value="140">140 ms</option></select></label></div>
 <div class="row"><button type="button" class="gold" id="apsMtAlignActive">✦ Alinhar pista ativa</button><button type="button" class="gold" id="apsMtAlignBatch" disabled>✦✦ Alinhar selecionadas (lote)</button><button type="button" id="apsMtAllPts">👁 Mostrar todos os pontos</button><button type="button" id="apsMtRefresh">↻ Ler pistas da DAW</button></div>
 <div class="mtstatus" id="apsMtStatus" role="status" aria-live="polite">Carregue pistas na DAW para alinhar umas com as outras.</div></div>`;
  const $ = id => document.getElementById(id), say = (t, k) => { const e = $('apsMtStatus'); e.textContent = t; e.dataset.kind = k || ''; };
  const st = { mode: 'grid', guide: null, visible: new Map(), batch: new Set(), cache: new WeakMap(), info: new Map(), busy: false };
  const tracks = () => (B.all ? B.all() : []).filter(t => t && t.buf);
  const colorOf = id => { const i = tracks().findIndex(t => t.id === id); return COLORS[(i < 0 ? 0 : i) % COLORS.length]; };
  const activeId = () => (B.current && B.current() || {}).id || null;
  const raw = id => tracks().find(t => t.id === id) || null;
  // tempo local de uma pista <-> tempo da sessão
  const toSession = (t, local) => (Number(t.start) || 0) + local - (Number(t.trimIn) || 0);
  const toLocal = (t, s) => s - (Number(t.start) || 0) + (Number(t.trimIn) || 0);
  function onsetsOf(buf) { let p = st.cache.get(buf); if (!p) { p = EL().onsets(buf).then(r => r.onsets.map(x => x.time)); st.cache.set(buf, p); p.catch(() => st.cache.delete(buf)); } return p; }
  const gridOffsetFor = t => toLocal(t, o.gridZero ? o.gridZero() : 0);
  async function refreshInfo() {
    const list = tracks(), sub = o.quant.settings().subdivision;
    await Promise.all(list.map(async t => {
      try { const times = await onsetsOf(t.buf), dev = C().gridDeviation(times.map(x => toSession(t, x)), { bpm: o.bpm(), subdivision: sub, gridOffset: o.gridZero ? o.gridZero() : 0 }); st.info.set(t.id, { n: times.length, off: dev.filter(d => d.off).length, times }); } catch (e) { st.info.set(t.id, { n: 0, off: 0, times: [], err: e.message }); }
    }));
  }
  function render() {
    const list = tracks(), act = activeId();
    for (const t of list) if (!st.visible.has(t.id)) st.visible.set(t.id, true);
    for (const id of [...st.batch]) if (!raw(id)) st.batch.delete(id);
    if (st.guide && !raw(st.guide)) st.guide = null;
    $('apsMtList').innerHTML = list.length ? list.map(t => {
      const inf = st.info.get(t.id), has = o.results.has(t.id), isB = has && B.buffer(t.id) === o.results.get(t.id), vis = st.visible.get(t.id) !== false, isAct = t.id === act;
      return `<div class="trk${isAct ? ' active' : ''}" role="listitem" data-id="${esc(t.id)}"><span class="sw" style="background:${colorOf(t.id)}"></span>
   <div class="nm">${esc(t.name || 'Pista')}<small>${inf ? `${inf.n} ataques${inf.off ? ` · <b>${inf.off} fora do tempo</b>` : ' · no tempo'}` : 'lendo ataques…'}${t.id === st.guide ? ' · 🥁 guia' : ''}${has ? (isB ? ' · alinhada (B)' : ' · original (A)') : ''}</small></div>
   <div class="acts"><button type="button" data-a="edit" class="${isAct ? 'on' : ''}" aria-pressed="${isAct}" title="Editar/alinhar esta pista">✎ ${isAct ? 'Editando' : 'Editar'}</button>
    <button type="button" data-a="pts" class="${vis ? 'on' : ''}" aria-pressed="${vis}" title="Mostrar os pontos desta pista no gráfico" ${isAct ? 'disabled' : ''}>👁</button>
    <label title="Incluir no lote"><input type="checkbox" data-a="batch" ${st.batch.has(t.id) ? 'checked' : ''} aria-label="Lote: ${esc(t.name)}">Lote</label>
    <button type="button" data-a="ab" ${has ? '' : 'disabled'} title="Comparar original (A) e alinhada (B)">A/B</button><button type="button" data-a="undo" ${has ? '' : 'disabled'} title="Voltar o original desta pista">↶</button></div></div>`;
    }).join('') : '<p class="sub">Nenhuma pista na sessão. Importe ou grave pistas na DAW.</p>';
    const g = $('apsMtGuide'); g.innerHTML = '<option value="">— escolha a pista guia —</option>' + list.filter(t => t.id !== act).map(t => `<option value="${esc(t.id)}" ${t.id === st.guide ? 'selected' : ''}>${esc(t.name || 'Pista')}</option>`).join('');
    $('apsMtAlignBatch').disabled = !st.batch.size || st.busy; $('apsMtAlignActive').disabled = !act || st.busy;
    $('apsMtModeGrid').classList.toggle('on', st.mode === 'grid'); $('apsMtModeGuide').classList.toggle('on', st.mode === 'guide');
  }
  async function refresh() { render(); await refreshInfo(); render(); o.quant.redraw(); }
  // pontos das outras pistas no tempo local da pista ativa
  function overlays() {
    const a = raw(activeId()); if (!a) return [];
    return tracks().filter(t => t.id !== a.id && st.visible.get(t.id) !== false && st.info.get(t.id)).map(t => ({ id: t.id, name: t.name || 'Pista', color: colorOf(t.id), times: st.info.get(t.id).times.map(x => toLocal(a, toSession(t, x))).filter(x => x >= 0 && x <= a.buf.duration) }));
  }
  function guideTimesFor(t, excludeSelf = true) {
    const g = raw(st.guide); if (!g || (excludeSelf && g.id === t.id)) return null; const inf = st.info.get(g.id); if (!inf) return null;
    return inf.times.map(x => toLocal(t, toSession(g, x))).filter(x => x >= 0 && x <= (o.originals.get(t.id) || t.buf).duration);
  }
  function target() {
    if (st.mode !== 'guide') return { mode: 'grid' };
    const a = raw(activeId()); const times = a && guideTimesFor(a); const g = raw(st.guide);
    return times && times.length ? { mode: 'guide', times, name: g.name, maxShiftMs: Number($('apsMtReach').value) } : { mode: 'grid' };
  }
  function setMode(m) {
    if (m === 'guide' && !st.guide) { const first = tracks().find(t => t.id !== activeId()); if (first) st.guide = first.id; }
    st.mode = m; render(); o.quant.redraw();
    say(m === 'guide' ? (st.guide ? `Modo pista guia: os ataques da pista ativa vão para os ataques de “${raw(st.guide)?.name}”, esticando sem cortes. Ataques sem par ficam onde foram tocados.` : 'Escolha a pista guia.') : 'Modo grade: os ataques vão para a grade do BPM e compasso da DAW.', 'ok');
  }
  async function editTrack(id) { B.focus(id); if (st.guide === id) st.guide = null; render(); if (o.onActive) o.onActive(id); await o.quant.analyze(); render(); }
  function abTrack(id) {
    const orig = o.originals.get(id), res = o.results.get(id); if (!orig || !res) return;
    const toA = B.buffer(id) === res; B.setBuffer(id, toA ? orig : res); if (id === activeId()) o.quant.adopt(id, orig, res, toA ? 'A' : 'B');
    render(); say(`${raw(id)?.name}: ouvindo ${toA ? 'A (original)' : 'B (alinhada)'}.`, 'ok');
  }
  function undoTrack(id) {
    const orig = o.originals.get(id); if (!orig) return; B.setBuffer(id, orig); o.originals.delete(id); o.results.delete(id);
    if (id === activeId()) o.quant.adopt(id, orig, null); refresh(); say(`${raw(id)?.name}: original de volta (nada foi perdido).`, 'ok');
  }
  // alinha uma pista (sem cortes) — usada pelo lote
  async function alignOne(t, set) {
    const orig = o.originals.get(t.id) || t.buf, on = await EL().onsets(orig), onsets = on.onsets;
    if (!onsets.length) return { id: t.id, name: t.name, skipped: 'sem ataques' };
    let plan, targetTimes = null;
    const goff = gridOffsetFor(t);
    if (st.mode === 'guide') { targetTimes = guideTimesFor(t); if (!targetTimes) return { id: t.id, name: t.name, skipped: 'é a própria guia' }; plan = C().planGuideWarp(onsets, targetTimes, { duration: orig.duration, strength: set.strength, maxShiftMs: Number($('apsMtReach').value), bpm: o.bpm(), subdivision: set.subdivision, gridOffset: goff }); }
    else plan = C().planWarp(onsets, { duration: orig.duration, bpm: o.bpm(), subdivision: set.subdivision, strength: set.strength, gridOffset: goff });
    const errs = (times, ref) => { const e = times.map(x => ref ? Math.min(...ref.map(g => Math.abs(g - x))) : Math.abs(C().gridDeviation([x], { bpm: o.bpm(), subdivision: set.subdivision, gridOffset: goff })[0].devMs / 1000)).map(v => v * 1000).sort((a, b) => a - b); return e.length ? e[e.length >> 1] : 0; };
    const before = errs(onsets.map(x => x.time), targetTimes);
    const r = await EL().quantize(orig, plan.markers, { engine: set.engine, protectMs: set.protectMs });
    if (!o.originals.has(t.id)) o.originals.set(t.id, orig);
    o.results.set(t.id, r.buffer); B.setBuffer(t.id, r.buffer);
    const after = errs((await EL().onsets(r.buffer)).onsets.map(x => x.time), targetTimes);
    if (t.id === activeId()) o.quant.adopt(t.id, orig, r.buffer, 'B');
    return { id: t.id, name: t.name, moved: plan.markers.filter(m => Math.abs(m.dst - m.src) > 0.002).length, before, after, silentMs: r.metrics.longestSilentMs, nan: r.metrics.nan, engine: r.engine };
  }
  async function alignBatch() {
    if (!st.batch.size) throw Error('Marque “Lote” nas pistas que quer alinhar.');
    if (st.mode === 'guide' && !raw(st.guide)) throw Error('Escolha a pista guia.');
    st.busy = true; render(); const set = o.quant.settings(), out = [];
    try {
      for (const id of [...st.batch]) { const t = raw(id); if (!t) continue; say(`Alinhando “${t.name}” sem cortes… (${out.length + 1}/${st.batch.size})`); out.push(await alignOne(t, set)); }
    } finally { st.busy = false; }
    root.__apsMtLast = out; await refresh();
    const done = out.filter(r => !r.skipped);
    say(`✓ ${done.length} pista(s) alinhada(s) ${st.mode === 'guide' ? 'pela guia “' + raw(st.guide)?.name + '”' : 'na grade'} sem cortes: ` + done.map(r => `${r.name}: ${r.before.toFixed(1)} → ${r.after.toFixed(1)} ms`).join(' · ') + (out.some(r => r.skipped) ? ' · ignoradas: ' + out.filter(r => r.skipped).map(r => `${r.name} (${r.skipped})`).join(', ') : '') + '. Cada pista tem A/B e ↶.', 'ok');
    return out;
  }
  $('apsMtList').addEventListener('click', e => {
    const b = e.target.closest('[data-a]'), row = e.target.closest('[data-id]'); if (!b || !row) return; const id = row.dataset.id, a = b.dataset.a;
    const guard = p => Promise.resolve(p).catch(err => say(err.message || String(err), 'err'));
    if (a === 'edit') guard(editTrack(id));
    else if (a === 'pts') { st.visible.set(id, st.visible.get(id) === false); render(); o.quant.redraw(); }
    else if (a === 'ab') abTrack(id); else if (a === 'undo') guard(undoTrack(id));
  });
  $('apsMtList').addEventListener('change', e => { const c = e.target.closest('[data-a="batch"]'), row = e.target.closest('[data-id]'); if (!c || !row) return; if (c.checked) st.batch.add(row.dataset.id); else st.batch.delete(row.dataset.id); render(); });
  $('apsMtModeGrid').addEventListener('click', () => setMode('grid'));
  $('apsMtModeGuide').addEventListener('click', () => setMode('guide'));
  $('apsMtGuide').addEventListener('change', e => { st.guide = e.target.value || null; if (st.guide) setMode('guide'); else render(); });
  $('apsMtReach').addEventListener('change', () => o.quant.redraw());
  $('apsMtAllPts').addEventListener('click', () => { const all = tracks().every(t => st.visible.get(t.id) !== false); tracks().forEach(t => st.visible.set(t.id, !all)); render(); o.quant.redraw(); });
  $('apsMtRefresh').addEventListener('click', () => refresh().then(() => say(`${tracks().length} pista(s) lida(s) da DAW · ${o.bpm()} BPM · compasso ${o.sig()}.`, 'ok')));
  $('apsMtAlignActive').addEventListener('click', () => { if (st.mode === 'guide' && !raw(st.guide)) { say('Escolha a pista guia.', 'err'); return; } o.quant.apply().then(() => refresh()); });
  $('apsMtAlignBatch').addEventListener('click', () => alignBatch().catch(e => { st.busy = false; render(); say(e.message || String(e), 'err'); }));
  const api = { state: st, refresh, render, overlays, target, setMode, editTrack, alignBatch, abTrack, undoTrack, setGuide: id => { st.guide = id; render(); }, colorOf };
  host.__apsMt = api; return api;
}
root.APSQuantMultitrack = { mount, COLORS };
})(typeof window !== 'undefined' ? window : globalThis);
