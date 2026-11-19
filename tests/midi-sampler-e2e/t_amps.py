import asyncio, base64, io, wave, json, numpy as np, sys
from playwright.async_api import async_playwright
BASE=sys.argv[1] if len(sys.argv)>1 else 'http://localhost:8765'; TAG=sys.argv[2] if len(sys.argv)>2 else ''
R="async()=>{const b=await APSMidiApp.renderWav();const r=new FileReader();return await new Promise(ok=>{r.onload=()=>ok(r.result.split(',')[1]);r.readAsDataURL(b);});}"
def ld(b64,save=None):
    raw=base64.b64decode(b64)
    if save: open('/workspace/aps-test/'+save,'wb').write(raw)
    w=wave.open(io.BytesIO(raw)); return np.frombuffer(w.readframes(w.getnframes()),'<i2').reshape(-1,w.getnchannels())[:,0]/32768
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(executable_path='/usr/bin/google-chrome',args=['--no-sandbox'])
        ctx=await b.new_context(viewport={'width':1200,'height':1500}); pg=await ctx.new_page(); errs=[]; bad=[]
        pg.on('pageerror',lambda e:errs.append(str(e)[:200])); pg.on('response',lambda r:bad.append((r.status,r.url)) if r.status>=400 and 'favicon' not in r.url else None)
        await pg.goto(BASE+'/midi-sampler.html',wait_until='load'); await pg.wait_for_timeout(2500)
        await pg.evaluate("document.querySelectorAll('details').forEach(d=>d.open=true)")
        await pg.fill('#bpm','100'); await pg.evaluate("n=>{document.getElementById('strength').value=0;APSMidiApp.S.raw=n;APSMidiApp.applyQuant();}",[{'start':.2,'end':.6,'midi':40,'vel':.9},{'start':1,'end':1.4,'midi':43,'vel':.9}])
        await pg.select_option('#inst','gm:electric_bass_finger:pluck'); xo=ld(await pg.evaluate(R))
        print('opções do seletor "Ambiente":',await pg.evaluate("[...document.querySelectorAll('#rv option')].map(o=>o.textContent)"))
        await pg.select_option('#rv','cab'); await pg.wait_for_timeout(500); await pg.evaluate("document.getElementById('wet').value=100")
        print('marcas:',await pg.evaluate("[...document.querySelectorAll('#cabBrand option')].map(o=>o.textContent)"))
        # novos = ids que antes não eram hospedados
        old=set(json.load(open('/workspace/aps-test/ids-antigos.json')))
        for brand in ['Ampeg','Darkglass DG410C','Hartke 45XL','Science Bass Cab','Mesa Powerhouse','Vox T-25','Peavey 115BX']:
            await pg.select_option('#cabBrand',brand); await pg.wait_for_timeout(300)
            n=await pg.evaluate("document.querySelectorAll('#cabIr option').length")
            # escolhe o último IR do último modelo
            mods=await pg.evaluate("[...document.querySelectorAll('#cabModel option')].map(o=>o.value)")
            await pg.select_option('#cabModel',mods[-1]); await pg.wait_for_timeout(300)
            ids=await pg.evaluate("[...document.querySelectorAll('#cabIr option')].map(o=>o.value)"); await pg.select_option('#cabIr',ids[-1]); await pg.wait_for_timeout(1500)
            ok=await pg.evaluate("!!(APSMidiApp.S.bassIR&&APSMidiApp.S.bassIR.id===document.getElementById('cabIr').value)")
            xi=ld(await pg.evaluate(R),'amps-%s%s.wav'%(brand.split()[0].lower(),TAG)); nn=min(len(xo),len(xi)); c=float(np.dot(xo[:nn],xi[:nn])/(np.linalg.norm(xo[:nn])*np.linalg.norm(xi[:nn])))
            print('%-18s modelo "%s" | IR %s (%s) | carregou=%s | corr seco x AmpS=%.3f | %s'%(brand,mods[-1][:30],ids[-1],'NOVO' if ids[-1] not in old else 'já existia',ok,c,(await pg.inner_text('#status'))[:70]))
        await pg.screenshot(path='/workspace/aps-test/amps-sampler%s.png'%TAG,full_page=True)
        print('errs',errs,'http>=400',bad[:5]); await b.close()
asyncio.run(main())
