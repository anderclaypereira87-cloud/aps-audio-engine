const CACHE='aps-shell-1.9.0';
const BASE=new URL('./',self.location).pathname;
const FILES=['index.html', 'login.html', 'auth-config.js',  'painel.html', 'daw.html', 'midia.html', 'bateria.html', 'separador.html', 'separador.js', 'separador-worker.js', 'partitura-pro.html', 'partitura-pro.js', 'aps-mix-assistant.js','aps-master.js', 'aps-mix-assistant.css', 'aps-studio-pro.css', 'aps-studio-pro.js', 'manifest.json', 'icon-192.png', 'icon-512.png'];
self.addEventListener('install',e=>{self.skipWaiting();e.waitUntil(caches.open(CACHE).then(c=>c.addAll(FILES.map(f=>BASE+f))));});
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('aps-shell-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{if(e.request.method!=='GET')return;const url=new URL(e.request.url);if(url.origin!==self.location.origin)return;const rel=url.pathname.startsWith(BASE)?url.pathname.slice(BASE.length):'';if(rel!==''&&!FILES.includes(rel))return;e.respondWith(fetch(e.request).catch(()=>caches.match(e.request,{ignoreSearch:true})));});
