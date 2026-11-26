/* APS Motor Elástico — Web Worker (processa fora da tela principal para não travar o celular). */
self.importScripts('./aps-elastic-core.js?v=1', './aps-elastic-engine.js?v=1');
self.onmessage = async (ev) => {
  const { id, cmd, data } = ev.data || {};
  try {
    const result = await self.APSElasticEngine.handle(cmd, data, (p, msg) => self.postMessage({ id, progress: p, message: msg }));
    const transfer = result && result.transfer || [];
    if (result) delete result.transfer;
    self.postMessage({ id, result }, transfer);
  } catch (e) {
    self.postMessage({ id, error: String(e && e.message || e) });
  }
};
