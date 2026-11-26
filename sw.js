const CACHE='aps-shell-4.0.21';
const BASE=new URL('./',self.location).pathname;
const FILES=['index.html','ensaio.html','professor.html','cifra-ao-vivo.html','palco.html','aps-live.js','aps-live.css','divulgar.html','registro.html','master-referencia.html','afinacao.html', 'melody-engine.html', 'login.html', 'auth-config.js',  'painel.html', 'daw.html', 'aps-daw-plus.js', 'aps-daw-io.js', 'aps-daw-video.js', 'midia.html', 'bateria.html', 'separador.html', 'separador.js', 'separador-worker.js', 'aps-sep-core.js', 'aps-drum-pieces.js', 'partitura-pro.html', 'partitura-pro.js', 'aps-transcribe.js', 'vendor/vexflow/vexflow.js', 'aps-mix-assistant.js','aps-master.js', 'aps-mix-assistant.css', 'aps-studio-pro.css', 'aps-studio-pro.js', 'projetos.html','aps-projects.js','drive-config.js','aps-plans.js','aps-pay.js','planos.html','aps-vocal.js','aps-clean.js','aps-share.js','aps-score.js','aps-chords.js','aps-loops.js','aps-tour.js','aps-tour.css','aps-daw-pro.js','aps-daw-pro.css','aps-instrument.js','aps-recognize.js','aps-estilos.js','aps-estilos-data.js','banda.html','kit.html','aps-gen.js','aps-lib.js','afinador.html','quantizacao.html','aps-elastic-core.js','aps-elastic-engine.js','aps-elastic-worker.js','aps-elastic.js','aps-elastic-quant-ui.js','aps-apply-play.js','aps-elastic-tune-ui.js','aps-quant-core.js','aps-quant-daw.js','aps-quant-rhythm.js','aps-quant-multitrack.js','aps-tuner-worklet.js','vendor/signalsmith-stretch/signalsmith-stretch-wasm.js','vendor/swift-f0/model.onnx','vendas.html','musica-ia.html','aps-lyria.js','arranjo.html','midi-sampler.html','aps-midi.js','midi-sampler.js','aps-midi-daw.js','aps-audio-big.js','aps-arranjo.js','aps-arranjo-daw.js','aps-arranjo-acordes.js','aps-transcribe.js','aps-ia-comandos.js','vendor/lame.min.js','manifest.json', 'icon-192.png', 'icon-512.png'];

// Core pages are required for installation. Optional assets are cached best-effort,
// so one missing legacy file does not prevent the offline shell from installing.
const CORE=['index.html','melody-engine.html','afinacao.html','manifest.json'];
self.addEventListener('install',event=>{
 event.waitUntil((async()=>{
  const cache=await caches.open(CACHE);
  await cache.addAll(CORE.map(f=>BASE+f));
  await Promise.allSettled(FILES.filter(f=>!CORE.includes(f)).map(f=>cache.add(BASE+f)));
  await self.skipWaiting();
 })());
});
self.addEventListener('activate',event=>event.waitUntil((async()=>{
 const keys=await caches.keys();
 await Promise.all(keys.filter(k=>k.startsWith('aps-shell-')&&k!==CACHE).map(k=>caches.delete(k)));
 await self.clients.claim();
})()));
self.addEventListener('fetch',event=>{
 const req=event.request;if(req.method!=='GET')return;
 const url=new URL(req.url);if(url.origin!==self.location.origin)return;
 const rel=url.pathname.startsWith(BASE)?url.pathname.slice(BASE.length):'';
 if(!FILES.includes(rel)&&rel!=='')return;
 event.respondWith((async()=>{
  const cache=await caches.open(CACHE);
  const cached=await cache.match(req,{ignoreSearch:true});
  if(cached){event.waitUntil(fetch(req).then(response=>{if(response.ok)return cache.put(req,response.clone())}).catch(()=>{}));return cached;}
  try{const response=await fetch(req);if(response.ok)event.waitUntil(cache.put(req,response.clone()));return response;}
  catch(e){if(req.mode==='navigate'){const fallback=await cache.match(BASE+'index.html');if(fallback)return fallback;}return Response.error();}
 })());
});
