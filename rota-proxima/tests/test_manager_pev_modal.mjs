import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../static/app.js', import.meta.url), 'utf8');

function extract(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(start, -1, `Função ausente: ${startMarker}`);
  assert.notEqual(end, -1, `Limite ausente: ${endMarker}`);
  return source.slice(start, end);
}

test('gerente comercial visualiza o botão de cadastrar PEV, sem ações exclusivas do administrador', async () => {
  const state = { user: { role: 'commercial_manager' }, pevs: [] };
  const page = { innerHTML: '' };
  const add = {};
  const search = {};
  const filter = {};
  let rendered = 0;
  const context = vm.createContext({
    state,
    async api(path) {
      assert.equal(path, '/api/pevs');
      return { items: [] };
    },
    $(selector) {
      if (selector === '#page') return page;
      if (selector === '#addPev') return add;
      if (selector === '#pevSearch') return search;
      if (selector === '#pevFilter') return filter;
      if (selector === '#geocodeMissingPevs' || selector === '#pevTrash') return null;
      throw new Error(`Elemento inesperado: ${selector}`);
    },
    openPevModal() {},
    drawPevList() { rendered += 1; },
  });

  vm.runInContext(
    extract('async function renderPevs()', 'function drawPevList()'),
    context,
    { filename: 'static/app.js' },
  );
  await context.renderPevs();

  assert.match(page.innerHTML, /id="addPev"/);
  assert.match(page.innerHTML, /\+ Novo PEV/);
  assert.doesNotMatch(page.innerHTML, /id="geocodeMissingPevs"/);
  assert.doesNotMatch(page.innerHTML, /id="pevTrash"/);
  assert.equal(typeof add.onclick, 'function');
  assert.equal(typeof search.oninput, 'function');
  assert.equal(typeof filter.onchange, 'function');
  assert.equal(rendered, 1);
});

test('cadastro pelo gerente carrega os comerciais e envia o responsável selecionado', async () => {
  const owner = '00000000-0000-4000-8000-000000000123';
  const calls = [];
  const state = { user: { role: 'commercial_manager', name: 'Gerente' }, commercials: [] };
  const values = {
    name: 'Novo PEV',
    commercial_owner_id: owner,
    address_mode: 'manual',
    street: 'Rua das Flores',
    city: 'Sorocaba',
    state: 'SP',
    whatsapp: '1',
    favorite: '0',
    lat: '',
    lng: '',
  };
  const input = () => ({ value: '', addEventListener() {} });
  const form = {
    values,
    elements: Object.fromEntries(['cep', 'number', 'street', 'district', 'city', 'state'].map(name => [name, input()])),
    address_mode: { value: 'manual' },
    cep: input(),
    street: input(),
    district: input(),
    city: input(),
    state: input(),
    lat: input(),
    lng: input(),
  };
  const cepWrap = { classList: { toggle() {} } };
  const lookup = {};
  const currentPosition = {};
  const dialog = { closed: false, close() { this.closed = true; } };
  let html = '';

  class FakeFormData {
    constructor(target) { this.target = target; }
    entries() { return Object.entries(this.target.values)[Symbol.iterator](); }
  }

  const context = vm.createContext({
    state,
    FormData: FakeFormData,
    esc: value => String(value ?? ''),
    async api(path, options) {
      calls.push({ path, options: options ? JSON.parse(JSON.stringify(options)) : undefined });
      if (path === '/api/commercials') return { items: [{ id: owner, name: 'Comercial responsável' }] };
      if (path === '/api/pevs') return { id: 42, geocode: null };
      throw new Error(`Requisição inesperada: ${path}`);
    },
    modal(content) { html = content; },
    $(selector) {
      if (selector === '#pevForm') return form;
      if (selector === '#cepWrap') return cepWrap;
      if (selector === '#lookupCep') return lookup;
      if (selector === '#useCurrentPevPos') return currentPosition;
      if (selector === '#modal') return dialog;
      throw new Error(`Elemento inesperado: ${selector}`);
    },
    $$() { return []; },
    toast() {},
    renderPevs() {},
    getPosition() {},
    digits: value => value,
  });

  vm.runInContext(
    extract('async function openPevModal(pev=null)', 'async function renderRequests()'),
    context,
    { filename: 'static/app.js' },
  );
  await context.openPevModal();

  assert.match(html, /name="commercial_owner_id"/);
  assert.match(html, /Comercial responsável/);
  assert.match(html, new RegExp(owner));
  assert.match(html, /Administrador e o Gerente Comercial/);

  let prevented = false;
  await form.onsubmit({ preventDefault() { prevented = true; } });

  assert.equal(prevented, true);
  assert.equal(dialog.closed, true);
  assert.equal(calls[0].path, '/api/commercials');
  assert.equal(calls[1].path, '/api/pevs');
  assert.equal(calls[1].options.method, 'POST');
  assert.equal(calls[1].options.body.commercial_owner_id, owner);
  assert.equal(calls[1].options.body.whatsapp, true);
  assert.equal(calls[1].options.body.favorite, false);
});
