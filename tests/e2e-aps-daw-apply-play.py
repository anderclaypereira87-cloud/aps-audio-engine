"""E2E da barra "Aplicar + Ouvir" na aba 🎯 Quantizar · Afinar da DAW (pedido do Anderclay):
botão verde "✓ Aplicar quantização na música" / "✓ Aplicar afinação na música" (com ↶ Desfazer e original guardado)
e a barra de Play logo abaixo ("▶ Ouvir o que está sendo feito" / "▶ Ouvir afinação", Editado | Original (A/B),
Solo nesta pista | Música toda, metrônomo e cursor sincronizado no gráfico). Roda em celular (390x844) e desktop,
e confere quantizacao.html / afinacao.html (Aplicar + Ouvir + 📤 Enviar para a DAW).
Rodar: python3 tests/e2e-aps-daw-apply-play.py
(salva /workspace/aps-daw-apply-play-01.png, -02.png e tests/e2e-aps-daw-apply-play-report.json)"""
import json, socket, sys
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from threading import Thread
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
SHOTS = {'quant': '/workspace/aps-daw-apply-play-01.png', 'tune': '/workspace/aps-daw-apply-play-02.png'}

GEN = r"""
window.__gen = {
  drums(sr, seconds, bpm) {
    const n = Math.round(seconds * sr), x = new Float32Array(n), unit = 60 / bpm / 4; let s = 7;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647); const hits = [];
    for (let k = 1; k * unit < seconds - 0.3; k += 2) hits.push(k * unit + (rnd() - 0.5) * 0.04);
    for (let i = 0; i < n; i++) x[i] = 0.06 * Math.sin(2 * Math.PI * 220 * i / sr) + 0.04 * Math.sin(2 * Math.PI * 330 * i / sr);
    hits.forEach((t, j) => { const i0 = Math.round(t * sr), f = j % 2 ? 180 : 70; for (let i = 0; i < 0.12 * sr && i0 + i < n; i++) { const e = Math.exp(-i / sr * 35); x[i0 + i] += 0.55 * e * Math.sin(2 * Math.PI * f * i / sr * (1 + 1.5 * Math.exp(-i / sr * 60))) + (j % 2 ? 0.2 * e * (rnd() * 2 - 1) : 0); } });
    const b = new AudioBuffer({ length: n, numberOfChannels: 2, sampleRate: sr }); b.copyToChannel(x, 0); b.copyToChannel(x, 1); return b;
  },
  voice(sr) {
    const C = window.APSElasticCore, notes = [{ midi: 56.75, dur: 1.2 }, { midi: 60.3, dur: 1.2 }];
    const total = notes.reduce((a, n) => a + n.dur, 0), x = new Float32Array(Math.round(total * sr)); let ph = 0, i = 0;
    const forms = [[700, 80], [1220, 90], [2600, 120]], st = forms.map(() => [0, 0]);
    for (const nt of notes) for (let k = 0; k < nt.dur * sr; k++, i++) {
      const t = k / sr, f = 440 * Math.pow(2, (nt.midi + 0.35 * Math.sin(2 * Math.PI * 5.5 * t) - 69) / 12);
      ph += f / sr; let g = 0; if (ph >= 1) { ph -= 1; g = 1; }
      let s = 0; forms.forEach(([fc, bw], j) => { const r = Math.exp(-Math.PI * bw / sr), a1 = 2 * r * Math.cos(2 * Math.PI * fc / sr), a2 = -r * r; const y = g + a1 * st[j][0] + a2 * st[j][1]; st[j][1] = st[j][0]; st[j][0] = y; s += y; });
      x[i] = 0.05 * s * Math.min(1, k / (0.02 * sr), (nt.dur * sr - k) / (0.02 * sr));
    }
    let pk = 0; for (const v of x) pk = Math.max(pk, Math.abs(v)); for (let j = 0; j < x.length; j++) x[j] *= 0.5 / pk;
    const b = new AudioBuffer({ length: x.length, numberOfChannels: 1, sampleRate: sr }); b.copyToChannel(x, 0); return b;
  },
  noteMean(buf, t0, t1) {
    const C = window.APSElasticCore, x = buf.getChannelData(0), tr = C.mpmTrack(x, buf.sampleRate, { rate: 16000 }); const v = [];
    for (let i = Math.round(t0 / tr.hopSec); i < t1 / tr.hopSec; i++) if (tr.f0[i] > 0) v.push(C.midiOf(tr.f0[i]));
    const m = v.reduce((a, b) => a + b, 0) / v.length; return { mean: m, sdCents: 100 * Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length) };
  },
  dupIds() { const c = {}; document.querySelectorAll('[id]').forEach(e => c[e.id] = (c[e.id] || 0) + 1); return Object.entries(c).filter(([, n]) => n > 1).map(([k]) => k); }
};
"""

VIS = """el => { const r = el.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2, top = document.elementFromPoint(cx, cy);
  return { inView: r.top >= -1 && r.bottom <= innerHeight + 1 && r.left >= -1 && r.right <= innerWidth + 1, onTop: !!top && (top === el || el.contains(top)), h: Math.round(r.height), w: Math.round(r.width), text: el.textContent.trim() }; }"""

def free_port():
    s = socket.socket(); s.bind(('127.0.0.1', 0)); p = s.getsockname()[1]; s.close(); return p

class Quiet(SimpleHTTPRequestHandler):
    def log_message(self, *a): pass

def wait_js(page, expr, seconds):
    # sondagem pelo Python (não depende do requestAnimationFrame da página, que pode atrasar com o áudio tocando)
    import time
    end = time.time() + seconds
    while time.time() < end:
        if page.evaluate(expr): return True
        page.wait_for_timeout(80)
    return False

def vis(page, sel): return page.locator(sel).evaluate(VIS)

def daw_flow(browser, origin, w, h, shots):
    errors = []
    ctx = browser.new_context(viewport={'width': w, 'height': h}, device_scale_factor=2 if shots else 1, service_workers='block', permissions=['microphone'])
    page = ctx.new_page()
    page.on('console', lambda m: m.type == 'error' and errors.append(m.text))
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('response', lambda r: r.status >= 400 and errors.append(f'HTTP {r.status} {r.url}'))
    page.add_init_script(GEN)
    page.goto(origin + '/daw.html'); page.wait_for_load_state('networkidle')
    page.wait_for_function("() => window.APSMixBridge && window.__apsQuantDaw && document.querySelector('#apsVocalTune').__apsTune && document.getElementById('apsQuantDeckPlay')", timeout=30000, polling=100)
    ids = page.evaluate("""() => { const B = APSMixBridge; B.setBpm && B.setBpm(100);
      const d = __gen.drums(44100, 6, 100), b2 = __gen.drums(44100, 6, 100);
      const idD = B.addTrack('Bateria', d, 'audio', 0), idB = B.addTrack('Percussão', b2, 'audio', 0), v1 = __gen.voice(44100), vb = new AudioBuffer({ length: v1.length * 3, numberOfChannels: 1, sampleRate: 44100 }); for (let k = 0; k < 3; k++) vb.copyToChannel(v1.getChannelData(0), 0, k * v1.length); const idV = B.addTrack('Voz', vb, 'audio', 0);
      window.__orig = { [idD]: d, [idB]: b2, [idV]: B.buffer(idV) }; B.focus(idD); return { idD, idB, idV }; }""")
    D, V = json.dumps(ids['idD']), json.dumps(ids['idV'])
    page.click('.pro-tabs [data-tab="elastico"]'); page.wait_for_timeout(500)
    r = {}
    # ---------- Quantização ----------
    r['q_visivel_ao_abrir'] = {'aplicar': vis(page, '#apsQuantApply'), 'play': vis(page, '#apsQuantDeckPlay'), 'gravar': vis(page, '#apsQuantDeckRec'), 'editado': vis(page, '#apsQuantDeckEdit'), 'original': vis(page, '#apsQuantDeckOrig')}
    page.click('#apsQuantAnalyze'); page.wait_for_function("() => __apsQuantDaw.quant.state.plan", timeout=60000, polling=100)
    r['q_msg_apos_analise'] = page.evaluate("() => document.getElementById('apsQuantDeckMsg').textContent")
    page.evaluate("() => { const s = document.getElementById('apsQuantStrength'); s.value = 70; s.dispatchEvent(new Event('input', {bubbles: true})); }")
    page.wait_for_function("() => { const st = __apsQuantDaw.quant.state; return st.preview && !st.previewJob && st.previewSig && st.previewSig.includes(String(st.plan.markers[0].dst.toFixed(4)).replace(/0+$/, '').slice(0, 4)); }", timeout=60000, polling=100)
    page.evaluate("() => __apsQuantDaw.quant.preview()")
    r['q_previa'] = page.evaluate(f"() => {{ const st = __apsQuantDaw.quant.state; return {{ previewReady: !!st.preview, trackStillOriginal: APSMixBridge.buffer({D}) === __orig[{D}], dirty: __apsQuantDaw.quant.dirty(), msg: document.getElementById('apsQuantDeckMsg').textContent }}; }}")
    page.click('#apsQuantDeckPlay'); page.wait_for_function("() => window.__apsApplyPlayLast && __apsApplyPlayLast.prefix === 'apsQuantDeck' && __apsQuantDaw.quant.deck.isPlaying()", timeout=60000, polling=100)
    wait_js(page, "() => __apsQuantDaw.quant.state.playhead > 0.3", 8)  # o relógio do áudio começa a andar
    r['q_play_editado'] = page.evaluate(f"() => {{ const st = __apsQuantDaw.quant.state, L = __apsApplyPlayLast; return {{ playing: st.deck ? true : __apsQuantDaw.quant.deck.isPlaying(), isPreview: L.buffers[0] === st.preview, notOriginal: L.buffers[0] !== st.original, listen: L.listen, btn: document.getElementById('apsQuantDeckPlay').textContent, time: document.getElementById('apsQuantDeckTime').textContent, playhead: st.playhead }}; }}")
    if shots:
        page.locator('#apsQuantEditor').evaluate("e => e.scrollIntoView({block: 'start'})"); page.wait_for_timeout(250)
        page.screenshot(path=SHOTS['quant']); r['shot_quant'] = SHOTS['quant']
    page.click('#apsQuantDeckOrig'); page.wait_for_function("() => __apsApplyPlayLast.listen === 'orig' && __apsQuantDaw.quant.deck.isPlaying()", timeout=20000, polling=100)
    r['q_play_original'] = page.evaluate("() => __apsApplyPlayLast.buffers[0] === __apsQuantDaw.quant.state.original")
    page.click('#apsQuantDeckEdit'); page.wait_for_function("() => __apsApplyPlayLast.listen === 'edit'", timeout=20000, polling=100)
    page.click('#apsQuantDeckAll'); page.wait_for_function("() => __apsApplyPlayLast.scope === 'all'", timeout=20000, polling=100)
    r['q_musica_toda_itens'] = page.evaluate("() => __apsApplyPlayLast.items")
    page.click('#apsQuantDeckSolo'); page.wait_for_function("() => __apsApplyPlayLast.scope === 'solo'", timeout=20000, polling=100)
    page.click('#apsQuantDeckMetro'); page.wait_for_timeout(900)
    r['q_metronomo'] = page.evaluate("() => { const m = __apsQuantDaw.quant.deck.metro; return { running: m.running, clicks: m.log.length, sync: document.getElementById('apsQrMetro').getAttribute('aria-pressed') }; }")
    page.click('#apsQuantDeckMetro')
    page.click('#apsQuantDeckPlay'); page.wait_for_timeout(150)
    r['q_parou'] = page.evaluate("() => !__apsQuantDaw.quant.deck.isPlaying() && __apsQuantDaw.quant.state.playhead === null")
    page.click('#apsQuantApply'); page.wait_for_function("() => __apsQuantDaw.quant.state.result && !__apsQuantDaw.quant.dirty()", timeout=60000, polling=100)
    r['q_aplicada'] = page.evaluate(f"() => {{ const st = __apsQuantDaw.quant.state; return {{ trackIsResult: APSMixBridge.buffer({D}) === st.result, changed: APSMixBridge.buffer({D}) !== __orig[{D}], originalKept: __apsQuantOriginals.get({D}) === __orig[{D}], btn: document.getElementById('apsQuantApply').textContent, msg: document.getElementById('apsQuantDeckMsg').textContent, undoEnabled: !document.getElementById('apsQuantUndo').disabled }}; }}")
    page.evaluate("() => { const s = document.getElementById('apsQuantStrength'); s.value = 55; s.dispatchEvent(new Event('input', {bubbles: true})); }"); page.wait_for_timeout(150)
    r['q_aviso_alteracoes'] = page.evaluate("() => ({ dirty: __apsQuantDaw.quant.dirty(), msg: document.getElementById('apsQuantDeckMsg').textContent, cls: document.getElementById('apsQuantDeckMsg').className })")
    page.click('#apsQuantUndo'); page.wait_for_timeout(200)
    r['q_desfazer'] = page.evaluate(f"() => ({{ restored: APSMixBridge.buffer({D}) === __orig[{D}], msg: document.getElementById('apsQuantDeckMsg').textContent }})")
    # lote (multitrack)
    page.locator('#apsMtList .trk[data-id="%s"] [data-a="batch"]' % ids['idB']).check(); page.wait_for_timeout(300)
    r['q_lote_botao'] = page.evaluate("() => { const b = document.getElementById('apsQuantApplyBatch'); return { hidden: b.hidden, text: b.textContent }; }")
    page.click('#apsQuantApplyBatch'); page.wait_for_function("() => window.__apsMtLast && __apsMtLast.length", timeout=60000, polling=100); page.wait_for_timeout(200)
    B2 = json.dumps(ids['idB'])
    r['q_lote_aplicado'] = page.evaluate(f"() => ({{ changed: APSMixBridge.buffer({B2}) !== __orig[{B2}], originalKept: __apsQuantOriginals.get({B2}) === __orig[{B2}], msg: document.getElementById('apsQuantDeckMsg').textContent }})")
    page.click('#apsMtList .trk[data-id="%s"] [data-a="undo"]' % ids['idB']); page.wait_for_timeout(300)
    r['q_lote_desfeito'] = page.evaluate(f"() => APSMixBridge.buffer({B2}) === __orig[{B2}]")
    # ---------- Afinação ----------
    page.evaluate(f"() => APSMixBridge.focus({V})")
    page.locator('#apsVocalTune').evaluate("e => e.scrollIntoView({block: 'start'})"); page.wait_for_timeout(300)
    r['t_visivel'] = {'aplicar': vis(page, '#apsVtApply'), 'play': vis(page, '#apsVtDeckPlay'), 'gravar': vis(page, '#apsVtDeckRec')}
    page.click('#apsVtAnalyze'); page.wait_for_function("() => document.querySelector('#apsVocalTune').__apsTune.state.plan", timeout=120000, polling=100)
    page.locator('#apsVtCanvas').evaluate("e => e.scrollIntoView({block: 'start'})"); page.wait_for_timeout(300)  # a barra fixa fica embaixo: o gráfico vai para o topo
    vinfo = page.evaluate("() => { const st = document.querySelector('#apsVocalTune').__apsTune.state, n = st.plan.notes[0], r = document.getElementById('apsVtCanvas').getBoundingClientRect(); return { target: n.target, x: r.left + st.view.X((n.t0 + n.t1) / 2), y: r.top + st.view.Y(n.target), rowH: st.view.rowH }; }")
    page.mouse.move(vinfo['x'], vinfo['y']); page.mouse.down()
    for k in range(1, 9): page.mouse.move(vinfo['x'], vinfo['y'] + vinfo['rowH'] * k / 8)
    page.mouse.up()
    r['t_nota'] = page.evaluate("() => ({ antes: %s, depois: document.querySelector('#apsVocalTune').__apsTune.state.plan.notes[0].target, msg: document.getElementById('apsVtDeckMsg').textContent })" % json.dumps(vinfo['target']))
    page.locator('#apsVocalTune').evaluate("e => e.scrollIntoView({block: 'start'})"); page.wait_for_timeout(200)
    page.click('#apsVtDeckPlay')
    if not wait_js(page, "() => window.__apsApplyPlayLast && __apsApplyPlayLast.prefix === 'apsVtDeck' && document.querySelector('#apsVocalTune').__apsTune.deck.isPlaying()", 120):
        raise RuntimeError('Ouvir afinação não começou a tocar: ' + json.dumps(page.evaluate("() => ({ msg: document.getElementById('apsVtDeckMsg').textContent, label: document.getElementById('apsVtDeckLabel').textContent, stops: window.__apsApplyPlayStops, last: { from: __apsApplyPlayLast.from, until: __apsApplyPlayLast.until, spans: __apsApplyPlayLast.spans } })"), ensure_ascii=False))
    page.wait_for_timeout(400)
    r['t_play_editado'] = page.evaluate(f"() => {{ const T = document.querySelector('#apsVocalTune').__apsTune, st = T.state, L = __apsApplyPlayLast; return {{ isPreview: L.buffers[0] === st.preview, notOriginal: L.buffers[0] !== st.original, trackStillOriginal: APSMixBridge.buffer({V}) === __orig[{V}], btn: document.getElementById('apsVtDeckPlay').textContent, playhead: st.playhead, time: document.getElementById('apsVtDeckTime').textContent }}; }}")
    if shots:
        page.wait_for_timeout(200); page.screenshot(path=SHOTS['tune']); r['shot_tune'] = SHOTS['tune']
    page.click('#apsVtDeckOrig'); page.wait_for_function("() => __apsApplyPlayLast.listen === 'orig' && __apsApplyPlayLast.prefix === 'apsVtDeck'", timeout=20000, polling=100)
    r['t_play_original'] = page.evaluate("() => __apsApplyPlayLast.buffers[0] === document.querySelector('#apsVocalTune').__apsTune.state.original")
    page.click('#apsVtDeckAll'); page.wait_for_function("() => __apsApplyPlayLast.scope === 'all' && __apsApplyPlayLast.prefix === 'apsVtDeck'", timeout=20000, polling=100)
    r['t_musica_toda_itens'] = page.evaluate("() => __apsApplyPlayLast.items")
    page.click('#apsVtDeckPlay'); page.wait_for_timeout(150)
    page.click('#apsVtApply'); page.wait_for_function("() => { const T = document.querySelector('#apsVocalTune').__apsTune; return T.state.result && !T.dirty(); }", timeout=120000, polling=100)
    r['t_aplicada'] = page.evaluate(f"() => {{ const st = document.querySelector('#apsVocalTune').__apsTune.state; return {{ trackIsResult: APSMixBridge.buffer({V}) === st.result, changed: APSMixBridge.buffer({V}) !== __orig[{V}], originalKept: __apsVtOriginals.get({V}) === __orig[{V}], btn: document.getElementById('apsVtApply').textContent, msg: document.getElementById('apsVtDeckMsg').textContent }}; }}")
    page.click('#apsVtUndo'); page.wait_for_timeout(200)
    r['t_desfazer'] = page.evaluate(f"() => APSMixBridge.buffer({V}) === __orig[{V}]")
    # ---------- ● Gravar sem sair da aba (gravador da DAW, microfone falso do Chrome) ----------
    page.locator('#apsQuantPanel').evaluate("e => e.scrollIntoView({block: 'start'})"); page.wait_for_timeout(200)
    n_before = page.evaluate("() => APSMixBridge.all().length")
    page.click('#apsQuantDeckRec'); page.wait_for_function("() => APSMixBridge.isRecording() && document.getElementById('apsQuantDeckRec').textContent === '⏹ Parar'", timeout=20000, polling=100)
    page.wait_for_timeout(300)
    r['rec_gravando'] = page.evaluate("() => ({ quantBtn: document.getElementById('apsQuantDeckRec').textContent, quantOn: document.getElementById('apsQuantDeckRec').classList.contains('on'), tuneBtn: document.getElementById('apsVtDeckRec').textContent, aindaNaAba: !document.getElementById('proPanel-elastico').hidden })")
    page.wait_for_function("() => document.getElementById('record').textContent.startsWith('■ Finalizar')", timeout=20000, polling=100)  # contagem de entrada terminou: gravando de verdade
    page.wait_for_timeout(1500)
    page.click('#apsQuantDeckRec'); page.wait_for_function("() => !APSMixBridge.isRecording() && window.__apsLastRecorded && __apsQuantDaw.quant.state.srcId === __apsLastRecorded", timeout=30000, polling=100)
    r['rec_pronta'] = page.evaluate(f"() => ({{ novaPista: APSMixBridge.all().length >= {n_before}, selecionada: APSMixBridge.selectedId() === __apsLastRecorded, noEditor: __apsQuantDaw.quant.state.srcId === __apsLastRecorded, dur: +APSMixBridge.buffer(__apsLastRecorded).duration.toFixed(2), btn: document.getElementById('apsQuantDeckRec').textContent, msg: document.getElementById('apsQuantDeckMsg').textContent, aindaNaAba: !document.getElementById('proPanel-elastico').hidden }})")
    r['semRolagemLateral'] = page.evaluate("() => document.documentElement.scrollWidth <= innerWidth + 1")
    r['dupIds'] = page.evaluate('__gen.dupIds()'); r['consoleErrors'] = list(errors)
    ctx.close(); return r

def solo_flow(browser, origin):
    errors = []; out = {}
    ctx = browser.new_context(viewport={'width': 390, 'height': 844}, service_workers='block', permissions=['microphone']); page = ctx.new_page()
    page.on('console', lambda m: m.type == 'error' and errors.append(m.text)); page.on('pageerror', lambda e: errors.append(str(e)))
    page.add_init_script(GEN); page.add_init_script('window.__apsNoNavigate = true;')
    page.goto(origin + '/quantizacao.html'); page.wait_for_load_state('networkidle'); page.wait_for_function('() => window.__apsQuantPage')
    page.evaluate("() => { window.__qsrc = __gen.drums(44100, 6, 100); __apsQuantPage.setOriginal(window.__qsrc); return __apsQuantPage.ui.analyze(); }")
    page.wait_for_function("() => __apsQuantPage.ui.state.plan", timeout=60000, polling=100)
    page.locator('#qDeckPlay').evaluate("e => e.scrollIntoView({block: 'end'})"); page.wait_for_timeout(200)  # nas páginas solo a barra fica logo abaixo do editor
    out['q_visivel'] = {'aplicar': vis(page, '#qApply'), 'play': vis(page, '#qDeckPlay'), 'gravar': vis(page, '#qDeckRec')}
    page.click('#qDeckPlay'); page.wait_for_function("() => window.__apsApplyPlayLast && __apsApplyPlayLast.prefix === 'qDeck'", timeout=60000, polling=100)
    out['q_play_previa'] = page.evaluate("() => __apsApplyPlayLast.buffers[0] === __apsQuantPage.ui.state.preview")
    page.click('#qDeckPlay')
    out['q_enviar_antes'] = page.evaluate("() => document.getElementById('qToDaw').disabled")
    page.click('#qDeckRec'); page.wait_for_function("() => document.getElementById('qDeckRec').textContent === '⏹ Parar'", timeout=20000, polling=100); page.wait_for_timeout(1500)
    page.click('#qDeckRec'); page.wait_for_function("() => document.getElementById('qDeckRec').textContent === '● Gravar' && document.getElementById('fileName').textContent.includes('gravada agora')", timeout=30000, polling=100)
    out['q_gravou_microfone'] = page.evaluate("() => ({ dur: +__apsQuantPage.ui.state.original.duration.toFixed(2), novo: __apsQuantPage.ui.state.original !== window.__qsrc })")
    page.evaluate("() => { __apsQuantPage.setOriginal(window.__qsrc); return __apsQuantPage.ui.analyze(); }"); page.wait_for_function("() => __apsQuantPage.ui.state.plan && __apsQuantPage.ui.state.original === window.__qsrc", timeout=60000, polling=100)
    page.click('#qApply'); page.wait_for_function("() => __apsQuantPage.ui.state.result && !document.getElementById('qToDaw').disabled", timeout=60000, polling=100)
    page.click('#qToDaw'); page.wait_for_timeout(800)
    out['q_enviado'] = page.evaluate("""() => new Promise(ok => { const r = indexedDB.open('aps-stems-transfer-v1', 1); r.onsuccess = () => { const g = r.result.transaction('sessions').objectStore('sessions').get('latest'); g.onsuccess = () => ok(!!(g.result && g.result.stems && g.result.stems[0].blob.size > 1000 && /Quantizado/.test(g.result.stems[0].name))); g.onerror = () => ok(false); }; r.onerror = () => ok(false); })""")
    page.goto(origin + '/afinacao.html'); page.wait_for_load_state('networkidle'); page.wait_for_function('() => window.__apsTunePage')
    page.evaluate("() => { __apsTunePage.setOriginal(__gen.voice(44100)); return __apsTunePage.ui.analyze(); }")
    page.wait_for_function("() => __apsTunePage.ui.state.plan", timeout=120000, polling=100)
    page.locator('#tDeckPlay').evaluate("e => e.scrollIntoView({block: 'end'})"); page.wait_for_timeout(200)  # nas páginas solo a barra fica logo abaixo do editor
    out['t_visivel'] = {'aplicar': vis(page, '#tApply'), 'play': vis(page, '#tDeckPlay')}
    page.click('#tDeckPlay'); page.wait_for_function("() => window.__apsApplyPlayLast && __apsApplyPlayLast.prefix === 'tDeck'", timeout=120000, polling=100)
    out['t_play_previa'] = page.evaluate("() => __apsApplyPlayLast.buffers[0] === __apsTunePage.ui.state.preview")
    page.click('#tDeckPlay')
    page.click('#tApply'); page.wait_for_function("() => __apsTunePage.ui.state.result && !document.getElementById('tToDaw').disabled", timeout=120000, polling=100)
    out['t_enviar_habilitado'] = True
    out['t_gravar'] = vis(page, '#tDeckRec')
    page.click('#tDeckRec'); page.wait_for_function("() => document.getElementById('tDeckRec').textContent === '⏹ Parar'", timeout=20000, polling=100); page.wait_for_timeout(1500)
    page.click('#tDeckRec'); page.wait_for_function("() => document.getElementById('tDeckRec').textContent === '● Gravar' && document.getElementById('msg').textContent.includes('Gravação pronta')", timeout=30000, polling=100)
    out['t_gravou_microfone'] = page.evaluate("() => ({ dur: +(__apsTunePage.ui.state.original ? __apsTunePage.ui.state.original.duration : 0).toFixed(2), msg: document.getElementById('msg').textContent })")
    out['semRolagemLateral'] = page.evaluate("() => document.documentElement.scrollWidth <= innerWidth + 1")
    out['dupIds'] = page.evaluate('__gen.dupIds()'); out['consoleErrors'] = list(errors)
    ctx.close(); return out

def main():
    port = free_port()
    httpd = ThreadingHTTPServer(('127.0.0.1', port), lambda *a, **k: Quiet(*a, directory=str(ROOT), **k))
    Thread(target=httpd.serve_forever, daemon=True).start()
    origin = f'http://127.0.0.1:{port}'; res = {}
    with sync_playwright() as p:
        browser = p.chromium.launch(channel='chrome', args=['--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'])
        res['celular_390x844'] = daw_flow(browser, origin, 390, 844, True)
        res['desktop_1280x900'] = daw_flow(browser, origin, 1280, 900, False)
        res['paginas_solo'] = solo_flow(browser, origin)
        browser.close()
    httpd.shutdown()
    checks = {}
    for name in ('celular_390x844', 'desktop_1280x900'):
        r = res[name]; v = r['q_visivel_ao_abrir']; tv = r['t_visivel']
        big = lambda e: e['inView'] and e['onTop'] and e['h'] >= 44
        checks[f'{name}: Aplicar quantização na música + Play abaixo visíveis ao abrir a aba (sem rolar), botões ≥ 44 px'] = big(v['aplicar']) and big(v['play']) and v['aplicar']['text'] == '✓ Aplicar quantização na música' and v['play']['text'] == '▶ Ouvir o que está sendo feito' and v['editado']['inView'] and v['original']['inView']
        checks[f'{name}: aviso "Alterações prontas para aplicar" e prévia sem mexer na pista'] = 'Alterações prontas para aplicar' in r['q_msg_apos_analise'] and r['q_previa']['previewReady'] and r['q_previa']['trackStillOriginal'] and r['q_previa']['dirty']
        checks[f'{name}: Play toca a prévia editada, mostra ⏹ Parar, tempo e cursor no gráfico'] = r['q_play_editado']['isPreview'] and r['q_play_editado']['notOriginal'] and r['q_play_editado']['btn'] == '⏹ Parar' and r['q_play_editado']['playhead'] is not None and r['q_play_editado']['playhead'] > 0 and not r['q_play_editado']['time'].startswith('0:00.0 ')
        checks[f'{name}: A/B toca o original; Música toda inclui as outras pistas; metrônomo sincronizado; Parar'] = r['q_play_original'] and r['q_musica_toda_itens'] >= 3 and r['q_metronomo']['running'] and r['q_metronomo']['clicks'] >= 1 and r['q_metronomo']['sync'] == 'true' and r['q_parou']
        checks[f'{name}: Aplicar quantização atualiza o buffer da pista e guarda o original'] = all(r['q_aplicada'][k] for k in ('trackIsResult', 'changed', 'originalKept', 'undoEnabled')) and 'Quantização aplicada na pista' in r['q_aplicada']['msg'] and 'Original guardado' in r['q_aplicada']['msg'] and r['q_aplicada']['btn'] == '✓ Quantização aplicada'
        checks[f'{name}: mudar a força depois de aplicar mostra "Alterações prontas"; Desfazer restaura o original'] = r['q_aviso_alteracoes']['dirty'] and 'dirty' in r['q_aviso_alteracoes']['cls'] and r['q_desfazer']['restored'] and 'Original de volta' in r['q_desfazer']['msg']
        checks[f'{name}: lote multitrack aplica pelo botão da barra e ↶ por pista'] = not r['q_lote_botao']['hidden'] and 'lote' in r['q_lote_botao']['text'] and r['q_lote_aplicado']['changed'] and r['q_lote_aplicado']['originalKept'] and r['q_lote_desfeito']
        checks[f'{name}: ● Gravar na barra (Quantização e Afinação) visível; grava sem sair da aba, vira ⏹ Parar em vermelho e a pista gravada fica selecionada no editor'] = big(v['gravar']) and v['gravar']['text'] == '● Gravar' and big(tv['gravar']) and r['rec_gravando']['quantBtn'] == '⏹ Parar' and r['rec_gravando']['quantOn'] and r['rec_gravando']['tuneBtn'] == '⏹ Parar' and r['rec_gravando']['aindaNaAba'] and r['rec_pronta']['selecionada'] and r['rec_pronta']['noEditor'] and r['rec_pronta']['dur'] > 0.5 and r['rec_pronta']['btn'] == '● Gravar' and r['rec_pronta']['aindaNaAba']
        checks[f'{name}: Aplicar afinação na música + Play abaixo visíveis'] = big(tv['aplicar']) and big(tv['play']) and tv['aplicar']['text'] == '✓ Aplicar afinação na música' and tv['play']['text'] == '▶ Ouvir afinação'
        checks[f'{name}: nota arrastada e Ouvir afinação toca a prévia (pista intacta), A/B e Música toda'] = r['t_nota']['depois'] == round(r['t_nota']['antes']) - 1 and r['t_play_editado']['isPreview'] and r['t_play_editado']['notOriginal'] and r['t_play_editado']['trackStillOriginal'] and r['t_play_editado']['btn'] == '⏹ Parar' and r['t_play_original'] and r['t_musica_toda_itens'] >= 3
        checks[f'{name}: Aplicar afinação atualiza o buffer da pista; Desfazer restaura o original'] = r['t_aplicada']['trackIsResult'] and r['t_aplicada']['changed'] and r['t_aplicada']['originalKept'] and 'Afinação aplicada na pista' in r['t_aplicada']['msg'] and r['t_desfazer']
        checks[f'{name}: 0 erros de console, 0 IDs duplicados, sem rolagem lateral'] = not r['consoleErrors'] and not r['dupIds'] and r['semRolagemLateral']
    s = res['paginas_solo']
    checks['quantizacao.html: Aplicar + Play visíveis, Play toca a prévia, 📤 Enviar para a DAW grava a pista'] = s['q_visivel']['aplicar']['inView'] and s['q_visivel']['play']['inView'] and s['q_play_previa'] and s['q_enviar_antes'] and s['q_enviado']
    checks['afinacao.html: Aplicar + Play visíveis, Play toca a prévia, Enviar habilitado após aplicar'] = s['t_visivel']['aplicar']['inView'] and s['t_visivel']['play']['inView'] and s['t_play_previa'] and s['t_enviar_habilitado']
    checks['páginas solo: ● Gravar pelo microfone direto na tela (quantização e afinação)'] = s['q_visivel']['gravar']['inView'] and s['q_gravou_microfone']['novo'] and s['q_gravou_microfone']['dur'] > 0.5 and s['t_gravar']['inView'] and 'Gravação pronta' in s['t_gravou_microfone']['msg']
    checks['páginas solo: 0 erros de console, 0 IDs duplicados, sem rolagem lateral'] = not s['consoleErrors'] and not s['dupIds'] and s['semRolagemLateral']
    res['checks'] = checks
    out = ROOT / 'tests' / 'e2e-aps-daw-apply-play-report.json'
    out.write_text(json.dumps(res, indent=2, ensure_ascii=False))
    for k, v in checks.items(): print(('✔ ' if v else '✖ ') + k)
    print(f"{sum(checks.values())}/{len(checks)} verificações OK · relatório: {out}")
    sys.exit(0 if all(checks.values()) else 1)

if __name__ == '__main__':
    main()
