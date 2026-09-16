import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../static/mobile-access.js', import.meta.url), 'utf8');

class ClassList {
  constructor() { this.values = new Set(); }
  toggle(name, force) {
    const enabled = force === undefined ? !this.values.has(name) : Boolean(force);
    if (enabled) this.values.add(name); else this.values.delete(name);
    return enabled;
  }
  contains(name) { return this.values.has(name); }
}

function createButton() {
  const listeners = new Map();
  const attributes = new Map([['aria-label', 'Instalar Rota Próxima no celular']]);
  const label = { textContent: 'Baixar no celular' };
  return {
    classList: new ClassList(),
    dataset: {},
    title: 'Instalar Rota Próxima no celular',
    addEventListener(type, handler) { listeners.set(type, handler); },
    getAttribute(name) { return attributes.get(name) || null; },
    setAttribute(name, value) { attributes.set(name, value); },
    querySelector(selector) { return selector === 'b' ? label : null; },
    async click() { return listeners.get('click')?.({ preventDefault() {} }); },
    listeners,
    label,
  };
}

function createScenario({ userAgent = 'Mozilla/5.0' } = {}) {
  const button = createButton();
  const dialog = { open: false, close() { this.open = false; } };
  const windowListeners = new Map();
  const observer = { disconnected: false, observe() {}, disconnect() { this.disconnected = true; } };
  const modalCalls = [];
  const context = vm.createContext({
    console,
    window: {
      navigator: { userAgent, standalone: false },
      matchMedia: () => ({ matches: false }),
      addEventListener(type, handler) { windowListeners.set(type, handler); },
    },
    document: {
      documentElement: {},
      addEventListener() {},
      getElementById(id) {
        if (id === 'installMobileApp') return button;
        if (id === 'modal') return dialog;
        return null;
      },
    },
    MutationObserver: function FakeMutationObserver() { return observer; },
    modal(html) { modalCalls.push(html); },
    toast() {},
  });
  vm.runInContext(source, context, { filename: 'static/mobile-access.js' });
  return { button, dialog, observer, modalCalls, windowListeners };
}

{
  const scenario = createScenario({ userAgent: 'Mozilla/5.0 (Linux; Android 14)' });
  assert.equal(scenario.button.dataset.mobileAccessBound, '1');
  assert.equal(scenario.observer.disconnected, true, 'observer legado deve ser desligado após encontrar o botão');

  await scenario.button.click();
  assert.equal(scenario.modalCalls.length, 1, 'o clique sem prompt deve abrir instruções');
  assert.match(scenario.modalCalls[0], /Instalar Rota Próxima/);
  assert.match(scenario.modalCalls[0], /menu/);
}

{
  const scenario = createScenario();
  let promptCalls = 0;
  let prevented = false;
  const installEvent = {
    preventDefault() { prevented = true; },
    async prompt() { promptCalls += 1; },
    userChoice: Promise.resolve({ outcome: 'accepted' }),
  };

  scenario.windowListeners.get('beforeinstallprompt')(installEvent);
  await scenario.button.click();
  assert.equal(prevented, true);
  assert.equal(promptCalls, 1, 'o prompt nativo deve ser acionado uma vez');
  assert.equal(scenario.modalCalls.length, 0, 'não deve abrir instruções quando o prompt nativo existe');
}

console.log('mobile access: botão e fallback de instalação aprovados');
