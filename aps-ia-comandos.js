/* APS — comandos de mixagem por texto/voz via worker aps-ia.
 * Só aplica processadores que já existem na DAW. Não envia o áudio. */
(function () {
  'use strict';
  const ENDPOINT = 'https://aps-ia.aps-audio.workers.dev/comando';
  const UPDATE_KEYS = ['gain', 'pan', 'bass', 'mid', 'treble', 'hpf', 'reverb', 'delay', 'drive', 'comp'];
  const SNAP_KEYS = UPDATE_KEYS.concat(['midFreq', 'ratio']);
  const TRACK_PROCESSORS = ['volume', 'eq', 'compressor', 'reverb', 'delay', 'distortion', 'pan'];

  const $ = (id) => document.getElementById(id);
  const B = () => window.APSMixBridge;
  const clip = (x, a, b) => Math.min(b, Math.max(a, x));
  const Speech = window.SpeechRecognition || window.webkitSpeechRecognition;

  let pending = null;
  let undoSnap = null;
  let lastUsage = null;
  let rec = null;
  let listening = false;

  function say(text, kind) {
    const box = $('apsIaMsg');
    if (!box) return;
    box.textContent = text;
    box.dataset.kind = kind || 'info';
  }

  function listTracks() {
    const bridge = B();
    if (!bridge) return [];
    if (typeof bridge.all === 'function') return bridge.all();
    return bridge.list() || [];
  }

  function trackParams(t) {
    return {
      gain: t.gain, pan: t.pan, bass: t.bass, mid: t.mid, midFreq: t.midFreq,
      treble: t.treble, hpf: t.hpf, reverb: t.reverb, delay: t.delay,
      drive: t.drive, comp: !!t.comp, ratio: t.ratio
    };
  }

  function buildState() {
    const bridge = B();
    const tracks = listTracks().map((t) => ({
      id: t.id,
      name: t.name,
      type: t.type,
      instrument: t.type,
      processors: TRACK_PROCESSORS.slice(),
      params: trackParams(t)
    }));
    return {
      bpm: bridge?.bpm?.() || Number($('bpm')?.value) || 100,
      sections: [],
      tracks,
      master: {
        id: 'master',
        processors: ['master'],
        params: {
          masterGain: Number($('masterGain')?.value) || 85,
          masterComp: !!$('masterComp')?.checked
        }
      }
    };
  }

  function snapAll() {
    const tracks = listTracks().map((t) => ({
      id: t.id,
      values: Object.fromEntries(SNAP_KEYS.map((k) => [k, t[k]]))
    }));
    return {
      tracks,
      masterGain: Number($('masterGain')?.value) || 85,
      masterComp: !!$('masterComp')?.checked
    };
  }

  function applyMaster(gain, comp) {
    const g = $('masterGain');
    const c = $('masterComp');
    if (g && gain !== undefined) {
      g.value = clip(Number(gain), 0, 125);
      if ($('masterGainValue')) $('masterGainValue').textContent = g.value + '%';
      g.dispatchEvent(new Event('input', { bubbles: true }));
    }
    if (c && comp !== undefined) {
      c.checked = !!comp;
      c.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }

  function applyResult(result) {
    const bridge = B();
    if (!bridge) throw new Error('Abra o estúdio para aplicar.');
    const actions = result?.actions || [];
    if (!actions.length) throw new Error('Não há ajustes aplicáveis.');
    undoSnap = snapAll();
    const byTrack = new Map();
    const extras = [];
    let masterGain, masterComp, touchedMaster = false;
    for (const a of actions) {
      if (a.target_type === 'master' || a.target_id === 'master' || a.processor === 'master') {
        if (a.param === 'masterGain') { masterGain = a.value; touchedMaster = true; }
        if (a.param === 'masterComp') { masterComp = a.value; touchedMaster = true; }
        continue;
      }
      if (UPDATE_KEYS.includes(a.param)) {
        if (!byTrack.has(a.target_id)) byTrack.set(a.target_id, {});
        byTrack.get(a.target_id)[a.param] = a.value;
      } else {
        extras.push(a);
      }
    }
    if (byTrack.size && typeof bridge.update === 'function') {
      bridge.update([...byTrack].map(([id, values]) => ({ id, values })));
    }
    for (const a of extras) {
      const t = bridge.raw?.(a.target_id);
      if (!t) continue;
      if (a.param === 'midFreq' && Number.isFinite(Number(a.value))) t.midFreq = clip(Number(a.value), 200, 3000);
      if (a.param === 'ratio' && Number.isFinite(Number(a.value))) t.ratio = clip(Number(a.value), 1, 8);
    }
    if (extras.length) bridge.commit?.();
    if (touchedMaster) applyMaster(masterGain, masterComp);
    $('apsIaApply').disabled = true;
    $('apsIaUndo').disabled = false;
    return undoSnap;
  }

  function undo() {
    const bridge = B();
    if (!undoSnap || !bridge) return;
    if (undoSnap.tracks?.length) bridge.update(undoSnap.tracks.map((t) => ({
      id: t.id,
      values: Object.fromEntries(UPDATE_KEYS.filter((k) => k in t.values).map((k) => [k, t.values[k]]))
    })));
    for (const t of undoSnap.tracks || []) {
      const raw = bridge.raw?.(t.id);
      if (!raw) continue;
      if ('midFreq' in t.values) raw.midFreq = t.values.midFreq;
      if ('ratio' in t.values) raw.ratio = t.values.ratio;
    }
    applyMaster(undoSnap.masterGain, undoSnap.masterComp);
    bridge.commit?.();
    undoSnap = null;
    $('apsIaUndo').disabled = true;
    say('Comando desfeito. Os valores voltaram ao que eram antes.', 'ok');
  }

  function formatPreview(result) {
    const lines = [];
    if (result.summary) lines.push(result.summary);
    const nameOf = (id) => {
      if (id === 'master') return 'Master';
      const t = listTracks().find((x) => x.id === id);
      return t ? t.name : id;
    };
    if (result.actions?.length) {
      lines.push('', 'Vai aplicar:');
      for (const a of result.actions) {
        const shown = typeof a.value === 'boolean' ? (a.value ? 'ligado' : 'desligado') : a.value;
        lines.push('• ' + nameOf(a.target_id) + ' · ' + a.processor + ' · ' + a.param + ' = ' + shown);
      }
    }
    if (result.cannot?.length) {
      lines.push('', 'Ainda não dá para fazer:');
      for (const c of result.cannot) lines.push('• ' + c);
    }
    if (result.usage) {
      const usd = result.usage.estimated_usd;
      lines.push('', 'Uso: ' + result.usage.total_tokens + ' tokens' + (usd != null ? ' · cerca de US$ ' + Number(usd).toFixed(5) : '') + '.');
    }
    lines.push('', 'Nada foi alterado ainda. Toque em Aplicar para ouvir o resultado.');
    return lines.join('\n');
  }

  async function analyze() {
    const text = $('apsIaInput')?.value.trim() || '';
    if (text.length < 4) { say('Escreva o que deseja na mixagem.', 'error'); return; }
    if (!listTracks().length) { say('Importe ou grave pistas primeiro.', 'error'); return; }
    $('apsIaAsk').disabled = true;
    say('Consultando a IA…', 'info');
    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comando: text, estado: buildState() })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || ('Falha HTTP ' + res.status));
      pending = data;
      lastUsage = data.usage || null;
      $('apsIaApply').disabled = !(data.actions && data.actions.length);
      say(formatPreview(data), data.actions?.length ? 'ok' : 'error');
    } catch (e) {
      pending = null;
      $('apsIaApply').disabled = true;
      say(e.message || 'Não foi possível consultar a IA.', 'error');
    } finally {
      $('apsIaAsk').disabled = false;
    }
  }

  function apply() {
    if (!pending) { say('Analise um comando antes de aplicar.', 'error'); return; }
    try {
      applyResult(pending);
      say((pending.summary || 'Ajustes aplicados.') + '\nVocê pode desfazer.', 'ok');
      pending = null;
    } catch (e) {
      say(e.message, 'error');
    }
  }

  function toggleMic() {
    if (!Speech) return;
    if (listening && rec) { rec.stop(); return; }
    rec = new Speech();
    rec.lang = 'pt-BR';
    rec.interimResults = false;
    rec.onstart = () => { listening = true; $('apsIaMic').textContent = '■ Parar'; say('Pode falar o comando…'); };
    rec.onerror = () => { listening = false; $('apsIaMic').textContent = '🎤 Falar'; };
    rec.onend = () => { listening = false; $('apsIaMic').textContent = '🎤 Falar'; };
    rec.onresult = (ev) => {
      const said = ev.results?.[0]?.[0]?.transcript || '';
      if (said) {
        $('apsIaInput').value = said;
        say('Ouvi: ' + said);
      }
    };
    rec.start();
  }

  function mount() {
    if ($('apsIaBox')) return true;
    const host = $('apsBandMixer') || $('apsMixAI');
    if (!host || !B()) return false;
    const box = document.createElement('section');
    box.id = 'apsIaBox';
    box.className = 'aps-ia-cmd';
    box.innerHTML = '<h3>✦ APS Maestro · comando de mixagem</h3>' +
      '<p class="aps-ia-cmd-sub">APS Maestro ouve o seu pedido em português e sugere volume, EQ, compressão, reverb, delay, saturação e panorama — só o que esta DAW já processa. O áudio não é enviado.</p>' +
      '<textarea id="apsIaInput" maxlength="1400" rows="3" placeholder="Ex.: Faça uma mixagem de forró com sanfona destacada, zabumba forte e triângulo definido"></textarea>' +
      '<div class="aps-ia-cmd-row">' +
      '<button type="button" id="apsIaAsk">✦ Analisar comando</button>' +
      '<button type="button" id="apsIaApply" disabled>✓ Aplicar</button>' +
      '<button type="button" id="apsIaUndo" disabled>↩ Desfazer</button>' +
      '<button type="button" id="apsIaMic" hidden>🎤 Falar</button>' +
      '</div>' +
      '<p id="apsIaMsg" class="aps-ia-cmd-msg" role="status">Importe as pistas e descreva a mixagem desejada.</p>';
    host.append(box);
    $('apsIaAsk').onclick = analyze;
    $('apsIaApply').onclick = apply;
    $('apsIaUndo').onclick = undo;
    if (Speech) {
      $('apsIaMic').hidden = false;
      $('apsIaMic').onclick = toggleMic;
    }
    return true;
  }

  const css = document.createElement('style');
  css.textContent = '.aps-ia-cmd{background:#151a26;border:1px solid #6a8f7a;border-radius:14px;padding:12px;margin:12px 0}' +
    '.aps-ia-cmd h3{margin:0 0 4px;color:#9edac0;font-size:15px}' +
    '.aps-ia-cmd-sub{font-size:12px;color:#aab;margin:0 0 8px}' +
    '.aps-ia-cmd textarea{width:100%;min-height:72px;border-radius:10px;border:1px solid #55586b;background:#111620;color:#fff;padding:10px;box-sizing:border-box}' +
    '.aps-ia-cmd-row{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}' +
    '.aps-ia-cmd-row button{background:#232a3a;color:#e8f6ee;border:1px solid #3d5c4c;border-radius:8px;padding:8px 12px;font-weight:700}' +
    '.aps-ia-cmd-row button:disabled{opacity:.45}' +
    '.aps-ia-cmd-msg{font-size:12px;color:#b4e4ba;margin:8px 0 0;white-space:pre-wrap}' +
    '.aps-ia-cmd-msg[data-kind=error]{color:#f0b4b0}' +
    '.aps-ia-cmd-msg[data-kind=ok]{color:#b4e4ba}';
  document.head.append(css);

  window.APSIaComandos = {
    endpoint: ENDPOINT,
    buildState,
    applyResult,
    undo,
    snapAll,
    lastUsage: () => lastUsage,
    pending: () => pending
  };

  let n = 0;
  const iv = setInterval(() => {
    if (mount() || ++n > 80) clearInterval(iv);
  }, 250);
})();
