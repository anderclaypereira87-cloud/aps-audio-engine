/* Local Chromium integration test. Requires Playwright and APS_TEST_CHROME.
 * Fake camera/mic are explicitly synthetic; mobile profiles are Chromium emulation.
 * APS_RECORDING_OUTPUT is outside the repository by default. No external requests.
 */
const { chromium, devices } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const root = path.resolve(__dirname, '../../..');
const output = process.env.APS_RECORDING_OUTPUT || '/tmp/aps-recording-evidence';
const evidence = { cases: [], errors: [], externalRequests: [], mobile: 'Chromium viewport/user-agent emulation only; no physical Android or iPhone' };
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
const server = http.createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const file = path.resolve(root, `.${pathname}`);
    if (!file.startsWith(root + path.sep)) throw Error('outside root');
    const body = await fs.readFile(file); res.writeHead(200, { 'content-type': mime[path.extname(file)] || 'application/octet-stream' }); res.end(body);
  } catch { res.writeHead(404); res.end('not found'); }
});
async function instrument(context, config = {}) {
  await context.addInitScript(config => {
    if (!navigator.mediaDevices) return; // about:blank is not a secure capture page.
    const media = navigator.mediaDevices, nativeGet = media.getUserMedia.bind(media);
    const capture = window.apsCaptureTest = { calls: [], streams: [], outputConnections: 0 };
    const connect = AudioNode.prototype.connect;
    AudioNode.prototype.connect = function(destination, ...args) {
      if (destination instanceof AudioDestinationNode) capture.outputConnections++;
      return connect.call(this, destination, ...args);
    };
    media.getUserMedia = async constraints => {
      capture.calls.push(constraints);
      if (config.denied) throw new DOMException('test denial', 'NotAllowedError');
      const stream = await nativeGet(constraints); capture.streams.push(stream);
      if (config.delayed) await new Promise(resolve => setTimeout(resolve, 500));
      return stream;
    };
    if (config.memory) Object.defineProperty(navigator.storage, 'getDirectory', { value: async () => { throw Error('test OPFS unavailable'); } });
    if (config.quota) Object.defineProperty(navigator.storage, 'getDirectory', { value: async () => ({ getDirectoryHandle: async () => ({
      getFileHandle: async () => ({ createWritable: async () => ({ write: async () => { throw new DOMException('full', 'QuotaExceededError'); }, abort: async () => {} }) }), removeEntry: async () => {},
    }) }) });
    if (config.webm) {
      const supported = MediaRecorder.isTypeSupported.bind(MediaRecorder);
      MediaRecorder.isTypeSupported = type => type.startsWith('video/webm') && supported(type);
    }
    if (config.unsupported) MediaRecorder.isTypeSupported = () => false;
  }, config);
}
async function open(browser, origin, config = {}, profile = {}) {
  const context = await browser.newContext({ ...profile });
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin === origin || url.protocol === 'blob:' || url.protocol === 'data:') return route.continue();
    evidence.externalRequests.push(url.href); return route.abort();
  });
  await instrument(context, config);
  const page = await context.newPage(); page.on('pageerror', error => evidence.errors.push(error.message));
  await page.goto(`${origin}/midia.html`);
  assert.equal(await page.evaluate(() => apsCaptureTest.calls.length), 0, 'no getUserMedia before click');
  return { context, page };
}
async function phase(page, expected) { await page.waitForFunction(value => document.querySelector('#rec-panel').dataset.state === value, expected, { timeout: 30000 }); }
async function enable(page) { await page.locator('#rec-activate').click(); await phase(page, 'preview'); }
async function begin(page) { await page.locator('#rec-start').click(); await phase(page, 'recording'); }
async function stoppedTracks(page) { assert.equal(await page.evaluate(() => apsCaptureTest.streams.flatMap(s => s.getTracks()).every(t => t.readyState === 'ended')), true); }
async function download(page, name) {
  const [file] = await Promise.all([page.waitForEvent('download'), page.locator('#rec-download').click()]);
  const extension = path.extname(file.suggestedFilename()); await file.saveAs(path.join(output, `${name}${extension}`));
  return extension;
}
(async () => {
  await fs.mkdir(output, { recursive: true });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ executablePath: process.env.APS_TEST_CHROME, headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--no-zygote',
      ...(process.env.APS_RECORDING_TEST_AUDIO ? [`--use-file-for-fake-audio-capture=${process.env.APS_RECORDING_TEST_AUDIO}`] : [])] });
  try {
    const desktop = await open(browser, origin, {}, { viewport: { width: 1280, height: 1000 } });
    const page = desktop.page;
    await enable(page);
    assert.equal(await page.locator('#rec-live').evaluate(el => el.muted && el.playsInline), true);
    assert.ok(await page.locator('#rec-camera option').count() >= 4);
    assert.ok(await page.locator('#rec-microphone option').count() >= 2);
    await begin(page); await page.waitForTimeout(3200);
    assert.ok(await page.locator('#rec-meter').evaluate(el => el.value) > 0, await page.evaluate(() => JSON.stringify({ level: document.querySelector('#rec-level').textContent, status: document.querySelector('#rec-status').textContent, tracks: apsCaptureTest.streams.at(-1).getTracks().map(t => ({ kind: t.kind, state: t.readyState, muted: t.muted, settings: t.getSettings() })) })));
    assert.equal(await page.evaluate(() => apsCaptureTest.outputConnections), 0, 'input never connected to speakers');
    await page.locator('#rec-stop').click(); await phase(page, 'recorded'); await stoppedTracks(page);
    const container = await download(page, 'desktop-original');
    assert.match(await page.locator('#rec-verify').textContent(), /imagem decodificada, áudio decodificado/);
    await page.locator('#rec-play').click(); await page.waitForFunction(() => document.querySelector('#rec-playback').currentTime > 0.2);
    await page.locator('#sync-source').selectOption('external');
    await page.locator('#rec-open').click(); await page.waitForFunction(() => document.querySelector('#sync-source').value === 'original');
    assert.match(await page.locator('#video-meta').textContent(), /APS-gravacao/);
    assert.equal(await page.locator('#media-export').isEnabled(), true);
    await page.locator('#rec-panel').screenshot({ path: path.join(output, 'desktop.png') });
    evidence.cases.push({ name: 'desktop', container, verification: await page.locator('#rec-verify').textContent(), importSource: await page.locator('#sync-source').inputValue(), liveTracksStopped: true });
    await page.locator('#rec-discard').click(); await phase(page, 'idle');
    await page.locator('#sync-preview').evaluate(el => Promise.race([el.play(), new Promise((_, reject) => setTimeout(() => reject(Error('editor playback timed out after recorder discard')), 5000))]));
    await page.waitForFunction(() => document.querySelector('#sync-preview').currentTime > 0.2);
    evidence.cases.push({ name: 'editor retains imported recording after recorder discard', passed: true });
    await desktop.context.close();

    const mobile = await open(browser, origin, { webm: true, memory: true }, devices['Pixel 7']);
    await enable(mobile.page); await begin(mobile.page); await mobile.page.waitForTimeout(1700);
    await mobile.page.locator('#rec-stop').click(); await phase(mobile.page, 'recorded'); await stoppedTracks(mobile.page);
    assert.match(await mobile.page.locator('#rec-format').textContent(), /memória temporária/);
    assert.match(await mobile.page.locator('#rec-verify').textContent(), /imagem decodificada, áudio decodificado/);
    await download(mobile.page, 'android-emulation-webm');
    assert.ok(await mobile.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await mobile.page.locator('#rec-panel').screenshot({ path: path.join(output, 'android-emulation.png') });
    evidence.cases.push({ name: 'Android profile, Chromium emulation', webmMemoryFallback: true, verification: await mobile.page.locator('#rec-verify').textContent() });
    await mobile.context.close();

    const iphone = await open(browser, origin, {}, devices['iPhone 13']);
    await enable(iphone.page);
    const input = await iphone.page.locator('#rec-microphone option').last().getAttribute('value');
    await iphone.page.locator('#rec-microphone').selectOption(input); await phase(iphone.page, 'idle'); await stoppedTracks(iphone.page);
    await enable(iphone.page);
    assert.deepEqual(await iphone.page.evaluate(() => apsCaptureTest.calls.at(-1).audio.deviceId), { exact: input.slice(7) });
    await begin(iphone.page); await iphone.page.waitForTimeout(1600);
    await iphone.page.locator('#rec-cancel').click(); await phase(iphone.page, 'idle'); await stoppedTracks(iphone.page);
    assert.equal(await iphone.page.locator('#rec-result').isHidden(), true);
    assert.ok(await iphone.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await iphone.page.locator('#rec-panel').screenshot({ path: path.join(output, 'iphone-emulation.png') });
    evidence.cases.push({ name: 'iPhone profile, Chromium emulation', selectionByDeviceId: true, cancelDiscards: true });
    await iphone.context.close();

    for (const [name, config] of [['permission-denied', { denied: true }], ['unsupported', { unsupported: true }]]) {
      const item = await open(browser, origin, config); await item.page.locator('#rec-activate').click(); await phase(item.page, 'error');
      assert.equal(await item.page.locator('#rec-start').isDisabled(), true); await stoppedTracks(item.page);
      evidence.cases.push({ name, message: await item.page.locator('#rec-status').textContent() }); await item.context.close();
    }
    const late = await open(browser, origin, { delayed: true });
    await late.page.locator('#rec-activate').click(); await phase(late.page, 'requesting'); await late.page.locator('#rec-off').click();
    await late.page.waitForTimeout(850); await phase(late.page, 'idle'); await stoppedTracks(late.page);
    evidence.cases.push({ name: 'late permission grant after turn off', tracksStopped: true }); await late.context.close();

    const full = await open(browser, origin, { quota: true }); await enable(full.page); await begin(full.page);
    await phase(full.page, 'error'); await stoppedTracks(full.page);
    assert.equal(await full.page.locator('#rec-result').isHidden(), true);
    assert.match(await full.page.locator('#rec-status').textContent(), /sem espaço/);
    evidence.cases.push({ name: 'simulated OPFS quota failure', originalNotOffered: true, tracksStopped: true }); await full.context.close();

    for (const interruption of ['ended', 'mute', 'hidden']) {
      const item = await open(browser, origin); await enable(item.page); await begin(item.page); await item.page.waitForTimeout(1600);
      await item.page.evaluate(interruption => {
        if (interruption === 'hidden') { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); }
        else { const track = apsCaptureTest.streams.at(-1).getVideoTracks()[0]; if (interruption === 'ended') track.stop(); track.dispatchEvent(new Event(interruption)); }
      }, interruption);
      await phase(item.page, 'recorded'); await stoppedTracks(item.page);
      evidence.cases.push({ name: `simulated lifecycle: ${interruption}`, message: await item.page.locator('#rec-status').textContent() }); await item.context.close();
    }
    assert.deepEqual(evidence.errors, []); assert.deepEqual(evidence.externalRequests, []);
    await fs.writeFile(path.join(output, 'browser-evidence.json'), JSON.stringify(evidence, null, 2));
    console.log(JSON.stringify(evidence, null, 2));
  } finally { await browser.close(); server.close(); }
})().catch(async error => { console.error(error); server.close(); process.exitCode = 1; });
