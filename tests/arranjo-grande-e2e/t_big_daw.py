import asyncio,subprocess
from playwright.async_api import async_playwright
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(executable_path='/usr/bin/google-chrome',args=['--no-sandbox'])
        ctx=await b.new_context(accept_downloads=True); pg=await ctx.new_page(); errs=[]; pg.on('pageerror',lambda e:errs.append(str(e)[:200]))
        pg.on('pageerror',lambda e:errs.append(str(e)[:200]))
        pg=await ctx.new_page(); up={}
        up={}
        await pg.add_init_script("const _f=window.fetch;window.__up=null;window.fetch=function(u,o){try{if(String(u).endsWith('/enviar')&&o&&o.body instanceof FormData){const f=o.body.get('file');window.__up={name:f.name,type:f.type,size:f.size};}}catch(e){}return _f.apply(this,arguments)}")
        async def h1(route,req): await route.fulfill(status=200,content_type='application/json',headers={'access-control-allow-origin':'*'},body='{"ok":true,"arquivoId":"teste"}')
        async def h2(route,req): await route.fulfill(status=200,content_type='application/json',headers={'access-control-allow-origin':'*'},body='{"ok":false,"error":"mock"}')
        await pg.route('**/enviar',h1); await pg.route('**/gerar',h2)
        errs=[]; pg.on('pageerror',lambda e:errs.append(str(e)[:200]))
        await pg.goto('http://localhost:8765/daw.html?modulo=gravacao',wait_until='load'); await pg.wait_for_timeout(3000)
        await pg.set_input_files('#file','/workspace/aps-test/grande/prog-9min.mp3'); await pg.wait_for_timeout(12000)
        print('pistas:',await pg.evaluate("APSMixBridge.all().map(t=>[t.name,Math.round(APSMixBridge.buffer(t.id).duration)])"))
        await pg.evaluate("document.getElementById('apsArranjoDireitos').click()"); await pg.evaluate("document.getElementById('apsArranjoPedido').value='teste'")
        await pg.evaluate("document.getElementById('apsArranjoGo').click()")
        for i in range(90):
            await pg.wait_for_timeout(1000); m=await pg.evaluate("document.getElementById('apsArranjoMsg').textContent")
            if 'mock' in m: break
        print('DAW IA msg:',m[:300]); print('enviado:',await pg.evaluate('window.__up'))
        await pg.evaluate("document.getElementById('apsArranjoAc').click()")
        for i in range(60):
            await pg.wait_for_timeout(1000); m=await pg.evaluate("document.getElementById('apsArranjoMsg').textContent")
            if m.startswith(('Pista nova','Não','Selecione')): break
        print('DAW acordes:',m[:200].replace('\n',' | ')); print('pistas:',await pg.evaluate("APSMixBridge.all().map(t=>[t.name.slice(0,40),Math.round(APSMixBridge.buffer(t.id).duration)])")); print('errs',errs); await b.close()
asyncio.run(main())
