"""Headless e2e: estilos mundiais na DAW e no seletor da Música com IA."""
import json
import sys
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from threading import Thread

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
SHOTS = Path('/workspace')
PORT = 8766


def main():
    handler = lambda *a, **k: SimpleHTTPRequestHandler(*a, directory=str(ROOT), **k)
    httpd = ThreadingHTTPServer(('127.0.0.1', PORT), handler)
    Thread(target=httpd.serve_forever, daemon=True).start()
    result = {}
    with sync_playwright() as p:
        browser = p.chromium.launch(
            channel='chrome',
            args=['--autoplay-policy=no-user-gesture-required'],
        )
        page = browser.new_page(viewport={'width': 1280, 'height': 1600})
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.goto(f'http://127.0.0.1:{PORT}/daw.html?modulo=mixagem', wait_until='domcontentloaded')
        page.wait_for_function('() => !!(window.APSMixBridge && window.APSEstilos)', timeout=20000)
        created = page.evaluate(
            '''() => {
              const AC = window.AudioContext || window.webkitAudioContext;
              const ctx = new AC();
              const mk = (name, type) => {
                const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
                const d = buf.getChannelData(0);
                for (let i = 0; i < d.length; i++) d[i] = Math.sin(2 * Math.PI * 220 * i / ctx.sampleRate) * 0.2;
                return window.APSMixBridge.addTrack(name, buf, type, 0);
              };
              return {
                guitar: mk('Guitarra fusion', 'guitar'),
                keys: mk('Rhodes', 'piano'),
                bass: mk('Baixo', 'bass'),
                drums: mk('Bateria', 'drums'),
                n: window.APSMixBridge.list().length
              };
            }'''
        )
        page.wait_for_function('() => !!document.getElementById("apsEstilos")', timeout=20000)
        page.locator('.pro-tabs [data-tab="ia"]').click()
        page.wait_for_function(
            '() => { const el = document.getElementById("apsEstilos"); if (!el) return false; const r = el.getBoundingClientRect(); return r.width > 80 && r.height > 80; }',
            timeout=10000,
        )
        ui = page.evaluate(
            '''() => {
              const box = document.getElementById('apsEstilos');
              const groups = [...box.querySelectorAll('.aps-est-group')].map(g => ({
                id: g.dataset.group,
                label: g.querySelector('h4')?.textContent,
                n: g.querySelectorAll('[data-est]').length
              }));
              return {
                title: box.querySelector('h3')?.textContent,
                groups,
                buttons: box.querySelectorAll('[data-est]').length,
                hasJazzFusion: !!box.querySelector('[data-est="jazz-fusion"]'),
                hasFunkBr: !!box.querySelector('[data-est="funk-br"]'),
                hasRnB: !!box.querySelector('[data-est="rnb"]'),
                genreOptions: [...document.querySelectorAll('#apsAIGenre option')].map(o => o.value)
              };
            }'''
        )
        page.locator('#apsEstilos').scroll_into_view_if_needed()
        page.screenshot(path=str(SHOTS / 'aps-estilos-mundiais-01-daw-grupos.png'), full_page=False)
        page.locator('[data-est="jazz-fusion"]').click()
        page.wait_for_function(
            '() => (document.getElementById("apsEstMsg")?.textContent || "").includes("Jazz fusion")',
            timeout=10000,
        )
        after = page.evaluate(
            '''(ids) => {
              const all = window.APSMixBridge.all();
              const pick = (id) => {
                const t = all.find(x => x.id === id);
                return { gain: t.gain, mid: t.mid, drive: t.drive, reverb: t.reverb, delay: t.delay, pan: t.pan, comp: !!t.comp };
              };
              return {
                guitar: pick(ids.guitar),
                keys: pick(ids.keys),
                bass: pick(ids.bass),
                drums: pick(ids.drums),
                msg: document.getElementById('apsEstMsg')?.textContent,
                on: document.querySelector('[data-est="jazz-fusion"]')?.classList.contains('on')
              };
            }''',
            created,
        )
        page.locator('#apsEstilos [data-group="black"]').scroll_into_view_if_needed()
        page.screenshot(path=str(SHOTS / 'aps-estilos-mundiais-02-daw-jazz-fusion.png'), full_page=False)

        page2 = browser.new_page(viewport={'width': 520, 'height': 1100})
        page2.on('pageerror', lambda e: errors.append('musica-ia: ' + str(e)))
        page2.goto(f'http://127.0.0.1:{PORT}/musica-ia.html', wait_until='domcontentloaded')
        page2.wait_for_function(
            '() => document.querySelectorAll("#estilo option").length > 10',
            timeout=20000,
        )
        musica = page2.evaluate(
            '''() => {
              const sel = document.getElementById('estilo');
              const groups = [...sel.querySelectorAll('optgroup')].map(g => ({
                label: g.label,
                options: [...g.querySelectorAll('option')].map(o => ({ value: o.value, label: o.textContent }))
              }));
              const values = [...sel.options].map(o => o.value);
              sel.value = 'jazz fusion';
              return {
                first: values[0],
                n: values.length,
                groups: groups.map(g => ({ label: g.label, n: g.options.length })),
                hasJazzFusion: values.includes('jazz fusion'),
                hasFunkBr: values.includes('funk brasileiro'),
                hasRnB: values.includes('r&b'),
                hasForro: values.includes('forró'),
                selected: sel.value
              };
            }'''
        )
        page2.locator('#estilo').scroll_into_view_if_needed()
        page2.screenshot(path=str(SHOTS / 'aps-estilos-mundiais-03-musica-ia.png'))
        browser.close()

    result = {
        'tracks': created,
        'ui': ui,
        'after': after,
        'musica': musica,
        'errors': errors,
        'shots': [
            str(SHOTS / 'aps-estilos-mundiais-01-daw-grupos.png'),
            str(SHOTS / 'aps-estilos-mundiais-02-daw-jazz-fusion.png'),
            str(SHOTS / 'aps-estilos-mundiais-03-musica-ia.png'),
        ],
    }
    print(json.dumps(result, ensure_ascii=False, indent=2))
    ok = (
        not errors
        and ui.get('buttons') == 46
        and ui.get('hasJazzFusion')
        and ui.get('hasFunkBr')
        and ui.get('hasRnB')
        and after.get('on')
        and after['guitar']['drive'] >= 10
        and after['guitar']['mid'] >= 3
        and musica.get('hasJazzFusion')
        and musica.get('hasFunkBr')
        and musica.get('hasRnB')
        and musica.get('first') == 'livre'
        and musica.get('selected') == 'jazz fusion'
    )
    httpd.shutdown()
    if not ok:
        print('E2E FALHOU', file=sys.stderr)
        sys.exit(1)
    print('E2E OK')


if __name__ == '__main__':
    main()
