import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  GROUPS, STYLES, BASE, styleKeys, groupedStyles, promptGroups,
  mixFor, resolveStyle, lyriaAccepted, allAiGenres, normStyle, RANGES
} from '../aps-estilos-data.js';
import { STYLES as LYRIA_STYLES, readGenerationFields } from '../workers/aps-lyria/lib.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const EXPECTED = [
  'forro', 'xote', 'baiao', 'piseiro', 'sertanejo', 'samba', 'pagode', 'bossa', 'mpb',
  'axe', 'frevo', 'arrocha', 'brega', 'funk-br', 'coco', 'maracatu', 'gospel',
  'afrobeat', 'amapiano',
  'salsa', 'cumbia', 'reggaeton', 'reggae',
  'funk', 'rnb', 'soul', 'jazz', 'jazz-fusion', 'blues',
  'rock', 'metal',
  'pop', 'kpop', 'jpop', 'acustico',
  'house', 'edm', 'trap', 'lofi', 'eletronica',
  'flamenco', 'celtic', 'bollywood', 'arabic', 'orquestral', 'instrumental'
];

test('o catálogo tem todos os estilos pedidos, cada um num grupo', () => {
  assert.deepEqual(styleKeys().sort(), [...EXPECTED].sort());
  assert.equal(styleKeys().length, 46);
  assert.equal(GROUPS.length, 8);
  const grouped = groupedStyles();
  assert.deepEqual(grouped.map((g) => g.id), GROUPS.map((g) => g.id));
  const ids = grouped.flatMap((g) => g.styles.map((s) => s.id));
  assert.deepEqual(ids.sort(), styleKeys().sort());
  for (const key of styleKeys()) {
    const st = STYLES[key];
    assert.ok(st.label, key);
    assert.ok(st.ico, key);
    assert.ok(st.desc, key);
    assert.ok(st.prompt, key);
    assert.ok(GROUPS.some((g) => g.id === st.group), key + ' group');
    assert.ok(Number.isFinite(st.lufs), key + ' lufs');
    assert.ok(st.width > 0.5 && st.width <= 1.4, key + ' width ' + st.width);
    assert.ok(st.sat >= 0 && st.sat <= 20, key + ' sat');
    assert.ok('rev' in st, key + ' rev');
  }
});

test('funk americano e funk brasileiro são estilos distintos', () => {
  assert.notEqual(STYLES.funk.prompt, STYLES['funk-br'].prompt);
  assert.equal(resolveStyle('funk carioca').id, 'funk-br');
  assert.equal(resolveStyle('funk americano').id, 'funk');
  assert.ok(mixFor('funk-br', 'kick').bass > mixFor('funk', 'kick').bass || mixFor('funk-br', 'bass').gain >= mixFor('funk', 'bass').gain);
  assert.ok(mixFor('funk-br', 'voz').reverb <= mixFor('funk', 'voz').reverb);
});

test('mixFor respeita faixas da DAW e aplica EQ, saturação, delay e largura', () => {
  const guitar = mixFor('jazz-fusion', 'guitar');
  assert.ok(guitar.drive >= 10, 'fusion guitar should have audible saturation');
  assert.ok(guitar.mid >= 3);
  assert.ok(Math.abs(guitar.pan) >= 20, 'fusion guitar sits off-center for width');
  const kick = mixFor('jazz-fusion', 'kick');
  assert.equal(kick.reverb, 0);
  assert.ok(kick.drive <= 4, 'kick stays almost dry of saturation');
  const metalG = mixFor('metal', 'guitar');
  assert.ok(metalG.drive > guitar.drive);
  assert.ok(Math.abs(metalG.pan) > Math.abs(guitar.pan));
  const bossaV = mixFor('bossa', 'voz');
  assert.equal(bossaV.comp, false);
  const piseiroV = mixFor('piseiro', 'voz');
  assert.ok(piseiroV.reverb < bossaV.reverb);
  for (const key of styleKeys()) {
    for (const role of Object.keys(BASE)) {
      const v = mixFor(key, role);
      for (const [k, [lo, hi]] of Object.entries(RANGES)) {
        assert.ok(v[k] >= lo && v[k] <= hi, `${key} ${role} ${k}=${v[k]}`);
      }
      assert.equal(typeof v.comp, 'boolean');
    }
  }
});

test('estilos clássicos do APS preservam o caráter original', () => {
  const sanfona = mixFor('forro', 'sanfona');
  assert.ok(sanfona.gain >= 90);
  assert.ok(sanfona.mid >= 2);
  const voice = mixFor('piseiro', 'voz');
  assert.ok(voice.reverb <= 8);
  const gospel = mixFor('gospel', 'coro');
  assert.ok(gospel.reverb >= 20);
  const mpbDrums = mixFor('mpb', 'drums');
  assert.ok(mpbDrums.gain < mixFor('axe', 'drums').gain);
});

test('aliases com acento, hífen e R&B resolvem para o estilo canônico', () => {
  const cases = [
    ['Forró', 'forro'],
    ['baião', 'baiao'],
    ['axé', 'axe'],
    ['Bossa Nova', 'bossa'],
    ['R&B', 'rnb'],
    ['r and b', 'rnb'],
    ['K-Pop', 'kpop'],
    ['lo fi', 'lofi'],
    ['jazz-fusion', 'jazz-fusion'],
    ['Jazz Fusion', 'jazz-fusion'],
    ['funk brasileiro', 'funk-br'],
    ['reguetón', 'reggaeton'],
    ['índia', 'bollywood'],
    ['eletrônica', 'eletronica']
  ];
  for (const [input, id] of cases) {
    assert.equal(resolveStyle(input)?.id, id, input);
  }
  assert.equal(resolveStyle('xyzzy-nao-existe'), null);
  assert.ok(normStyle('R&B') === 'rnb');
});

test('a Mixagem IA recebe um gênero para cada estilo do catálogo', () => {
  const all = allAiGenres();
  assert.deepEqual(Object.keys(all).sort(), styleKeys().sort());
  assert.equal(all.pop.rev, 14);
  assert.equal(all.pop.lufs, -14);
  assert.equal(all.rock.width, 1.15);
  assert.equal(all.trap.del, 12);
  assert.equal(all.acustico.duck, 0);
  assert.equal(all.forro.lufs, -11);
});

test('o worker da Lyria aceita todos os prompts e aliases do catálogo', () => {
  const accepted = lyriaAccepted();
  assert.equal(LYRIA_STYLES.size, accepted.size);
  for (const st of Object.values(STYLES)) {
    const ok = readGenerationFields({ prompt: 'uma música', estilo: st.prompt, modo: 'clip' });
    assert.equal(ok.estilo, st.prompt, st.prompt);
    for (const alias of st.aliases) {
      const r = readGenerationFields({ prompt: 'uma música', estilo: alias, modo: 'clip' });
      assert.equal(r.estilo, st.prompt, alias);
    }
  }
  assert.equal(readGenerationFields({ prompt: 'x', estilo: 'livre', modo: 'clip' }).estilo, '');
  assert.ok(readGenerationFields({ prompt: 'x', estilo: 'nao-existe', modo: 'clip' }).error);
});

test('musica-ia e a DAW carregam o catálogo único, sem lista paralela', () => {
  const html = readFileSync(join(root, 'musica-ia.html'), 'utf8');
  const daw = readFileSync(join(root, 'daw.html'), 'utf8');
  const lyria = readFileSync(join(root, 'aps-lyria.js'), 'utf8');
  const estilos = readFileSync(join(root, 'aps-estilos.js'), 'utf8');
  const worker = readFileSync(join(root, 'workers/aps-lyria/lib.js'), 'utf8');
  assert.match(html, /aps-lyria\.js\?v=455/);
  assert.match(html, /<select id="estilo">/);
  assert.doesNotMatch(html, /<option value="forró">/);
  assert.match(lyria, /fillEstiloSelect/);
  assert.match(lyria, /aps-estilos-data\.js/);
  assert.match(daw, /aps-estilos\.js\?v=370/);
  assert.match(daw, /type="module"/);
  assert.match(estilos, /aps-estilos-data\.js/);
  assert.match(estilos, /groupedStyles/);
  assert.match(worker, /aps-estilos-data\.js/);
  const prompts = promptGroups().flatMap((g) => g.options.map((o) => o.value));
  assert.ok(prompts.includes('jazz fusion'));
  assert.ok(prompts.includes('funk brasileiro'));
  assert.ok(prompts.includes('r&b'));
});
