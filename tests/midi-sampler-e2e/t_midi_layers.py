import asyncio, json, base64, numpy as np, wave, io
from playwright.async_api import async_playwright
R="async()=>{const b=await APSMidiApp.renderWav();const r=new FileReader();return await new Promise(ok=>{r.onload=()=>ok(r.result.split(',')[1]);r.readAsDataURL(b);});}"
O='/workspace/aps-test/'
def load(b64,save=None):
    raw=base64.b64decode(b64)
    if save: open(O+save,'wb').write(raw)
    w=wave.open(io.BytesIO(raw)); x=np.frombuffer(w.readframes(w.getnframes()),'<i2').reshape(-1,w.getnchannels())/32768; return x,w.getframerate()
async def setnotes(pg,notes):
    await pg.evaluate("n=>{document.getElementById('strength').value=0;APSMidiApp.S.raw=n;APSMidiApp.S.drumsMode=false;APSMidiApp.applyQuant();}",notes)
async def setlayers(pg,layers):
    await pg.evaluate("L=>{const S=APSMidiApp.S;S.layers=L.map(l=>Object.assign(APSMidiApp.newLayer(),l));S.layerVer++;S.aud=null;APSMidiApp.drawLayers();document.getElementById('inst').value='layers';}",layers)
async def rnd(pg,save=None):
    return load(await pg.evaluate(R),save)
def corr(a,b):
    n=min(len(a),len(b)); a=a[:n]; b=b[:n]; return float(np.dot(a,b)/(np.linalg.norm(a)*np.linalg.norm(b)+1e-12))
def rms(x): return float(np.sqrt((x**2).mean()))
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(executable_path='/usr/bin/google-chrome',args=['--no-sandbox'])
        ctx=await b.new_context(viewport={'width':1250,'height':1900}); pg=await ctx.new_page(); errs=[]; pg.on('pageerror',lambda e:errs.append(str(e)[:300]))
        await pg.goto('http://localhost:8765/midi-sampler.html',wait_until='load'); await pg.evaluate("document.querySelectorAll('details').forEach(d=>d.open=true)")
        await pg.fill('#bpm','100')
        PI='gm:acoustic_grand_piano:pluck'; ST='gm:string_ensemble_1:sustain'
        # --- 1) piano + cordas
        ch=[{'start':.2,'end':1.6,'midi':m,'vel':.8} for m in (60,64,67)]+[{'start':2.0,'end':3.4,'midi':m,'vel':.8} for m in (57,60,64)]
        await setnotes(pg,ch)
        await setlayers(pg,[dict(src=PI,pan=-30),dict(src=ST,vol=70,pan=30)]); xs,sr=await rnd(pg,'camadas-piano-cordas.wav')
        await setlayers(pg,[dict(src=PI,pan=-30),dict(src=ST,vol=70,pan=30,mute=True)]); xp,_=await rnd(pg)
        await setlayers(pg,[dict(src=PI,pan=-30,mute=True),dict(src=ST,vol=70,pan=30)]); xc,_=await rnd(pg)
        n=min(len(xs),len(xp),len(xc)); 
        # normalização: renderWav normaliza picos -> comparar por correlação com a soma
        s=xp[:n]+xc[:n]
        print('piano+cordas: correlação da camada dupla com piano+cordas separados = %.3f (piano só: %.3f, cordas só: %.3f)'%(corr(xs[:n,0],s[:,0]),corr(xs[:n,0],xp[:n,0]),corr(xs[:n,0],xc[:n,0])))
        print('pan: piano (-30) energia E/D = %.2f/%.2f | cordas (+30) E/D = %.2f/%.2f'%(rms(xp[:,0]),rms(xp[:,1]),rms(xc[:,0]),rms(xc[:,1])))
        await pg.screenshot(path=O+'midi-layers-ui.png',full_page=True)
        # --- 2) split por teclas: baixo até Dó3, piano a partir de Dó#3
        await setnotes(pg,[{'start':.2,'end':1.2,'midi':36,'vel':.8},{'start':1.6,'end':2.6,'midi':72,'vel':.8}])
        BA='gm:acoustic_bass:pluck'
        await setlayers(pg,[dict(src=BA,hikey=48),dict(src=PI,lokey=49)]); xs,sr=await rnd(pg,'camadas-split-teclas.wav')
        await setlayers(pg,[dict(src=BA)]); xb,_=await rnd(pg); await setlayers(pg,[dict(src=PI)]); xpi,_=await rnd(pg)
        a=slice(int(.15*sr),int(1.3*sr)); c=slice(int(1.55*sr),int(2.7*sr))
        print('split: janela grave ~ baixo-só %.3f (piano-só %.3f) | janela aguda ~ piano-só %.3f (baixo-só %.3f)'%(corr(xs[a,0],xb[a,0]),corr(xs[a,0],xpi[a,0]),corr(xs[c,0],xpi[c,0]),corr(xs[c,0],xb[c,0])))
        # --- 3) faixa de velocidade
        await setnotes(pg,[{'start':.2,'end':1.0,'midi':64,'vel':.3},{'start':1.5,'end':2.3,'midi':64,'vel':.95}])
        FL='gm:flute:sustain'; TR='gm:trumpet:sustain'
        await setlayers(pg,[dict(src=FL,hivel=80),dict(src=TR,lovel=81)]); xs,sr=await rnd(pg,'camadas-faixa-velocidade.wav')
        await setlayers(pg,[dict(src=FL)]); xf,_=await rnd(pg); await setlayers(pg,[dict(src=TR)]); xt,_=await rnd(pg)
        a=slice(int(.15*sr),int(1.2*sr)); c=slice(int(1.45*sr),int(2.5*sr))
        print('velocidade: nota fraca ~ flauta %.3f (trompete %.3f) | nota forte ~ trompete %.3f (flauta %.3f)'%(corr(xs[a,0],xf[a,0]),corr(xs[a,0],xt[a,0]),corr(xs[c,0],xt[c,0]),corr(xs[c,0],xf[c,0])))
        # --- 4) bateria: dois bumbos em um pad
        kk=[{'start':.2+i*.6,'end':.3+i*.6,'midi':36,'vel':.9} for i in range(4)]
        await setnotes(pg,kk)
        await setlayers(pg,[dict(src='drums:aps-acustico',piece='kick',sampleIdx=0),dict(src='drums:aps-studio',piece='kick',sampleIdx=0,vol=80)]); xs,sr=await rnd(pg,'camadas-bumbo-duplo.wav')
        await setlayers(pg,[dict(src='drums:aps-acustico',piece='kick',sampleIdx=0)]); xa,_=await rnd(pg); await setlayers(pg,[dict(src='drums:aps-studio',piece='kick',sampleIdx=0)]); xst,_=await rnd(pg)
        print('bumbo duplo: corr com acústico-só %.3f, com studio-só %.3f; energia dupla %.3f vs sós %.3f / %.3f (norm.)'%(corr(xs[:,0],xa[:,0]),corr(xs[:,0],xst[:,0]),rms(xs[:,0]),rms(xa[:,0]),rms(xst[:,0])))
        print('amostras do bumbo (acústico):',await pg.evaluate("fetch('kits/kits.json').then(r=>r.json()).then(k=>k['aps-acustico'].pieces.kick.map(a=>a.label))"))
        # --- 5) kit completo: todas as peças + round-robin
        pat=[(36,.9),(38,.9),(42,.7),(44,.6),(46,.8),(49,.9),(51,.7),(53,.7),(55,.9),(45,.8),(47,.8),(50,.8),(41,.8),(37,.7)]
        await setnotes(pg,[{'start':.2+i*.5,'end':.3+i*.5,'midi':m,'vel':v} for i,(m,v) in enumerate(pat)])
        await pg.select_option('#inst','drums:combo'); xs,sr=await rnd(pg,'bateria-completa-gm.wav')
        print('kit completo (acústico+pratos): energia por peça GM:',[(m,round(rms(xs[int((.2+i*.5)*sr):int((.2+i*.5+.45)*sr),0]),3)) for i,(m,v) in enumerate(pat)])
        await setnotes(pg,[{'start':.2+i*.4,'end':.3+i*.4,'midi':38,'vel':.9} for i in range(6)])
        xs,sr=await rnd(pg,'caixa-round-robin.wav'); w=[xs[int((.2+i*.4)*sr):int((.2+i*.4+.3)*sr),0] for i in range(6)]
        print('round-robin caixa: correlação entre golpes consecutivos de mesma velocidade:',[round(corr(w[i],w[i+1]),2) for i in range(5)])
        # --- 6) presets
        await setlayers(pg,[dict(src=PI,pan=-30),dict(src=ST,vol=70,pan=30,trans=-12,fine=7)]); await pg.fill('#presetName','Piano + cordas'); await pg.click('#presetSave')
        await pg.screenshot(path=O+'midi-layers-preset.png',full_page=True)
        async with pg.expect_download() as d: await pg.click('#presetExp')
        dd=await d.value; await dd.save_as(O+'preset-piano-cordas.json'); print('exportado:',dd.suggested_filename, json.load(open(O+'preset-piano-cordas.json'))['layers'][1]['trans'])
        await pg.reload(wait_until='load'); await pg.evaluate("document.querySelectorAll('details').forEach(d=>d.open=true)")
        print('após recarregar, presets:',await pg.evaluate("[...document.getElementById('presetSel').options].map(o=>o.value)"))
        await pg.click('#presetLoad'); print('carregado:',await pg.evaluate("APSMidiApp.S.layers.map(l=>[l.src,l.vol,l.pan,l.trans,l.fine])"),await pg.evaluate("document.getElementById('inst').value"))
        await pg.evaluate("localStorage.clear()"); await pg.reload(wait_until='load'); await pg.evaluate("document.querySelectorAll('details').forEach(d=>d.open=true)")
        await pg.set_input_files('#presetImp',O+'preset-piano-cordas.json'); await pg.wait_for_timeout(500)
        print('importado:',await pg.evaluate("APSMidiApp.S.layers.length"),(await pg.inner_text('#status'))[:60])
        # --- 7) IR de cabine de baixo
        await pg.fill('#bpm','100'); await setnotes(pg,[{'start':.2,'end':.6,'midi':40,'vel':.9},{'start':1,'end':1.4,'midi':43,'vel':.9}])
        await pg.select_option('#inst','gm:electric_bass_finger:pluck'); xo,sr=await rnd(pg)
        first=await pg.evaluate("[...document.querySelectorAll('#rv option')].filter(o=>o.value.startsWith('bass:')).length")
        opt=await pg.evaluate("[...document.querySelectorAll('#rv option')].find(o=>o.value.startsWith('bass:')).value+'|'+[...document.querySelectorAll('#rv option')].find(o=>o.value.startsWith('bass:')).textContent")
        await pg.select_option('#rv',opt.split('|')[0]); await pg.wait_for_timeout(1500); await pg.evaluate("document.getElementById('wet').value=100")
        xi,_=await rnd(pg,'baixo-ir-cabine.wav'); n=min(len(xo),len(xi))
        print('IRs de cabine no seletor de reverb:',first,'| primeiro:',opt.split('|')[1],'| corr seco x com cabine %.3f'%corr(xo[:n,0],xi[:n,0]))
        print('errs',errs); await b.close()
asyncio.run(main())
