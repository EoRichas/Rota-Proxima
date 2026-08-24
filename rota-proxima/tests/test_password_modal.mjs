import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../static/app.js', import.meta.url), 'utf8');
const start = source.indexOf('function openPasswordModal(required=false)');
const end = source.indexOf('function sendPresenceHeartbeat()', start);

assert.notEqual(start, -1, 'A interface precisa definir o formulário de troca de senha.');
assert.notEqual(end, -1, 'Não foi possível isolar o formulário de troca de senha.');

function createScenario({ error } = {}) {
  const calls = [];
  const notices = [];
  const listeners = new Map();
  const state = { user: { must_change_password: true }, page: 'dashboard' };
  const form = { onsubmit: null };
  const button = { disabled: false };
  const dialog = {
    closeCount: 0,
    addEventListener(type, handler) { listeners.set(type, handler); },
    removeEventListener(type, handler) {
      if (listeners.get(type) === handler) listeners.delete(type);
    },
    close() { this.closeCount += 1; },
  };
  let html = '';

  class FakeFormData {
    constructor(target) { this.values = target.values; }
    [Symbol.iterator]() { return Object.entries(this.values)[Symbol.iterator](); }
  }

  const context = vm.createContext({
    state,
    FormData: FakeFormData,
    modal(content) { html = content; return dialog; },
    $(selector) {
      if (selector === '#passwordForm') return form;
      if (selector === '#savePassword') return button;
      throw new Error(`Elemento inesperado: ${selector}`);
    },
    async api(path, options) {
      calls.push({ path, options: JSON.parse(JSON.stringify(options)) });
      if (error) throw new Error(error);
      return { ok: true };
    },
    toast(message, type) { notices.push({ message, type }); },
    renderUsers() {},
  });

  vm.runInContext(source.slice(start, end), context, { filename: 'static/app.js' });

  return {
    button,
    calls,
    dialog,
    form,
    get html() { return html; },
    listeners,
    notices,
    open(required) { return context.openPasswordModal(required); },
    state,
    async submit(values) {
      let prevented = false;
      await form.onsubmit({
        preventDefault() { prevented = true; },
        target: { values },
      });
      assert.equal(prevented, true);
    },
  };
}

test('a troca obrigatória bloqueia saída e salva a nova senha', async () => {
  const scenario = createScenario();

  scenario.open(true);

  assert.match(scenario.html, /Definir nova senha/);
  assert.match(scenario.html, /name="current_password"/);
  assert.match(scenario.html, /name="new_password"/);
  assert.match(scenario.html, /name="confirm_password"/);
  assert.match(scenario.html, /minlength="8"/);
  assert.doesNotMatch(scenario.html, /modal-close/);

  let cancelled = false;
  scenario.listeners.get('cancel')({ preventDefault() { cancelled = true; } });
  assert.equal(cancelled, true);

  await scenario.submit({
    current_password: 'temporaria-123',
    new_password: 'definitiva-456',
    confirm_password: 'definitiva-456',
  });

  assert.deepEqual(scenario.calls, [{
    path: '/api/change-password',
    options: {
      method: 'POST',
      body: { current_password: 'temporaria-123', new_password: 'definitiva-456' },
    },
  }]);
  assert.equal(scenario.state.user.must_change_password, false);
  assert.equal(scenario.dialog.closeCount, 1);
  assert.equal(scenario.listeners.has('cancel'), false);
  assert.deepEqual(scenario.notices, [{ message: 'Senha alterada com sucesso.', type: 'success' }]);
});

test('a troca opcional permite fechar o formulário', () => {
  const scenario = createScenario();

  scenario.open(false);

  assert.match(scenario.html, /Alterar minha senha/);
  assert.match(scenario.html, /modal-close/);
  assert.match(scenario.html, />Cancelar</);
  assert.equal(scenario.listeners.has('cancel'), false);
});

test('senhas divergentes ou reaproveitadas não são enviadas', async () => {
  const scenario = createScenario();
  scenario.open(true);

  await scenario.submit({
    current_password: 'temporaria-123',
    new_password: 'definitiva-456',
    confirm_password: 'diferente-789',
  });
  await scenario.submit({
    current_password: 'temporaria-123',
    new_password: 'temporaria-123',
    confirm_password: 'temporaria-123',
  });

  assert.equal(scenario.calls.length, 0);
  assert.equal(scenario.dialog.closeCount, 0);
  assert.deepEqual(scenario.notices, [
    { message: 'A confirmação da nova senha não confere.', type: 'error' },
    { message: 'A nova senha precisa ser diferente da senha atual.', type: 'error' },
  ]);
});

test('senha atual incorreta mantém o formulário aberto para nova tentativa', async () => {
  const scenario = createScenario({ error: 'Senha atual incorreta' });
  scenario.open(true);

  await scenario.submit({
    current_password: 'senha-errada',
    new_password: 'definitiva-456',
    confirm_password: 'definitiva-456',
  });

  assert.equal(scenario.calls.length, 1);
  assert.equal(scenario.dialog.closeCount, 0);
  assert.equal(scenario.button.disabled, false);
  assert.equal(scenario.state.user.must_change_password, true);
  assert.deepEqual(scenario.notices, [{ message: 'Senha atual incorreta', type: 'error' }]);
});
