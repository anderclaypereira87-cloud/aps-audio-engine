"""E2E da Quantização Multitrack na DAW + página solo: botão giratório de compasso, ⚡ Auto (BPM + Compasso),
metrônomo com lookahead, pontos das outras pistas no gráfico, alinhar na grade / pela pista guia / em lote,
arraste manual, A/B e Desfazer por pista. Rodar: python3 tests/e2e-aps-quant-multitrack.py
(salva /workspace/aps-quant-mt-*.png e tests/e2e-aps-quant-multitrack-report.json)"""
import json, socket, sys
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from threading import Thread
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
SHOT = '/workspace/aps-quant-mt-{:02d}-{}.png'

GEN = r"""
window.__gen = {
  tail(i, L) { const r = (L - i) / (0.4 * L); return r >= 1 ? 1 : 0.5 - 0.5 * Math.cos(Math.PI * Math.max(0, r)); },
  // bateria num compasso: tempo 1 acentuado (bumbo forte), demais tempos mais fracos; pad contínuo
  drums(sr, bpm, num, bars, lead, jitter) {
    const beat = 60 / bpm, n = Math.round((lead + bars * num * beat + 0.8) * sr), x = new Float32Array(n), hits = []; let s = 5;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < n; i++) x[i] = 0.03 * Math.sin(2 * Math.PI * 330 * i / sr);
    for (let k = 0; k < bars * num; k++) {
      const t = lead + k * beat + (rnd() - 0.5) * (jitter || 0), b = k % num, amp = b === 0 ? 0.9 : 0.38, f = b === 0 ? 60 : 150, i0 = Math.round(t * sr), L = Math.round(0.14 * sr); hits.push(t);
      for (let i = 0; i < L && i0 + i < n; i++) x[i0 + i] += amp * Math.exp(-i / sr * 40) * this.tail(i, L) * Math.sin(2 * Math.PI * f * i / sr * (1 + Math.exp(-i / sr * 60)));
    }
    const b = new AudioBuffer({ length: n, numberOfChannels: 2, sampleRate: sr }); b.copyToChannel(x, 0); b.copyToChannel(x, 1); window.__hits = window.__hits || {}; return { b, hits };
  },
  // instrumento tocando os tempos dados, deslocado ±(15..35) ms
  pluck(sr, times, seconds, freq, maxOff, seed) {
    const n = Math.round(seconds * sr), x = new Float32Array(n); let s = seed || 9; const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647); const played = [];
    for (let i = 0; i < n; i++) x[i] = 0.035 * Math.sin(2 * Math.PI * freq / 2 * i / sr);
    for (const t0 of times) {
      const off = maxOff ? (rnd() < 0.5 ? -1 : 1) * (0.015 + rnd() * (maxOff - 0.015)) : 0, t = t0 + off, j0 = Math.round(t * sr), L = Math.round(0.26 * sr); played.push(t);
      for (let i = 0; i < L && j0 + i < n; i++) x[j0 + i] += 0.45 * Math.exp(-i / sr * 14) * Math.min(1, i / (0.002 * sr)) * this.tail(i, L) * (Math.sin(2 * Math.PI * freq * i / sr) + 0.4 * Math.sin(4 * Math.PI * freq * i / sr));
    }
    const b = new AudioBuffer({ length: n, numberOfChannels: 1, sampleRate: sr }); b.copyToChannel(x, 0); return { b, played };
  },
  med(v) { const s = v.slice().sort((a, b) => a - b); return s.length ? s[s.length >> 1] : 0; },
  errTo(buf, ref) { const on = APSElasticCore.detectOnsets([buf.getChannelData(0)], buf.sampleRate); return { n: on.length, med: this.med(on.map(o => Math.min(...ref.map(g => Math.abs(g - o.time))) * 1000)) }; },
  dupIds() { const c = {}; document.querySelectorAll('[id]').forEach(e => c[e.id] = (c[e.id] || 0) + 1); return Object.entries(c).filter(([, n]) => n > 1).map(([k]) => k); }
};
"""

def free_port():
    s = socket.socket(); s.bind(('127.0.0.1', 0)); p = s.getsockname()[1]; s.close(); return p

class Quiet(SimpleHTTPRequestHandler):
    def log_message(self, *a): pass

def knob_center(page, sel):
    b = page.locator(sel).bounding_box(); return b['x'] + b['width'] / 2, b['y'] + b['height'] / 2, b['width']

def turn_knob(page, sel, angle_deg):
    import math
    cx, cy, w = knob_center(page, sel)
    r = w * 0.18  # arrasta perto do centro (fora dos rótulos)
    page.mouse.move(cx, cy - r * 0.2); page.mouse.down()
    for a in range(-150, int(angle_deg) + 1, 15) if angle_deg >= -150 else [angle_deg]:
        page.mouse.move(cx + r * math.sin(math.radians(a)), cy - r * math.cos(math.radians(a)))
    page.mouse.move(cx + r * math.sin(math.radians(angle_deg)), cy - r * math.cos(math.radians(angle_deg)))
    page.mouse.up()

def main():
    port = free_port()
    httpd = ThreadingHTTPServer(('127.0.0.1', port), lambda *a, **k: Quiet(*a, directory=str(ROOT), **k))
    Thread(target=httpd.serve_forever, daemon=True).start()
    origin = f'http://127.0.0.1:{port}'
    res, n = {}, [0]
    def shot(page, name, el=None):
        n[0] += 1; path = SHOT.format(n[0], name)
        if el: page.locator(el).evaluate("e => e.scrollIntoView({block: 'start'})"); page.wait_for_timeout(150)
        page.screenshot(path=path, full_page=False); res.setdefault('screenshots', []).append(path)
    with sync_playwright() as p:
        browser = p.chromium.launch(channel='chrome', args=['--autoplay-policy=no-user-gesture-required'])
        def new_page(path, errors, w=1280, h=900):
            ctx = browser.new_context(viewport={'width': w, 'height': h}, service_workers='block')
            page = ctx.new_page()
            page.on('console', lambda m: m.type == 'error' and errors.append(m.text + ' @ ' + str(m.location.get('url', ''))))
            page.on('pageerror', lambda e: errors.append(str(e)))
            page.on('response', lambda r: r.status >= 400 and errors.append(f'HTTP {r.status} {r.url}'))
            page.add_init_script(GEN)
            page.goto(origin + path); page.wait_for_load_state('networkidle')
            return page

        # ================= DAW (daw.html) =================
        err = []; page = new_page('/daw.html', err)
        page.wait_for_function('() => window.__apsQuantDaw && window.APSMixBridge')
        page.evaluate("() => { document.getElementById('bpm').value = 100; document.getElementById('bpm').dispatchEvent(new Event('change', {bubbles:true})); const s = document.getElementById('apsTimeSig'); s.value = '4/4'; s.dispatchEvent(new Event('change', {bubbles:true})); }")
        ids = page.evaluate("""() => {
          const B = APSMixBridge, sr = 44100, bpm = 96, num = 3, bars = 7, lead = 0.4;
          const d = __gen.drums(sr, bpm, num, bars, lead, 0.006); const secs = d.b.duration;
          const odd = d.hits.filter((_, i) => i % 3 !== 1);  // baixo: tempos 1 e 3 de cada compasso, desalinhado
          const bass = __gen.pluck(sr, odd, secs, 98, 0.035, 11), gtr = __gen.pluck(sr, d.hits.filter((_, i) => i % 3 === 1), secs, 196, 0.03, 23);
          const idD = B.addTrack('Bateria', d.b, 'audio', 0), idB = B.addTrack('Baixo', bass.b, 'audio', 0), idG = B.addTrack('Guitarra', gtr.b, 'audio', 0);
          window.__drumHits = d.hits; window.__orig = { [idD]: d.b, [idB]: bass.b, [idG]: gtr.b }; B.focus(idD); return { idD, idB, idG };
        }""")
        page.click('.pro-tabs [data-tab="elastico"]'); page.wait_for_timeout(400)
        page.click('#apsMtRefresh'); page.wait_for_function("() => document.querySelectorAll('#apsMtList .trk').length === 3 && !document.querySelector('#apsMtList').textContent.includes('lendo')", timeout=30000)
        read = page.evaluate("""() => ({ qrBpm: +document.getElementById('apsQrBpm').value, knob: document.getElementById('apsQrKnobSvg').dataset.value, dawBpm: APSMixBridge.bpm(), dawSig: document.getElementById('apsTimeSig').value,
          rows: [...document.querySelectorAll('#apsMtList .trk .nm')].map(e => e.textContent.trim()), colors: [...document.querySelectorAll('#apsMtList .sw')].map(e => e.style.background) })""")
        res['daw_leitura'] = read
        page.locator('#apsQuantPanel').scroll_into_view_if_needed()
        shot(page, 'daw-painel-multitrack', '#apsQuantPanel')

        # --- botão giratório: arrastar até 6/8 (topo), roda do mouse, setas ---
        knob = '#apsQrKnobSvg'
        page.locator(knob).scroll_into_view_if_needed()
        turn_knob(page, knob, 0); page.wait_for_timeout(250)
        k1 = page.evaluate("() => ({ knob: document.getElementById('apsQrKnobSvg').dataset.value, daw: document.getElementById('apsTimeSig').value, pro: document.getElementById('proSig')?.value, draw: __apsQuantDaw.quant.state.lastDraw && __apsQuantDaw.quant.state.lastDraw.meter })")
        cx, cy, _ = knob_center(page, knob); page.mouse.move(cx, cy); page.mouse.wheel(0, 120); page.wait_for_timeout(200)
        k2 = page.evaluate("() => document.getElementById('apsQrKnobSvg').dataset.value")
        page.focus(knob); page.keyboard.press('ArrowLeft'); page.keyboard.press('ArrowLeft'); page.keyboard.press('ArrowLeft'); page.wait_for_timeout(150)
        k3 = page.evaluate("() => ({ knob: document.getElementById('apsQrKnobSvg').dataset.value, daw: document.getElementById('apsTimeSig').value, pro: document.getElementById('proSig')?.value, angle: document.querySelector('#apsQrKnobSvg .rot').dataset.angle })")
        page.click('#apsMtList .trk[data-id="%s"] [data-a="edit"]' % ids['idD']); page.wait_for_function("() => __apsQuantDaw.quant.state.plan", timeout=30000)
        grid = page.evaluate("() => { const d = __apsQuantDaw.quant.state.lastDraw; const b = d.bars; return { meter: d.meter, bars: b.length, barGap: b.length > 1 ? +(b[1] - b[0]).toFixed(4) : 0, expected: +APSElasticCore.meterInfo(d.meter, d.bpm).bar.toFixed(4) }; }")
        res['knob'] = dict(arrastarAte68=k1, roda=k2, setas=k3, grade=grid)
        shot(page, 'knob-compasso', '#apsQuantRhythm')

        # --- ⚡ Auto (BPM + Compasso) na bateria ---
        page.click('#apsQrAuto'); page.wait_for_function("() => window.__apsQuantAuto", timeout=30000); page.wait_for_timeout(300)
        auto = page.evaluate("() => ({ r: { bpm: __apsQuantAuto.bpm, sig: __apsQuantAuto.sig, confidence: +__apsQuantAuto.confidence.toFixed(2), downbeat: +__apsQuantAuto.downbeat.toFixed(3) }, dawBpm: APSMixBridge.bpm(), proBpm: +(document.getElementById('proBpm')?.value || 0), dawSig: document.getElementById('apsTimeSig').value, proSig: document.getElementById('proSig')?.value, knob: document.getElementById('apsQrKnobSvg').dataset.value, gridZero: +__apsQuantDaw.gridZero().toFixed(3), status: document.getElementById('apsQrStatus').textContent })")
        res['auto'] = auto
        shot(page, 'auto-bpm-compasso', '#apsQuantRhythm')

        # --- Metrônomo: liga, ▶ ouvir, confere agenda (acento no tempo 1, intervalo, sincronia) ---
        page.click('#apsQrMetro'); page.click('#apsQrPlay'); page.wait_for_timeout(1000); page.wait_for_function('() => __apsQuantDaw.rhythm.metro.log.length >= 5', timeout=15000)
        met = page.evaluate("""() => { const m = __apsQuantDaw.rhythm.metro, L = m.log, pv = window.__apsQuantPreview, i = m.info;
          const gaps = L.slice(1).map((c, k) => c.at - L[k].at), syncErr = Math.max(...L.map(c => Math.abs((c.at - pv.t0) - (c.session - pv.from))));
          return { clicks: L.length, accents: L.map(c => c.accent).join(''), beats: L.map(c => c.beat).join(''), gapMs: +(1000 * gaps.reduce((a, b) => a + b, 0) / gaps.length).toFixed(3), gapSpreadMs: +(1000 * (Math.max(...gaps) - Math.min(...gaps))).toFixed(4), expectedGapMs: +(1000 * i.click).toFixed(3), syncErrMs: +(1000 * syncErr).toFixed(4), sig: i.sig, bpm: i.bpm, onGrid: L.every(c => Math.abs(((c.session - i.zero) / i.click) - Math.round((c.session - i.zero) / i.click)) < 1e-6), label: document.getElementById('apsQrPlay').textContent, ctxState: pv.ctx.state, ctxTime: +pv.ctx.currentTime.toFixed(3), t0: +pv.t0.toFixed(3) }; }""")
        res['metronomo_daw'] = met
        shot(page, 'metronomo-tocando', '#apsQuantRhythm')
        page.click('#apsQrPlay'); page.wait_for_timeout(200)

        # --- pontos das outras pistas sobre o gráfico (edita o Baixo) ---
        page.click('#apsMtList .trk[data-id="%s"] [data-a="edit"]' % ids['idB']); page.wait_for_function("() => __apsQuantDaw.quant.state.srcId === %s && __apsQuantDaw.quant.state.plan" % json.dumps(ids['idB']), timeout=30000)
        page.select_option('#apsQuantZoom', '8'); page.wait_for_timeout(300)
        ov = page.evaluate("() => ({ overlays: __apsQuantDaw.quant.state.lastDraw.overlays, legend: document.getElementById('apsQuantMtLegend').textContent, canvasH: document.getElementById('apsQuantCanvas').getBoundingClientRect().height, rows: [...document.querySelectorAll('#apsMtList .nm small')].map(e => e.textContent) })")
        page.locator('#apsQuantCanvas').scroll_into_view_if_needed()
        shot(page, 'pontos-outras-pistas', '#apsQuantEditor')
        page.click('#apsMtList .trk[data-id="%s"] [data-a="pts"]' % ids['idG']); page.wait_for_timeout(200)
        ov_hidden = page.evaluate("() => Object.keys(__apsQuantDaw.quant.state.lastDraw.overlays)")
        page.click('#apsMtList .trk[data-id="%s"] [data-a="pts"]' % ids['idG']); page.wait_for_timeout(200)
        ov_back = page.evaluate("() => Object.keys(__apsQuantDaw.quant.state.lastDraw.overlays)")
        res['overlays'] = dict(visiveis=ov, ocultandoGuitarra=ov_hidden, mostrandoDeNovo=ov_back)

        # --- alinhar na grade (pista ativa = Baixo) + Desfazer ---
        page.click('#apsMtModeGrid'); page.click('#apsMtAlignActive')
        page.wait_for_function("() => APSMixBridge.buffer(%s) !== window.__orig[%s]" % (json.dumps(ids['idB']), json.dumps(ids['idB'])), timeout=60000)
        g_res = page.evaluate("() => { const id = %s, D = __apsQuantDaw; const bpm = APSMixBridge.bpm(), z = D.gridZero(), unit = 60 / bpm; const gridRef = []; for (let t = z; t < 30; t += unit / 2) gridRef.push(t); return { before: __gen.errTo(window.__orig[id], gridRef), after: __gen.errTo(APSMixBridge.buffer(id), gridRef), status: document.getElementById('apsQuantStatus').textContent }; }" % json.dumps(ids['idB']))
        page.click('#apsQuantUndo'); page.wait_for_timeout(200)
        g_undo = page.evaluate("() => APSMixBridge.buffer(%s) === window.__orig[%s]" % (json.dumps(ids['idB']), json.dumps(ids['idB'])))
        res['alinhar_grade'] = dict(resultado=g_res, desfazerVoltaOriginal=g_undo)

        # --- alinhar pela pista guia (Baixo pelos ataques da Bateria) ---
        page.select_option('#apsMtGuide', ids['idD']); page.wait_for_timeout(300)
        gp = page.evaluate("() => ({ mode: __apsQuantDaw.quant.state.mode, matched: __apsQuantDaw.quant.state.plan.matched, markers: __apsQuantDaw.quant.state.plan.markers.length })")
        page.click('#apsMtAlignActive')
        page.wait_for_function("() => APSMixBridge.buffer(%s) !== window.__orig[%s]" % (json.dumps(ids['idB']), json.dumps(ids['idB'])), timeout=60000)
        guide = page.evaluate("() => { const id = %s, drum = APSElasticCore.detectOnsets([window.__orig[%s].getChannelData(0)], 44100).map(o => o.time); const y = APSMixBridge.buffer(id), m = APSElasticCore.metrics([y.getChannelData(0)], 44100); return { before: __gen.errTo(window.__orig[id], drum), after: __gen.errTo(y, drum), nan: m.nan, maiorSilencioMs: +m.longestSilentMs.toFixed(3), sameLength: y.length === window.__orig[id].length, status: document.getElementById('apsQuantStatus').textContent }; }" % (json.dumps(ids['idB']), json.dumps(ids['idD'])))
        res['alinhar_guia'] = dict(plano=gp, resultado=guide)
        shot(page, 'alinhado-pela-guia', '#apsQuantEditor')

        # --- arraste manual de marcador (ímã na grade) ---
        page.locator('#apsQuantCanvas').scroll_into_view_if_needed(); page.wait_for_timeout(200)
        mk = page.evaluate("() => { const st = __apsQuantDaw.quant.state, v = st.view, cv = document.getElementById('apsQuantCanvas').getBoundingClientRect(); const m = st.plan.markers.find(m => v.X(m.dst) > 60 && v.X(m.dst) < v.W - 80); return { id: m.id, dst: m.dst, x: cv.left + v.X(m.dst), y: cv.top + v.mid + 14 }; }")
        page.mouse.move(mk['x'], mk['y']); page.mouse.down(); page.mouse.move(mk['x'] + 18, mk['y'], steps=4); page.mouse.move(mk['x'] + 36, mk['y'], steps=4); page.mouse.up(); page.wait_for_timeout(200)
        dd = page.evaluate("() => { const st = __apsQuantDaw.quant.state; return st.plan.markers.find(m => m.id === %s).dst; }" % json.dumps(mk['id']))
        res['arraste'] = dict(marcador=mk['id'], antes=round(mk['dst'], 4), depois=round(dd, 4), ima=page.evaluate("() => document.getElementById('apsQuantSnap').value"))

        # --- A/B e Desfazer (pista ativa) ---
        page.click('#apsQuantAB'); page.wait_for_timeout(150)
        ab_a = page.evaluate("() => APSMixBridge.buffer(%s) === window.__orig[%s]" % (json.dumps(ids['idB']), json.dumps(ids['idB'])))
        page.click('#apsQuantAB'); page.wait_for_timeout(150)
        ab_b = page.evaluate("() => APSMixBridge.buffer(%s) !== window.__orig[%s]" % (json.dumps(ids['idB']), json.dumps(ids['idB'])))
        page.click('#apsQuantUndo'); page.wait_for_timeout(150)
        undo = page.evaluate("() => APSMixBridge.buffer(%s) === window.__orig[%s]" % (json.dumps(ids['idB']), json.dumps(ids['idB'])))
        res['ab_desfazer'] = dict(A_original=ab_a, B_alinhada=ab_b, desfazer=undo)

        # --- lote: Baixo + Guitarra pela guia Bateria ---
        for k in ('idB', 'idG'): page.check('#apsMtList .trk[data-id="%s"] [data-a="batch"]' % ids[k])
        page.click('#apsMtAlignBatch')
        page.wait_for_function("() => window.__apsMtLast && window.__apsMtLast.length === 2", timeout=120000); page.wait_for_timeout(400)
        batch = page.evaluate("() => ({ results: __apsMtLast.map(r => ({ name: r.name, moved: r.moved, beforeMs: +r.before.toFixed(2), afterMs: +r.after.toFixed(2), maiorSilencioMs: +r.silentMs.toFixed(3), nan: r.nan, engine: r.engine })), changed: [%s, %s].map(id => APSMixBridge.buffer(id) !== window.__orig[id]), originalsKept: [%s, %s].map(id => __apsQuantOriginals.get(id) === window.__orig[id]), drumUntouched: APSMixBridge.buffer(%s) === window.__orig[%s], rowButtons: [...document.querySelectorAll('#apsMtList .trk')].map(r => ({ ab: !r.querySelector('[data-a=ab]').disabled, undo: !r.querySelector('[data-a=undo]').disabled })), status: document.getElementById('apsMtStatus').textContent })" % (json.dumps(ids['idB']), json.dumps(ids['idG']), json.dumps(ids['idB']), json.dumps(ids['idG']), json.dumps(ids['idD']), json.dumps(ids['idD'])))
        shot(page, 'lote-alinhado', '#apsQuantPanel')
        page.click('#apsMtList .trk[data-id="%s"] [data-a="ab"]' % ids['idG']); page.wait_for_timeout(150)
        row_ab = page.evaluate("() => APSMixBridge.buffer(%s) === window.__orig[%s]" % (json.dumps(ids['idG']), json.dumps(ids['idG'])))
        page.click('#apsMtList .trk[data-id="%s"] [data-a="undo"]' % ids['idG']); page.wait_for_timeout(300)
        row_undo = page.evaluate("() => APSMixBridge.buffer(%s) === window.__orig[%s] && !__apsQuantOriginals.has(%s)" % (json.dumps(ids['idG']), json.dumps(ids['idG']), json.dumps(ids['idG'])))
        batch.update(linhaAB_original=row_ab, linhaDesfazer=row_undo)
        res['lote'] = batch
        page.set_viewport_size({'width': 1280, 'height': 1100}); page.locator('#apsQuantPanel').scroll_into_view_if_needed(); page.wait_for_timeout(200)
        shot(page, 'daw-visao-geral')
        res['daw_extra'] = dict(dupIds=page.evaluate('__gen.dupIds()'), consoleErrors=list(err))

        # ================= página solo (quantizacao.html) =================
        err2 = []; page = new_page('/quantizacao.html', err2, 1200, 950)
        page.wait_for_function('() => window.__apsQuantPage')
        page.evaluate("() => { const d = __gen.drums(44100, 92, 3, 7, 0.3, 0.012); window.__solo = d; __apsQuantPage.setOriginal(d.b); return __apsQuantPage.ui.analyze(); }"); page.wait_for_timeout(600)
        page.locator('#qrKnobSvg').scroll_into_view_if_needed()
        page.focus('#qrKnobSvg'); page.keyboard.press('ArrowRight'); page.keyboard.press('ArrowRight'); page.wait_for_timeout(150)
        s_k = page.evaluate("() => ({ knob: document.getElementById('qrKnobSvg').dataset.value, state: __apsQuantPage.state().sig, drawn: __apsQuantPage.ui.state.lastDraw.meter })")
        page.click('#qrKnobSvg text.opt[data-i="6"]'); page.wait_for_timeout(150)
        s_click = page.evaluate("() => __apsQuantPage.state().sig")
        page.click('#qrAuto'); page.wait_for_function("() => window.__apsQuantAuto", timeout=30000); page.wait_for_timeout(300)
        s_auto = page.evaluate("() => ({ r: { bpm: __apsQuantAuto.bpm, sig: __apsQuantAuto.sig, confidence: +__apsQuantAuto.confidence.toFixed(2), downbeat: +__apsQuantAuto.downbeat.toFixed(3) }, state: __apsQuantPage.state(), knob: document.getElementById('qrKnobSvg').dataset.value, bars: __apsQuantPage.ui.state.lastDraw.bars.slice(0, 3) })")
        page.click('#qrMetro'); page.click('#play'); page.wait_for_timeout(800); page.wait_for_function('() => __apsQuantPage.rhythm.metro.log.length >= 5', timeout=15000)
        s_met = page.evaluate("""() => { const m = __apsQuantPage.rhythm.metro, L = m.log, pv = window.__apsQuantPreview, i = m.info, gaps = L.slice(1).map((c, k) => c.at - L[k].at);
          return { clicks: L.length, accents: L.map(c => c.accent).join(''), gapMs: +(1000 * gaps.reduce((a, b) => a + b, 0) / gaps.length).toFixed(3), expectedGapMs: +(1000 * i.click).toFixed(3), syncErrMs: +(1000 * Math.max(...L.map(c => Math.abs((c.at - pv.t0) - (c.session - pv.from))))).toFixed(4), downbeatsOnBar: L.filter(c => c.accent === 2).every(c => Math.abs(((c.session - i.zero) / (i.click * i.num)) - Math.round((c.session - i.zero) / (i.click * i.num))) < 1e-6), playLabel: document.getElementById('play').textContent }; }""")
        page.locator('#rhythmHost').scroll_into_view_if_needed()
        shot(page, 'solo-metronomo-auto')
        page.click('#play'); page.wait_for_timeout(150)
        page.click('#qApply'); page.wait_for_function("() => !document.getElementById('qAB').disabled", timeout=60000)
        s_apply = page.evaluate("() => { const r = __apsQuantPage.ui.state.result, s = __apsQuantPage.state(), unit = 60 / s.bpm; const ref = []; for (let t = s.gridZero; t < 30; t += unit) ref.push(t); return { before: __gen.errTo(window.__solo.b, ref), after: __gen.errTo(r, ref), status: document.getElementById('qStatus').textContent }; }")
        page.locator('#quantHost').scroll_into_view_if_needed()
        shot(page, 'solo-quantizado-grade-compasso')
        res['solo'] = dict(knobSetas=s_k, knobCliqueRotulo=s_click, auto=s_auto, metronomo=s_met, quantizar=s_apply, dupIds=page.evaluate('__gen.dupIds()'), consoleErrors=list(err2))

        # celular (390 px)
        err3 = []; page = new_page('/quantizacao.html', err3, 390, 844)
        page.wait_for_function('() => window.__apsQuantPage')
        page.locator('#rhythmHost').scroll_into_view_if_needed(); page.wait_for_timeout(200)
        overflow = page.evaluate('() => document.documentElement.scrollWidth > window.innerWidth + 1')
        shot(page, 'solo-celular-knob')
        res['celular'] = dict(semRolagemLateral=not overflow, consoleErrors=list(err3))
        browser.close()
    httpd.shutdown()

    d, s = res, res['solo']
    checks = {
        'daw: lê BPM e compasso da DAW': d['daw_leitura']['qrBpm'] == d['daw_leitura']['dawBpm'] == 100 and d['daw_leitura']['knob'] == d['daw_leitura']['dawSig'] == '4/4',
        'daw: lista as 3 pistas com cor própria': len(d['daw_leitura']['rows']) == 3 and len(set(d['daw_leitura']['colors'])) == 3,
        'knob: arrastar gira até 6/8 e sincroniza DAW (clássico + Pro) e grade': d['knob']['arrastarAte68']['knob'] == '6/8' == d['knob']['arrastarAte68']['daw'] == d['knob']['arrastarAte68']['pro'] == d['knob']['arrastarAte68']['draw'],
        'knob: roda do mouse avança 1 posição': d['knob']['roda'] == '5/4',
        'knob: setas (acessibilidade) voltam 3 posições': d['knob']['setas']['knob'] == '3/4' == d['knob']['setas']['daw'] == d['knob']['setas']['pro'],
        'grade: tempo 1 de cada compasso no intervalo certo': d['knob']['grade']['bars'] >= 2 and abs(d['knob']['grade']['barGap'] - d['knob']['grade']['expected']) < 1e-3,
        'auto: 96 BPM e 3/4 detectados e aplicados na DAW': abs(d['auto']['r']['bpm'] - 96) <= 1 and d['auto']['r']['sig'] == '3/4' and d['auto']['dawBpm'] == 96 and d['auto']['dawSig'] == '3/4' == d['auto']['proSig'] == d['auto']['knob'] and d['auto']['proBpm'] == 96,
        'metrônomo (DAW): acento no tempo 1 a cada 3, intervalo exato e sincronia < 0,01 ms': d['metronomo_daw']['clicks'] >= 4 and all((a == '2') == (b == '1') for a, b in zip(d['metronomo_daw']['accents'], d['metronomo_daw']['beats'])) and d['metronomo_daw']['beats'][:3] in ('123', '231', '312') and abs(d['metronomo_daw']['gapMs'] - d['metronomo_daw']['expectedGapMs']) < 0.01 and d['metronomo_daw']['syncErrMs'] < 0.01 and d['metronomo_daw']['onGrid'],
        'pontos das outras pistas aparecem (Bateria + Guitarra) com legenda': set(d['overlays']['visiveis']['overlays'].keys()) == {ids['idD'], ids['idG']} and all(v['points'] > 0 for v in d['overlays']['visiveis']['overlays'].values()) and 'Bateria' in d['overlays']['visiveis']['legend'],
        'ocultar/mostrar pontos de uma pista': ids['idG'] not in d['overlays']['ocultandoGuitarra'] and ids['idG'] in d['overlays']['mostrandoDeNovo'],
        'alinhar na grade melhora e Desfazer volta o original': d['alinhar_grade']['resultado']['after']['med'] < d['alinhar_grade']['resultado']['before']['med'] / 3 and d['alinhar_grade']['desfazerVoltaOriginal'],
        'alinhar pela guia: erro mediano cai >5×, 0 buracos, 0 NaN, mesma duração': d['alinhar_guia']['plano']['mode'] == 'guide' and d['alinhar_guia']['resultado']['after']['med'] < d['alinhar_guia']['resultado']['before']['med'] / 5 and d['alinhar_guia']['resultado']['maiorSilencioMs'] < 1 and d['alinhar_guia']['resultado']['nan'] == 0 and d['alinhar_guia']['resultado']['sameLength'],
        'arraste manual move o marcador': abs(d['arraste']['depois'] - d['arraste']['antes']) > 0.005,
        'A/B alterna e Desfazer volta o original': d['ab_desfazer']['A_original'] and d['ab_desfazer']['B_alinhada'] and d['ab_desfazer']['desfazer'],
        'lote: 2 pistas alinhadas, originais guardados, guia intacta, A/B e ↶ por pista': all(d['lote']['changed']) and all(d['lote']['originalsKept']) and d['lote']['drumUntouched'] and all(r['afterMs'] < r['beforeMs'] for r in d['lote']['results']) and all(r['maiorSilencioMs'] < 1 and r['nan'] == 0 for r in d['lote']['results']) and d['lote']['linhaAB_original'] and d['lote']['linhaDesfazer'],
        'daw: 0 erros de console e 0 IDs duplicados': not d['daw_extra']['consoleErrors'] and not d['daw_extra']['dupIds'],
        'solo: knob por setas e por clique no rótulo': s['knobSetas']['knob'] == '2/4' == s['knobSetas']['state'] == s['knobSetas']['drawn'] and s['knobCliqueRotulo'] == '12/8',
        'solo: auto 92 BPM 3/4': abs(s['auto']['r']['bpm'] - 92) <= 1 and s['auto']['r']['sig'] == '3/4' and s['auto']['knob'] == '3/4',
        'solo: metrônomo com acento só no tempo 1 e sincronia < 0,01 ms': s['metronomo']['clicks'] >= 4 and s['metronomo']['downbeatsOnBar'] and s['metronomo']['syncErrMs'] < 0.01 and abs(s['metronomo']['gapMs'] - s['metronomo']['expectedGapMs']) < 0.01,
        'solo: quantizar na grade melhora': s['quantizar']['after']['med'] < s['quantizar']['before']['med'],
        'solo/celular: 0 erros de console, sem rolagem lateral': not s['consoleErrors'] and not s['dupIds'] and not res['celular']['consoleErrors'] and res['celular']['semRolagemLateral'],
    }
    res['checks'] = checks
    out = ROOT / 'tests' / 'e2e-aps-quant-multitrack-report.json'
    out.write_text(json.dumps(res, indent=2, ensure_ascii=False))
    for k, v in checks.items(): print(('✔ ' if v else '✖ ') + k)
    print(f"{sum(checks.values())}/{len(checks)} verificações OK · relatório: {out}")
    sys.exit(0 if all(checks.values()) else 1)

if __name__ == '__main__':
    main()
