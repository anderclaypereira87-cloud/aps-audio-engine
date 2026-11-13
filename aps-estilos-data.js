/* APS — catálogo único de estilos mundiais (mix da DAW + criação com IA).
   EQ, compressão, saturação (drive), reverb, delay e abertura estéreo (width no pan).
   Estilos brasileiros já existentes foram preservados; os novos seguem prática
   comum de mixagem de cada gênero. Ajuste tudo neste arquivo. */
export const GROUPS = [
  { id: 'brasil', label: 'Brasil' },
  { id: 'africa', label: 'África' },
  { id: 'latina', label: 'América Latina e Caribe' },
  { id: 'black', label: 'Soul, jazz e blues' },
  { id: 'rock', label: 'Rock e metal' },
  { id: 'pop', label: 'Pop mundial' },
  { id: 'eletro', label: 'Eletrônica' },
  { id: 'mundo', label: 'Europa, Oriente e clássico' }
];

// base por papel: g=volume, b/m/t=EQ dB, h=HPF Hz, r=reverb, d=delay, c=comp, p=pan, s=drive
export const BASE = {
  voz:     { g: 100, b: -1, m: 1,  t: 2,  h: 90,  r: 12, d: 6, c: 1, p: 0,   s: 2 },
  coro:    { g: 70,  b: -2, m: 0,  t: 2,  h: 130, r: 18, d: 6, c: 1, p: 30,  s: 1 },
  kick:    { g: 92,  b: 3,  m: -2, t: 1,  h: 30,  r: 0,  d: 0, c: 1, p: 0,   s: 0 },
  snare:   { g: 85,  b: 0,  m: 1,  t: 2,  h: 90,  r: 10, d: 0, c: 1, p: 0,   s: 3 },
  hat:     { g: 60,  b: -4, m: -1, t: 1,  h: 300, r: 4,  d: 0, c: 0, p: 20,  s: 0 },
  perc:    { g: 65,  b: -2, m: 0,  t: 2,  h: 160, r: 8,  d: 0, c: 0, p: -25, s: 2 },
  drums:   { g: 90,  b: 1,  m: -1, t: 1,  h: 35,  r: 6,  d: 0, c: 1, p: 0,   s: 4 },
  bass:    { g: 88,  b: 2,  m: 1,  t: -2, h: 35,  r: 0,  d: 0, c: 1, p: 0,   s: 2 },
  sanfona: { g: 82,  b: -2, m: 1,  t: 1,  h: 110, r: 10, d: 2, c: 1, p: -15, s: 5 },
  violao:  { g: 75,  b: -2, m: 0,  t: 2,  h: 90,  r: 10, d: 0, c: 1, p: -30, s: 3 },
  guitar:  { g: 72,  b: -1, m: 1,  t: 1,  h: 100, r: 8,  d: 4, c: 1, p: 30,  s: 8 },
  keys:    { g: 70,  b: -2, m: 0,  t: 1,  h: 70,  r: 14, d: 3, c: 0, p: 15,  s: 3 },
  horn:    { g: 70,  b: -2, m: 1,  t: 1,  h: 120, r: 12, d: 2, c: 1, p: -20, s: 3 },
  strings: { g: 62,  b: -2, m: 0,  t: 1,  h: 100, r: 20, d: 0, c: 0, p: 20,  s: 1 },
  other:   { g: 70,  b: -1, m: 0,  t: 0,  h: 100, r: 10, d: 0, c: 0, p: 0,   s: 2 }
};

export const RANGES = {
  gain: [0, 150], pan: [-100, 100], bass: [-12, 12], mid: [-12, 12],
  treble: [-12, 12], hpf: [20, 500], reverb: [0, 40], delay: [0, 35], drive: [0, 50]
};

export function clamp(v, lo, hi) {
  const n = Number(v);
  if (!Number.isFinite(n)) return lo;
  return Math.min(hi, Math.max(lo, n));
}

export function normStyle(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, 'n')
    .replace(/[^a-z0-9]+/g, '');
}

export const STYLES = {
  forro: { label: 'Forró', ico: '🪗', group: 'brasil', prompt: 'forró', aliases: ['forro', 'forró', 'pe de serra', 'pé de serra'], lufs: -11, width: 0.95, sat: 5, rev: 0, desc: 'Sanfona na frente, zabumba com peso, triângulo brilhante.', adj: { sanfona: { g: 12, m: 2, t: 1, p: 0 }, kick: { g: 6, b: 2 }, hat: { g: 8, t: 3 }, bass: { g: 4 }, voz: { r: -2 } }, ai: { voz: 1, width: 0.95, rev: 10, del: 6, duck: 5, bright: 1.5, comp: 1.2, lufs: -11 } },
  piseiro: { label: 'Piseiro', ico: '🔥', group: 'brasil', prompt: 'piseiro', aliases: ['piseiro'], lufs: -9.5, width: 0.9, sat: 6, rev: -4, desc: 'Grave forte e seco, teclado/sanfona brilhante, voz na cara.', adj: { kick: { g: 10, b: 4 }, bass: { g: 8, b: 3 }, keys: { g: 10, t: 2 }, sanfona: { g: 8, t: 2 }, voz: { g: 4, r: -6, d: 2 } }, ai: { voz: 1, width: 0.9, rev: 6, del: 6, duck: 6, bright: 2, comp: 1.3, lufs: -9.5 } },
  xote: { label: 'Xote', ico: '💃', group: 'brasil', prompt: 'xote', aliases: ['xote'], lufs: -12, width: 0.95, sat: 4, rev: 2, desc: 'Forró xote dançante: sanfona clara, zabumba redondo e triângulo definido.', adj: { sanfona: { g: 10, m: 2, t: 2, p: -10 }, kick: { g: 4, b: 2 }, hat: { g: 10, t: 3 }, bass: { g: 2 }, voz: { r: 2 } } },
  baiao: { label: 'Baião', ico: '🌵', group: 'brasil', prompt: 'baião', aliases: ['baiao', 'baião'], lufs: -11, width: 0.95, sat: 5, rev: 0, desc: 'Zabumba marcada, sanfona rítmica e triângulo brilhante.', adj: { sanfona: { g: 10, m: 2, t: 1 }, kick: { g: 10, b: 3 }, hat: { g: 10, t: 4 }, bass: { g: 6, b: 2 }, voz: { g: 2 } } },
  sertanejo: { label: 'Sertanejo', ico: '🤠', group: 'brasil', prompt: 'sertanejo', aliases: ['sertanejo', 'sertanejo universitario', 'sertanejo universitário'], lufs: -11, width: 1, sat: 4, rev: 4, desc: 'Vozes abertas com ambiência, violão definido, baixo redondo.', adj: { voz: { r: 6, d: 4, t: 1 }, coro: { g: 10, r: 6 }, violao: { g: 10, t: 1 }, bass: { b: 1 }, guitar: { r: 4 } }, ai: { voz: 1, width: 0.95, rev: 16, del: 9, duck: 3, bright: 1.5, comp: 1.1, lufs: -13 } },
  samba: { label: 'Samba', ico: '🟢', group: 'brasil', prompt: 'samba', aliases: ['samba'], lufs: -12, width: 1.05, sat: 3, rev: 2, desc: 'Percussão viva, cavaco na frente e grave do surdo presente.', adj: { perc: { g: 16, t: 2, c: 1 }, violao: { g: 12, m: 2, t: 2 }, kick: { g: 6, b: 2 }, bass: { g: 4, b: 1 }, voz: { r: 2 }, coro: { g: 8 } } },
  pagode: { label: 'Pagode', ico: '🥁', group: 'brasil', prompt: 'pagode', aliases: ['pagode'], lufs: -11, width: 1.05, sat: 3, rev: 2, desc: 'Percussão viva (pandeiro, tantã, repique), cavaco na frente.', adj: { perc: { g: 18, t: 2, c: 1 }, violao: { g: 10, m: 2, t: 2 }, bass: { g: 4, b: 1 }, voz: { r: 2 }, coro: { g: 10 } } },
  bossa: { label: 'Bossa nova', ico: '🌴', group: 'brasil', prompt: 'bossa nova', aliases: ['bossa', 'bossa nova', 'bossanova'], lufs: -16, width: 0.95, sat: 2, rev: 6, desc: 'Violão de nylon íntimo, voz suave, percussão leve e muita dinâmica.', adj: { violao: { g: 14, m: 2, t: 1, c: 0, r: 4 }, voz: { g: 2, c: 0, r: 6, d: 2 }, perc: { g: 4, t: 1 }, drums: { g: -8, c: 0 }, kick: { g: -8 }, bass: { g: -2, c: 0 }, keys: { r: 6 } }, ai: { voz: 1, width: 0.95, rev: 18, del: 4, duck: 0, bright: 0.5, comp: 0.7, lufs: -16 } },
  mpb: { label: 'MPB', ico: '🎶', group: 'brasil', prompt: 'mpb', aliases: ['mpb', 'musica popular brasileira', 'música popular brasileira'], lufs: -14, width: 1, sat: 2, rev: 4, desc: 'Mais dinâmica, menos compressão, timbres naturais.', adj: { voz: { c: 0, r: 4 }, violao: { g: 12, c: 0 }, drums: { g: -8, c: 0 }, kick: { g: -8 }, bass: { g: -4 }, keys: { r: 4 } } },
  axe: { label: 'Axé', ico: '🎉', group: 'brasil', prompt: 'axé', aliases: ['axe', 'axé'], lufs: -10, width: 1.1, sat: 5, rev: 0, desc: 'Percussão e metais na frente, energia alta.', adj: { perc: { g: 18, t: 2 }, horn: { g: 14, t: 2 }, guitar: { g: 6, t: 2 }, kick: { g: 6 }, voz: { g: 4 } } },
  frevo: { label: 'Frevo', ico: '☂️', group: 'brasil', prompt: 'frevo', aliases: ['frevo'], lufs: -10, width: 1.15, sat: 6, rev: 0, desc: 'Metais na frente, energia alta e percussão brilhante.', adj: { horn: { g: 16, t: 3 }, perc: { g: 14, t: 2 }, kick: { g: 6 }, guitar: { g: 4, t: 1 }, voz: { g: 4, t: 1 } } },
  arrocha: { label: 'Arrocha', ico: '💔', group: 'brasil', prompt: 'arrocha', aliases: ['arrocha'], lufs: -10.5, width: 1, sat: 5, rev: 3, desc: 'Voz romântica com delay, guitarra/teclado melódicos, grave cheio.', adj: { voz: { d: 10, r: 4, g: 4 }, guitar: { g: 10, d: 6, r: 6 }, keys: { g: 6, r: 6 }, bass: { b: 2, g: 4 } } },
  brega: { label: 'Brega', ico: '💗', group: 'brasil', prompt: 'brega', aliases: ['brega', 'brega funk'], lufs: -10.5, width: 1, sat: 4, rev: 4, desc: 'Voz romântica na frente, teclado envolvente e delay cantado.', adj: { voz: { g: 6, d: 12, r: 6, t: 1 }, keys: { g: 10, r: 8, d: 4 }, guitar: { g: 4, r: 4 }, bass: { b: 2, g: 4 } } },
  'funk-br': { label: 'Funk brasileiro', ico: '🔴', group: 'brasil', prompt: 'funk brasileiro', aliases: ['funk br', 'funk brasileiro', 'funk carioca', 'funk ostentacao', 'funk ostentação'], lufs: -9, width: 0.8, sat: 6, rev: -6, desc: 'Grave e 808 muito fortes, voz seca na cara, hats brilhantes e pouco reverb.', adj: { kick: { g: 14, b: 5, t: 1 }, bass: { g: 12, b: 4, t: -3 }, voz: { g: 6, r: -8, d: 4, t: 2 }, hat: { g: 10, t: 3 }, perc: { g: 4, t: 2 }, guitar: { g: -4 }, keys: { g: 4, t: 2 } }, ai: { voz: 0.5, width: 0.8, rev: 4, del: 6, duck: 7, bright: 2, comp: 1.4, lufs: -9 } },
  coco: { label: 'Coco', ico: '🥥', group: 'brasil', prompt: 'coco', aliases: ['coco', 'côco'], lufs: -12, width: 1.05, sat: 3, rev: 1, desc: 'Percussão de terreiro na frente, voz de chamada e resposta, groove seco.', adj: { perc: { g: 16, t: 2, c: 1 }, voz: { g: 4, r: 2 }, coro: { g: 12, r: 4 }, kick: { g: 6, b: 2 }, bass: { g: 2 } } },
  maracatu: { label: 'Maracatu', ico: '👑', group: 'brasil', prompt: 'maracatu', aliases: ['maracatu'], lufs: -11, width: 1.1, sat: 4, rev: 0, desc: 'Alfaias graves e pesadas, metais e agogô brilhantes, pulso ritual.', adj: { kick: { g: 12, b: 4 }, perc: { g: 16, t: 3 }, horn: { g: 8, t: 2 }, bass: { g: 6, b: 2 }, voz: { g: 2, r: 2 } } },
  gospel: { label: 'Gospel', ico: '🙌', group: 'brasil', prompt: 'gospel', aliases: ['gospel', 'gospel brasileiro'], lufs: -12, width: 1.1, sat: 3, rev: 8, desc: 'Voz e coro grandes, teclados largos, reverb mais longo.', adj: { voz: { r: 10, d: 4 }, coro: { g: 15, r: 10 }, keys: { g: 10, r: 8, p: 0 }, strings: { g: 8 }, drums: { r: 4 } }, ai: { voz: 0.5, width: 1.05, rev: 22, del: 7, duck: 3, bright: 1.5, comp: 1, lufs: -14 } },

  afrobeat: { label: 'Afrobeat', ico: '🌍', group: 'africa', prompt: 'afrobeat', aliases: ['afrobeat', 'afro beat', 'afro-beat'], lufs: -11, width: 1.2, sat: 5, rev: 0, desc: 'Percussão ocupada, metais na frente, baixo quente e groove seco.', adj: { perc: { g: 16, t: 2, c: 1, p: -10 }, horn: { g: 14, t: 2, p: 15 }, bass: { g: 8, b: 2, m: 2 }, kick: { g: 6, b: 2 }, guitar: { g: 6, m: 2, r: -2 }, keys: { g: 4, r: 2 }, voz: { r: -2, d: 2 } }, ai: { voz: 0.5, width: 1.2, rev: 8, del: 4, duck: 4, bright: 1.5, comp: 1.1, lufs: -11 } },
  amapiano: { label: 'Amapiano', ico: '🎹', group: 'africa', prompt: 'amapiano', aliases: ['amapiano'], lufs: -9.5, width: 1.15, sat: 3, rev: 2, desc: 'Log drum e baixo profundos, piano aéreo, hats largos e pads espaçosos.', adj: { kick: { g: 10, b: 4 }, bass: { g: 12, b: 4, t: -2 }, keys: { g: 12, t: 2, r: 8 }, hat: { g: 10, t: 3, p: 20 }, perc: { g: 8, t: 2 }, voz: { r: 2, d: 4 }, drums: { g: 2 } }, ai: { voz: 0.5, width: 1.15, rev: 12, del: 8, duck: 5, bright: 1.8, comp: 1.2, lufs: -9.5 } },

  salsa: { label: 'Salsa', ico: '🎺', group: 'latina', prompt: 'salsa', aliases: ['salsa'], lufs: -11, width: 1.15, sat: 4, rev: 2, desc: 'Percussão (congas, timbales) e piano montuno presentes, metais brilhantes.', adj: { perc: { g: 16, t: 2, c: 1 }, keys: { g: 12, m: 2, t: 1, p: -15 }, horn: { g: 14, t: 3, p: 50 }, bass: { g: 6, m: 2 }, kick: { g: 4, b: 1 }, voz: { g: 4, r: 2 }, coro: { g: 10, p: 15 } }, ai: { voz: 0.5, width: 1.15, rev: 12, del: 5, duck: 3, bright: 1.8, comp: 1.1, lufs: -11 } },
  cumbia: { label: 'Cumbia', ico: '🪗', group: 'latina', prompt: 'cumbia', aliases: ['cumbia'], lufs: -11, width: 1, sat: 3, rev: 2, desc: 'Acordeão e guacharaca na frente, baixo dançante e grave redondo.', adj: { sanfona: { g: 14, m: 2, t: 1 }, perc: { g: 12, t: 2 }, bass: { g: 6, b: 2 }, kick: { g: 6, b: 2 }, guitar: { g: 4, r: 2 }, voz: { r: 2, d: 4 } }, ai: { voz: 1, width: 1, rev: 12, del: 6, duck: 4, bright: 1.3, comp: 1.1, lufs: -11 } },
  reggaeton: { label: 'Reggaeton', ico: '🏙️', group: 'latina', prompt: 'reggaeton', aliases: ['reggaeton', 'regueton', 'reguetón', 'latin', 'urbano', 'latin urban'], lufs: -9, width: 0.85, sat: 5, rev: -4, desc: 'Dembow seco e forte, 808 presente, voz na cara e pouco reverb.', adj: { kick: { g: 12, b: 4 }, bass: { g: 12, b: 4, t: -2 }, voz: { g: 6, r: -6, d: 6, t: 2 }, hat: { g: 8, t: 3 }, perc: { g: 6, t: 1 }, keys: { g: 4, t: 1 } }, ai: { voz: 0.5, width: 0.85, rev: 6, del: 8, duck: 6, bright: 2, comp: 1.3, lufs: -9 } },
  reggae: { label: 'Reggae', ico: '🌿', group: 'latina', prompt: 'reggae', aliases: ['reggae', 'roots reggae', 'dancehall'], lufs: -12, width: 1.1, sat: 4, rev: 2, desc: 'Baixo e bumbo redondos, guitarra skank no lado, órgão e caixa no aro.', adj: { bass: { g: 10, b: 3, m: 1 }, kick: { g: 6, b: 3 }, guitar: { g: 6, m: 2, h: 140, r: 2, p: 15 }, keys: { g: 8, r: 4, p: -10 }, snare: { g: 2, r: 4 }, voz: { r: 4, d: 6 } }, ai: { voz: 0.5, width: 1.1, rev: 14, del: 8, duck: 3, bright: 1, comp: 0.9, lufs: -12 } },

  funk: { label: 'Funk americano', ico: '🕺', group: 'black', prompt: 'funk', aliases: ['funk', 'funk americano', 'us funk', 'p-funk', 'funk eua'], lufs: -10, width: 0.9, sat: 8, rev: -4, desc: 'Grave seco e forte, baixo slap no médio, guitarra wah e pouco reverb.', adj: { kick: { g: 12, b: 4 }, bass: { g: 10, b: 3, m: 2 }, voz: { g: 4, r: -6, d: 2 }, hat: { g: 6, t: 2 }, guitar: { g: 8, m: 3, s: 6 } }, ai: { voz: 0.5, width: 0.85, rev: 6, del: 4, duck: 6, bright: 2, comp: 1.3, lufs: -10 } },
  rnb: { label: 'R&B', ico: '💜', group: 'black', prompt: 'r&b', aliases: ['rnb', 'r&b', 'r and b', 'rhythm and blues'], lufs: -11, width: 1.1, sat: 5, rev: 5, desc: 'Voz sedosa com delay, baixo quente, pads largos e agudos suaves.', adj: { voz: { g: 6, r: 6, d: 10, t: 2 }, coro: { g: 10, r: 8, p: 20 }, bass: { g: 6, b: 2, m: 1 }, keys: { g: 8, r: 8, p: 20 }, kick: { g: 4, b: 2 }, hat: { g: 4, t: 1 }, guitar: { r: 4, d: 4 } }, ai: { voz: 1, width: 1.1, rev: 16, del: 12, duck: 4, bright: 1.8, comp: 1.1, lufs: -11 } },
  soul: { label: 'Soul', ico: '❤️', group: 'black', prompt: 'soul', aliases: ['soul', 'motown', 'neo soul', 'neo-soul'], lufs: -12, width: 1.05, sat: 8, rev: 5, desc: 'Voz grande no médio, órgãos e metais quentes, saturação analógica.', adj: { voz: { g: 6, m: 2, r: 6, d: 4 }, horn: { g: 10, m: 2, r: 4 }, keys: { g: 10, r: 6, s: 4 }, bass: { g: 4, b: 2, m: 1 }, drums: { r: 4 }, guitar: { g: 4, r: 4, s: 4 } }, ai: { voz: 1, width: 1.05, rev: 16, del: 7, duck: 2, bright: 1.2, comp: 0.9, lufs: -12 } },
  jazz: { label: 'Jazz', ico: '🎷', group: 'black', prompt: 'jazz', aliases: ['jazz'], lufs: -14, width: 1.1, sat: 2, rev: 6, desc: 'Mais dinâmica, piano e sopros abertos, compressão leve.', adj: { keys: { g: 10, r: 6, c: 0 }, horn: { g: 8, r: 6 }, drums: { g: -4, c: 0 }, bass: { g: -2, c: 0 }, voz: { c: 0, r: 6 } }, ai: { voz: 0.5, width: 1.1, rev: 18, del: 3, duck: 0, bright: 0.8, comp: 0.7, lufs: -16 } },
  'jazz-fusion': { label: 'Jazz fusion', ico: '⚡', group: 'black', prompt: 'jazz fusion', aliases: ['jazz fusion', 'fusion', 'jazz-fusion', 'jazzfusion'], lufs: -14, width: 1.15, sat: 6, rev: 4, desc: 'Piano/Rhodes e guitarra definidos, baixo presente, bateria com ataque e boa dinâmica.', adj: { keys: { g: 10, m: 2, r: 6, p: -5 }, guitar: { g: 10, m: 3, t: 1, s: 6 }, bass: { g: 6, m: 3, t: -1 }, drums: { g: 2, c: 0, t: 1 }, horn: { g: 6, r: 4 }, voz: { c: 0, r: 4 } }, ai: { voz: 0, width: 1.15, rev: 14, del: 4, duck: 2, bright: 1.2, comp: 0.8, lufs: -14 } },
  blues: { label: 'Blues', ico: '🎸', group: 'black', prompt: 'blues', aliases: ['blues'], lufs: -12, width: 1, sat: 10, rev: 3, desc: 'Guitarra no meio, voz presente e baixo redondo.', adj: { guitar: { g: 12, m: 3, t: 1, r: 4, s: 8 }, voz: { g: 4, r: 4, d: 4 }, bass: { b: 2, g: 4 }, drums: { r: 2 }, keys: { r: 4 } }, ai: { voz: 0.5, width: 1, rev: 14, del: 6, duck: 2, bright: 1, comp: 0.9, lufs: -12 } },

  rock: { label: 'Rock', ico: '🤘', group: 'rock', prompt: 'rock', aliases: ['rock', 'rock and roll', 'classic rock'], lufs: -10.5, width: 1.15, sat: 12, rev: -2, desc: 'Guitarras presentes, bateria com ataque e menos ambiência.', adj: { guitar: { g: 12, m: 2, t: 1, r: -4, s: 8 }, drums: { g: 6, c: 1 }, kick: { g: 6, b: 2 }, bass: { g: 4, m: 1 }, voz: { g: 4, r: -2 } }, ai: { voz: -1, width: 1.15, rev: 10, del: 4, duck: 3, bright: 1, comp: 1.2, lufs: -12 } },
  metal: { label: 'Metal', ico: '⚔️', group: 'rock', prompt: 'metal', aliases: ['metal', 'heavy metal', 'thrash', 'hard rock'], lufs: -9.5, width: 1.2, sat: 18, rev: -3, desc: 'Guitarras saturadas em estéreo, bumbo seco e definido, voz na frente.', adj: { guitar: { g: 14, m: -2, t: 2, r: -6, s: 16, p: 45 }, drums: { g: 8, c: 1, t: 2 }, kick: { g: 10, b: 3, m: -3, t: 2 }, bass: { g: 6, m: 2, t: -2, s: 4 }, voz: { g: 6, r: -4, t: 2, m: 1 }, hat: { g: 4, t: 2 } }, ai: { voz: 0, width: 1.2, rev: 6, del: 2, duck: 4, bright: 1.5, comp: 1.3, lufs: -9.5 } },

  pop: { label: 'Pop', ico: '⭐', group: 'pop', prompt: 'pop', aliases: ['pop'], lufs: -11, width: 1, sat: 4, rev: 2, desc: 'Voz clara na frente, banda equilibrada e brilho controlado.', adj: { voz: { g: 6, t: 2, r: 4, d: 4 }, drums: { g: 2 }, bass: { g: 2 }, guitar: { g: 2, p: 25 }, keys: { g: 4, r: 4 } }, ai: { voz: 0, width: 1, rev: 14, del: 8, duck: 4, bright: 1.5, comp: 1, lufs: -14 } },
  kpop: { label: 'K-pop', ico: '🇰🇷', group: 'pop', prompt: 'k-pop', aliases: ['kpop', 'k-pop', 'k pop'], lufs: -9.5, width: 1.2, sat: 4, rev: 2, desc: 'Voz polida e brilhante, camadas largas, grave justo e mix moderna.', adj: { voz: { g: 8, t: 3, r: 4, d: 6 }, coro: { g: 12, r: 6, p: 20 }, kick: { g: 8, b: 3, t: 1 }, bass: { g: 6, b: 2 }, hat: { g: 8, t: 3, p: 15 }, keys: { g: 6, t: 2, r: 4 }, drums: { g: 4 } }, ai: { voz: 1, width: 1.2, rev: 14, del: 8, duck: 5, bright: 2.2, comp: 1.2, lufs: -9.5 } },
  jpop: { label: 'J-pop', ico: '🇯🇵', group: 'pop', prompt: 'j-pop', aliases: ['jpop', 'j-pop', 'j pop'], lufs: -10, width: 1.15, sat: 3, rev: 3, desc: 'Voz brilhante na frente, teclados claros, bateria com ataque e mix aberta.', adj: { voz: { g: 6, t: 3, r: 4, d: 4 }, keys: { g: 8, t: 2, r: 4 }, drums: { g: 4, t: 1 }, kick: { g: 4, b: 1 }, bass: { g: 2 }, guitar: { g: 4, t: 1 } }, ai: { voz: 1, width: 1.15, rev: 14, del: 6, duck: 4, bright: 2, comp: 1.1, lufs: -10 } },
  acustico: { label: 'Acústico', ico: '🪵', group: 'pop', prompt: 'acústico', aliases: ['acustico', 'acústico', 'acoustic', 'unplugged'], lufs: -16, width: 1, sat: 2, rev: 6, desc: 'Timbres naturais, pouca compressão, voz e violão íntimos.', adj: { voz: { c: 0, r: 6, d: 2 }, violao: { g: 14, c: 0, r: 6 }, guitar: { g: 4, r: 4, s: -4 }, drums: { g: -10, c: 0, r: 4 }, kick: { g: -10 }, bass: { g: -6, c: 0 }, keys: { r: 6 } }, ai: { voz: 1, width: 1, rev: 18, del: 3, duck: 0, bright: 0.5, comp: 0.7, lufs: -16 } },

  house: { label: 'House', ico: '🏠', group: 'eletro', prompt: 'house', aliases: ['house', 'deep house', 'tech house'], lufs: -9, width: 1.15, sat: 5, rev: 1, desc: 'Bumbo no quatro, baixo com groove, hats largos e stabs de synth/piano.', adj: { kick: { g: 14, b: 4, t: 1 }, bass: { g: 10, b: 3, m: 1 }, hat: { g: 10, t: 3, p: 40 }, keys: { g: 8, t: 2, r: 4 }, perc: { g: 6, t: 1 }, voz: { r: 2, d: 6 } }, ai: { voz: 0, width: 1.15, rev: 12, del: 8, duck: 6, bright: 1.8, comp: 1.2, lufs: -9 } },
  edm: { label: 'EDM', ico: '💥', group: 'eletro', prompt: 'edm', aliases: ['edm', 'electronic dance', 'festival', 'big room'], lufs: -8.5, width: 1.25, sat: 7, rev: 0, desc: 'Bumbo e baixo enormes, synths largos, mix brilhante e bem limitada.', adj: { kick: { g: 16, b: 5, t: 2 }, bass: { g: 12, b: 4, t: -2 }, keys: { g: 10, t: 3, r: 4 }, hat: { g: 10, t: 4 }, voz: { g: 2, r: -2, d: 6, t: 2 }, drums: { g: 4 } }, ai: { voz: 0, width: 1.25, rev: 10, del: 8, duck: 7, bright: 2.2, comp: 1.4, lufs: -8.5 } },
  trap: { label: 'Trap', ico: '🧢', group: 'eletro', prompt: 'trap', aliases: ['trap'], lufs: -10, width: 0.9, sat: 6, rev: -3, desc: '808 enorme, hats rápidos, voz seca com delay e caixa/clap secos.', adj: { kick: { g: 12, b: 5 }, bass: { g: 14, b: 5, t: -3 }, hat: { g: 10, t: 4 }, voz: { g: 6, r: -4, d: 10, t: 2 }, snare: { g: 4, t: 2, r: -2 }, keys: { g: 4, r: 2 } }, ai: { voz: 0.5, width: 0.9, rev: 8, del: 12, duck: 6, bright: 2, comp: 1.3, lufs: -11 } },
  lofi: { label: 'Lo-fi', ico: '📻', group: 'eletro', prompt: 'lo-fi', aliases: ['lofi', 'lo-fi', 'lo fi', 'lofi hip hop', 'lo-fi hip hop'], lufs: -14, width: 0.85, sat: 12, rev: 4, desc: 'Mais escuro e quente, saturação de fita, bateria macia e menos agudos.', adj: { voz: { t: -2, r: 6, d: 4, s: 6 }, drums: { g: -4, t: -2, r: 4, s: 8 }, kick: { g: -2, t: -2 }, bass: { g: 2, b: 1, t: -3, s: 4 }, keys: { g: 6, t: -2, r: 8, s: 6 }, guitar: { t: -2, r: 6, s: 4 }, hat: { g: -4, t: -2 } }, ai: { voz: 0, width: 0.85, rev: 16, del: 8, duck: 2, bright: 0.3, comp: 0.8, lufs: -14 } },
  eletronica: { label: 'Eletrônica', ico: '🎧', group: 'eletro', prompt: 'eletrônica', aliases: ['eletronica', 'eletrônica', 'electronic', 'electronica'], lufs: -9.5, width: 1.15, sat: 6, rev: -3, desc: 'Bumbo e baixo fortes, agudos nítidos e mix mais seca.', adj: { kick: { g: 14, b: 4 }, bass: { g: 10, b: 3 }, hat: { g: 8, t: 3 }, keys: { g: 6, t: 2 }, voz: { r: -4, d: 4 } }, ai: { voz: 0, width: 1.15, rev: 8, del: 8, duck: 6, bright: 2, comp: 1.3, lufs: -9.5 } },

  flamenco: { label: 'Flamenco', ico: '🌹', group: 'mundo', prompt: 'flamenco', aliases: ['flamenco'], lufs: -14, width: 0.9, sat: 7, rev: 3, desc: 'Violão de nylon com corpo e ataque, palmas brilhantes e voz com sala.', adj: { violao: { g: 16, m: 3, t: 2, s: 6, r: 2 }, perc: { g: 12, t: 3 }, voz: { g: 4, r: 6, d: 2, m: 1 }, bass: { g: -4 }, kick: { g: -6 }, guitar: { g: 6, m: 2, s: 4 } }, ai: { voz: 1, width: 0.9, rev: 14, del: 4, duck: 0, bright: 1.5, comp: 0.8, lufs: -14 } },
  celtic: { label: 'Celta', ico: '🍀', group: 'mundo', prompt: 'celtic', aliases: ['celtic', 'celta', 'irlandes', 'irlandês', 'folk celta'], lufs: -14, width: 1.15, sat: 2, rev: 6, desc: 'Violino e flauta aéreos, violão natural e reverb de sala.', adj: { strings: { g: 14, r: 10, t: 1, p: 25 }, horn: { g: 8, r: 8, t: 2 }, violao: { g: 10, r: 6, c: 0 }, perc: { g: 4, r: 4 }, drums: { g: -6, c: 0 }, voz: { r: 8, c: 0 }, bass: { g: -4 } }, ai: { voz: 0.5, width: 1.15, rev: 20, del: 4, duck: 0, bright: 1.2, comp: 0.7, lufs: -16 } },
  bollywood: { label: 'Índia / Bollywood', ico: '🇮🇳', group: 'mundo', prompt: 'bollywood', aliases: ['bollywood', 'indian', 'india', 'índia', 'indiana', 'hindi'], lufs: -11, width: 1.2, sat: 4, rev: 6, desc: 'Cordas largas, percussão (tabla) presente, voz com reverb e delay.', adj: { strings: { g: 14, r: 12 }, perc: { g: 12, t: 2, m: 1 }, voz: { g: 6, r: 8, d: 8, t: 1 }, keys: { g: 6, r: 8 }, bass: { g: 2 }, coro: { g: 8, r: 8 } }, ai: { voz: 1, width: 1.2, rev: 20, del: 10, duck: 2, bright: 1.6, comp: 1, lufs: -11 } },
  arabic: { label: 'Árabe', ico: '🌙', group: 'mundo', prompt: 'arabic', aliases: ['arabic', 'arabe', 'árabe', 'middle eastern', 'orientais', 'maqam'], lufs: -13, width: 1.15, sat: 3, rev: 7, desc: 'Voz ornamentada com reverb, oud/cordas e percussão (darbuka) presentes.', adj: { voz: { g: 6, r: 10, d: 6, m: 1 }, strings: { g: 12, r: 10 }, perc: { g: 12, t: 2 }, violao: { g: 6, m: 2, r: 4 }, bass: { g: 0 }, keys: { r: 8 } }, ai: { voz: 1, width: 1.15, rev: 22, del: 8, duck: 1, bright: 1.3, comp: 0.8, lufs: -13 } },
  orquestral: { label: 'Orquestral', ico: '🎻', group: 'mundo', prompt: 'orquestral', aliases: ['orquestral', 'orchestra', 'classical', 'classico', 'clássico'], lufs: -16, width: 1.3, sat: 1, rev: 12, desc: 'Cordas e metais espaçosos, dinâmica ampla e muita ambiência.', adj: { strings: { g: 16, r: 16 }, horn: { g: 10, r: 10 }, keys: { g: 6, r: 10 }, drums: { g: -10, c: 0 }, voz: { r: 8 }, bass: { g: -4 } }, ai: { voz: 0, width: 1.3, rev: 26, del: 2, duck: 0, bright: 0.8, comp: 0.6, lufs: -18 } },
  instrumental: { label: 'Instrumental', ico: '🎼', group: 'mundo', prompt: 'instrumental', aliases: ['instrumental'], lufs: -15, width: 1.05, sat: 2, rev: 4, desc: 'Mix equilibrada e dinâmica, sem priorizar voz, timbres naturais.', adj: { voz: { g: -8, r: 4 }, keys: { g: 8, r: 6 }, guitar: { g: 6, r: 4 }, violao: { g: 6, r: 4 }, strings: { g: 8, r: 8 }, drums: { g: -4, c: 0 }, bass: { g: -2 } }, ai: { voz: 0, width: 1.05, rev: 16, del: 4, duck: 2, bright: 1, comp: 0.8, lufs: -15 } }
};

const DRY = new Set(['kick', 'bass']);

export function styleKeys() {
  return Object.keys(STYLES);
}

export function resolveStyle(value) {
  const needle = normStyle(value);
  if (!needle) return null;
  for (const [id, st] of Object.entries(STYLES)) {
    const names = [id, st.prompt, st.label, ...(st.aliases || [])];
    if (names.some((n) => normStyle(n) === needle)) return { id, ...st };
  }
  return null;
}

export function lyriaAccepted() {
  const set = new Set();
  for (const [id, st] of Object.entries(STYLES)) {
    for (const n of [id, st.prompt, st.label, ...(st.aliases || [])]) {
      const raw = String(n || '').trim();
      if (raw) set.add(raw.toLowerCase());
    }
  }
  return set;
}

export function mixFor(styleKey, role) {
  const st = STYLES[styleKey] || resolveStyle(styleKey);
  if (!st) return null;
  const r = BASE[role] || BASE.other;
  const a = (st.adj && st.adj[role]) || {};
  const v = (k) => (r[k] ?? 0) + (a[k] ?? 0);
  const dry = DRY.has(role);
  const width = st.width ?? 1;
  const sat = st.sat || 0;
  return {
    gain: clamp(v('g'), ...RANGES.gain),
    bass: clamp(v('b'), ...RANGES.bass),
    mid: clamp(v('m'), ...RANGES.mid),
    treble: clamp(v('t'), ...RANGES.treble),
    hpf: clamp(v('h'), ...RANGES.hpf),
    reverb: clamp(Math.max(0, v('r') + (dry ? 0 : (st.rev || 0))), ...RANGES.reverb),
    delay: clamp(Math.max(0, v('d')), ...RANGES.delay),
    drive: clamp(v('s') + (dry ? Math.min(sat, 2) : sat), ...RANGES.drive),
    comp: Object.hasOwn(a, 'c') ? !!a.c : !!r.c,
    pan: clamp(Math.round(v('p') * width), ...RANGES.pan)
  };
}

export function aiGenre(styleKey) {
  const st = STYLES[styleKey] || resolveStyle(styleKey);
  if (!st) return null;
  const ai = st.ai || {};
  return {
    label: st.label,
    voz: ai.voz ?? 0,
    width: ai.width ?? st.width ?? 1,
    rev: ai.rev ?? Math.max(0, 10 + (st.rev || 0)),
    del: ai.del ?? 6,
    duck: ai.duck ?? 3,
    bright: ai.bright ?? 1.5,
    comp: ai.comp ?? 1,
    lufs: ai.lufs ?? st.lufs
  };
}

export function allAiGenres() {
  return Object.fromEntries(styleKeys().map((k) => [k, aiGenre(k)]));
}

export function groupedStyles() {
  return GROUPS.map((g) => ({
    ...g,
    styles: styleKeys().filter((k) => STYLES[k].group === g.id).map((id) => ({ id, ...STYLES[id] }))
  })).filter((g) => g.styles.length);
}

export function promptGroups() {
  return groupedStyles().map((g) => ({
    id: g.id,
    label: g.label,
    options: g.styles.map((s) => ({ value: s.prompt, label: s.label }))
  }));
}

export function fillEstiloSelect(sel, { includeLivre = true, current } = {}) {
  if (!sel) return;
  const keep = current ?? sel.value;
  sel.replaceChildren();
  if (includeLivre) {
    const livre = new Option('Livre (uso o texto acima)', 'livre');
    sel.add(livre);
  }
  for (const g of promptGroups()) {
    const og = document.createElement('optgroup');
    og.label = g.label;
    for (const o of g.options) og.append(new Option(o.label, o.value));
    sel.append(og);
  }
  const values = [...sel.options].map((o) => o.value);
  const resolved = keep && resolveStyle(keep);
  const next = values.includes(keep) ? keep : (resolved && values.includes(resolved.prompt) ? resolved.prompt : (includeLivre ? 'livre' : values[0]));
  if (next) sel.value = next;
}

if (typeof globalThis !== 'undefined') globalThis.APSEstilosData = {
  GROUPS, BASE, RANGES, STYLES, clamp, normStyle, styleKeys, resolveStyle,
  lyriaAccepted, mixFor, aiGenre, allAiGenres, groupedStyles, promptGroups, fillEstiloSelect
};
