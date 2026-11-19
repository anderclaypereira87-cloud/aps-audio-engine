import asyncio, time, re, subprocess, sys
from playwright.async_api import async_playwright
G='/workspace/aps-test/grande/'
files=sys.argv[1:] or ['prog-12min-48k-24bit.wav','prog-3min.aiff','prog-3min.flac','prog-3min.ogg','prog-3min.mp3','prog-3min.m4a']
async def heap(pg): return await pg.evaluate("Math.round((performance.memory||{}).usedJSHeapSize/1048576)")
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(executable_path='/usr/bin/google-chrome',args=['--no-sandbox','--enable-precise-memory-info','--js-flags=--max-old-space-size=4096'])
        for fn in files:
            ctx=await b.new_context(viewport={'width':1100,'height':1600}); pg=await ctx.new_page(); errs=[]; pg.on('pageerror',lambda e:errs.append(str(e)[:200]))
            up={}
            async def h_enviar(route,req):
                up['bytes']=req.post_data_buffer or b''; await route.fulfill(status=200,content_type='application/json',headers={'access-control-allow-origin':'*'},body='{"ok":true,"arquivoId":"teste"}')
            async def h_gerar(route,req):
                up['gerar']=req.post_data; await route.fulfill(status=200,content_type='application/json',headers={'access-control-allow-origin':'*'},body='{"ok":false,"error":"mock (nao gera)"}')
            await pg.route('**/enviar',h_enviar); await pg.route('**/gerar',h_gerar)
            await pg.add_init_script("const _f=window.fetch;window.__up=null;window.fetch=function(u,o){try{if(String(u).endsWith('/enviar')&&o&&o.body instanceof FormData){const f=o.body.get('file');window.__up={name:f.name,type:f.type,size:f.size};}}catch(e){}return _f.apply(this,arguments)}")
            await pg.goto('http://localhost:8765/arranjo.html',wait_until='load'); await pg.wait_for_timeout(1500)
            t0=time.time(); await pg.set_input_files('#audioFile',G+fn)
            for i in range(60):
                await pg.wait_for_timeout(500)
                st=await pg.inner_text('#status')
                if ('carregado' in st and 'Lendo' not in st) or 'analisado' in st or 'grande demais' in st or 'Não' in st: break
            print('\n###',fn,'| carregou em %.1fs'%(time.time()-t0)); print('  info:',(await pg.inner_text('#fileInfo'))[:260])
            await pg.select_option('#acInst','piano'); t1=time.time(); await pg.click('#acGerar')
            for i in range(400):
                await pg.wait_for_timeout(1000); st=await pg.inner_text('#status')
                if st.startswith(('Arranjo pronto','Não','Erro','Envie')) or 'não' in st[:20].lower(): break
            tt=time.time()-t1; print('  acordes: %.0fs ->'%tt,st[:110]); print('  ',(await pg.inner_text('#acInfo'))[:230])
            dur=await pg.evaluate("new Promise(r=>{const a=document.getElementById('acPlayer');if(a.duration)return r(a.duration);a.onloadedmetadata=()=>r(a.duration);setTimeout(()=>r(0),5000)})"); print('  duração do arranjo gerado: %.1fs | heap JS: %d MB'%(dur,await heap(pg)))
            # IA
            await pg.evaluate("document.getElementById('refDireitos')&&(document.getElementById('refDireitos').checked=true,document.getElementById('refDireitos').dispatchEvent(new Event('change',{bubbles:true})))")
            await pg.fill('#pedido','teste de envio'); t2=time.time(); await pg.click('#gerar')
            for i in range(240):
                await pg.wait_for_timeout(1000)
                if 'bytes' in up and 'gerar' in up: break
            await pg.wait_for_timeout(500); print('  IA: %.0fs | status: %s'%(time.time()-t2,(await pg.inner_text('#status'))[:200]))
            if 'bytes' in up:
                raw=up['bytes']; i=raw.find(b'\r\n\r\n')+4; j=raw.rfind(b'\r\n--'); mp3=raw[i:j]; open('/tmp/enviado.mp3','wb').write(mp3)
                pr=subprocess.run(['ffprobe','-v','error','-show_entries','format=duration,format_name:stream=codec_name,sample_rate,channels,bit_rate','-of','csv=p=0','/tmp/enviado.mp3'],capture_output=True,text=True).stdout.strip().replace('\n',' | ')
                print('  enviado à IA: %.2f MB | %s'%(len(mp3)/1048576,pr)); print('  corpo /gerar:',up.get('gerar','')[:200])
            print('  arquivo enviado (visto no navegador):',await pg.evaluate('window.__up')); print('  errs',errs[:3]); await ctx.close()
        await b.close()
asyncio.run(main())
