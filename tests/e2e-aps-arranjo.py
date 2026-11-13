"""E2E do APS Arranjo e dos nomes APS Maestro, com o worker mockado."""
import socket
import sys
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from threading import Thread

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
SHOT_DIR = Path('/workspace')
FORBIDDEN = ('Gemini', 'Lyria', 'Mureka', 'OpenAI', 'SynthID')


def free_port():
    s = socket.socket(); s.bind(('127.0.0.1', 0)); p = s.getsockname()[1]; s.close(); return p


def tiny_mp3():
    # Minimal MPEG-1 Layer III frame (silent-ish), repeated.
    frame = bytes.fromhex('fffb9000000000000000000000000000000000000000000000000000000000000000')
    return frame * 40


def visible_leaks(page):
    text = page.inner_text('body')
    return [w for w in FORBIDDEN + ('Google',) if w in text and not (w == 'Google' and 'Drive' in text)]


def attach_mock(page, mp3):
    def handle(route):
        url = route.request.url
        method = route.request.method
        if url.endswith('/saude') or url.rstrip('/').endswith('8788'):
            if method == 'GET' and '/saude' in url or url.endswith(':8788/') or url.endswith(':8788'):
                route.fulfill(status=200, content_type='application/json', body='{"ok":true,"service":"aps-arranjo","notice":"APS Arranjo: áudio gerado por IA. É uma criação nova, não a sua gravação original.","dailyCap":8}')
                return
        if method == 'OPTIONS':
            route.fulfill(status=204, headers={'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type'})
            return
        if '/enviar' in url and method == 'POST':
            route.fulfill(status=200, content_type='application/json', body='{"ok":true,"arquivoId":"file-1","finalidade":"instrumental","notice":"APS Arranjo: áudio gerado por IA. É uma criação nova, não a sua gravação original."}')
            return
        if '/gerar' in url and method == 'POST':
            route.fulfill(status=200, content_type='application/json', body='{"ok":true,"id":"task-1","tipo":"instrumental","status":"preparando","notice":"APS Arranjo: áudio gerado por IA. É uma criação nova, não a sua gravação original."}')
            return
        if '/tarefa/' in url and method == 'GET':
            route.fulfill(status=200, content_type='application/json', body='{"ok":true,"id":"task-1","tipo":"instrumental","status":"pronto","notice":"APS Arranjo: áudio gerado por IA. É uma criação nova, não a sua gravação original.","aviso":"Este áudio foi gerado por IA. Não é a sua gravação original.","resultados":[{"id":"c1","duracaoMs":1000,"url":"http://127.0.0.1:8788/audio?u=https%3A%2F%2Fcdn.example%2Fa.mp3"}]}')
            return
        if '/audio' in url and method == 'GET':
            route.fulfill(status=200, content_type='audio/mpeg', body=mp3)
            return
        route.fulfill(status=404, content_type='application/json', body='{"ok":false,"error":"Caminho não encontrado."}')

    page.route('http://127.0.0.1:8788/**', handle)
    page.route('https://aps-arranjo.aps-audio.workers.dev/**', handle)


def main():
    port = free_port()
    handler = lambda *a, **k: SimpleHTTPRequestHandler(*a, directory=str(ROOT), **k)
    httpd = ThreadingHTTPServer(('127.0.0.1', port), handler)
    Thread(target=httpd.serve_forever, daemon=True).start()
    origin = f'http://127.0.0.1:{port}'
    mp3_path = Path('/tmp/aps-arranjo-fixture.mp3')
    mp3_path.write_bytes(tiny_mp3())
    shots = []
    leaks = []
    with sync_playwright() as p:
        browser = p.chromium.launch(
            channel='chrome',
            args=['--autoplay-policy=no-user-gesture-required'],
        )
        page = browser.new_page(viewport={'width': 1100, 'height': 900})
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        attach_mock(page, mp3_path.read_bytes())

        page.goto(f'{origin}/index.html', wait_until='domcontentloaded')
        page.wait_for_selector('a.tool[href="./arranjo.html"]')
        card = page.locator('a.tool[href="./arranjo.html"]')
        assert 'APS Arranjo' in card.inner_text()
        card.scroll_into_view_if_needed()
        # O card antigo "Criar música com IA" ainda cita o provedor; isso só muda com OK do dono.
        # O card novo do Arranjo não pode citar provedor.
        card_text = card.inner_text()
        for w in FORBIDDEN + ('Google',):
            assert w not in card_text, f'card do Arranjo cita {w}'
        leftover = [x for x in visible_leaks(page) if x not in ('Google', 'Lyria')]
        leaks += [f'index:{x}' for x in leftover]
        shot = SHOT_DIR / 'aps-arranjo-integ-01-index.png'
        page.screenshot(path=str(shot), full_page=True)
        shots.append(shot)

        page.goto(f'{origin}/painel.html', wait_until='domcontentloaded')
        page.wait_for_selector('text=APS Maestro')
        page.wait_for_selector('text=APS Arranjo')
        leaks += [f'painel:{x}' for x in visible_leaks(page)]
        shot = SHOT_DIR / 'aps-arranjo-integ-02-painel.png'
        page.screenshot(path=str(shot), full_page=True)
        shots.append(shot)

        page.goto(f'{origin}/musica-ia.html', wait_until='domcontentloaded')
        page.wait_for_selector('h1')
        assert 'APS Maestro' in page.inner_text('h1')
        assert page.query_selector('a[href="./arranjo.html"]')
        leaks += [f'maestro:{x}' for x in visible_leaks(page)]
        shot = SHOT_DIR / 'aps-arranjo-integ-03-maestro.png'
        page.screenshot(path=str(shot), full_page=True)
        shots.append(shot)

        page.goto(f'{origin}/arranjo.html', wait_until='domcontentloaded')
        page.wait_for_selector('#gerar')
        assert 'APS Arranjo' in page.inner_text('h1')
        assert page.query_selector('a[href="./musica-ia.html"]')
        assert page.query_selector('a[href="./separador.html"]')
        assert page.query_selector('#fidelidade')
        assert page.query_selector('#refDireitos')
        assert page.query_selector('#abrirSeparador')
        assert 'Bem livre' in page.inner_text('body')
        assert 'Parecido com o original' in page.inner_text('body')
        assert page.locator('#fidelidade').input_value() == '3'
        page.set_input_files('#audioFile', str(mp3_path))
        page.wait_for_timeout(400)
        page.fill('#pedido', 'acrescente um baixo suave')
        # Without rights, generation must be blocked
        page.click('#gerar')
        page.wait_for_timeout(400)
        status_sem = page.inner_text('#status')
        assert 'direito' in status_sem.lower()
        shot = SHOT_DIR / 'aps-arranjo-integ-04-direitos.png'
        page.screenshot(path=str(shot), full_page=True)
        shots.append(shot)

        page.locator('#fidelidade').fill('1')
        page.wait_for_timeout(200)
        hint_baixa = page.inner_text('#fidelidadeHint')
        assert 'inspiração' in hint_baixa.lower() or 'inspiracao' in hint_baixa.lower()
        shot = SHOT_DIR / 'aps-arranjo-integ-05-bem-livre.png'
        page.screenshot(path=str(shot), full_page=True)
        shots.append(shot)

        page.locator('#fidelidade').fill('3')
        page.wait_for_timeout(200)
        hint_alta = page.inner_text('#fidelidadeHint')
        assert 'andamento' in hint_alta.lower()
        page.check('#refDireitos')
        shot = SHOT_DIR / 'aps-arranjo-integ-06-parecido.png'
        page.screenshot(path=str(shot), full_page=True)
        shots.append(shot)
        page.click('#gerar')
        page.wait_for_function("() => !document.getElementById('baixar').disabled", timeout=20000)
        status = page.inner_text('#status')
        assert 'áudio novo' in status.lower() or 'gravação original' in status.lower()
        assert page.locator('#abrirSeparador').is_enabled()
        assert page.locator('#abrirDaw').is_enabled()
        assert 'Abrir no Separador' in page.inner_text('#abrirSeparador')
        assert 'Abrir no Estúdio' in page.inner_text('#abrirDaw')
        leaks += [f'arranjo:{x}' for x in visible_leaks(page)]
        shot = SHOT_DIR / 'aps-arranjo-integ-07-resultado.png'
        page.screenshot(path=str(shot), full_page=True)
        shots.append(shot)

        page.goto(f'{origin}/daw.html?modulo=mixagem', wait_until='domcontentloaded')
        page.wait_for_function('() => !!(window.APSMixBridge && window.APSIaComandos)', timeout=20000)
        page.evaluate(
            '''() => {
              const AC = window.AudioContext || window.webkitAudioContext;
              const ctx = new AC();
              const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
              const d = buf.getChannelData(0);
              for (let i = 0; i < d.length; i++) d[i] = Math.sin(2 * Math.PI * 220 * i / ctx.sampleRate) * 0.2;
              window.APSMixBridge.addTrack('Sanfona teste', buf, 'acordeon', 0);
            }'''
        )
        page.wait_for_selector('#apsIaBox', state='attached', timeout=20000)
        page.wait_for_selector('#apsArranjoBox', state='attached', timeout=20000)
        page.evaluate(
            '''() => {
              const reveal = (el) => {
                let n = el;
                while (n && n !== document.body) {
                  n.hidden = false;
                  const st = getComputedStyle(n);
                  if (st.display === 'none') n.style.setProperty('display', n.tagName === 'SPAN' ? 'inline' : 'block', 'important');
                  if (st.visibility === 'hidden') n.style.setProperty('visibility', 'visible', 'important');
                  n = n.parentElement;
                }
              };
              const ia = document.getElementById('apsIaBox');
              const ar = document.getElementById('apsArranjoBox');
              reveal(ia); reveal(ar);
              const host = document.querySelector('.wrap') || document.body;
              if (ar && ar.getBoundingClientRect().height === 0) host.prepend(ar);
              if (ia && ia.getBoundingClientRect().height === 0) host.prepend(ia);
              ia?.scrollIntoView({block:'start'});
            }'''
        )
        page.wait_for_timeout(200)
        assert 'APS Maestro' in page.inner_text('#apsIaBox')
        assert 'APS Arranjo' in page.inner_text('#apsArranjoBox')
        leaks += [f'daw:{x}' for x in visible_leaks(page)]
        page.locator('#apsArranjoBox').scroll_into_view_if_needed()
        shot = SHOT_DIR / 'aps-arranjo-integ-08-daw.png'
        page.screenshot(path=str(shot), full_page=True)
        shots.append(shot)
        page.locator('#apsIaBox').scroll_into_view_if_needed()
        shot = SHOT_DIR / 'aps-arranjo-integ-09-daw-maestro.png'
        page.screenshot(path=str(shot), full_page=True)
        shots.append(shot)
        browser.close()

    if errors:
        print('PAGE_ERRORS', errors)
        return 1
    if leaks:
        print('VISIBLE_LEAKS', leaks)
        return 1
    print('OK shots', [str(s) for s in shots])
    return 0


if __name__ == '__main__':
    sys.exit(main())
