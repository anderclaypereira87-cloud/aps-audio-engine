import asyncio, sys, json
from playwright.async_api import async_playwright
BASE=sys.argv[1] if len(sys.argv)>1 else 'http://localhost:8765'
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(executable_path='/usr/bin/google-chrome',args=['--no-sandbox'])
        pg=await b.new_page(viewport={'width':1300,'height':1500}); errs=[]; bad=[]
        pg.on('pageerror',lambda e:errs.append(str(e)[:200])); pg.on('response',lambda r:bad.append((r.status,r.url)) if r.status>=400 and 'favicon' not in r.url else None)
        await pg.goto(BASE+'/daw.html?modulo=baixo',wait_until='load'); await pg.wait_for_timeout(5000)
        await pg.click('#proIR'); await pg.wait_for_timeout(1500)
        await pg.screenshot(path='/workspace/aps-test/amps-daw-lista.png')
        print('contagem:',await pg.inner_text('#apsIrCount')); print('pill:',await pg.evaluate("document.querySelector('.pill')&&document.querySelector('.pill').textContent"))
        print('aba:',await pg.evaluate("document.querySelector('[data-aps-tab=baixo]').textContent"))
        old=set(json.load(open('/workspace/aps-test/ids-antigos.json')))
        picks=await pg.evaluate("(()=>{const o=%s;const by={};for(const x of window.APS_BASS_IRS){if(!o.includes(x.id)&&x.builtin)(by[x.brand]=by[x.brand]||[]).push(x);}return Object.values(by).map(a=>a[a.length-1]);})()"%json.dumps(list(old)))
        print('testando',len(picks),'marcas (IRs novos)')
        for x in picks[:8]:
            await pg.fill('#apsIrSearch',x['name']); await pg.wait_for_timeout(500)
            n=await pg.evaluate("document.querySelectorAll('#apsIrList .aps-ir-choice').length")
            await pg.evaluate("n=>{for(const b of document.querySelectorAll('#apsIrList .aps-ir-choice')){if(b.querySelector('.aps-ir-title').textContent.endsWith(n)){b.click();return;}}document.querySelector('#apsIrList .aps-ir-choice').click();}",x['name'])
            await pg.wait_for_timeout(1800)
            st=await pg.inner_text('#apsIrStatus')
            print('%-26s %-14s resultados=%d | %s'%(x['brand'],x['id'],n,st[:110]))
        await pg.screenshot(path='/workspace/aps-test/amps-daw.png',full_page=False)
        print('errs',errs[:3],'http>=400',bad[:5]); await b.close()
asyncio.run(main())
