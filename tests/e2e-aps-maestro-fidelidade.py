"""Headless UI: o controle de fidelidade e o aviso de direitos aparecem e reagem."""
import sys
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from threading import Thread

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
PORT = 8776


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
        page.goto(f'http://127.0.0.1:{PORT}/musica-ia.html', wait_until='domcontentloaded')
        page.wait_for_selector('#fidelidade', timeout=15000)
        result['title'] = page.title()
        result['slider'] = page.locator('#fidelidade').is_visible()
        result['default'] = page.locator('#fidelidade').input_value()
        result['hint_alta'] = page.locator('#fidelidadeHint').inner_text()
        result['labels'] = page.locator('.fid-labels').inner_text()
        result['rights'] = page.locator('#refDireitos').count() == 1
        result['notice'] = page.locator('#notice').inner_text()
        result['warn'] = page.locator('.ref-warn').first.inner_text()
        result['script'] = page.locator('script[src*="aps-lyria.js"]').get_attribute('src')

        page.locator('#fidelidade').fill('1')
        result['hint_baixa'] = page.locator('#fidelidadeHint').inner_text()
        page.locator('#fidelidade').fill('2')
        result['hint_media'] = page.locator('#fidelidadeHint').inner_text()
        page.locator('#fidelidade').fill('3')
        result['hint_alta_de_novo'] = page.locator('#fidelidadeHint').inner_text()

        page.locator('#gerar').click()
        page.wait_for_timeout(300)
        result['status_sem_ref'] = page.locator('#status').inner_text()

        # Tiny silent wav so the file input is accepted; generation is not called
        # because rights are unchecked.
        wav = Path('/tmp/aps-fidelidade-e2e.wav')
        wav.write_bytes(_pcm_wav())
        page.set_input_files('#refFile', str(wav))
        page.wait_for_function('() => !document.getElementById("analisarRef").disabled', timeout=10000)
        page.locator('#gerar').click()
        page.wait_for_timeout(400)
        result['status_sem_direitos'] = page.locator('#status').inner_text()
        result['checkbox_checked'] = page.locator('#refDireitos').is_checked()
        result['page_errors'] = errors
        browser.close()
    httpd.shutdown()

    checks = {
        'title': 'Criar música com IA' in result['title'],
        'slider': result['slider'] is True,
        'default_alta': result['default'] == '3',
        'labels': 'Bem livre' in result['labels'] and 'Parecido com o original' in result['labels'],
        'rights': result['rights'] is True,
        'synthid': 'SynthID' in result['notice'],
        'nao_edita': 'não edita' in result['warn'].lower() or 'nao edita' in result['warn'].lower(),
        'script_v': 'v=455' in (result['script'] or ''),
        'hint_alta': 'andamento' in result['hint_alta'].lower() and 'gravação editada' in result['hint_alta'].lower(),
        'hint_baixa': 'inspiração' in result['hint_baixa'].lower() or 'inspiracao' in result['hint_baixa'].lower(),
        'hint_media': 'arranjo' in result['hint_media'].lower(),
        'status_sem_ref': 'ritmo' in result['status_sem_ref'].lower() or 'escreva' in result['status_sem_ref'].lower(),
        'status_sem_direitos': 'direito' in result['status_sem_direitos'].lower(),
        'no_js_errors': result['page_errors'] == [],
    }
    failed = [k for k, ok in checks.items() if not ok]
    print(result)
    print('CHECKS', checks)
    if failed:
        print('FAILED', failed)
        sys.exit(1)
    print('OK')


def _pcm_wav(seconds=2, sample_rate=8000):
    import struct
    n = sample_rate * seconds
    data = b'\x00\x00' * n
    return b''.join([
        b'RIFF',
        struct.pack('<I', 36 + len(data)),
        b'WAVE',
        b'fmt ',
        struct.pack('<IHHIIHH', 16, 1, 1, sample_rate, sample_rate * 2, 2, 16),
        b'data',
        struct.pack('<I', len(data)),
        data,
    ])


if __name__ == '__main__':
    main()
