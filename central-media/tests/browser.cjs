/* Usage: APS_TEST_CHROME=/path/to/chrome APS_FIXTURES=/tmp/aps-media-fixtures node central-media/tests/browser.cjs
 * Requires Playwright. Routes only localhost requests to local fixtures; no external services.
 */
const { chromium, devices } = require('playwright');
const fs = require('node:fs/promises'), path = require('node:path'), assert = require('node:assert/strict');
const http = require('node:http');
const root = path.resolve(__dirname, '../..'), fixtures = process.env.APS_FIXTURES || '/tmp/aps-media-fixtures';
const results = { cases: [], ui: {}, errors: [] };
let origin, dawStub = false;
async function routeLocal(route) {
  const request = route.request(), pathname = decodeURIComponent(new URL(request.url()).pathname);
  if (dawStub && pathname === '/daw.html') return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>DAW transfer test receiver</title>' });
  if (pathname.includes('..')) return route.abort();
  const file = pathname.startsWith('/__fixtures/') ? path.join(fixtures, pathname.slice(12)) : path.join(root, pathname);
  try {
    const data = await fs.readFile(file), ext = path.extname(file);
    const contentType = ({ '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.mp4': 'video/mp4', '.wav': 'audio/wav', '.webm': 'video/webm' })[ext] || 'application/octet-stream';
    const range = request.headers().range?.match(/bytes=(\d+)-(\d*)/);
    if (range) {
      const start = +range[1], end = Math.min(data.length - 1, range[2] ? +range[2] : data.length - 1);
      return route.fulfill({ status: 206, contentType, headers: { 'accept-ranges': 'bytes', 'content-range': `bytes ${start}-${end}/${data.length}` }, body: data.subarray(start, end + 1) });
    }
    await route.fulfill({ status: 200, contentType, headers: { 'accept-ranges': 'bytes' }, body: data });
  } catch { await route.fulfill({ status: 404, body: 'not found' }); }
}
async function run(page, config) {
  return page.evaluate(async config => {
    async function file(name) { const r = await fetch('/__fixtures/' + name); return new File([await r.blob()], name); }
    async function worker(data) {
      const w = new Worker('/central-media/media-worker.js', { type: 'module' }); let heap = 0;
      return new Promise((resolve, reject) => {
        w.onerror = e => { w.terminate(); reject(Error(e.message)); };
        w.onmessage = ({ data: message }) => {
          heap = Math.max(heap, performance.memory?.usedJSHeapSize || 0);
          if (config.cancel && message.type === 'progress' && message.stage === 'export') w.postMessage({ type: 'cancel' });
          if (['result', 'error', 'cancelled'].includes(message.type)) { w.terminate(); message.peakMainHeap = heap; resolve(message); }
        };
        w.postMessage(data);
      });
    }
    const videoFile = await file(config.video || 'reference.mp4'), audioFile = await file(config.audio || 'offset-250ms.wav');
    const v = await worker({ type: 'inspect', file: videoFile }), a = await worker({ type: 'inspect', file: audioFile });
    if (v.type !== 'result' || a.type !== 'result') throw Error(JSON.stringify({ v, a }));
    if (config.inspect) return { video: v.result, audio: a.result };
    const sync = await worker({ type: 'sync', videoFile, audioFile, videoInfo: v.result, audioInfo: a.result });
    if (config.syncOnly) return { sync, video: v.result };
    const alignment = sync.result?.alignment;
    const options = { videoFile, audioFile, source: config.source || 'external', offsetSeconds: alignment?.accepted ? alignment.offsetSeconds : -.25, rate: alignment?.accepted && alignment.driftDetected ? alignment.rate : 1, format: config.format || 'auto', resolution: config.resolution || 'source', videoSettings: config.videoSettings || {}, audioSettings: config.audioSettings || {}, audioOnly: !!config.audioOnly };
    const exported = await worker({ type: 'export', options, reference: sync.result?.reference });
    if (exported.type !== 'result') return { exported, alignment, video: v.result };
    if (config.noDownload) return { exported: { ...exported, result: { ...exported.result, blob: undefined } }, alignment, video: v.result };
    const buffer = new Uint8Array(await exported.result.blob.arrayBuffer()); let binary = '';
    for (let i = 0; i < buffer.length; i += 8192) binary += String.fromCharCode(...buffer.subarray(i, i + 8192));
    return { exported: { ...exported, result: { ...exported.result, blob: undefined } }, base64: btoa(binary), alignment, video: v.result };
  }, config);
}

(async () => {
  const server = http.createServer((req, res) => routeLocal({
    request: () => ({ url: () => origin + req.url, headers: () => req.headers }),
    fulfill: async ({ status, contentType, headers, body }) => { res.writeHead(status, { 'content-type': contentType || 'text/plain', ...headers }); res.end(body); },
    abort: () => res.destroy(),
  }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); origin = `http://127.0.0.1:${server.address().port}`;
  const launch = () => chromium.launch({ executablePath: process.env.APS_TEST_CHROME, headless: true, args: ['--no-sandbox', '--single-process', '--no-zygote', '--disable-gpu'] });
  let browser = await launch();
  try {
    const context = await browser.newContext({ viewport: { width: 1365, height: 1000 }, serviceWorkers: 'block' });
    const page = await context.newPage();
    page.on('pageerror', e => results.errors.push(e.message));
    await page.goto(origin + '/midia.html');
    results.browser = await page.evaluate(() => ({ ua: navigator.userAgent, secureContext: isSecureContext, videoEncoder: typeof VideoEncoder, audioEncoder: typeof AudioEncoder, offscreen: typeof OffscreenCanvas, audioWorklet: typeof AudioWorkletNode }));
    results.codecs = await page.evaluate(async () => { const m = await import('/central-media/media-io.js'); return m.encodingOptions(1920, 1080); });
    const cases = process.env.APS_MEMORY_ONLY ? [{ name: 'memory-590s', video: 'long-reference.mp4', audio: 'drift-1000ppm.wav', noDownload: true }] : [
      { name: '250ms', audio: 'offset-250ms.wav' }, { name: '1s', audio: 'offset-1s.wav' },
      { name: 'silence', audio: 'silence-3s.wav' }, { name: 'advance', audio: 'advance-250ms.wav' },
      { name: 'mp3', audio: 'offset-250ms.mp3' }, { name: 'original', source: 'original' }, { name: 'mute', source: 'mute' },
      { name: 'no-reference', video: 'no-reference.mp4' },
      { name: '1080p', video: '1080.mp4', resolution: '1080', videoSettings: { exposure: .15, sharpness: 5, denoise: 5 } },
      { name: 'drift-590s', video: 'long-reference.mp4', audio: 'drift-1000ppm.wav' },
      { name: 'cancel', video: 'long-reference.mp4', audio: 'drift-1000ppm.wav', cancel: true },
      { name: 'wav', audioOnly: true, audioSettings: { gain: -3, highpass: 40 } },
    ];
    for (const c of cases.filter(() => !process.env.APS_UI_ONLY)) {
      const started = Date.now(); const r = await run(page, c);
      if (c.cancel) assert.equal(r.exported.type, 'cancelled');
      else {
        assert.equal(r.exported.type, 'result', JSON.stringify(r));
        if (c.name !== '1080p' && c.name !== 'no-reference') assert.ok(r.alignment.accepted, JSON.stringify(r.alignment));
        if (r.base64) { const name = `export-${c.name}.${r.exported.result.extension}`; await fs.writeFile(path.join(fixtures, name), Buffer.from(r.base64, 'base64')); r.file = name; delete r.base64; }
        assert.ok(r.exported.result.bytes > 1000);
      }
      r.case = c.name; r.elapsedSeconds = (Date.now() - started) / 1000;
      results.cases.push(r); console.log(c.name, JSON.stringify({ elapsed: r.elapsedSeconds, offset: r.alignment?.offsetSeconds, rate: r.alignment?.rate, type: r.exported?.type, frames: r.exported?.result?.frames, bytes: r.exported?.result?.bytes }));
    }
    if (process.env.APS_MEMORY_ONLY) return;
    await page.setInputFiles('#sync-video', path.join(fixtures, 'reference.mp4'));
    await page.waitForFunction(() => !document.querySelector('#media-controls').disabled && document.querySelector('#video-meta').textContent.includes('reference.mp4'));
    await page.setInputFiles('#sync-audio', path.join(fixtures, 'offset-250ms.wav'));
    await page.waitForFunction(() => !document.querySelector('#sync-analyze').disabled);
    await page.click('#sync-analyze'); await page.waitForFunction(() => document.querySelector('#sync-result').textContent.includes('Correlação:'));
    results.ui.offset = await page.inputValue('#sync-offset'); assert.ok(Math.abs(+results.ui.offset + 250) < 10);
    await page.click('#listen-after');
    try { await page.waitForFunction(() => !document.querySelector('#sync-preview').paused, undefined, { timeout: 5000 }); }
    catch (e) { console.log('preview diagnostic', await page.evaluate(() => ({ status: document.querySelector('#media-status').textContent, src: document.querySelector('#sync-preview').currentSrc, ready: document.querySelector('#sync-preview').readyState, mediaError: document.querySelector('#sync-preview').error?.message }))); throw e; }
    await page.waitForTimeout(300); results.ui.playing = await page.evaluate(() => ({ video: document.querySelector('#sync-preview').currentTime, audio: document.querySelector('#sync-external').currentTime }));
    await page.evaluate(() => document.querySelector('#sync-preview').pause());
    assert.ok(Math.abs(results.ui.playing.audio - results.ui.playing.video - .25) < .08);
    await page.click('#media-export'); await page.waitForFunction(() => !document.querySelector('#media-download').hidden);
    results.ui.videoExport = await page.textContent('#media-export-result'); assert.ok(results.ui.videoExport.includes('dentro de 1 quadro'));
    await page.evaluate(() => document.querySelector('#media-final-preview').play());
    await page.waitForFunction(() => document.querySelector('#media-final-preview').currentTime > .1);
    results.ui.exportPlayback = await page.evaluate(() => { const v = document.querySelector('#media-final-preview'); v.pause(); return { currentTime: v.currentTime, error: v.error?.message || null }; });
    await page.screenshot({ path: path.join(fixtures, 'desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 393, height: 851 });
    results.ui.mobileNoOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
    await page.screenshot({ path: path.join(fixtures, 'mobile.png'), fullPage: true });
    if (!results.ui.mobileNoOverflow) console.log('overflow', await page.evaluate(() => [...document.querySelectorAll('body *')].map(e => ({ tag: e.tagName, id: e.id, class: e.className, right: e.getBoundingClientRect().right, width: e.getBoundingClientRect().width })).filter(e => e.right > innerWidth + 1)));
    assert.ok(results.ui.mobileNoOverflow);
    await page.setInputFiles('#sync-audio', path.join(fixtures, 'offset-250ms.mp3'));
    await page.waitForFunction(() => !document.querySelector('#sync-analyze').disabled);
    await page.click('#sync-analyze'); await page.waitForFunction(() => document.querySelector('#preview-note').textContent.includes('calibrado por correlação'));
    results.ui.mp3PreviewCalibration = await page.textContent('#preview-note');
    await page.click('#listen-after'); await page.waitForTimeout(300);
    results.ui.mp3Playing = await page.evaluate(() => ({ video: document.querySelector('#sync-preview').currentTime, audio: document.querySelector('#sync-external').currentTime }));
    assert.ok(Math.abs(results.ui.mp3Playing.audio - results.ui.mp3Playing.video - .25) < .08);
    await page.evaluate(() => document.querySelector('#sync-preview').pause());
    dawStub = true;
    await page.click('#media-to-daw'); await page.waitForURL('**/daw.html?modulo=gravacao&importar=midia');
    results.ui.dawTransfer = await page.evaluate(() => new Promise((resolve, reject) => {
      const request = indexedDB.open('aps-media-transfer', 1);
      request.onsuccess = () => { const db = request.result, tx = db.transaction('files', 'readonly'), r = tx.objectStore('files').get('next'); r.onsuccess = async () => { const file = r.result.file; resolve({ name: file.name, size: file.size, type: file.type, header: new TextDecoder().decode(await file.slice(0, 4).arrayBuffer()) }); db.close(); }; r.onerror = () => reject(r.error); };
    }));
    assert.equal(results.ui.dawTransfer.header, 'RIFF'); assert.equal(results.ui.dawTransfer.type, 'audio/wav');
    await context.close(); await browser.close(); browser = await launch();
    // Separate device emulation, not physical Android verification.
    const mobile = await browser.newContext({ ...devices['Pixel 7'], serviceWorkers: 'block' });
    const mp = await mobile.newPage(); await mp.goto(origin + '/midia.html');
    results.ui.androidEmulation = await mp.evaluate(() => ({ ua: navigator.userAgent, overflow: document.documentElement.scrollWidth > innerWidth }));
    assert.equal(results.ui.androidEmulation.overflow, false); await mobile.close();
    assert.deepEqual(results.errors, []);
  } finally { await fs.writeFile(path.join(fixtures, process.env.APS_MEMORY_ONLY ? 'memory-browser-results.json' : 'browser-results.json'), JSON.stringify(results, null, 2)); await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
})().catch(e => { console.error(e); process.exitCode = 1; });
