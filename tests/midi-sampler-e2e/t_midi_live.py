import asyncio, json, numpy as np
from playwright.async_api import async_playwright
truth=json.load(open('/workspace/aps-test/melodia-truth.json'))['truth']
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(executable_path='/usr/bin/google-chrome',args=['--no-sandbox','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream','--use-file-for-fake-audio-capture=/workspace/aps-test/melodia-humanizada.wav','--autoplay-policy=no-user-gesture-required'])
        ctx=await b.new_context(permissions=['microphone'],viewport={'width':1200,'height':1500}); pg=await ctx.new_page(); errs=[]; pg.on('pageerror',lambda e:errs.append(str(e)[:300]))
        await pg.goto('http://localhost:8765/midi-sampler.html',wait_until='load')
        await pg.fill('#bpm','100'); await pg.select_option('#grid','1/8'); await pg.evaluate("document.getElementById('strength').value=100")
        await pg.click('#rec'); 
        await pg.wait_for_timeout(3500)
        print('aos 3,5 s de gravação, notas já lidas ao vivo:',await pg.evaluate("(APSMidiApp.S.raw||[]).length"), '| status:',(await pg.inner_text('#status'))[:90])
        await pg.screenshot(path='/workspace/aps-test/midi-live-gravando.png',full_page=True)
        await pg.wait_for_timeout(3600)
        await pg.click('#recStop'); await pg.wait_for_timeout(1500)
        print('status final:',await pg.inner_text('#status'))
        raw=await pg.evaluate("APSMidiApp.S.raw.map(n=>[n.midi,n.start,n.end,n.vel])")
        print('notas:',len(raw),'esperadas',len(truth))
        tm=[t['midi'] for t in truth]; got=[r[0] for r in raw]
        # alinhar por sequência: 1ª repetição
        hits=sum(1 for g,t in zip(got,tm) if g==t); print('sequência de alturas igual à tocada: %d/%d'%(hits,len(tm)))
        off=[r[1]-t['played'] for r,t in zip(raw,truth)]; print('deslocamento (latência+início do arquivo): mediana %.0f ms, variação (desvio padrão) %.0f ms'%(1000*np.median(off),1000*np.std(off)))
        print('alturas lidas:',got[:20])
        await pg.screenshot(path='/workspace/aps-test/midi-live-final.png',full_page=True)
        print('errs',errs); await b.close()
asyncio.run(main())
