import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
const source = fs.readFileSync(new URL('../static/app.js', import.meta.url), 'utf8');
function scenario(role = 'quality') {
  const nodes = new Map();
  const calls = [];
  const state = { user: { role } };
  const ctx = vm.createContext({
    state, clearInterval() {},
    $(id) { if (!nodes.has(id)) nodes.set(id, { innerHTML: '', classList: {remove(){},add(){}} }); return nodes.get(id); },
    $$() { return []; },
    renderHistory: async () => calls.push('history'),
    renderCollectionReport: async () => calls.push('reports'),
    esc: value => value,
  });
  const start = source.indexOf('function renderNav()');
  const end = source.indexOf('async function loadCore()', start);
  vm.runInContext(source.slice(start, end), ctx);
  return {ctx, nodes, calls, state};
}
test('Qualidade tem somente Histórico e Relatório operacional no menu', () => {
  const {ctx,nodes} = scenario(); ctx.renderNav();
  const html = nodes.get('#nav').innerHTML;
  assert.equal((html.match(/<button /g)||[]).length, 2);
  assert.match(html, /data-page="history"/);
  assert.match(html, /data-page="reports"/);
  assert.match(html, /Relatório operacional/);
});
test('Navegação direta a módulos não permitidos retorna ao histórico', async () => {
  const {ctx,calls,state} = scenario();
  for (const page of ['users','settings','dashboard','planner','routes','requests','driver','production','pevs']) {
    await ctx.go(page); assert.equal(state.page, 'history');
  }
  assert.equal(calls.length, 9);
  assert.ok(calls.every(page => page === 'history'));
});
test('Relatório operacional permanece acessível', async () => {
  const {ctx,calls,state} = scenario(); await ctx.go('reports');
  assert.deepEqual(calls, ['reports']); assert.equal(state.page, 'reports');
});
test('Primeiro acesso de Qualidade abre o histórico', () => {
  const {ctx,calls} = scenario();
  ctx.roleLabel = {quality:'Qualidade'}; ctx.esc = x => x;
  ctx.go = page => calls.push(page); ctx.renderNav = () => {};
  ctx.sendPresenceHeartbeat = () => {}; ctx.startPresenceHeartbeat = () => {};
  ctx.setInterval = () => 1; ctx.clearInterval = () => {};
  ctx.apiCache = {clear(){}};
  const start = source.indexOf('function enterApp(user)');
  const end = source.indexOf('function renderNav()', start);
  vm.runInContext(source.slice(start,end), ctx);
  ctx.enterApp({role:'quality',name:'Consulta',username:'consulta'});
  assert.deepEqual(calls, ['history']);
});
test('Histórico só exibe rotas finalizadas', async () => {
  const {ctx,nodes} = scenario();
  ctx.api = async () => ({items:[{id:1,status:'draft'},{id:2,status:'finished'},{id:3,status:'in_progress'}]});
  ctx.routeListHtml = routes => {assert.deepEqual(Array.from(routes,x=>x.id),[2]);return 'Rota finalizada';};
  ctx.bindRouteOpeners = () => {};
  const start = source.indexOf('async function renderHistory()');
  const end = source.indexOf('let driverLocationWatch',start);
  vm.runInContext(source.slice(start,end),ctx);
  await ctx.renderHistory(); assert.match(nodes.get('#page').innerHTML,/Qualidade/);
});
