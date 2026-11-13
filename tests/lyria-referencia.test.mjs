import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MAX_AUDIO,
  MAX_DURATION_SEC,
  REF_DAILY,
  REF_PER_IP_HOUR,
  DAILY_GLOBAL,
  NOTICE,
  REF_NOTICE,
  normalizeMime,
  sanitizeDesc,
  composeReferenceUserPrompt,
  parseFidelidade,
  parseDireitos,
  buildPrompt,
  wavDurationSeconds,
  referenceReady,
  extractJsonText
} from '../workers/aps-lyria/lib.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(root, 'musica-ia.html'), 'utf8');
const client = readFileSync(join(root, 'aps-lyria.js'), 'utf8');

function pcmWav(seconds = 1, sampleRate = 8000) {
  const samples = sampleRate * seconds;
  const dataSize = samples * 2;
  const buf = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);
  const write = (i, s) => { for (let n = 0; n < s.length; n++) bytes[i + n] = s.charCodeAt(n); };
  write(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  write(8, 'WAVE');
  write(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, 'data');
  view.setUint32(40, dataSize, true);
  return bytes;
}

test('limites de tamanho e duração permanecem apertados', () => {
  assert.equal(MAX_AUDIO, 10 * 1024 * 1024);
  assert.equal(MAX_DURATION_SEC, 120);
  assert.equal(REF_DAILY, 15);
  assert.equal(REF_PER_IP_HOUR, 3);
  assert.equal(DAILY_GLOBAL, 20);
});

test('normalizeMime aceita tipos comuns de exportação do estúdio', () => {
  assert.equal(normalizeMime('audio/mpeg', 'mix.mp3'), 'audio/mp3');
  assert.equal(normalizeMime('audio/x-wav', 'mix.wav'), 'audio/wav');
  assert.equal(normalizeMime('', 'export.m4a'), 'audio/m4a');
  assert.equal(normalizeMime('audio/ogg; codecs=opus', 'loop.ogg'), 'audio/ogg');
  assert.equal(normalizeMime('application/octet-stream', 'song.flac'), 'audio/flac');
  assert.equal(normalizeMime('text/plain', 'notes.txt'), '');
});

test('wavDurationSeconds lê um WAV PCM curto', () => {
  const dur = wavDurationSeconds(pcmWav(2, 8000));
  assert.ok(Math.abs(dur - 2) < 0.01);
  assert.equal(wavDurationSeconds(new Uint8Array([1, 2, 3])), null);
});

test('sanitizeDesc limpa campos e ignora letra se vier na resposta', () => {
  const desc = sanitizeDesc({
    genero: '  Forró pé de serra  ',
    bpm: 98.4,
    tom: 'Dó maior',
    clima: 'alegre',
    instrumentos: ['sanfona', 'zabumba', 'triângulo', '', 12],
    estrutura: 'intro 0:00-0:08 e refrão',
    acordes: 'I-V-vi-IV',
    groove: 'xote marcado no 2 e no 4',
    contornoMelodia: 'frases curtas ascendentes',
    caracterMix: 'sanfona na frente, grave da zabumba presente',
    resumo: 'Forró instrumental com sanfona e zabumba, andamento dançante.',
    eMusica: true,
    letra: 'não deve aparecer',
    lyrics: 'também não'
  });
  assert.equal(desc.genero, 'Forró pé de serra');
  assert.equal(desc.bpm, 98);
  assert.deepEqual(desc.instrumentos, ['sanfona', 'zabumba', 'triângulo']);
  assert.equal(desc.acordes, 'I-V-vi-IV');
  assert.equal(desc.groove, 'xote marcado no 2 e no 4');
  assert.equal(desc.caracterMix, 'sanfona na frente, grave da zabumba presente');
  assert.equal(desc.eMusica, true);
  assert.equal('letra' in desc, false);
  assert.equal('lyrics' in desc, false);
});

test('sanitizeDesc rejeita bpm impossível e marca áudio que não é música', () => {
  const desc = sanitizeDesc({ bpm: 12, resumo: 'sirene', eMusica: false });
  assert.equal(desc.bpm, null);
  assert.equal(desc.eMusica, false);
  assert.equal(referenceReady(desc), 'Este áudio não parece uma música que dê para usar de referência. Envie uma gravação musical de até 2 minutos.');
  assert.ok(referenceReady(sanitizeDesc({ eMusica: true, resumo: 'curto' })));
  assert.equal(referenceReady(sanitizeDesc({ eMusica: true, resumo: 'Forró instrumental com sanfona e zabumba bem marcados.' })), null);
});

test('o pedido para o Lyria deixa claro que é uma música nova, não uma edição', () => {
  const prompt = composeReferenceUserPrompt({
    genero: 'forró',
    bpm: 100,
    tom: 'Dó',
    clima: 'festeiro',
    instrumentos: ['sanfona', 'zabumba'],
    estrutura: 'intro e refrão',
    resumo: 'Forró pé de serra instrumental, dançante, com sanfona na frente.',
    eMusica: true
  }, 'quero um pouco mais de triângulo');
  assert.match(prompt, /música original nova/i);
  assert.match(prompt, /não é uma edição/i);
  assert.match(prompt, /sanfona/);
  assert.match(prompt, /triângulo/);
  assert.match(prompt, /100 BPM/);
  const built = buildPrompt(prompt, 'forró', '', 'clip');
  assert.match(built, /30 segundos/);
  assert.match(built, /Do not imitate/);
});

test('extractJsonText aceita JSON puro ou em bloco', () => {
  assert.equal(extractJsonText({ candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }] }), '{"ok":true}');
  assert.equal(extractJsonText({ candidates: [{ content: { parts: [{ text: '```json\n{"ok":1}\n```' }] } }] }), '{"ok":1}');
});

test('avisos da página e do cliente nunca apresentam o resultado como a gravação original', () => {
  assert.match(html, /não edita/i);
  assert.match(html, /música <strong>nova<\/strong>/i);
  assert.match(html, /Plano premium/);
  assert.match(html, /APS Maestro/);
  assert.doesNotMatch(html, /Google Lyria|SynthID/i);
  assert.match(html, /id="baixar"/);
  assert.match(html, /id="abrirSeparador"/);
  assert.match(html, /id="abrirDaw"/);
  assert.doesNotMatch(html, /editar a sua gravação|gravação editada pela IA da sua música original/i);
  assert.match(REF_NOTICE, /criação nova inspirada/);
  assert.match(REF_NOTICE, /não uma edição do áudio original/);
  assert.match(NOTICE, /APS Maestro/);
  assert.match(NOTICE, /não a sua gravação original/);
  assert.match(client, /não a sua gravação editada/);
  assert.match(client, /API_BASE \+ '\/referencia'/);
  assert.match(html, /id="analisarRef"/);
  assert.match(client, /\$\('analisarRef'\)/);
  assert.equal(client.includes('index.html'), false);
});

test('avisos e limites do cliente coincidem com o servidor', () => {
  assert.match(client, /const MAX_AUDIO = 10 \* 1024 \* 1024/);
  assert.match(client, /const MAX_DURATION_SEC = 120/);
  assert.match(html, /até 2 minutos e 10 MB/);
  assert.match(html, /15 análises por dia/);
});

const DESC = {
  genero: 'forró',
  bpm: 100,
  tom: 'G major',
  clima: 'festeiro',
  instrumentos: ['sanfona', 'zabumba'],
  estrutura: 'intro 0:00-0:08 e refrão 0:08-0:30',
  acordes: 'I-V-vi-IV',
  groove: 'xote no 2 e no 4',
  contornoMelodia: 'frases curtas na sanfona',
  caracterMix: 'sanfona na frente',
  resumo: 'Forró pé de serra instrumental, dançante, com sanfona na frente.',
  eMusica: true
};

test('parseFidelidade e parseDireitos aceitam os valores da tela', () => {
  assert.equal(parseFidelidade(3), 'alta');
  assert.equal(parseFidelidade('parecido com o original'), 'alta');
  assert.equal(parseFidelidade(2), 'media');
  assert.equal(parseFidelidade('1'), 'baixa');
  assert.equal(parseFidelidade('bem livre'), 'baixa');
  assert.equal(parseFidelidade(''), 'media');
  assert.equal(parseFidelidade('xyz'), null);
  assert.equal(parseDireitos(true), true);
  assert.equal(parseDireitos('1'), true);
  assert.equal(parseDireitos('on'), true);
  assert.equal(parseDireitos('0'), false);
  assert.equal(parseDireitos(''), false);
});

test('alta fidelidade trava BPM, tom, instrumentação e groove no pedido ao Lyria', () => {
  const alta = composeReferenceUserPrompt(DESC, 'quero manter a sanfona', 'alta');
  assert.match(alta, /bem parecida/i);
  assert.match(alta, /Andamento exato: 100 BPM/);
  assert.match(alta, /Tom ou escala \(mantenha\): G major/);
  assert.match(alta, /Instrumentação travada: sanfona, zabumba/);
  assert.match(alta, /Groove \(siga de perto\): xote no 2 e no 4/);
  assert.match(alta, /Harmonia: I-V-vi-IV/);
  assert.match(alta, /não deve ser apresentado como o áudio original/i);
  assert.match(alta, /Não é uma edição|NÃO é uma edição/i);
  assert.doesNotMatch(alta, /apenas inspirada nesta descrição de estilo/i);
  const baixa = composeReferenceUserPrompt(DESC, '', 'baixa');
  assert.match(baixa, /apenas inspirada nesta descrição de estilo/i);
  assert.match(baixa, /Andamento aproximado: 100 BPM/);
  assert.doesNotMatch(baixa, /Andamento exato/);
  assert.doesNotMatch(baixa, /Instrumentação travada/);
  const media = composeReferenceUserPrompt(DESC, '', 'media');
  assert.match(media, /pode variar o arranjo/i);
  assert.match(media, /Harmonia/);
});

test('a página tem o controle de fidelidade, o aviso de direitos e nunca trata o resultado como o original', () => {
  assert.match(html, /id="fidelidade"/);
  assert.match(html, /Parecido com o original/);
  assert.match(html, /Bem livre/);
  assert.match(html, /id="refDireitos"/);
  assert.match(html, /não substitui o original/);
  assert.match(html, /aps-lyria\.js\?v=456/);
  assert.match(client, /fidelidade/);
  assert.match(client, /direitos/);
  assert.match(client, /FIDELIDADE_LEVEL/);
  assert.match(client, /não a sua gravação editada/);
});
