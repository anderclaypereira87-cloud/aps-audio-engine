// Testes de navegador reais (Playwright + Chromium headless) do separador e da bateria por peça.
// Uso: ORT_DIR=/caminho/node_modules_parent FIX=/dir/fixtures OUT=/dir/saida node tests/e2e-separador.cjs [casos...]
const {createRequire}=require('module');const req=createRequire(process.env.ORT_DIR+'/');const {chromium}=req('playwright');
const fs=require('fs'),path=require('path'),{spawn,execSync}=require('child_process');
const ROOT=path.resolve(__dirname,'..'),FIX=process.env.FIX,OUT=process.env.OUT;fs.mkdirSync(OUT,{recursive:true});
const PORT=Number(process.env.PORT||8799),BASE=`http://127.0.0.1:${PORT}`;const results={};
function rssMB(){try{return Math.round(execSync("ps -eo rss=,comm= | grep -i -E 'chrom|headless' || true").toString().split('\n').filter(Boolean).reduce((s,x)=>s+Number(x.trim().split(/\s+/)[0]),0)/1024);}catch{return 0;}}
async function page(browser,init){const ctx=await browser.newContext({acceptDownloads:true});if(init)await ctx.addInitScript(init);const p=await ctx.newPage();p._errors=[];p.on('pageerror',e=>p._errors.push(String(e)));p.on('console',m=>{if(m.type()==='error')p._errors.push(m.text());});return {ctx,p};}
async function separate(browser,sec,{quality='studio',cancelAfterMs=0,route=null}={}){
 const {ctx,p}=await page(browser);if(route)await ctx.route('**/htdemucs_6s_leve.onnx',route);
 await p.goto(BASE+'/separador.html');await p.setInputFiles('#song',path.join(FIX,`mix_${sec}s.wav`));
 await p.check('input[name=apsEngine][value=leve]');await p.selectOption('#duration',String(sec));await p.selectOption('#outputQuality',quality);
 const t0=Date.now();let peak=0;const iv=setInterval(()=>{peak=Math.max(peak,rssMB());},1000);
 await p.click('#start');
 if(cancelAfterMs){await p.waitForFunction(()=>/Bloco 1 de/.test(document.getElementById('phase').textContent),null,{timeout:600000}).catch(()=>{});await p.waitForTimeout(cancelAfterMs);const before=rssMB();await p.click('#cancel');await p.waitForTimeout(4000);
  const st=await p.evaluate(()=>({phase:document.getElementById('phase').textContent,state:APS6Stem.state(),start:!document.getElementById('start').disabled}));clearInterval(iv);const after=rssMB();await ctx.close();return {cancel:true,before,after,...st,errors:p._errors};}
 await p.waitForFunction(()=>APS6Stem.state().hasResult||/Não foi possível|Cancel/.test(document.getElementById('phase').textContent),null,{timeout:3600000});
 clearInterval(iv);const wall=(Date.now()-t0)/1000;
 const st=await p.evaluate(()=>({phase:document.getElementById('phase').textContent,check:document.getElementById('resultCheck').textContent,state:APS6Stem.state()}));
 const r={sec,quality,wall,peakBrowserRssMB:peak,...st,errors:p._errors};
 if(st.state.hasResult){const dir=path.join(OUT,`web_${sec}s_${quality}`);fs.mkdirSync(dir,{recursive:true});
  for(const id of ['bateria','baixo','outros','voz','guitarra','piano']){const [d]=await Promise.all([p.waitForEvent('download'),p.click(`button[data-download=${id}]`)]);await d.saveAs(path.join(dir,id+'.wav'));}
  const [z]=await Promise.all([p.waitForEvent('download',{timeout:120000}),p.click('#zipAll')]);await z.saveAs(path.join(dir,'stems.zip'));
  r.zipTest=execSync(`python3 -c "import zipfile;z=zipfile.ZipFile('${dir}/stems.zip');print(z.testzip(),len(z.namelist()))"`).toString().trim();
  r.analysis=JSON.parse(execSync(`python3 ${ROOT}/tests/analyze_stems.py ${FIX}/mix_${sec}s.wav ${dir} ${FIX}/ref_${sec}s`).toString());
  // integração com a DAW (handoff já existente via IndexedDB)
  await p.click('#sendMixer');await p.waitForURL(/daw\.html/,{timeout:30000});await p.waitForTimeout(3000);r.dawNoticeVisible=await p.evaluate(()=>!document.getElementById('apsTransferNotice').hidden);await p.evaluate(()=>document.getElementById('apsTransferButton').click());await p.waitForTimeout(10000);
  r.daw=await p.evaluate(()=>{try{return window.Timbra?.getState().tracks.map(t=>t.name+':'+t.duration.toFixed(3));}catch(e){return 'erro '+e.message;}});}
 await ctx.close();return r;
}
async function limits(browser){const out={};
 for(const [label,init] of [['mem1GB',()=>Object.defineProperty(Navigator.prototype,'deviceMemory',{get:()=>1})],['android2GB',()=>{Object.defineProperty(Navigator.prototype,'deviceMemory',{get:()=>2});Object.defineProperty(Navigator.prototype,'userAgent',{get:()=>'Mozilla/5.0 (Linux; Android 10; Mobile)'});}],['desktop8GB',()=>Object.defineProperty(Navigator.prototype,'deviceMemory',{get:()=>8})]]){
  const {ctx,p}=await page(browser,init);await p.goto(BASE+'/separador.html');
  out[label]=await p.evaluate(()=>({limits:APS6Stem.limits(),startDisabled:document.getElementById('start').disabled,enabledDurations:[...document.getElementById('duration').options].filter(o=>!o.disabled).map(o=>o.value),completoEnabled:!document.querySelector('input[value=completo]').disabled,msg:document.getElementById('deviceCheck').textContent}));await ctx.close();}
 return out;}
async function drums(browser){
 const {ctx,p}=await page(browser);await p.goto(BASE+'/bateria.html#aps-drum-analyzer');
 await p.setInputFiles('#apsAnalyzeFile',path.join(FIX,'drums30.wav'));await p.waitForFunction(()=>/Bateria carregada/.test(document.getElementById('apsAnalysisStatus').textContent));
 await p.click('#apsAnalyze');await p.waitForTimeout(1500);
 const r={status:await p.textContent('#apsAnalysisStatus'),dyn:await p.textContent('#apsDynamic'),pager:await p.textContent('#apsEventsPager'),abPanel:!!(await p.$('#apsOpsAB'))};
 const first=await p.$$eval('#apsEvents .aps-ev',rows=>rows.length);
 await p.fill('#apsEvents .aps-ev:nth-child(1) input[type=number]','0.5');await p.dispatchEvent('#apsEvents .aps-ev:nth-child(1) input[type=number]','change');
 await p.click('#apsEvents .aps-ev:nth-child(1) button');
 r.afterEdit=await p.textContent('#apsEventsPager');r.rowsFirstPage=first;
 const [d]=await Promise.all([p.waitForEvent('download'),p.click('#apsExportMidi')]);const f=path.join(OUT,'bateria.mid');await d.saveAs(f);r.midiHeader=fs.readFileSync(f).subarray(0,4).toString();r.midiBytes=fs.statSync(f).size;r.errors=p._errors;await ctx.close();return r;}
(async()=>{
 const srv=spawn('python3',['-m','http.server',String(PORT),'--bind','127.0.0.1'],{cwd:ROOT,stdio:'ignore'});await new Promise(r=>setTimeout(r,1200));
 const browser=await chromium.launch();const cases=process.argv.slice(2);
 try{for(const c of cases){const t=Date.now();console.error('caso',c);
  if(c==='limits')results.limits=await limits(browser);
  else if(c==='drums')results.drums=await drums(browser);
  else if(c==='cancel')results.cancel=await separate(browser,60,{cancelAfterMs:3000});
  else if(c==='badmodel')results.badmodel=await separate(browser,10,{route:r=>r.fulfill({status:200,body:Buffer.alloc(2048)})});
  else if(c==='nomodel')results.nomodel=await separate(browser,10,{route:r=>r.abort()});
  else {const [s,q]=c.split(':');results['sep_'+c]=await separate(browser,Number(s),{quality:q||'studio'});}
  console.error('  ',((Date.now()-t)/1000).toFixed(0),'s');fs.writeFileSync(path.join(OUT,'e2e-results.json'),JSON.stringify(results,null,1));}}
 finally{await browser.close();srv.kill();}
 console.log(JSON.stringify(results,null,1));
})();
