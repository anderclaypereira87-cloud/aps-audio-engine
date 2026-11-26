/* APS Quant Pro v2 no estúdio (daw.html): liga o editor elástico à pista selecionada. */
(function (root) {
'use strict';
function start() {
  const host = document.getElementById('apsQuantPanel'), B = root.APSMixBridge;
  if (!host || !B || !root.APSElasticQuantUI) return;
  const originals = root.__apsQuantOriginals || (root.__apsQuantOriginals = new Map());
  root.APSElasticQuantUI.mount(host, {
    idPrefix: 'apsQuant',
    getSource: () => { const t = B.current && B.current(); return t ? { id: t.id, buffer: t.buf } : null; },
    originalOf: id => originals.get(id) || null,
    bpm: () => B.bpm ? B.bpm() : 100,
    apply: (buf, info) => { if (!originals.has(info.id)) originals.set(info.id, info.original); B.setBuffer(info.id, buf); },
    restore: (buf, info) => { B.setBuffer(info.id, buf); if (info.undo) originals.delete(info.id); }
  });
  document.getElementById('bpm')?.addEventListener('change', () => host.__apsQuant && host.__apsQuant.redraw());
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})(window);
