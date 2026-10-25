import { LIMITS, canAppend } from './recording-core.mjs';

/** Ordered local writes. No network, no whole-recording arrayBuffer copies. */
export async function createChunkStore() {
  let dir, name, handle, writer, budget = LIMITS.fileBytes;
  try {
    const estimate = await navigator.storage?.estimate?.();
    if (estimate?.quota) {
      const free = estimate.quota - (estimate.usage || 0) - 8 * 1048576;
      if (free < 8 * 1048576) throw Error('Pouco espaço disponível.');
      budget = Math.min(budget, Math.floor(free));
    }
    const root = await navigator.storage.getDirectory();
    dir = await root.getDirectoryHandle('aps-live-recording', { create: true });
    name = `take-${Date.now()}-${crypto.randomUUID()}`;
    handle = await dir.getFileHandle(name, { create: true });
    writer = await handle.createWritable();
  } catch {
    if (name) await dir?.removeEntry(name).catch(() => {});
    handle = writer = null; budget = LIMITS.memoryBytes;
  }
  let bytes = 0, pending = 0, chain = Promise.resolve(), fault = null, closed = false, chunks = [];
  return {
    mode: writer ? 'disk' : 'memory', budget,
    get bytes() { return bytes; },
    append(chunk) {
      if (closed || fault) return Promise.reject(fault || Error('Gravação já encerrada.'));
      if (!canAppend(bytes, chunk.size, budget)) { fault = Error('Limite de espaço atingido. Não há uma gravação completa recuperável. Grave um trecho menor.'); return Promise.reject(fault); }
      // Limit the backlog when a local disk stalls; do not queue hundreds of MB.
      if (writer && pending + chunk.size > LIMITS.memoryBytes) { fault = Error('O armazenamento não acompanhou a gravação. Libere espaço e tente novamente.'); return Promise.reject(fault); }
      bytes += chunk.size; pending += chunk.size;
      const operation = chain.then(async () => {
        if (fault) throw fault;
        if (writer) await writer.write(chunk); else chunks.push(chunk);
      }).catch(error => { fault = error; throw error; }).finally(() => { pending -= chunk.size; });
      chain = operation.catch(() => {});
      return operation;
    },
    async finish(mime) {
      closed = true; await chain;
      if (fault) throw fault;
      if (writer) { await writer.close(); writer = null; return handle.getFile(); }
      const blob = new Blob(chunks, { type: mime }); chunks = []; return blob;
    },
    async dispose() {
      closed = true; await chain; chunks = [];
      await writer?.abort().catch(() => {}); writer = null;
      if (name) { await dir.removeEntry(name).catch(() => {}); name = null; }
    },
  };
}
