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

function installPlannerHelpers(context) {
  vm.runInContext(
    extract('function normalizeServiceType', 'async function renderPlanner()'),
    context,
    { filename: 'static/app.js' },
  );
}

test('alterar Coleta/Entrega atualiza também a prévia já calculada', () => {
  const stop = { pev: { id: 10 }, service_type: 'delivery' };
  const state = {
    plannerServiceTypes: { 10: 'delivery' },
    routePreview: { stops: [stop] },
  };
  const context = vm.createContext({ state });
  installPlannerHelpers(context);

  const value = context.setPlannerServiceType(10, 'collection');

  assert.equal(value, 'collection');
  assert.equal(state.plannerServiceTypes[10], 'collection');
  assert.equal(stop.service_type, 'collection');
});

test('salvar usa o tipo atual do seletor, não o tipo antigo da prévia', async () => {
  const calls = [];
  const state = {
    plannerServiceTypes: { 10: 'collection' },
    routePreview: {
      total_distance_m: 1000,
      total_duration_s: 120,
      stops: [{
        pev: { id: 10 },
        service_type: 'delivery',
        priority: 'normal',
        distance_m: 1000,
        duration_s: 120,
      }],
    },
    requestSelection: [],
    plannerExactTimes: {},
  };
  const elements = {
    '#routeDriver': { value: 'driver-1' },
    '#routeName': { value: 'Rota de coleta' },
    '#routeDate': { value: '2026-09-02' },
  };
  const context = vm.createContext({
    state,
    $(selector) { return elements[selector]; },
    async api(path, options) {
      calls.push({ path, options });
      return { id: 99 };
    },
    toast() {},
    openRoute() {},
  });
  installPlannerHelpers(context);
  vm.runInContext(
    extract('async function saveDraft()', 'async function renderRoutes()'),
    context,
    { filename: 'static/app.js' },
  );

  await context.saveDraft();

  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, '/api/routes');
  assert.equal(calls[0].options.body.stops[0].service_type, 'collection');
});
