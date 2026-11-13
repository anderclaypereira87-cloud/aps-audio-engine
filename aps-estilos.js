/* APS 3.7.0 — Modelos de mixagem por estilo mundial (1 toque).
   Os valores ficam em aps-estilos-data.js. As gravações originais não são alteradas. */
import { STYLES, groupedStyles, mixFor } from './aps-estilos-data.js';

const clean = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const ROLES = [
  ['voz', /voz|vocal|canto|lead/],
  ['coro', /coro|backing|bv/],
  ['kick', /kick|bumbo|zabumba/],
  ['snare', /snare|caixa|aro|rim/],
  ['hat', /hat|chimbal|prato|crash|ride|triangulo/],
  ['perc', /perc|conga|pandeiro|shaker|tamborim|repique|timba|surdo|agogo/],
  ['drums', /drum|bateria/],
  ['bass', /bass|baixo/],
  ['sanfona', /sanfona|acorde|acordeon|teclado sanfona/],
  ['violao', /violao|acoust|nylon|cavaco/],
  ['guitar', /guitar|guitarra/],
  ['keys', /piano|keys|teclado|synth|organ|orgao/],
  ['horn', /metais|horn|sax|trompete|trombone/],
  ['strings', /string|cordas|violino/]
];
const roleOf = (t) => {
  const n = clean(t.name + ' ' + t.type);
  for (const [r, re] of ROLES) if (re.test(n)) return r;
  return 'other';
};

let undo = null;

function apply(key) {
  const B = window.APSMixBridge, st = STYLES[key];
  if (!B) { msg('Abra o estúdio para aplicar.'); return; }
  if (!st) { msg('Estilo não reconhecido.'); return; }
  const tracks = B.list();
  if (!tracks.length) { msg('Importe ou grave pistas primeiro — depois toque no estilo.'); return; }
  const ups = tracks.map((t) => {
    const values = mixFor(key, roleOf(t));
    return { id: t.id, values };
  });
  try {
    undo = B.update(ups);
    const mc = document.getElementById('masterComp');
    if (mc && !mc.checked) { mc.checked = true; mc.dispatchEvent(new Event('change', { bubbles: true })); }
    const btn = document.getElementById('apsEstUndo');
    if (btn) btn.disabled = !undo?.length;
    highlight(key);
    msg('✓ Estilo ' + st.label + ' aplicado em ' + ups.length + ' pista(s): EQ, compressão, saturação, reverb/delay e abertura estéreo por instrumento. Alvo de master: ' + st.lufs + ' LUFS. Toque em ↩ para desfazer.');
  } catch (e) {
    msg('Não foi possível aplicar: ' + e.message);
  }
}

function msg(t) {
  const m = document.getElementById('apsEstMsg');
  if (m) m.textContent = t;
}

function highlight(key) {
  document.querySelectorAll('#apsEstilos [data-est]').forEach((b) => {
    b.classList.toggle('on', b.dataset.est === key);
  });
}

function syncMixAssistant() {
  const sel = document.getElementById('apsAIGenre');
  const data = window.APSEstilosData;
  if (!sel || !data) return;
  const current = sel.value;
  const genres = data.allAiGenres();
  if (window.APSMixAI?.GENRES) Object.assign(window.APSMixAI.GENRES, genres);
  const keep = current;
  sel.replaceChildren();
  for (const g of data.groupedStyles()) {
    const og = document.createElement('optgroup');
    og.label = g.label;
    for (const s of g.styles) og.append(new Option(s.label, s.id));
    sel.append(og);
  }
  if ([...sel.options].some((o) => o.value === keep)) sel.value = keep;
}

function mount() {
  if (document.getElementById('apsEstilos')) { syncMixAssistant(); return true; }
  const host = document.getElementById('apsMixAI');
  if (!host) return false;
  const box = document.createElement('section');
  box.id = 'apsEstilos';
  box.className = 'aps-estilos';
  const groups = groupedStyles().map((g) =>
    '<div class="aps-est-group" data-group="' + g.id + '"><h4>' + g.label + '</h4><div class="aps-est-grid">' +
    g.styles.map((s) => '<button type="button" data-est="' + s.id + '" title="' + s.desc + '"><span>' + s.ico + '</span>' + s.label + '</button>').join('') +
    '</div></div>'
  ).join('');
  box.innerHTML = '<h3>🌍 Estilos mundiais · mix em 1 toque</h3><p class="aps-est-sub">Ajusta volume, EQ, compressão, saturação, reverb/delay, panorama e abertura estéreo de cada instrumento pelo estilo. As gravações não são alteradas.</p>' +
    groups +
    '<div class="aps-est-row"><button type="button" id="apsEstUndo" disabled>↩ Desfazer estilo</button></div><p id="apsEstMsg" class="aps-est-msg" role="status">Escolha um estilo.</p>';
  host.prepend(box);
  box.querySelectorAll('[data-est]').forEach((b) => { b.onclick = () => apply(b.dataset.est); });
  document.getElementById('apsEstUndo').onclick = () => {
    if (!undo?.length) return;
    window.APSMixBridge.update(undo);
    undo = null;
    document.getElementById('apsEstUndo').disabled = true;
    highlight('');
    msg('Estilo desfeito.');
  };
  syncMixAssistant();
  return true;
}

function mountTools() {
  const logo = document.querySelector('.pro-logo');
  if (!logo || document.getElementById('apsToolsLink')) return;
  const a = document.createElement('a');
  a.id = 'apsToolsLink';
  a.href = './afinador.html';
  a.className = 'aps-tools-link';
  a.textContent = '🎯';
  a.title = 'Afinador e metrônomo';
  logo.insertAdjacentElement('afterend', a);
}

const css = document.createElement('style');
css.textContent = '.aps-estilos{background:#151a26;border:1px solid #9e7c42;border-radius:14px;padding:12px;margin:0 0 12px}.aps-estilos h3{margin:0 0 4px;color:#e5be74;font-size:15px}.aps-est-sub{font-size:12px;color:#aab;margin:0 0 8px}.aps-est-group{margin:10px 0 2px}.aps-est-group h4{margin:0 0 6px;color:#dcc89a;font-size:11px;letter-spacing:.06em;text-transform:uppercase}.aps-est-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(92px,1fr));gap:6px}.aps-est-grid button{background:#232a3a;color:#f5d79e;border:1px solid #5d4c2c;border-radius:10px;padding:9px 4px;font-weight:700;font-size:13px;min-height:52px;display:flex;flex-direction:column;align-items:center;gap:2px}.aps-est-grid button span{font-size:18px}.aps-est-grid button.on,.aps-est-grid button:active{background:#dbb66f;color:#151922}.aps-est-row{margin-top:8px}.aps-est-row button{background:#282f3d;color:#ddd;border:1px solid #555;border-radius:8px;padding:6px 10px}.aps-est-msg{font-size:12px;color:#b4e4ba;margin:6px 0 0;white-space:pre-wrap}.aps-tools-link{color:#e5be74;font-size:12px;text-decoration:none;border:1px solid #9e7c42;border-radius:8px;padding:3px 7px;margin-left:6px;white-space:nowrap}';
document.head.append(css);

window.APSEstilos = { apply, styles: STYLES, roleOf, mixFor };
let n = 0;
const iv = setInterval(() => {
  const ok = mount();
  mountTools();
  if ((ok && document.getElementById('apsToolsLink')) || ++n > 60) clearInterval(iv);
}, 250);
