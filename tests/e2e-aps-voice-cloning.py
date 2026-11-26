"""E2E do APS Voz Studio (voice-singer.html) contra o código REAL do Worker rodando localmente
(tests/voice-cloning-mock-server.mjs: KV/R2 em memória e provedores mockados — zero gasto).
Rodar: python3 tests/e2e-aps-voice-cloning.py
Salva /workspace/aps-voice-01.png, -02.png, -03.png e tests/e2e-aps-voice-cloning-report.json"""
import json, math, socket, struct, subprocess, sys, tempfile, time
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from threading import Thread
from urllib.request import urlopen
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
TMP = Path(tempfile.mkdtemp(prefix='aps-voz-'))
results = []

def free_port():
    s = socket.socket(); s.bind(('127.0.0.1', 0)); p = s.getsockname()[1]; s.close(); return p

class Quiet(SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=str(ROOT), **k)
    def log_message(self, *a): pass

def voice_wav(path, seconds, f0=220, rate=44100):
    n = int(seconds * rate); frames = bytearray()
    for i in range(n):
        t = i / rate; f = f0 * (1 + 0.02 * math.sin(2 * math.pi * 5 * t))
        env = 0.6 + 0.4 * math.sin(2 * math.pi * 0.5 * t) ** 2
        x = env * (0.5 * math.sin(2 * math.pi * f * t) + 0.2 * math.sin(4 * math.pi * f * t) + 0.1 * math.sin(6 * math.pi * f * t))
        frames += struct.pack('<h', int(max(-1, min(1, x)) * 30000))
    hdr = b'RIFF' + struct.pack('<I', 36 + len(frames)) + b'WAVEfmt ' + struct.pack('<IHHIIHH', 16, 1, 1, rate, rate * 2, 2, 16) + b'data' + struct.pack('<I', len(frames))
    Path(path).write_bytes(hdr + frames); return str(path)

def check(name, cond, detail=''):
    results.append({'teste': name, 'ok': bool(cond), 'detalhe': detail}); print(('✔ ' if cond else '✖ ') + name + (' — ' + str(detail) if detail else ''))

def start_mock(port, *extra):
    p = subprocess.Popen(['node', str(ROOT / 'tests/voice-cloning-mock-server.mjs'), str(port), *extra], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    for _ in range(50):
        try: urlopen(f'http://127.0.0.1:{port}/api/health', timeout=0.5); return p
        except Exception as e:
            if hasattr(e, 'code'): return p
            time.sleep(0.1)
    raise RuntimeError('mock worker não subiu')

def main():
    sample = voice_wav(TMP / 'minha-voz.wav', 32)
    short = voice_wav(TMP / 'curta.wav', 5)
    guide = voice_wav(TMP / 'guia.wav', 4, f0=330)
    web = free_port(); srv = ThreadingHTTPServer(('127.0.0.1', web), Quiet); Thread(target=srv.serve_forever, daemon=True).start()
    api, api_auth = free_port(), free_port()
    site = f'http://127.0.0.1:{web}'
    mock, mock_auth = start_mock(api, 'ok', site), start_mock(api_auth, 'auth', site)
    page_url = f'http://127.0.0.1:{web}/voice-singer.html?api=http://127.0.0.1:{api}'
    try:
        with sync_playwright() as pw:
            b = pw.chromium.launch(channel='chrome', args=['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'])
            # ---------- celular ----------
            ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True, accept_downloads=True)
            pg = ctx.new_page(); errors = []
            pg.on('pageerror', lambda e: errors.append(str(e)))
            pg.on('dialog', lambda d: d.accept())
            pg.goto(page_url)
            expect(pg.locator('#connPill')).to_have_text('Conectado', timeout=10000)
            check('carrega e conecta ao worker (/api/health)', True, pg.locator('#engineChips').inner_text().replace('\n', ' | '))
            body = pg.locator('body').inner_text()
            check('UI sem nomes de provedores externos', not any(w in body.lower() for w in ['replicate', 'kits', 'rvc']))
            html = (ROOT / 'voice-singer.html').read_text(encoding='utf-8').lower()
            check('código da página sem nomes de provedores', not any(w in html for w in ['replicate', 'kits.ai', 'rvc']))
            pg.screenshot(path='/workspace/aps-voice-01.png', full_page=False)

            # amostra curta → aviso
            pg.set_input_files('#sampleFile', short)
            expect(pg.locator('#sampleInfo')).to_contain_text('Curto demais', timeout=10000)
            check('valida amostra curta demais (< 20 s)', True)
            pg.set_input_files('#sampleFile', sample)
            expect(pg.locator('#sampleInfo')).to_contain_text('0:32', timeout=10000)
            check('envio de amostra com player e checagem de duração', pg.locator('#samplePlayer').is_visible(), pg.locator('#sampleInfo').inner_text())

            # criar voz sem consentimento → bloqueia
            pg.fill('#voiceName', 'Minha Voz Teste')
            pg.click('#createBtn')
            expect(pg.locator('#createStatus')).to_contain_text('confirmação', timeout=5000)
            check('exige consentimento antes de criar voz', True)
            pg.check('#consent')
            pg.click('#createBtn')
            expect(pg.locator('#createStatus')).to_contain_text('Treino iniciado', timeout=20000)
            expect(pg.locator('#voiceList')).to_contain_text('Treinando', timeout=5000)
            check('criação de voz (Motor Treino) inicia treino e mostra status', True)
            expect(pg.locator('#voiceList')).to_contain_text('Pronta', timeout=30000)
            check('polling de status: voz fica Pronta', True, pg.locator('#createStatus').inner_text())

            # voz pelo Motor Rápido
            pg.select_option('#createMode', 'rapido')
            expect(pg.locator('#rapidoModel')).to_contain_text('Voz Demo Rápida')
            pg.fill('#voiceName', 'Voz Rápida')
            pg.click('#createBtn')
            expect(pg.locator('#createStatus')).to_contain_text('pronta para converter', timeout=10000)
            check('voz pelo Motor Rápido registrada', pg.locator('#voiceList li').count() == 2)

            # conversão
            pg.select_option('#voiceSelect', label='Minha Voz Teste')
            pg.set_input_files('#guideFile', guide)
            expect(pg.locator('#convertStatus')).to_contain_text('Guia pronta', timeout=10000)
            pg.locator('#pitch').fill('3'); pg.locator('#pitch').dispatch_event('input')
            check('transposição em semitons', pg.locator('#pitchOut').inner_text() == '+3 semitons', pg.locator('#pitchOut').inner_text())
            pg.select_option('#engineSelect', 'treino')
            pg.click('#convertBtn')
            expect(pg.locator('#resultBox')).to_be_visible(timeout=40000)
            check('conversão concluída e resultado exibido', True, pg.locator('#convertStatus').inner_text())
            check('aviso de voz gerada por IA no resultado', 'gerada por IA' in pg.locator('#aiBadge').inner_text())

            # A/B
            pg.click('#abOriginal')
            a_on = pg.get_attribute('#abOriginal', 'aria-pressed') == 'true' and pg.get_attribute('#abClone', 'aria-pressed') == 'false'
            src_ok = pg.evaluate("() => !!document.getElementById('origAudio').src && !!document.getElementById('cloneAudio').src")
            pg.click('#abClone')
            check('A/B original vs voz clonada', a_on and src_ok and pg.get_attribute('#abClone', 'aria-pressed') == 'true')
            pg.click('#playBtn'); pg.wait_for_timeout(400)
            t = pg.evaluate("() => document.getElementById('cloneAudio').currentTime")
            pg.click('#abOriginal'); pg.wait_for_timeout(200)
            t2 = pg.evaluate("() => document.getElementById('origAudio').currentTime")
            check('A/B mantém a posição ao trocar', t2 >= t * 0.8, f'clone={t:.2f}s original={t2:.2f}s')
            pg.click('#playBtn')
            pg.screenshot(path='/workspace/aps-voice-02.png', full_page=False)
            pg.locator('#resultPanel').screenshot(path='/workspace/aps-voice-02-resultado.png')

            # download WAV
            with pg.expect_download() as d:
                pg.click('#dlWav')
            dl = d.value; p = TMP / dl.suggested_filename; dl.save_as(p)
            head = p.read_bytes()[:12]
            check('baixar WAV', dl.suggested_filename.endswith('.wav') and head[:4] == b'RIFF' and head[8:12] == b'WAVE', dl.suggested_filename)

            # desfazer
            pg.click('#undoBtn')
            expect(pg.locator('#resultBox')).to_be_hidden()
            check('Desfazer preserva o original e remove o resultado', 'original continua intacto' in pg.locator('#resultEmpty').inner_text())

            # reabrir pelo histórico e enviar ao Estúdio
            pg.locator('#jobList').evaluate('el => el.closest("details").open = true')
            pg.locator('#jobList button', has_text='Abrir').first.click()
            expect(pg.locator('#resultBox')).to_be_visible(timeout=10000)
            pg.click('#toDaw')
            pg.wait_for_url('**/daw.html?modulo=gravacao&importStems=1*', timeout=15000)
            stems = pg.evaluate("""() => new Promise((res) => { const r = indexedDB.open('aps-stems-transfer-v1', 1);
                r.onsuccess = () => { const tx = r.result.transaction('sessions', 'readonly'); const q = tx.objectStore('sessions').get('latest');
                q.onsuccess = () => res(q.result ? { name: q.result.name, stems: q.result.stems.map(s => ({ id: s.id, name: s.name, size: s.blob.size })) } : null); }; })""")
            check('Abrir no Estúdio (DAW) via handoff aps-stems-transfer-v1', bool(stems) and len(stems['stems']) == 2 and stems['stems'][0]['id'] == 'vocals' and 'IA' in stems['name'], json.dumps(stems, ensure_ascii=False))
            check('sem erros de JavaScript na página', not [e for e in errors], errors[:3])

            # erro de saldo
            urlopen(f'http://127.0.0.1:{api}/__mock/mode?m=saldo').read()
            pg.goto(page_url); pg.on('dialog', lambda d: None)
            expect(pg.locator('#connPill')).to_have_text('Conectado', timeout=10000)
            pg.select_option('#voiceSelect', label='Minha Voz Teste')
            pg.set_input_files('#guideFile', guide)
            expect(pg.locator('#convertStatus')).to_contain_text('Guia pronta', timeout=10000)
            pg.click('#convertBtn')
            expect(pg.locator('#convertStatus')).to_contain_text('Sem saldo', timeout=15000)
            check('erro de saldo mostrado em português sem nome do provedor', 'replicate' not in pg.locator('#convertStatus').inner_text().lower(), pg.locator('#convertStatus').inner_text())
            log = json.loads(urlopen(f'http://127.0.0.1:{api}/__mock/log').read())
            meth = json.loads(urlopen(f'http://127.0.0.1:{api}/__mock/methods').read())
            check('sem preflight CORS (todas as chamadas são requisições simples)', not any(m.startswith('OPTIONS') for m in meth), f'{len(meth)} requisições, 0 OPTIONS')
            check('nenhuma chamada real: só provedores mockados', all(('api.replicate.com' in x or 'arpeggi.io' in x or 'mock.delivery' in x) for x in log), f'{len(log)} chamadas mockadas')
            ctx.close()

            # ---------- Cloudflare Access: sem login ----------
            ctx2 = b.new_context(viewport={'width': 1280, 'height': 860})
            pg2 = ctx2.new_page()
            pg2.goto(f'http://127.0.0.1:{web}/voice-singer.html?api=http://127.0.0.1:{api_auth}')
            expect(pg2.locator('#connPill')).to_have_text('Precisa entrar', timeout=10000)
            check('Access sem login: mostra “Entrar com segurança”', pg2.locator('#loginBtn').is_visible(), pg2.locator('#connMsg').inner_text())
            pg2.screenshot(path='/workspace/aps-voice-03.png', full_page=False)
            pg2.route(f'http://127.0.0.1:{api_auth}/', lambda r: r.fulfill(status=200, body='login-mock'))
            pg2.click('#loginBtn'); pg2.wait_for_url(f'http://127.0.0.1:{api_auth}/', timeout=5000)
            check('botão de login abre o estúdio no endereço seguro (Access)', pg2.url == f'http://127.0.0.1:{api_auth}/')
            # redirecionamento 302 do Access (opaqueredirect) também é tratado
            pg2.goto(f'http://127.0.0.1:{web}/voice-singer.html?api=http://127.0.0.1:{api}')
            pg2.route(f'http://127.0.0.1:{api}/api/health**', lambda r: r.fulfill(status=302, headers={'location': 'https://mock.cloudflareaccess.com/cdn-cgi/access/login', 'access-control-allow-origin': f'http://127.0.0.1:{web}', 'access-control-allow-credentials': 'true'}))
            pg2.click('#testBtn')
            expect(pg2.locator('#connPill')).to_have_text('Precisa entrar', timeout=10000)
            check('Access 302 (redirecionamento) tratado com pedido de login', True)
            # desktop limpo conectado
            pg2.unroute(f'http://127.0.0.1:{api}/api/health**')
            pg2.click('#testBtn')
            expect(pg2.locator('#connPill')).to_have_text('Conectado', timeout=10000)
            pg2.screenshot(path='/workspace/aps-voice-04-desktop.png', full_page=True)
            ctx2.close()

            # ---------- estúdio servido pelo próprio servidor seguro (modo publicado, celular) ----------
            urlopen(f'http://127.0.0.1:{api}/__mock/mode?m=ok').read()
            ctx3 = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
            pg3 = ctx3.new_page(); err3 = []
            pg3.on('pageerror', lambda e: err3.append(str(e))); pg3.on('dialog', lambda d: d.accept())
            # no ar, o site já confia no servidor padrão; no teste, registra o servidor local no site (via ?api=)
            pg3.goto(f'{site}/voice-singer.html?api=http://127.0.0.1:{api}')
            pg3.goto(f'http://127.0.0.1:{api}/')
            expect(pg3.locator('#connPill')).to_have_text('Conectado', timeout=10000)
            check('estúdio no servidor seguro (mesma origem) conecta', pg3.evaluate('() => window.APSVoz.api') == f'http://127.0.0.1:{api}')
            check('links do estúdio apontam para o site APS', pg3.evaluate("() => document.querySelector('nav a[href=\"./daw.html\"]').href") == site + '/daw.html')
            pg3.select_option('#voiceSelect', label='Minha Voz Teste')
            pg3.set_input_files('#guideFile', guide)
            expect(pg3.locator('#convertStatus')).to_contain_text('Guia pronta', timeout=10000)
            pg3.click('#convertBtn')
            expect(pg3.locator('#resultBox')).to_be_visible(timeout=40000)
            check('conversão no servidor seguro', True)
            pg3.screenshot(path='/workspace/aps-voice-05-servidor-seguro.png')
            with ctx3.expect_page() as newp:
                pg3.click('#toDaw')
            daw = newp.value
            daw.wait_for_url('**/daw.html?modulo=gravacao&importStems=1*', timeout=20000)
            expect(pg3.locator('#resultStatus')).to_contain_text('Enviado ao Estúdio', timeout=10000)
            st = daw.evaluate("""() => new Promise((res) => { const r = indexedDB.open('aps-stems-transfer-v1', 1);
                r.onsuccess = () => { const q = r.result.transaction('sessions', 'readonly').objectStore('sessions').get('latest');
                q.onsuccess = () => res(q.result ? q.result.stems.map(s => s.id + ':' + s.blob.size) : null); }; })""")
            check('Abrir no Estúdio a partir do servidor seguro (postMessage → DAW do site)', bool(st) and len(st) == 2 and st[0].startswith('vocals:'), st)
            check('sem erros de JavaScript no servidor seguro', not err3, err3[:3])
            ctx3.close(); b.close()
    finally:
        mock.terminate(); mock_auth.terminate(); srv.shutdown()
    ok = all(r['ok'] for r in results)
    (ROOT / 'tests/e2e-aps-voice-cloning-report.json').write_text(json.dumps({'ok': ok, 'total': len(results), 'passaram': sum(r['ok'] for r in results), 'resultados': results}, ensure_ascii=False, indent=1))
    print(f"\n{sum(r['ok'] for r in results)}/{len(results)} verificações OK")
    sys.exit(0 if ok else 1)

if __name__ == '__main__':
    main()
