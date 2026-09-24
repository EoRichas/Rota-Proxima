import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../static/app.js',import.meta.url),'utf8');
const section=source.slice(source.indexOf('function agendaStatus('),source.indexOf('async function renderHistory()'));
const row=(overrides={})=>({id:1,pev_name:'PEV Marcelo',city:'Sorocaba',state:'SP',route_name:'Rota 1',route_date:'2026-09-25',route_status:'released',status:'pending',service_type:'collection',...overrides});
function fixture({items=[row()],error=null,role='commercial'}={}) {
 const nodes=new Map(),calls=[],notices=[];
 const ctx=vm.createContext({
  state:{user:{role,name:'Marcelo'},page:'agenda'},
  $:selector=>{if(!nodes.has(selector))nodes.set(selector,{innerHTML:'',value:'',disabled:false,isConnected:true});return nodes.get(selector);},
  $$:()=>[],URLSearchParams,Intl,Date,
  esc:value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;'),
  fmtDate:value=>value.split('-').reverse().join('/'),serviceTypeLabel:{collection:'Coleta',delivery:'Entrega'},
  api:async path=>{calls.push(path);if(error)throw error;return {items};},
  toast:(...args)=>notices.push(args),
 });
 vm.runInContext(section,ctx);
 return {ctx,nodes,calls,notices};
}
test('Agenda entra somente no menu Comercial',()=>{
 for(const role of ['commercial','admin','commercial_manager','driver','production','quality']){
  const {ctx,nodes}=fixture({role});
  vm.runInContext(source.slice(source.indexOf('function renderNav()'),source.indexOf('async function go(page)')),ctx);
  ctx.renderNav();assert.equal(nodes.get('#nav').innerHTML.includes('data-page="agenda"'),role==='commercial');
 }
});
test('agrupa por data programada em ordem cronológica',()=>{
 const {ctx}=fixture();
 const html=ctx.agendaListHtml([row(),row({id:2,route_date:'2026-09-24',pev_name:'PEV anterior'}),row({id:3})]);
 assert.equal((html.match(/<section/g)||[]).length,2);
 assert.ok(html.indexOf('24/09/2026')<html.indexOf('25/09/2026'));
 assert.match(html,/2 agendamentos/);
});
test('situações de agendamento e execução têm nomes distintos',()=>{
 const {ctx}=fixture();
 for(const [input,label] of [[{route_status:'draft'},'Planejada'],[{},'Agendada'],[{route_status:'in_progress'},'Em rota'],[{status:'arrived'},'No local'],[{status:'completed'},'Realizada'],[{status:'failed'},'Não realizada']]){
  assert.equal(ctx.agendaStatus(row(input))[1],label);
 }
});
test('horário exato, janela e ausência de horário',()=>{
 const {ctx}=fixture();
 assert.match(ctx.agendaListHtml([row({exact_time:'09:00:00'})]),/Horário previsto: 09:00/);
 assert.match(ctx.agendaListHtml([row({window_start:'08:00:00',window_end:'12:00:00'})]),/Janela: 08:00 às 12:00/);
 assert.match(ctx.agendaListHtml([row()]),/Horário não definido/);
});
test('pesquisa e escapes impedem HTML em nomes',()=>{
 const {ctx}=fixture();
 const rows=[row({pev_name:'<script>teste</script>'}),row({id:2,pev_name:'Outro PEV',city:'Votorantim'})];
 const html=ctx.agendaListHtml(rows,'TESTE');
 assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>|Outro PEV/);
 assert.match(ctx.agendaListHtml(rows,'Votorantim'),/Outro PEV/);
 assert.match(ctx.agendaListHtml(rows,'inexistente'),/Nenhum agendamento/);
});
test('consulta envia apenas datas e usa o usuário da sessão no servidor',async()=>{
 const {ctx,nodes,calls}=fixture();
 // O DOM de teste não interpreta o value do HTML; preparar entradas equivalentes.
 ctx.$('#agendaFrom').value='2026-09-01';ctx.$('#agendaTo').value='2026-09-30';
 await ctx.renderAgenda();
 assert.equal(calls[0],'/api/agenda?from=2026-09-01&to=2026-09-30');
 assert.match(nodes.get('#page').innerHTML,/Comercial • Marcelo/);
 assert.match(nodes.get('#agendaResults').innerHTML,/PEV Marcelo/);
 assert.equal(nodes.get('#agendaRefresh').disabled,false);
});
test('falha de consulta limpa resultado e permite tentar novamente',async()=>{
 const {ctx,nodes}=fixture({error:new Error('Dados indisponíveis')});
 ctx.$('#agendaFrom').value='2026-09-01';ctx.$('#agendaTo').value='2026-09-30';
 await ctx.renderAgenda();
 assert.match(nodes.get('#agendaResults').innerHTML,/role="alert".*Dados indisponíveis/);
 assert.equal(nodes.get('#agendaRefresh').disabled,false);
});
test('perfil sem permissão não dispara consulta',async()=>{
 const {ctx,calls}=fixture({role:'quality'});
 await assert.rejects(ctx.renderAgenda(),/Sem permissão/);assert.equal(calls.length,0);
});
