/* APS Quant Pro v2 no estúdio (daw.html): quantização elástica MULTITRACK dentro da DAW.
 * - Ritmo: botão giratório de compasso, BPM, ⚡ Auto (BPM + Compasso) e metrônomo sincronizados com a DAW
 * - Multitrack: lista de pistas, pontos das outras pistas no gráfico, alinhar na grade / pela guia / em lote
 * - Editor elástico (marcadores de warp) da pista ativa. O original de cada pista fica guardado. */
(function (root) {
'use strict';
function start() {
  const host = document.getElementById('apsQuantPanel'), B = root.APSMixBridge;
  if (!host || !B || !root.APSElasticQuantUI) return;
  const $ = id => document.getElementById(id);
  const originals = root.__apsQuantOriginals || (root.__apsQuantOriginals = new Map());
  const results = root.__apsQuantResults || (root.__apsQuantResults = new Map());
  host.innerHTML = '<div id="apsQuantRhythm"></div><div id="apsQuantMT"></div><div id="apsQuantEditor"></div>';
  // compasso da DAW (#apsTimeSig no modo clássico, #proSig no Estúdio Pro); garante todas as opções do botão giratório
  const METERS = (root.APSQuantRhythm && root.APSQuantRhythm.METERS) || ['4/4', '3/4', '2/4', '6/8', '5/4', '7/8', '12/8'];
  ['apsTimeSig', 'proSig'].forEach(id => { const s = $(id); if (s) for (const m of METERS) if (![...s.options].some(o => o.value === m)) s.add(new Option(m, m)); });
  const getSig = () => ($('apsTimeSig') && $('apsTimeSig').value) || '4/4';
  const getBpm = () => (B.bpm ? Number(B.bpm()) : 100) || 100;
  let gridZero = 0; // tempo da sessão onde cai o tempo 1 do compasso 1 (0 = grade da DAW)
  const active = () => { const t = B.current && B.current(); return t || null; };
  const toLocal = (t, s) => s - (Number(t.start) || 0) + (Number(t.trimIn) || 0);
  let mt = null, rhythm = null;
  const quant = root.APSElasticQuantUI.mount($('apsQuantEditor'), {
    idPrefix: 'apsQuant',
    getSource: () => { const t = active(); return t ? { id: t.id, buffer: t.buf } : null; },
    originalOf: id => originals.get(id) || null,
    bpm: getBpm,
    meter: getSig,
    gridOffset: () => { const t = active(); return t ? toLocal(t, gridZero) : 0; },
    overlays: () => (mt ? mt.overlays() : []),
    target: () => (mt ? mt.target() : { mode: 'grid' }),
    onAnalyzed: () => { mt && mt.render(); },
    apply: (buf, info) => { if (!originals.has(info.id)) originals.set(info.id, info.original); if (!info.ab) results.set(info.id, buf); B.setBuffer(info.id, buf); mt && mt.render(); },
    restore: (buf, info) => { B.setBuffer(info.id, buf); if (info.undo) { originals.delete(info.id); results.delete(info.id); } mt && mt.refresh(); }
  });
  const setSig = s => {
    const a = $('apsTimeSig'); if (a && a.value !== s) { a.value = s; a.dispatchEvent(new Event('change', { bubbles: true })); }
    const p = $('proSig'); if (p && p.value !== s) p.value = s;
    quant.redraw(); mt && mt.refresh();
  };
  const setBpm = v => {
    v = Math.max(40, Math.min(240, Math.round(v))); const b = $('bpm');
    if (b) { b.value = v; b.dispatchEvent(new Event('change', { bubbles: true })); } else if (B.setBpm) B.setBpm(v);
    const p = $('proBpm'); if (p) p.value = v;
    quant.redraw(); mt && mt.refresh();
  };
  if (root.APSQuantRhythm) rhythm = root.APSQuantRhythm.mountBar($('apsQuantRhythm'), {
    idPrefix: 'apsQr',
    getBpm, setBpm, getSig, setSig,
    getGridZero: () => gridZero,
    setGridZero: t => { const bar = root.APSElasticCore.meterInfo(getSig(), getBpm()).bar; gridZero = ((t % bar) + bar) % bar; if (gridZero > bar - 0.005) gridZero = 0; quant.redraw(); mt && mt.refresh(); },
    // Auto: analisa a pista ativa (ou, sem pista ativa, a primeira pista) e converte o tempo 1 para o tempo da sessão
    analyze: async () => {
      const t = active() || (B.all() || [])[0]; if (!t) throw Error('Carregue uma pista na DAW primeiro.');
      const buf = originals.get(t.id) || t.buf, r = await root.APSElastic.tempoMeter(buf);
      r.downbeat = (Number(t.start) || 0) + (r.downbeat || 0) - (Number(t.trimIn) || 0); r.source = t.name; return r;
    },
    // ▶ com metrônomo: toca a pista ativa (A ou B) junto com as pistas cujos pontos estão visíveis, do início da janela do gráfico
    audio: () => {
      const a = active(); if (!a) return null;
      const ctx = root.__apsQuantCtx || (root.__apsQuantCtx = new (root.AudioContext || root.webkitAudioContext)());
      const vis = mt ? mt.state.visible : new Map(), viewLocal = quant.viewStart(), from = (Number(a.start) || 0) + viewLocal - (Number(a.trimIn) || 0);
      const items = [{ buffer: quant.audible() || a.buf, start: (Number(a.start) || 0) - (Number(a.trimIn) || 0) }];
      for (const t of (B.all() || [])) if (t.id !== a.id && vis.get(t.id) !== false && t.buf) items.push({ buffer: t.buf, start: (Number(t.start) || 0) - (Number(t.trimIn) || 0) });
      if (B.stop) B.stop();
      return { ctx, from: Math.max(0, from), items, label: `${a.name}: ${quant.listening() === 'B' ? 'B (alinhada)' : 'A (original)'}` + (items.length > 1 ? ` + ${items.length - 1} pista(s) visível(is).` : '.') };
    }
  });
  if (root.APSQuantMultitrack) mt = root.APSQuantMultitrack.mount($('apsQuantMT'), {
    bridge: B, quant, originals, results, bpm: getBpm, sig: getSig, gridZero: () => gridZero
  });
  host.__apsQuant = quant; // compatibilidade: outros módulos/testes procuram o editor em #apsQuantPanel
  root.__apsQuantDaw = { quant, rhythm, mt, gridZero: () => gridZero, setSig, setBpm, getSig, getBpm };
  // DAW -> quantização: BPM e compasso mudados no transporte/Estúdio Pro aparecem aqui na hora
  document.getElementById('bpm')?.addEventListener('change', () => { rhythm && rhythm.sync(); quant.redraw(); });
  document.getElementById('apsTimeSig')?.addEventListener('change', () => { const p = $('proSig'); if (p && p.value !== getSig()) p.value = getSig(); rhythm && rhythm.sync(); quant.redraw(); });
  // pistas novas/removidas: relê a lista quando a aba é aberta ou quando a sessão muda
  let sig = '';
  setInterval(() => { if (!mt || host.offsetParent === null) return; const s = (B.all() || []).map(t => t.id + ':' + (t.buf && t.buf.length)).join('|'); if (s !== sig) { sig = s; mt.refresh(); } }, 1200);
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})(window);
