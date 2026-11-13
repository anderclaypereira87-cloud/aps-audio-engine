"""E2E do EQ gráfico: painel, bandas, bypass, IA mockada (A/B) e desfazer."""
import json
import socket
import sys
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from threading import Thread

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
SHOT_DIR = Path('/workspace')
ENDPOINT = 'https://aps-ia.aps-audio.workers.dev/eq'

MOCK = {
    'ok': True,
    'curveA': {
        'label': 'Seu pedido: mais brilho',
        'bands': [
            {'type': 'lowshelf', 'f': 60, 'g': 0, 'q': 0.7},
            {'type': 'peaking', 'f': 125, 'g': 0, 'q': 1},
            {'type': 'peaking', 'f': 250, 'g': 0, 'q': 1},
            {'type': 'peaking', 'f': 500, 'g': 0, 'q': 1},
            {'type': 'peaking', 'f': 1000, 'g': 1, 'q': 1},
            {'type': 'peaking', 'f': 2000, 'g': 2, 'q': 1},
            {'type': 'peaking', 'f': 4000, 'g': 4, 'q': 0.9},
            {'type': 'highshelf', 'f': 8000, 'g': 6, 'q': 0.7},
        ],
    },
    'curveB': {
        'label': 'Sugestão da IA',
        'reason': 'Na voz, um lift suave nos agudos e um corte pequeno em 250 Hz tira o embolado sem deixar o som estridente.',
        'bands': [
            {'type': 'lowshelf', 'f': 60, 'g': -1, 'q': 0.7},
            {'type': 'peaking', 'f': 125, 'g': 0, 'q': 1},
            {'type': 'peaking', 'f': 250, 'g': -3, 'q': 1.2},
            {'type': 'peaking', 'f': 500, 'g': 0, 'q': 1},
            {'type': 'peaking', 'f': 1000, 'g': 0, 'q': 1},
            {'type': 'peaking', 'f': 2000, 'g': 1.5, 'q': 1},
            {'type': 'peaking', 'f': 4000, 'g': 2.5, 'q': 0.9},
            {'type': 'highshelf', 'f': 8000, 'g': 3, 'q': 0.7},
        ],
    },
    'summary': 'A curva azul segue o pedido de brilho; a laranja é mais equilibrada.',
}


def free_port():
    s = socket.socket(); s.bind(('127.0.0.1', 0)); p = s.getsockname()[1]; s.close(); return p



def show_geq(page, anchor=None):
    page.evaluate(
        """(id) => {
          const box = document.getElementById('apsGeqBox');
          const dock = document.getElementById('proDockBody');
          const el = (id && document.getElementById(id)) || box;
          if (el) el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
          if (dock && box) {
            const top = box.getBoundingClientRect().top - dock.getBoundingClientRect().top + dock.scrollTop;
            dock.scrollTop = Math.max(0, top - 8);
          }
        }""",
        anchor,
    )
    page.wait_for_timeout(80)

def main():
    port = free_port()
    handler = lambda *a, **k: SimpleHTTPRequestHandler(*a, directory=str(ROOT), **k)
    httpd = ThreadingHTTPServer(('127.0.0.1', port), handler)
    Thread(target=httpd.serve_forever, daemon=True).start()
    origin = f'http://127.0.0.1:{port}'
    shots = []
    with sync_playwright() as p:
        browser = p.chromium.launch(
            channel='chrome',
            args=['--autoplay-policy=no-user-gesture-required'],
        )
        context = browser.new_context(service_workers='block', viewport={'width': 1280, 'height': 900})
        page = context.new_page()
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))

        def handle_eq(route):
            if route.request.method == 'OPTIONS':
                route.fulfill(
                    status=204,
                    headers={
                        'Access-Control-Allow-Origin': origin,
                        'Access-Control-Allow-Methods': 'POST,OPTIONS',
                        'Access-Control-Allow-Headers': 'Content-Type',
                    },
                )
                return
            route.fulfill(
                status=200,
                content_type='application/json; charset=utf-8',
                headers={'Access-Control-Allow-Origin': origin},
                body=json.dumps(MOCK),
            )

        page.route(ENDPOINT, handle_eq)

        page.goto(f'{origin}/daw.html?modulo=mixagem', wait_until='domcontentloaded')
        page.wait_for_function(
            '() => !!(window.APSMixBridge && window.APSEqGrafico && window.APSEqGraficoCore)',
            timeout=20000,
        )
        page.evaluate("() => document.querySelector('[data-aps-tab=\\'mixagem\\']')?.click()")
        created = page.evaluate(
            '''() => {
              const AC = window.AudioContext || window.webkitAudioContext;
              const ctx = new AC();
              const mk = (name, type, freq) => {
                const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
                const d = buf.getChannelData(0);
                for (let i = 0; i < d.length; i++) d[i] = Math.sin(2 * Math.PI * freq * i / ctx.sampleRate) * 0.2;
                return window.APSMixBridge.addTrack(name, buf, type, 0);
              };
              const voz = mk('Voz teste', 'voz', 1000);
              const baixo = mk('Baixo teste', 'bass', 80);
              window.APSMixBridge.focus(voz);
              return { voz, baixo, n: window.APSMixBridge.list().length };
            }'''
        )
        # No modo Pro o canal (#fx) fica na aba Editor do dock.
        page.locator('.pro-tabs button[data-tab="editor"]').click()
        page.wait_for_timeout(200)

        page.wait_for_function(
            '''() => {
              const b = document.getElementById("apsGeqBox");
              if (!b || !b.isConnected) return false;
              const r = b.getBoundingClientRect();
              return r.width > 40 && r.height > 40;
            }''',
            timeout=20000,
        )
        page.locator('#apsGeqBox').scroll_into_view_if_needed()

        before = page.evaluate(
            '''(id) => {
              const t = window.APSMixBridge.all().find(x => x.id === id);
              return {
                bass: t.bass, mid: t.mid, midFreq: t.midFreq, treble: t.treble, hpf: t.hpf,
                geq: t.graphicEq && JSON.parse(JSON.stringify(t.graphicEq))
              };
            }''',
            created['voz'],
        )
        assert before['geq'] and len(before['geq']['bands']) == 8, before
        assert all(b['g'] == 0 for b in before['geq']['bands']), before['geq']
        # classic preset 'voz' must still be there
        assert before['hpf'] == 75 and before['treble'] == 2, before

        show_geq(page)
        shot1 = SHOT_DIR / 'aps-eq-grafico-01-painel.png'
        page.locator('#apsGeqBox').screenshot(path=str(shot1))
        shots.append(str(shot1))

        # Select band 8 (highshelf / brilho) via inspect inputs
        page.evaluate(
            '''() => {
              const t = window.APSMixBridge.current();
              t.graphicEq.bands[7].g = 5;
              window.APSEqGrafico.ensure(t);
              window.APSMixBridge.commit();
              window.APSEqGrafico.draw();
            }'''
        )
        page.wait_for_timeout(200)
        mid = page.evaluate(
            '''(id) => {
              const t = window.APSMixBridge.all().find(x => x.id === id);
              return {
                g8: t.graphicEq.bands[7].g,
                bass: t.bass, treble: t.treble, hpf: t.hpf, mid: t.mid, midFreq: t.midFreq
              };
            }''',
            created['voz'],
        )
        assert mid['g8'] == 5, mid
        assert mid['bass'] == before['bass'] and mid['treble'] == before['treble']
        assert mid['hpf'] == before['hpf'] and mid['mid'] == before['mid'] and mid['midFreq'] == before['midFreq']

        show_geq(page)
        shot2 = SHOT_DIR / 'aps-eq-grafico-02-banda.png'
        page.locator('#apsGeqBox').screenshot(path=str(shot2))
        shots.append(str(shot2))

        # Bypass then un-bypass, then reset
        page.locator('#apsGeqBypass').check()
        page.wait_for_timeout(100)
        byp = page.evaluate('(id) => window.APSMixBridge.all().find(x => x.id === id).graphicEq.bypass', created['voz'])
        assert byp is True
        page.locator('#apsGeqBypass').uncheck()
        page.locator('#apsGeqReset').click()
        page.wait_for_timeout(150)
        reset = page.evaluate(
            '''(id) => {
              const t = window.APSMixBridge.all().find(x => x.id === id);
              return { bands: t.graphicEq.bands.map(b => b.g), treble: t.treble, bypass: t.graphicEq.bypass };
            }''',
            created['voz'],
        )
        assert reset['bands'] == [0, 0, 0, 0, 0, 0, 0, 0], reset
        assert reset['treble'] == before['treble']
        assert reset['bypass'] is False

        page.fill('#apsGeqInput', 'mais brilho na voz')
        page.locator('#apsGeqAsk').click()
        page.wait_for_function('() => !document.getElementById("apsGeqAB").hidden', timeout=10000)
        ab_text = page.locator('#apsGeqAB').inner_text()
        assert 'Usar a sua ou a da IA?' in ab_text
        pending = page.evaluate('() => window.APSEqGrafico.pending()')
        assert pending and len(pending['curveA']['bands']) >= 6
        assert pending['curveB']['bands'][7]['g'] == 3
        assert 'embolado' in (pending.get('reason') or '') or 'Sugestão' in page.locator('#apsGeqMsg').inner_text()

        show_geq(page, 'apsGeqAB')
        shot3 = SHOT_DIR / 'aps-eq-grafico-03-ab.png'
        page.locator('#proDock').screenshot(path=str(shot3))
        shots.append(str(shot3))

        page.locator('#apsGeqListenA').click()
        page.wait_for_timeout(100)
        listen_a = page.evaluate('(id) => window.APSMixBridge.all().find(x => x.id === id).graphicEq.bands[7].g', created['voz'])
        assert listen_a == 6, listen_a
        # classic params still intact while previewing
        still = page.evaluate(
            '''(id) => {
              const t = window.APSMixBridge.all().find(x => x.id === id);
              return { bass: t.bass, mid: t.mid, treble: t.treble, hpf: t.hpf };
            }''',
            created['voz'],
        )
        assert still == {k: before[k] for k in ('bass', 'mid', 'treble', 'hpf')}, still

        page.locator('#apsGeqListenB').click()
        page.locator('#apsGeqUseB').click()
        page.wait_for_timeout(150)
        applied = page.evaluate(
            '''(id) => {
              const t = window.APSMixBridge.all().find(x => x.id === id);
              return { g250: t.graphicEq.bands[2].g, g8: t.graphicEq.bands[7].g, treble: t.treble, hidden: document.getElementById('apsGeqAB').hidden };
            }''',
            created['voz'],
        )
        assert applied['g250'] == -3 and applied['g8'] == 3, applied
        assert applied['treble'] == before['treble']
        assert applied['hidden'] is True

        show_geq(page)
        shot4 = SHOT_DIR / 'aps-eq-grafico-04-aplicado.png'
        page.locator('#apsGeqBox').screenshot(path=str(shot4))
        shots.append(str(shot4))

        page.locator('#apsGeqUndo').click()
        page.wait_for_timeout(150)
        undone = page.evaluate(
            '''(id) => {
              const t = window.APSMixBridge.all().find(x => x.id === id);
              return { bands: t.graphicEq.bands.map(b => b.g), treble: t.treble };
            }''',
            created['voz'],
        )
        assert undone['bands'] == [0, 0, 0, 0, 0, 0, 0, 0], undone
        assert undone['treble'] == before['treble']

        if errors:
            raise SystemExit('pageerror: ' + ' | '.join(errors))

        browser.close()
    httpd.shutdown()
    print('E2E OK')
    print('tracks', created['n'])
    print('shots', '\n'.join(shots))


if __name__ == '__main__':
    try:
        main()
    except Exception as e:
        print('E2E FAIL', type(e).__name__, e)
        sys.exit(1)
