import asyncio, json, base64
from playwright.async_api import async_playwright
STAT="""async (b64)=>{const bin=atob(b64),u=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)u[i]=bin.charCodeAt(i);const c=new AudioContext();const b=await c.decodeAudioData(u.buffer);const x=b.getChannelData(0);let e=0,pk=0,tail=0;for(let i=0;i<x.length;i++){e+=x[i]*x[i];pk=Math.max(pk,Math.abs(x[i]));}
 const last=APSMidiApp.S.notes.reduce((m,n)=>Math.max(m,n.end),0);for(let i=Math.floor((last+.4)*b.sampleRate);i<x.length;i++)tail+=x[i]*x[i];return{dur:b.duration,rms:Math.sqrt(e/x.length),peak:pk,tail:Math.sqrt(tail/Math.max(1,x.length-Math.floor((last+.4)*b.sampleRate)))};}"""
async def blob64(pg):
    return await pg.evaluate("async()=>{const b=await APSMidiApp.renderWav();const r=new FileReader();return await new Promise(ok=>{r.onload=()=>ok(r.result.split(',')[1]);r.readAsDataURL(b);});}")
async def run(pg,fn,kind):
    await pg.set_input_files('#fAudio','/workspace/aps-test/'+fn); await pg.wait_for_timeout(1200)
    await pg.select_option('#kind',kind); await pg.click('#go')
    for i in range(90):
        await pg.wait_for_timeout(1000); st=await pg.inner_text('#status')
        if st.startswith(('✅','Não')): break
    n=await pg.evaluate("APSMidiApp.S.raw.length"); print(kind,fn,'->',st[:60],'| notas:',n); return n
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(executable_path='/usr/bin/google-chrome',args=['--no-sandbox'])
        pg=await b.new_page(viewport={'width':1200,'height':1500}); errs=[]; pg.on('pageerror',lambda e:errs.append(str(e)[:300]))
        await pg.goto('http://localhost:8765/midi-sampler.html',wait_until='load')
        await run(pg,'teste-piano.wav','poly')
        await pg.screenshot(path='/workspace/aps-test/midi-b-poly.png',full_page=True)
        out={}
        for label,val in [('piano','gm:acoustic_grand_piano:pluck'),('sanfona','gm:accordion:sustain'),('acordeao-tango','gm:tango_accordion:sustain'),('cordas','gm:string_ensemble_1:sustain')]:
            await pg.select_option('#inst',val)
            s=await pg.evaluate(STAT,await blob64(pg)); out[label]=s; print('timbre',label,{k:round(v,4) for k,v in s.items()})
            open('/workspace/aps-test/midi-render-%s.wav'%label,'wb').write(base64.b64decode(await blob64(pg)))
        await pg.select_option('#inst','gm:acoustic_grand_piano:pluck')
        for rv in ('off','sala','igreja'):
            await pg.select_option('#rv',rv); await pg.evaluate("document.getElementById('wet').value=60")
            s=await pg.evaluate(STAT,await blob64(pg)); print('reverb',rv,'cauda após a última nota: %.5f'%s['tail'])
            open('/workspace/aps-test/midi-render-piano-reverb-%s.wav'%rv,'wb').write(base64.b64decode(await blob64(pg)))
        await pg.select_option('#rv','off')
        await run(pg,'teste-bateria.wav','drums')
        await pg.screenshot(path='/workspace/aps-test/midi-b-drums.png',full_page=True)
        print('instrumento após bateria:',await pg.evaluate("document.getElementById('inst').value"))
        s=await pg.evaluate(STAT,await blob64(pg)); print('bateria render',{k:round(v,4) for k,v in s.items()})
        open('/workspace/aps-test/midi-render-bateria.wav','wb').write(base64.b64decode(await blob64(pg)))
        print('errs',errs); await b.close()
asyncio.run(main())
