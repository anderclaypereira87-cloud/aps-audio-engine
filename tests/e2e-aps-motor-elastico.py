"""E2E do Motor Elástico (Fase 1): quantização sem cortes, afinação com arraste de nota,
afinador MPM (microfone falso com Si grave de 30,87 Hz) e painéis do estúdio.
Rodar: python3 tests/e2e-aps-motor-elastico.py  (salva /workspace/aps-elastico-fase1-*.png)"""
import json, math, socket, struct, sys, wave
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from threading import Thread
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
SHOT = '/workspace/aps-elastico-fase1-{:02d}-{}.png'
FAKE_MIC = Path('/tmp/aps-fake-mic-si-grave.wav')

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

def make_fake_mic():
    sr, secs = 48000, 20
    with wave.open(str(FAKE_MIC), 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr)
        f = 30.87
        frames = bytearray()
        for i in range(sr * secs):
            t = i / sr
            v = 0.30 * math.sin(2 * math.pi * f * t) + 0.25 * math.sin(4 * math.pi * f * t) + 0.18 * math.sin(6 * math.pi * f * t) + 0.08 * math.sin(8 * math.pi * f * t)
            frames += struct.pack('<h', int(max(-1, min(1, v)) * 32000))
        w.writeframes(bytes(frames))

def free_port():
    s = socket.socket(); s.bind(('127.0.0.1', 0)); p = s.getsockname()[1]; s.close(); return p

class Quiet(SimpleHTTPRequestHandler):
    def log_message(self, *a): pass

def main():
    make_fake_mic()
    port = free_port()
    httpd = ThreadingHTTPServer(('127.0.0.1', port), lambda *a, **k: Quiet(*a, directory=str(ROOT), **k))
    Thread(target=httpd.serve_forever, daemon=True).start()
    origin = f'http://127.0.0.1:{port}'
    res, n = {}, [0]
    def shot(page, name):
        n[0] += 1; path = SHOT.format(n[0], name); page.screenshot(path=path, full_page=False); res.setdefault('screenshots', []).append(path)
    with sync_playwright() as p:
        browser = p.chromium.launch(channel='chrome', args=['--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', f'--use-file-for-fake-audio-capture={FAKE_MIC}'])
        def new_page(path, errors):
            ctx = browser.new_context(viewport={'width': 1280, 'height': 900}, permissions=['microphone'], service_workers='block')
            page = ctx.new_page()
            page.on('console', lambda m: m.type == 'error' and errors.append(m.text + ' @ ' + str(m.location.get('url', ''))))
            page.on('pageerror', lambda e: errors.append(str(e)))
            page.on('response', lambda r: r.status >= 400 and errors.append(f'HTTP {r.status} {r.url}'))
            page.add_init_script(GEN)
            page.goto(origin + path, wait_until='load')
            return page

        # ---------- 1. quantizacao.html ----------
        err = []; page = new_page('/quantizacao.html', err)
        page.wait_for_function('window.__apsQuantPage && window.APSElastic')
        page.evaluate("""() => { const b = __gen.drums(44100, 6, 100); window.__srcCopy = b.getChannelData(0).slice(); __apsQuantPage.setOriginal(b); const bpm = document.getElementById('qBpm'); if (bpm) { bpm.value = 100; bpm.dispatchEvent(new Event('change')); } }""")
        page.click('#qAnalyze'); page.wait_for_function("document.querySelector('#quantHost').__apsQuant.state.plan", timeout=30000)
        page.locator('#qCanvas').scroll_into_view_if_needed()
        mk = page.evaluate("""() => { const st = document.querySelector('#quantHost').__apsQuant.state, m = st.plan.markers[1], r = document.getElementById('qCanvas').getBoundingClientRect(); return { id: m.id, src: m.src, dst: m.dst, x: r.left + st.view.X(m.dst), y: r.top + st.view.mid + 50, n: st.plan.markers.length }; }""")
        shot(page, 'quant-marcadores')
        page.mouse.move(mk['x'], mk['y']); page.mouse.down(); page.mouse.move(mk['x'] + 12, mk['y'], steps=6); page.mouse.move(mk['x'] + 24, mk['y'], steps=6); page.mouse.up()
        dragged = page.evaluate(f"() => {{ const st = document.querySelector('#quantHost').__apsQuant.state; const m = st.plan.markers.find(m => m.id === {json.dumps(mk['id'])}); return {{ dst: m.dst, manual: m.manual }}; }}")
        page.evaluate("""() => { const q = window.APSElastic.quantize; window.APSElastic.quantize = async (...a) => { const r = await q(...a); window.__lastQuant = { engine: r.engine, metrics: r.metrics, warnings: (r.warnings || []).length, worker: APSElastic.usingWorker() }; return r; }; }""")
        page.click('#qApply'); page.wait_for_function('window.__lastQuant', timeout=60000)
        page.wait_for_timeout(300)
        quant = page.evaluate("""() => { const st = document.querySelector('#quantHost').__apsQuant.state, b = st.result, o = st.original.getChannelData(0); let same = true; for (let i = 0; i < o.length; i += 97) if (o[i] !== __srcCopy[i]) { same = false; break; } const on = APSElasticCore.detectOnsets([b.getChannelData(0)], b.sampleRate), unit = 0.15, e = on.map(x => Math.abs(x.time - Math.round(x.time / unit) * unit) * 1000).sort((a, b) => a - b); return { ...window.__lastQuant, len: b.length, srcLen: st.original.length, originalIntact: same, gridMedianMs: e[e.length >> 1], gridMaxMs: e[e.length - 1], onsetsOut: on.length, status: document.getElementById('qStatus').textContent }; }""")
        shot(page, 'quant-resultado')
        page.click('#qAB'); ab = page.evaluate("() => document.getElementById('qAB').textContent")
        page.click('#qAB'); page.click('#qUndo')
        undo = page.evaluate("() => ({ result: !!document.querySelector('#quantHost').__apsQuant.state.result, status: document.getElementById('qStatus').textContent })")
        res['quantizacao'] = dict(markers=mk['n'], drag={'antes': mk['dst'], 'depois': dragged['dst'], 'manual': dragged['manual']}, **quant, abLabel=ab, undoClearsResult=not undo['result'], dupIds=page.evaluate('__gen.dupIds()'), consoleErrors=list(err))
        page.context.close()

        # ---------- 2. afinacao.html ----------
        err = []; page = new_page('/afinacao.html', err)
        page.wait_for_function('window.__apsTunePage && window.APSElastic && window.APSElasticCore')
        page.evaluate("() => __apsTunePage.setOriginal(__gen.voice(44100))")
        page.click('#tAnalyze'); page.wait_for_function("document.querySelector('#tuneHost').__apsTune.state.plan", timeout=90000)
        page.locator('#tCanvas').scroll_into_view_if_needed()
        info = page.evaluate("""() => { const st = document.querySelector('#tuneHost').__apsTune.state, n = st.plan.notes[0], r = document.getElementById('tCanvas').getBoundingClientRect(); return { source: st.track.source, notes: st.plan.notes.length, center: n.center, target: n.target, x: r.left + st.view.X((n.t0 + n.t1) / 2), y: r.top + st.view.Y(n.target), rowH: st.view.rowH, statusAnalise: document.getElementById('tStatus').textContent }; }""")
        shot(page, 'afinacao-analise')
        page.mouse.move(info['x'], info['y']); page.mouse.down()
        for k in range(1, 9): page.mouse.move(info['x'], info['y'] - info['rowH'] * 2 * k / 8)
        page.mouse.up()
        after = page.evaluate("() => { const n = document.querySelector('#tuneHost').__apsTune.state.plan.notes[0]; return { target: n.target, manual: n.manual, bar: document.getElementById('tNoteInfo').textContent }; }")
        page.click('#tApply'); page.wait_for_function("document.querySelector('#tuneHost').__apsTune.state.result", timeout=90000)
        tuned = page.evaluate("""() => { const st = document.querySelector('#tuneHost').__apsTune.state, a = __gen.noteMean(st.original, 0.25, 1.0), b = __gen.noteMean(st.result, 0.25, 1.0), c = __gen.noteMean(st.result, 1.45, 2.2); let pk = 0, nan = 0; const y = st.result.getChannelData(0); for (const v of y) { if (!Number.isFinite(v)) nan++; pk = Math.max(pk, Math.abs(v)); } return { worker: APSElastic.usingWorker(), nota1Antes: a.mean, nota1Depois: b.mean, vibAntes: a.sdCents, vibDepois: b.sdCents, nota2Depois: c.mean, peak: pk, nan, status: document.getElementById('tStatus').textContent }; }""")
        shot(page, 'afinacao-nota-arrastada')
        page.click('#tAB'); ab = page.evaluate("() => document.getElementById('tAB').textContent"); page.click('#tAB'); page.click('#tUndo')
        res['afinacao'] = dict(**info, dragTarget=after, **tuned, abLabel=ab, undoClearsResult=not page.evaluate("() => !!document.querySelector('#tuneHost').__apsTune.state.result"), noDelayLine=page.evaluate("() => !document.documentElement.innerHTML.includes('createDelay')"), dupIds=page.evaluate('__gen.dupIds()'), consoleErrors=list(err))
        page.context.close()

        # ---------- 3. afinador.html (microfone falso: Si grave 30,87 Hz) ----------
        err = []; page = new_page('/afinador.html', err)
        page.select_option('#inst', 'baixo5'); page.click('#go')
        page.wait_for_function("document.getElementById('hz').textContent.includes('Hz ·')", timeout=20000); page.wait_for_timeout(1500)
        tun = page.evaluate("() => ({ mode: window.__apsTunerMode, note: document.getElementById('nt').textContent, hz: document.getElementById('hz').textContent, status: document.getElementById('ss').textContent, hit: [...document.querySelectorAll('#strs span.hit')].map(s => s.textContent) })")
        shot(page, 'afinador-si-grave')
        page.click('#mStrobe'); page.wait_for_timeout(800); shot(page, 'afinador-estroboscopico')
        strobe = page.evaluate("() => !document.getElementById('strobe').hidden")
        page.select_option('#inst', 'sopro_bb'); page.wait_for_timeout(700)
        bb = page.evaluate("() => ({ note: document.getElementById('nt').textContent, tr: document.getElementById('tr').textContent })")
        page.click('#mNeedle'); page.wait_for_timeout(300); shot(page, 'afinador-sopro-sib')
        page.click('#go')
        res['afinador'] = dict(**tun, strobeVisible=strobe, soproSib=bb, presets=page.evaluate("() => [...document.querySelectorAll('#inst option')].map(o => o.value)"), dupIds=page.evaluate('__gen.dupIds()'), consoleErrors=list(err))
        page.context.close()

        # ---------- 4. daw.html (painéis do estúdio) ----------
        err = []; page = new_page('/daw.html', err)
        page.wait_for_function("window.APSMixBridge && document.querySelector('#apsQuantPanel').__apsQuant && document.querySelector('#apsVocalTune').__apsTune", timeout=30000)
        tid = page.evaluate("() => { const id = APSMixBridge.addTrack('Bateria teste', __gen.drums(44100, 6, 100), 'audio', 0); APSMixBridge.focus(id); APSMixBridge.setBpm && APSMixBridge.setBpm(100); window.__dawOrig = APSMixBridge.buffer(id); return id; }")
        page.click('.pro-tabs [data-tab="elastico"]'); page.wait_for_timeout(300)
        page.evaluate("() => document.querySelector('#apsQuantPanel').__apsQuant.analyze()")
        page.wait_for_function("document.querySelector('#apsQuantPanel').__apsQuant.state.plan", timeout=30000)
        page.locator('#apsQuantCanvas').scroll_into_view_if_needed(); page.wait_for_timeout(200)
        mk = page.evaluate("""() => { const st = document.querySelector('#apsQuantPanel').__apsQuant.state, m = st.plan.markers[2], r = document.getElementById('apsQuantCanvas').getBoundingClientRect(); return { id: m.id, dst: m.dst, x: r.left + st.view.X(m.dst), y: r.top + st.view.mid + 50 }; }""")
        page.mouse.move(mk['x'], mk['y']); page.mouse.down(); page.mouse.move(mk['x'] - 20, mk['y'], steps=8); page.mouse.up()
        dd = page.evaluate(f"() => document.querySelector('#apsQuantPanel').__apsQuant.state.plan.markers.find(m => m.id === {json.dumps(mk['id'])}).dst")
        page.click('#apsQuantApply'); page.wait_for_function("document.querySelector('#apsQuantPanel').__apsQuant.state.result", timeout=60000)
        page.wait_for_timeout(200)
        changed = page.evaluate(f"() => APSMixBridge.buffer({json.dumps(tid)}) !== window.__dawOrig")
        shot(page, 'daw-quant-pro-v2')
        page.click('#apsQuantUndo'); restored = page.evaluate(f"() => APSMixBridge.buffer({json.dumps(tid)}) === window.__dawOrig")
        vid = page.evaluate("() => { const id = APSMixBridge.addTrack('Voz teste', __gen.voice(44100), 'audio', 0); APSMixBridge.focus(id); return id; }")
        page.evaluate("() => document.querySelector('#apsVocalTune').__apsTune.analyze()")
        page.wait_for_function("document.querySelector('#apsVocalTune').__apsTune.state.plan", timeout=90000)
        page.locator('#apsVtCanvas').scroll_into_view_if_needed(); page.wait_for_timeout(300)
        vinfo = page.evaluate("() => { const st = document.querySelector('#apsVocalTune').__apsTune.state, n = st.plan.notes[0], r = document.getElementById('apsVtCanvas').getBoundingClientRect(); return { target: n.target, x: r.left + st.view.X((n.t0 + n.t1) / 2), y: r.top + st.view.Y(n.target), rowH: st.view.rowH }; }")
        page.mouse.move(vinfo['x'], vinfo['y']); page.mouse.down()
        for k in range(1, 9): page.mouse.move(vinfo['x'], vinfo['y'] + vinfo['rowH'] * k / 8)
        page.mouse.up()
        vt = page.evaluate("() => document.querySelector('#apsVocalTune').__apsTune.state.plan.notes[0].target")
        page.click('#apsVtApply'); page.wait_for_function("document.querySelector('#apsVocalTune').__apsTune.state.result", timeout=90000)
        vchanged = page.evaluate(f"() => APSMixBridge.buffer({json.dumps(vid)}) === document.querySelector('#apsVocalTune').__apsTune.state.result")
        shot(page, 'daw-afinacao-voz')
        page.click('#apsVtUndo'); vrest = page.evaluate(f"() => APSMixBridge.buffer({json.dumps(vid)}) === document.querySelector('#apsVocalTune').__apsTune.state.original")
        res['daw'] = dict(quantCanvasCount=page.evaluate("() => document.querySelectorAll('#apsQuantCanvas').length"), oldQuantBox=page.evaluate("() => !!document.getElementById('apsQuantBox')"), markerDrag={'antes': mk['dst'], 'depois': dd}, trackChanged=changed, undoRestoresOriginal=restored, vocalCanvas=page.evaluate("() => !!document.getElementById('apsVtCanvas')"), vocalDrag={'antes': vinfo['target'], 'depois': vt}, vocalApplied=vchanged, vocalUndo=vrest, dupIds=page.evaluate('__gen.dupIds()'), consoleErrors=list(err))
        page.context.close()
        browser.close()
    httpd.shutdown()
    print(json.dumps(res, indent=1, ensure_ascii=False))
    ok = True
    q, a, t, d = res['quantizacao'], res['afinacao'], res['afinador'], res['daw']
    checks = {
        'quant: 0 erros de console': not q['consoleErrors'], 'quant: 0 IDs duplicados': not q['dupIds'],
        'quant: marcador arrastado': abs(q['drag']['depois'] - q['drag']['antes']) > 0.005 and q['drag']['manual'],
        'quant: Signalsmith no Worker': q['engine'] == 'poly' and q['worker'],
        'quant: sem buracos/NaN/clip': q['metrics']['longestSilentMs'] < 1 and q['metrics']['nan'] == 0 and q['metrics']['peak'] <= 1,
        'quant: duração igual e original intacto': q['len'] == q['srcLen'] and q['originalIntact'],
        'quant: A/B e desfazer': 'ouvindo A' in q['abLabel'] and q['undoClearsResult'],
        'afinação: 0 erros de console': not a['consoleErrors'], 'afinação: 0 IDs duplicados': not a['dupIds'],
        'afinação: SwiftF0 ativo': 'swiftf0' in a['source'],
        'afinação: nota arrastada +2': a['dragTarget']['manual'] and abs(a['dragTarget']['target'] - (round(a['target']) + 2)) < 1e-6,
        'afinação: nota chegou ao alvo': abs(a['nota1Depois'] - a['dragTarget']['target']) < 0.12,
        'afinação: vibrato mantido': abs(a['vibDepois'] - a['vibAntes']) < 5,
        'afinação: sem NaN/clip': a['nan'] == 0 and a['peak'] < 1, 'afinação: A/B e desfazer': 'ouvindo A' in a['abLabel'] and a['undoClearsResult'],
        'afinação: sem delay-line': a['noDelayLine'],
        'afinador: 0 erros de console': not t['consoleErrors'], 'afinador: AudioWorklet': t['mode'] == 'worklet',
        'afinador: Si grave 30,87 Hz': t['note'].startswith('Si') and '30.8' in t['hz'],
        'afinador: estroboscópico': t['strobeVisible'], 'afinador: sopro Sib transpõe': 'Sib' in t['soproSib']['tr'] and t['soproSib']['note'].startswith('Dó#'),
        'daw: 0 erros de console': not d['consoleErrors'], 'daw: 0 IDs duplicados': not d['dupIds'], 'daw: 1 apsQuantCanvas': d['quantCanvasCount'] == 1 and not d['oldQuantBox'],
        'daw: marcador arrastado': abs(d['markerDrag']['depois'] - d['markerDrag']['antes']) > 0.005,
        'daw: pista recebe resultado e desfazer volta original': d['trackChanged'] and d['undoRestoresOriginal'], 'daw: painel de voz': d['vocalCanvas'], 'daw: nota arrastada −1 e aplicada na pista': d['vocalDrag']['depois'] == round(d['vocalDrag']['antes']) - 1 and d['vocalApplied'] and d['vocalUndo'],
    }
    for k, v in checks.items():
        print(('✔ ' if v else '✖ ') + k); ok = ok and v
    print('RESULTADO:', 'PASSOU' if ok else 'FALHOU', f'({sum(checks.values())}/{len(checks)})')
    sys.exit(0 if ok else 1)

if __name__ == '__main__':
    main()
