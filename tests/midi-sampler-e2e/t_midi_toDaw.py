import asyncio
from playwright.async_api import async_playwright
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(executable_path='/usr/bin/google-chrome',args=['--no-sandbox'])
        ctx=await b.new_context(viewport={'width':1300,'height':1400}); pg=await ctx.new_page(); errs=[]; pg.on('pageerror',lambda e:errs.append(str(e)[:200]))
        await pg.goto('http://localhost:8765/midi-sampler.html',wait_until='load')
        await pg.set_input_files('#fAudio','/workspace/aps-test/melodia-humanizada.wav'); await pg.wait_for_timeout(1200)
        await pg.select_option('#kind','mono'); await pg.click('#go'); await pg.wait_for_timeout(3000)
        await pg.select_option('#inst','gm:tango_accordion:sustain')
        try:
            async with ctx.expect_page(timeout=20000) as ev: await pg.click('#toDaw')
            d=await ev.value
        except Exception as e:
            d=pg; print('sem nova aba; navegou?',e.__class__.__name__)
        await d.wait_for_timeout(8000); print('url',d.url)
        print('pistas no Estúdio:',await d.evaluate("window.APSMixBridge&&window.APSMixBridge.all().map(t=>t.name)"))
        print('errs',errs); await b.close()
asyncio.run(main())
