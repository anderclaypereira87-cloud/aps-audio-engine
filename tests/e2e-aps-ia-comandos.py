"""Teste real: Apply altera parâmetros da DAW e Undo restaura o snapshot."""
import json
import sys
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from threading import Thread

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
PORT = 8765


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
        page = browser.new_page()
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.goto(f'http://127.0.0.1:{PORT}/daw.html?modulo=mixagem', wait_until='domcontentloaded')
        page.wait_for_function('() => !!(window.APSMixBridge && window.APSIaComandos)', timeout=20000)
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
              const a = mk('Sanfona teste', 'acordeon');
              const b = mk('Guitarra teste', 'guitar');
              return {a, b, n: window.APSMixBridge.list().length};
            }'''
        )
        page.wait_for_function('() => !!document.getElementById("apsIaBox")', timeout=20000)
        before = page.evaluate(
            '''([a, b]) => {
              const tracks = window.APSMixBridge.all();
              const ta = tracks.find(t => t.id === a);
              const tb = tracks.find(t => t.id === b);
              return {
                gain: ta.gain, bass: ta.bass, pan: tb.pan, reverb: ta.reverb,
                masterGain: Number(document.getElementById('masterGain').value)
              };
            }''',
            [created['a'], created['b']],
        )
        applied = page.evaluate(
            '''([a, b]) => {
              window.APSIaComandos.applyResult({
                summary: 'teste',
                actions: [
                  {target_type:'track', target_id:a, processor:'volume', param:'gain', value:133},
                  {target_type:'track', target_id:a, processor:'eq', param:'bass', value:7},
                  {target_type:'track', target_id:a, processor:'reverb', param:'reverb', value:22},
                  {target_type:'track', target_id:b, processor:'pan', param:'pan', value:-42},
                  {target_type:'master', target_id:'master', processor:'master', param:'masterGain', value:70}
                ],
                cannot: []
              });
              const tracks = window.APSMixBridge.all();
              const ta = tracks.find(t => t.id === a);
              const tb = tracks.find(t => t.id === b);
              return {
                gain: ta.gain, bass: ta.bass, pan: tb.pan, reverb: ta.reverb,
                masterGain: Number(document.getElementById('masterGain').value)
              };
            }''',
            [created['a'], created['b']],
        )
        undone = page.evaluate(
            '''([a, b]) => {
              window.APSIaComandos.undo();
              const tracks = window.APSMixBridge.all();
              const ta = tracks.find(t => t.id === a);
              const tb = tracks.find(t => t.id === b);
              return {
                gain: ta.gain, bass: ta.bass, pan: tb.pan, reverb: ta.reverb,
                masterGain: Number(document.getElementById('masterGain').value)
              };
            }''',
            [created['a'], created['b']],
        )
        result = {
            'created': created,
            'before': before,
            'after_apply': applied,
            'after_undo': undone,
            'ui': page.evaluate('() => !!document.getElementById("apsIaInput")'),
            'errors': errors,
        }
        browser.close()
    httpd.shutdown()
    print(json.dumps(result, ensure_ascii=False, indent=2))
    ok = (
        created['n'] >= 2
        and applied['gain'] == 133
        and applied['bass'] == 7
        and applied['pan'] == -42
        and applied['reverb'] == 22
        and applied['masterGain'] == 70
        and undone['gain'] == before['gain']
        and undone['bass'] == before['bass']
        and undone['pan'] == before['pan']
        and undone['reverb'] == before['reverb']
        and undone['masterGain'] == before['masterGain']
        and result['ui']
        and not result['errors']
    )
    print('E2E OK' if ok else 'E2E FALHOU')
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
