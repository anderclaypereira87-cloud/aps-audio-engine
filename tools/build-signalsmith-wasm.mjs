// Gera vendor/signalsmith-stretch/signalsmith-stretch-wasm.js a partir do pacote oficial
// signalsmith-stretch@1.3.2 (MIT). Apenas extrai a fábrica WASM (Emscripten) sem alterar o
// algoritmo, para uso offline em Web Worker / Node (sem AudioWorklet).
// Uso: node tools/build-signalsmith-wasm.mjs
import { readFileSync, writeFileSync } from 'node:fs';
const dir = new URL('../vendor/signalsmith-stretch/', import.meta.url);
const src = readFileSync(new URL('SignalsmithStretch.mjs', dir), 'utf8');
const start = src.indexOf('var SignalsmithStretch = (() => {');
const endMarker = 'return moduleRtn;\n}\n);\n})();';
const end = src.indexOf(endMarker);
if (start < 0 || end < 0) throw Error('Formato inesperado do SignalsmithStretch.mjs');
const factory = src.slice(start, end + endMarker.length);
const out = `/*! Signalsmith Stretch 1.3.2 (MIT) — Copyright (c) 2022 Geraint Luff / Signalsmith Audio Ltd.
 * Fábrica WASM extraída sem modificações de vendor/signalsmith-stretch/SignalsmithStretch.mjs
 * por tools/build-signalsmith-wasm.mjs. Licença completa: vendor/signalsmith-stretch/LICENSE.txt */
(function (root) {
${factory}
root.SignalsmithStretchWasm = SignalsmithStretch;
if (typeof module === 'object' && module.exports) module.exports = SignalsmithStretch;
})(typeof globalThis !== 'undefined' ? globalThis : this);
`;
writeFileSync(new URL('signalsmith-stretch-wasm.js', dir), out);
console.log('ok', out.length, 'bytes');
