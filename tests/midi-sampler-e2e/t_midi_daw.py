import asyncio
from playwright.async_api import async_playwright
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(executable_path='/usr/bin/google-chrome',args=['--no-sandbox'])
        ctx=await b.new_context(viewport={'width':1300,'height':1400}); pg=await ctx.new_page(); errs=[]; pg.on('pageerror',lambda e:errs.append(str(e)[:200]))
        await pg.goto('http://localhost:8765/daw.html?modulo=gravacao',wait_until='load'); await pg.wait_for_timeout(3000)
        await pg.set_input_files('#file','/workspace/aps-test/melodia-humanizada.wav'); await pg.wait_for_timeout(3500)
        print('pistas:',await pg.evaluate("window.APSMixBridge.all().map(t=>t.name)"),'| botão presente:',await pg.evaluate("!!document.getElementById('apsMidiGo')"))
        await pg.evaluate("document.getElementById('apsMidiKind').value='mono'")
        async with ctx.expect_page() as ev:
            await pg.evaluate("document.getElementById('apsMidiGo').click()")
        np_=await ev.value; np_.on('pageerror',lambda e:errs.append(str(e)[:200]))
        await np_.wait_for_load_state('load')
        for i in range(40):
            await np_.wait_for_timeout(1000)
            st=await np_.inner_text('#status')
            if st.startswith('✅'): break
        print('DAW msg:',await pg.evaluate("document.getElementById('apsMidiMsg').textContent")[:80] if False else (await pg.inner_text('#apsMidiMsg'))[:100])
        print('Sampler:',st[:80],'| notas',await np_.evaluate("APSMidiApp.S.raw.length"),'| url',np_.url)
        await np_.screenshot(path='/workspace/aps-test/midi-daw-handoff.png',full_page=True)
        await pg.screenshot(path='/workspace/aps-test/midi-daw-painel.png',full_page=False)
        # volta ao Estúdio
        await np_.select_option('#inst','gm:tango_accordion:sustain')
        print('errs',errs); await b.close()
asyncio.run(main())
