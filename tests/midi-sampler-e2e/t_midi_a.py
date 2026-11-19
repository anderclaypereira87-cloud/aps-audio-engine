import asyncio, json
from playwright.async_api import async_playwright
truth=json.load(open('/workspace/aps-test/melodia-truth.json'))
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(executable_path='/usr/bin/google-chrome',args=['--no-sandbox'])
        pg=await b.new_page(viewport={'width':1200,'height':1500}); errs=[]; pg.on('pageerror',lambda e:errs.append(str(e)[:300]))
        await pg.goto('http://localhost:8765/midi-sampler.html',wait_until='load')
        await pg.set_input_files('#fAudio','/workspace/aps-test/melodia-humanizada.wav'); await pg.wait_for_timeout(1500)
        await pg.select_option('#kind','mono'); await pg.fill('#bpm','100'); await pg.fill('#off','1.0'); await pg.evaluate("document.getElementById('bpm').dataset.user='1'")
        await pg.select_option('#strength' if False else '#grid','1/8'); await pg.evaluate("document.getElementById('strength').value=0")
        await pg.click('#go')
        for i in range(60):
            await pg.wait_for_timeout(1000)
            st=await pg.inner_text('#status')
            if st.startswith(('✅','Não')): break
        print(st)
        raw=await pg.evaluate("APSMidiApp.S.raw.map(n=>[n.midi,n.start,n.end,n.vel])")
        print('notas lidas:',len(raw),'esperadas',len(truth['truth']))
        okp=sum(1 for r,t in zip(raw,truth['truth']) if r[0]==t['midi']); print('alturas corretas: %d/%d'%(okp,len(truth['truth'])))
        err=[abs(r[1]-t['played']) for r,t in zip(raw,truth['truth'])]; print('erro médio de início vs tocado: %.0f ms (máx %.0f ms)'%(1000*sum(err)/len(err),1000*max(err)))
        await pg.screenshot(path='/workspace/aps-test/midi-a-0pct.png',full_page=True)
        res={}
        for s in (0,50,100):
            await pg.evaluate(f"(()=>{{const e=document.getElementById('strength');e.value={s};e.dispatchEvent(new Event('input'));}})()")
            q=await pg.evaluate("APSMidiApp.S.notes.map(n=>[n.midi,n.start,n.end])")
            gridt=lambda t:round((t-1.0)/0.3)*0.3+1.0
            dev=[abs(n[1]-gridt(n[1])) for n in q]; res[s]=max(dev)
            print('força %d%%: desvio máx. da grade 1/8 = %.1f ms'%(s,1000*res[s]))
            if s==100: await pg.screenshot(path='/workspace/aps-test/midi-a-100pct.png',full_page=True)
        # triolas
        await pg.select_option('#grid','1/8T')
        q=await pg.evaluate("APSMidiApp.S.notes.map(n=>n.start)"); step=60/100/3; print('tercina 1/8T desvio máx: %.1f ms'%(1000*max(abs(t-(round((t-1.0)/step)*step+1.0)) for t in q)))
        print('errs',errs)
        await b.close()
asyncio.run(main())
