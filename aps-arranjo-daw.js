/* APS Arranjo na DAW — envia a pista selecionada e devolve um áudio novo de IA.
   Nunca substitui a gravação original. */
(function () {
  const $ = (id) => document.getElementById(id);
  const PROD_API = 'https://aps-arranjo.aps-audio.workers.dev';
  const API_BASE = (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
    ? `${location.protocol}//${location.hostname}:8788`
    : PROD_API;
  const NOTICE = 'APS Arranjo: áudio gerado por IA. É uma criação nova, não a sua gravação original.';
  const MAX_AUDIO = 10 * 1024 * 1024;
  const MAX_DURATION_SEC = 480;

  let busy = false;

  function say(msg, kind) {
    const el = $('apsArranjoMsg');
    if (!el) return;
    el.textContent = msg;
    el.dataset.kind = kind || '';
  }

  function B() { return window.APSMixBridge; }

  function selectedTrack() {
    const bridge = B();
    if (!bridge) return null;
    const id = bridge.selectedId?.();
    if (!id) return null;
    const buf = bridge.buffer?.(id);
    const row = (bridge.all?.() || []).find((t) => t.id === id);
    if (!buf || !row) return null;
    return { id, name: row.name || 'Pista', buf };
  }

  async function encodeMp3(buf) {
    if (!window.APSShare?.mp3) throw Error('Não foi possível preparar o áudio da pista.');
    return window.APSShare.mp3(buf, { kbps: 192 });
  }

  async function pollTask(id, tipo) {
    const start = Date.now();
    while (Date.now() - start < 10 * 60 * 1000) {
      const res = await fetch(API_BASE + '/tarefa/' + encodeURIComponent(id) + '?tipo=' + encodeURIComponent(tipo));
      const data = await res.json().catch(() => ({}));
      if (data.status === 'pronto' && data.resultados?.length) return data;
      if (data.status === 'falhou' || (res.ok === false && data.status && !['gerando', 'preparando', 'fila'].includes(data.status))) {
        throw Error(data.error || 'Não foi possível criar o arranjo agora.');
      }
      say('A IA está criando um áudio novo… ' + Math.round((Date.now() - start) / 1000) + ' s. A pista original permanece.', 'info');
      await new Promise((r) => setTimeout(r, 4000));
    }
    throw Error('O arranjo demorou demais. Tente novamente em instantes.');
  }

  async function addGenerated(name, blob) {
    const bridge = B();
    const ctx = bridge.tapMaster?.()?.context;
    if (!ctx) throw Error('Abra o estúdio para receber o arranjo.');
    const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
    const id = bridge.addTrack(name, buf, 'other', 0);
    if (id) bridge.focus?.(id);
    bridge.commit?.();
    return id;
  }

  async function run() {
    if (busy) return;
    const track = selectedTrack();
    if (!track) {
      say('Selecione uma pista com áudio. O original não será alterado.', 'error');
      return;
    }
    if (track.buf.duration > MAX_DURATION_SEC) {
      say('A pista pode ter no máximo 8 minutos.', 'error');
      return;
    }
    const modo = $('apsArranjoModo')?.value || 'nova';
    const pedido = $('apsArranjoPedido')?.value.trim() || '';
    const letra = $('apsArranjoLetra')?.value.trim() || '';
    if (modo === 'estender' && !letra) {
      say('Para estender, escreva a letra que deve continuar a música.', 'error');
      return;
    }
    busy = true;
    $('apsArranjoGo').disabled = true;
    say('Preparando a pista selecionada e pedindo um arranjo novo…', 'info');
    try {
      const mp3 = await encodeMp3(track.buf);
      if (mp3.size > MAX_AUDIO) throw Error('A pista ficou grande demais depois da conversão.');
      const finalidade = (modo === 'nova' && !letra) ? 'instrumento' : (modo === 'nova' ? 'referencia' : 'audio');
      const form = new FormData();
      form.append('file', new File([mp3], 'pista.mp3', { type: 'audio/mpeg' }));
      form.append('finalidade', finalidade);
      const up = await fetch(API_BASE + '/enviar', { method: 'POST', body: form });
      const upData = await up.json().catch(() => ({}));
      if (!up.ok || !upData.ok) throw Error(upData.error || 'Não foi possível enviar a pista.');
      const body = { modo, pedido, letra, arquivoId: upData.arquivoId, finalidade };
      if (modo === 'instrumento') body.tipoPista = $('apsArranjoTipo')?.value || 'guitarra';
      if (modo === 'estender') body.extendEm = Math.max(8, track.buf.duration - 2);
      const gen = await fetch(API_BASE + '/gerar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const genData = await gen.json().catch(() => ({}));
      if (!gen.ok || !genData.ok) throw Error(genData.error || 'Não foi possível criar o arranjo agora.');
      const done = await pollTask(genData.id, genData.tipo || 'musica');
      const first = done.resultados[0];
      if (!first?.url) throw Error('A resposta não trouxe o áudio gerado.');
      const res = await fetch(first.url);
      if (!res.ok) throw Error('Não foi possível baixar o áudio gerado.');
      const blob = await res.blob();
      if (!blob.size) throw Error('O áudio gerado veio vazio.');
      const newName = 'APS Arranjo IA · ' + track.name;
      await addGenerated(newName, blob);
      say('Arranjo adicionado como pista nova: ' + newName + '. A gravação original permanece. ' + NOTICE, 'ok');
    } catch (e) {
      say(e.message || 'Não foi possível criar o arranjo agora.', 'error');
    } finally {
      busy = false;
      const btn = $('apsArranjoGo');
      if (btn) btn.disabled = false;
    }
  }

  function syncTipo() {
    const wrap = $('apsArranjoTipoWrap');
    if (wrap) wrap.hidden = ($('apsArranjoModo')?.value !== 'instrumento');
  }

  function mount() {
    if ($('apsArranjoBox')) return true;
    const host = $('apsMasterPanel') || $('export')?.parentElement || $('apsBandMixer');
    if (!host || !B()) return false;
    const box = document.createElement('section');
    box.id = 'apsArranjoBox';
    box.className = 'aps-arranjo-box';
    box.innerHTML = '<h3>♮ APS Arranjo</h3>' +
      '<p class="aps-arranjo-sub">Envia a pista selecionada e devolve um áudio <strong>novo</strong> gerado por IA. A gravação original não é editada nem substituída.</p>' +
      '<label>Tipo de arranjo' +
      '<select id="apsArranjoModo">' +
      '<option value="nova">Música ou instrumental novo</option>' +
      '<option value="acompanhar">Acrescentar acompanhamento</option>' +
      '<option value="instrumento">Acrescentar um instrumento</option>' +
      '<option value="estender">Estender (pede letra)</option>' +
      '</select></label>' +
      '<label id="apsArranjoTipoWrap" hidden>Instrumento' +
      '<select id="apsArranjoTipo">' +
      '<option value="guitarra">Guitarra</option>' +
      '<option value="baixo">Baixo</option>' +
      '<option value="teclado">Teclado</option>' +
      '<option value="bateria">Bateria</option>' +
      '<option value="cordas">Cordas</option>' +
      '<option value="sopros">Sopros</option>' +
      '</select></label>' +
      '<textarea id="apsArranjoPedido" maxlength="1024" rows="2" placeholder="Ex.: acrescente um baixo e mantenha o clima da pista."></textarea>' +
      '<textarea id="apsArranjoLetra" maxlength="5000" rows="2" placeholder="Letra, se for estender ou acrescentar voz."></textarea>' +
      '<div class="aps-arranjo-row"><button type="button" id="apsArranjoGo">♮ Criar arranjo da pista</button></div>' +
      '<p id="apsArranjoMsg" class="aps-arranjo-msg" role="status">Selecione uma pista e peça um arranjo novo. O original permanece.</p>';
    if (host.id === 'apsBandMixer' && $('apsIaBox')) host.append(box);
    else host.prepend(box);
    $('apsArranjoGo').onclick = run;
    $('apsArranjoModo').onchange = syncTipo;
    return true;
  }

  const css = document.createElement('style');
  css.textContent = '.aps-arranjo-box{background:#1a1710;border:1px solid #b99755;border-radius:14px;padding:12px;margin:12px 0}' +
    '.aps-arranjo-box h3{margin:0 0 4px;color:#f4d99f;font-size:15px}' +
    '.aps-arranjo-sub{font-size:12px;color:#dbcaab;margin:0 0 8px}' +
    '.aps-arranjo-box label{display:block;color:#f4d99f;font-size:12px;font-weight:700;margin:8px 0}' +
    '.aps-arranjo-box select,.aps-arranjo-box textarea{width:100%;margin-top:4px;border-radius:10px;border:1px solid #55586b;background:#111620;color:#fff;padding:8px;box-sizing:border-box;font:14px/1.4 system-ui}' +
    '.aps-arranjo-row{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}' +
    '.aps-arranjo-row button{background:#3a2a18;color:#ffe1a3;border:1px solid #b99755;border-radius:8px;padding:8px 12px;font-weight:700}' +
    '.aps-arranjo-row button:disabled{opacity:.45}' +
    '.aps-arranjo-msg{font-size:12px;color:#ffe1a3;margin:8px 0 0;white-space:pre-wrap}' +
    '.aps-arranjo-msg[data-kind=error]{color:#f0b4b0}' +
    '.aps-arranjo-msg[data-kind=ok]{color:#b4e4ba}';
  document.head.append(css);

  window.APSArranjoDaw = { endpoint: API_BASE, selectedTrack };

  let n = 0;
  const iv = setInterval(() => {
    if (mount() || ++n > 80) clearInterval(iv);
  }, 250);
})();
