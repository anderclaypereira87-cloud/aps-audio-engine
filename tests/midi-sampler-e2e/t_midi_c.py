import asyncio, json, base64, numpy as np, wave, io
from playwright.async_api import async_playwright
A='/workspace/aps-test/amostras/'
R="async()=>{const b=await APSMidiApp.renderWav();const r=new FileReader();return await new Promise(ok=>{r.onload=()=>ok(r.result.split(',')[1]);r.readAsDataURL(b);});}"
def load(b64,save=None):
    raw=base64.b64decode(b64)
    if save: open(save,'wb').write(raw)
    w=wave.open(io.BytesIO(raw)); n=w.getnframes(); x=np.frombuffer(w.readframes(n),'<i2').reshape(-1,w.getnchannels())[:,0]/32768; return x,w.getframerate()
def dom(x,sr,a,b):
    s=x[int(a*sr):int(b*sr)]; f=np.abs(np.fft.rfft(s*np.hanning(len(s)))); return np.argmax(f)*sr/len(s)
async def setnotes(pg,notes):
    await pg.evaluate("n=>{APSMidiApp.S.raw=n;APSMidiApp.S.drumsMode=false;APSMidiApp.applyQuant();}",notes)
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(executable_path='/usr/bin/google-chrome',args=['--no-sandbox'])
        pg=await b.new_page(viewport={'width':1200,'height':1700}); errs=[]; pg.on('pageerror',lambda e:errs.append(str(e)[:300]))
        await pg.goto('http://localhost:8765/midi-sampler.html',wait_until='load'); await pg.evaluate("document.querySelectorAll('details').forEach(d=>d.open=true)")
        # 1) amostras afinadas Piano_C4/G4: tocar C4(60), G4(67), D4(62)  -> esperado 261.6, 392, 293.7
        await pg.set_input_files('#fSamples',[A+'Piano_C4.wav',A+'Piano_G4.wav']); await pg.wait_for_timeout(1500)
        print('tabela:',await pg.evaluate("APSMidiApp.S.samples.map(r=>[r.name,r.root,r.lokey,r.hikey])"))
        await pg.click('#useSamples'); await pg.fill('#bpm','100')
        await setnotes(pg,[{'start':.2,'end':1.0,'midi':60,'vel':.8},{'start':1.5,'end':2.3,'midi':67,'vel':.8},{'start':2.8,'end':3.6,'midi':62,'vel':.8},{'start':4.1,'end':4.9,'midi':55,'vel':.8}])
        await pg.evaluate("document.getElementById('grid').value='off'") if False else None
        x,sr=load(await pg.evaluate(R),'/workspace/aps-test/midi-render-amostras-usuario.wav')
        for nm,(a,b_),exp in [('C4',(.25,.6),261.6),('G4',(1.55,1.9),392.0),('D4 (esticada de C4)',(2.85,3.2),293.7),('G3 (G4 uma oitava abaixo)',(4.15,4.5),196.0)]:
            print('amostra',nm,'freq medida %.1f Hz (esperado %.1f)'%(dom(x,sr,a,b_),exp))
        # 2) kit de bateria pelos nomes
        await pg.set_input_files('#fSamples',[A+'kick.wav',A+'snare.wav',A+'hihat.wav']); await pg.wait_for_timeout(1200)
        print('pads:',await pg.evaluate("APSMidiApp.S.samples.map(r=>[r.name,r.root,r.fixed])"))
        await pg.click('#useSamples')
        await setnotes(pg,[{'start':.2+i*.5,'end':.3+i*.5,'midi':m,'vel':.9} for i,m in enumerate([36,42,38,42,36,36,38,42])])
        x,sr=load(await pg.evaluate(R),'/workspace/aps-test/midi-render-kit-usuario.wav'); print('kit usuário: pico %.2f, rms %.3f, 8 golpes -> energia por janela:'%(abs(x).max(),x.std()),[round(float(np.sqrt((x[int((.2+i*.5)*sr):int((.2+i*.5+.1)*sr)]**2).mean())),3) for i in range(8)])
        # 3) SFZ com camadas de velocidade
        await pg.set_input_files('#fSamples',[A+'kit.sfz',A+'soft.wav',A+'hard.wav']); await pg.wait_for_timeout(1200)
        print('SFZ regiões:',await pg.evaluate("APSMidiApp.S.samples.map(r=>[r.name,r.lokey,r.hikey,r.lovel,r.hivel,r.root])"))
        await pg.click('#useSamples')
        await setnotes(pg,[{'start':.2,'end':1.0,'midi':60,'vel':.3},{'start':1.6,'end':2.4,'midi':60,'vel':.95}])
        x,sr=load(await pg.evaluate(R),'/workspace/aps-test/midi-render-sfz-camadas.wav')
        print('camada vel 38 (soft=300Hz): %.0f Hz | camada vel 120 (hard=600Hz): %.0f Hz'%(dom(x,sr,.25,.6),dom(x,sr,1.65,2.0)))
        await pg.screenshot(path='/workspace/aps-test/midi-c-amostras-sfz.png',full_page=True)
        # 4) IR do usuário
        await pg.select_option('#inst','gm:acoustic_grand_piano:pluck'); await setnotes(pg,[{'start':.2,'end':.4,'midi':72,'vel':.9}])
        await pg.select_option('#rv','user'); await pg.set_input_files('#fIR',A+'IR-eco.wav'); await pg.wait_for_timeout(800)
        await pg.evaluate("document.getElementById('wet').value=100")
        x,sr=load(await pg.evaluate(R),'/workspace/aps-test/midi-render-ir-usuario-eco.wav')
        e=lambda a,b_:float(np.sqrt((x[int(a*sr):int(b_*sr)]**2).mean()))
        print('IR do usuário: energia 0.25-0.4s %.4f | eco1 (~0.7-0.9s) %.4f | eco2 (~1.2-1.4s) %.4f | vazio 1.8-2.2s %.5f'%(e(.2,.4),e(.7,.9),e(1.2,1.4),e(1.8,2.2)))
        await pg.select_option('#rv','off')
        # 5) MIDI ida e volta
        await pg.fill('#bpm','120'); await setnotes(pg,[{'start':.5*i,'end':.5*i+.4,'midi':60+i,'vel':.5+.05*i} for i in range(8)])
        async with pg.expect_download() as d: await pg.click('#dlMidi')
        dd=await d.value; await dd.save_as('/workspace/aps-test/midi-roundtrip.mid')
        orig=await pg.evaluate("APSMidiApp.S.notes.map(n=>[n.midi,+n.start.toFixed(3),+n.end.toFixed(3),+n.vel.toFixed(2)])")
        await pg.evaluate("APSMidiApp.S.raw=[];APSMidiApp.applyQuant()"); await pg.set_input_files('#fMidi','/workspace/aps-test/midi-roundtrip.mid'); await pg.wait_for_timeout(600)
        back=await pg.evaluate("APSMidiApp.S.raw.map(n=>[n.midi,+n.start.toFixed(3),+n.end.toFixed(3),+n.vel.toFixed(2)])")
        print('MIDI ida/volta: %d notas; máx diferença início %.3fs, fim %.3fs, vel %.2f'%(len(back),max(abs(a[1]-b_[1]) for a,b_ in zip(orig,back)),max(abs(a[2]-b_[2]) for a,b_ in zip(orig,back)),max(abs(a[3]-b_[3]) for a,b_ in zip(orig,back))), 'alturas iguais:',[a[0] for a in orig]==[b_[0] for b_ in back])
        print('errs',errs); await b.close()
asyncio.run(main())
