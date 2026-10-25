import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const source = readFileSync(new URL('../aps-daw-video.js', import.meta.url), 'utf8');

function setup({hasPanel = true, secure = true} = {}) {
  let permissions = 0;
  const elements = new Map();
  const elem = id => {
    if (!elements.has(id)) elements.set(id, {
      value: 'user', checked: false, hidden: true, disabled: false, textContent: '',
      style: {}, options: [], addEventListener() {}, removeAttribute() {},
      pause() {}, play: async () => {}, load() {}, replaceChildren() {},
      after() {}, append() {}, setAttribute() {}, srcObject: null
    });
    return elements.get(id);
  };
  const doc = {
    head: {append() {}},
    getElementById(id) { return id === 'recordHelp' && !hasPanel ? null : elem(id); },
    createElement() { return {className: '', innerHTML: '', textContent: ''}; }
  };
  const window = {isSecureContext: secure, addEventListener() {}};
  const navigator = {mediaDevices: {getUserMedia() { permissions++; throw Error('Não deve abrir'); }}};
  runInNewContext(source, {window, document: doc, navigator, setTimeout, clearTimeout, performance, URL});
  return {window, elem, get permissions() { return permissions; }};
}

test('script ignora páginas sem painel de gravação', () => {
  const {window, permissions} = setup({hasPanel: false});
  assert.equal(window.APSDawVideo, undefined);
  assert.equal(permissions, 0);
});

test('ao carregar DAW, câmera e microfone não pedem permissão', async () => {
  const fixture = setup();
  assert.ok(fixture.window.APSDawVideo);
  assert.equal(fixture.permissions, 0);
  assert.equal(fixture.window.APSDawVideo.isEnabled(), false);
  assert.equal(await fixture.window.APSDawVideo.prepare(), false);
  assert.equal(fixture.permissions, 0);
});

test('em contexto não seguro, vídeo recusa sem pedir câmera', async () => {
  const fixture = setup({secure: false});
  fixture.elem('apsCamTake').checked = true;
  await assert.rejects(fixture.window.APSDawVideo.prepare(), /HTTPS/);
  assert.equal(fixture.permissions, 0);
});
