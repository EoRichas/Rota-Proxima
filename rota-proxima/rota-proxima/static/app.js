const state = {
  user: null,
  page: null,
  pevs: [],
  drivers: [],
  users: [],
  routes: [],
  templates: [],
  requests: [],
  requestSelection: [],
  settings: null,
  routePreview: null,
  plannerSelection: new Set(),
  plannerPriorities: {},
  map: null,
};

const $ = (s, root=document) => root.querySelector(s);
const $$ = (s, root=document) => [...root.querySelectorAll(s)];
const esc = (v='') => String(v).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const fmtKm = m => `${((Number(m)||0)/1000).toFixed((Number(m)||0) >= 10000 ? 0 : 1).replace('.', ',')} km`;
const fmtDuration = sec => {
  sec = Math.round(Number(sec)||0);
  const h = Math.floor(sec/3600), min = Math.round((sec%3600)/60);
  if (!h) return `${min} min`;
  return `${h}h ${String(min).padStart(2,'0')}min`;
};
const fmtDate = s => s ? new Date(`${s}T12:00:00`).toLocaleDateString('pt-BR') : '—';
const fmtDateTime = s => s ? new Date(s).toLocaleString('pt-BR', {dateStyle:'short', timeStyle:'short'}) : '—';
const localHHMM = () => { const d=new Date(); return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`; };
const digits = s => String(s||'').replace(/\D/g,'');
const phoneHref = s => `tel:${digits(s)}`;
const whatsHref = s => `https://wa.me/55${digits(s).replace(/^55/,'')}`;
const statusLabel = {draft:'Rascunho',released:'Liberada',in_progress:'Em andamento',finished:'Finalizada',cancelled:'Cancelada'};
const priorityLabel = {urgent:'Urgente',high:'Alta',normal:'Normal',low:'Baixa'};
const roleLabel = {admin:'Administrador',commercial_manager:'Gerente Comercial',commercial:'Comercial',driver:'Motorista'};
const requestStatusLabel = {pending:'Pendente',scheduled:'Em rota',in_service:'Em atendimento',completed:'Concluída',not_completed:'Não realizada',cancelled:'Cancelada'};
const apiCache = new Map();
const apiPending = new Map();
const apiCacheTtl = path => path.startsWith('/api/pevs') ? 30000 : path==='/api/drivers' ? 30000 : path==='/api/settings' ? 30000 : path==='/api/users' ? 15000 : 0;

function toast(msg, type='') {
  const el = $('#toast');
  el.textContent = msg; el.className = `toast ${type}`;
  clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.add('hidden'), 3200);
}

async function api(path, opts={}) {
  const method=(opts.method||'GET').toUpperCase();
  const ttl=method==='GET'?apiCacheTtl(path):0;
  const cached=ttl?apiCache.get(path):null;
  if(cached && Date.now()-cached.at<ttl) return cached.data;
  const pendingKey=method==='GET'?path:null;
  if(pendingKey && apiPending.has(pendingKey)) return apiPending.get(pendingKey);
  const run=(async()=>{
    const config = {credentials:'same-origin', headers:{}, ...opts};
    if (opts.body && typeof opts.body !== 'string') {
      config.headers['Content-Type'] = 'application/json';
      config.body = JSON.stringify(opts.body);
    }
    const res = await fetch(path, config);
    let data = {};
    try { data = await res.json(); } catch {}
    if (!res.ok) throw new Error(data.error || `Erro ${res.status}`);
    if(ttl) apiCache.set(path,{at:Date.now(),data});
    if(method!=='GET') apiCache.clear();
    return data;
  })();
  if(pendingKey) apiPending.set(pendingKey,run);
  try{return await run;}finally{if(pendingKey) apiPending.delete(pendingKey);}
}

function modal(html) {
  $('#modalContent').innerHTML = html;
  const dlg = $('#modal');
  dlg.showModal();
  $$('.modal-close', dlg).forEach(b => b.onclick = () => dlg.close());
  return dlg;
}

async function getPosition(required=false) {
  try {
    return await new Promise((resolve, reject) => {
      if (!navigator.geolocation) return reject(new Error('GPS não disponível neste dispositivo.'));
      navigator.geolocation.getCurrentPosition(
        p => resolve({lat:p.coords.latitude, lng:p.coords.longitude, accuracy:p.coords.accuracy}),
        e => reject(new Error(e.message || 'Não foi possível obter a localização.')),
        {enableHighAccuracy:true, timeout:12000, maximumAge:30000}
      );
    });
  } catch (e) {
    if (required) throw e;
    toast('GPS indisponível neste acesso. O horário será registrado sem coordenadas.', 'error');
    return {lat:null, lng:null, accuracy:null};
  }
}

async function boot() {
  try {
    const me = await api('/api/me');
    if (me.user) return enterApp(me.user);
    const setup = await api('/api/setup-status');
    $('#authScreen').classList.remove('hidden');
    $('#setupForm').classList.toggle('hidden', !setup.needs_setup);
    $('#loginForm').classList.toggle('hidden', setup.needs_setup);
  } catch (e) { toast(e.message, 'error'); }
}

$('#setupForm').addEventListener('submit', async e => {
  e.preventDefault();
  try {
    await api('/api/setup', {method:'POST', body:{name:$('#setupName').value, username:$('#setupUsername').value, password:$('#setupPassword').value}});
    toast('Administrador criado. Faça login.', 'success');
    $('#setupForm').classList.add('hidden'); $('#loginForm').classList.remove('hidden');
    $('#loginUsername').value = $('#setupUsername').value;
  } catch (err) { toast(err.message, 'error'); }
});

$('#loginForm').addEventListener('submit', async e => {
  e.preventDefault();
  try {
    const data = await api('/api/login', {method:'POST', body:{username:$('#loginUsername').value, password:$('#loginPassword').value}});
    enterApp(data.user);
  } catch (err) { toast(err.message, 'error'); }
});

$('#logoutBtn').onclick = async () => {
  await api('/api/logout', {method:'POST'}).catch(()=>{});
  location.reload();
};
$('#menuBtn').onclick = () => $('#sidebar').classList.toggle('open');

function enterApp(user) {
  state.user = user;
  $('#authScreen').classList.add('hidden'); $('#appShell').classList.remove('hidden');
  $('#sidebarRole').textContent = roleLabel[user.role] || user.role;
  $('#currentUserCard').innerHTML = `<strong>${esc(user.name)}</strong><span>@${esc(user.username)}</span><button id="myPasswordBtn" class="btn ghost small" style="margin-top:8px">Minha senha</button>`;
  $('#myPasswordBtn').onclick = () => openPasswordModal(false);
  if (user.must_change_password) setTimeout(() => openPasswordModal(true), 80);
  $('#mobileUserInitial').textContent = user.name.slice(0,1).toUpperCase();
  renderNav();
  const initial = user.role === 'driver' ? 'driver' : user.role === 'commercial' ? 'requests' : 'dashboard';
  go(initial);
}

function renderNav() {
  let items=[];
  if (state.user.role === 'driver') items=[['driver','Minha rota'],['history','Histórico']];
  else if (state.user.role === 'commercial') items=[['requests','Solicitações'],['pevs','PEVs / Locais']];
  else if (state.user.role === 'commercial_manager') items=[['dashboard','Dashboard'],['routes','Rotas'],['requests','Solicitações'],['pevs','PEVs / Locais']];
  else items=[['dashboard','Dashboard'],['requests','Solicitações'],['planner','Planejar rota'],['pevs','PEVs / Locais'],['routes','Rotas'],['templates','Recorrentes'],['users','Usuários'],['activities','Atividades'],['settings','Configurações']];
  $('#nav').innerHTML = items.map(([id,label]) => `<button data-page="${id}">${label}</button>`).join('');
  $$('#nav button').forEach(b => b.onclick = () => { $('#sidebar').classList.remove('open'); go(b.dataset.page); });
}

async function go(page) {
  state.page = page;
  $$('#nav button').forEach(b => b.classList.toggle('active', b.dataset.page === page));
  $('#page').innerHTML = `<div class="empty">Carregando...</div>`;
  try {
    if (page === 'dashboard') return renderDashboard();
    if (page === 'planner') return renderPlanner();
    if (page === 'pevs') return renderPevs();
    if (page === 'requests') return renderRequests();
    if (page === 'routes') return renderRoutes();
    if (page === 'templates') return renderTemplates();
    if (page === 'users') return renderUsers();
    if (page === 'activities') return renderActivities();
    if (page === 'settings') return renderSettings();
    if (page === 'driver') return renderDriverHome();
    if (page === 'history') return renderHistory();
  } catch (e) { $('#page').innerHTML = `<div class="warning">${esc(e.message)}</div>`; }
}

async function loadCore() {
  const tasks = [api('/api/pevs'), api('/api/drivers'), api('/api/routes')];
  const [p,d,r] = await Promise.all(tasks);
  state.pevs = p.items; state.drivers = d.items; state.routes = r.items;
}

async function renderDashboard() {
  const summary=await api('/api/dashboard');
  const todayRoutes=summary.routes||[];
  state.routes=todayRoutes;
  const counts=summary.route_counts||{draft:0,released:0,in_progress:0,finished:0,cancelled:0};
  const pendingRequests=Number(summary.pending_requests||0);
  const pendingInfo=summary;
  const admin = state.user.role === 'admin';
  $('#page').innerHTML = `
    <div class="page-head"><div><span class="eyebrow">Operação</span><h1>Dashboard</h1><p class="muted">Acompanhamento de solicitações comerciais e rotas de hoje.</p></div><div class="page-head-actions"><button id="viewRequestsBtn" class="btn secondary">Solicitações (${pendingRequests})</button>${admin?'<button id="newRouteBtn" class="btn primary">+ Nova rota</button>':''}</div></div>
    <div class="grid stats">
      <div class="card stat-card"><span>Solicitações pendentes</span><strong>${pendingRequests}</strong></div>
      <div class="card stat-card"><span>PEVs sem localização confirmada</span><strong>${pendingInfo.unconfirmed_locations}</strong></div>
      <div class="card stat-card"><span>Rotas em andamento</span><strong>${counts.in_progress}</strong></div>
      <div class="card stat-card"><span>Rotas finalizadas hoje</span><strong>${counts.finished}</strong></div>
    </div>
    <div class="card" style="margin-top:16px"><h2>Central de pendências</h2><div class="grid stats"><div class="stat-card"><span>Solicitações aguardando planejamento</span><strong>${pendingInfo.pending_requests}</strong></div><div class="stat-card"><span>PEVs sem coordenada confirmada</span><strong>${pendingInfo.unconfirmed_locations}</strong></div><div class="stat-card"><span>Rotas com alerta de horário</span><strong>${pendingInfo.routes_at_risk}</strong></div><div class="stat-card"><span>Coletas não realizadas hoje</span><strong>${pendingInfo.not_completed_today}</strong></div></div></div>
    <div class="card" style="margin-top:16px"><h2>Rotas de hoje</h2>${routeListHtml(todayRoutes)}</div>`;
  if ($('#newRouteBtn')) $('#newRouteBtn').onclick = () => go('planner');
  $('#viewRequestsBtn').onclick = () => go('requests');
  bindRouteOpeners();
}

function routeListHtml(routes) {
  if (!routes.length) return `<div class="empty">Nenhuma rota encontrada.</div>`;
  return `<div class="list">${routes.map(r => {
    const canDelete = state.user?.role === 'admin' && ['draft','finished','cancelled'].includes(r.status);
    return `<div class="list-item">
    <div class="list-item-main"><strong>${esc(r.name)}</strong><span>${fmtDate(r.route_date)} • ${esc(r.driver_name)} • ${r.completed_stops}/${r.total_stops} paradas</span></div>
    <div class="actions"><span class="badge ${r.status}">${statusLabel[r.status]||r.status}</span><button class="btn ghost small open-route" data-id="${r.id}">Abrir</button>${canDelete?`<button class="btn danger small delete-route" data-id="${r.id}" data-name="${esc(r.name)}">Excluir</button>`:''}</div>
  </div>`;
  }).join('')}</div>`;
}
function bindRouteOpeners() {
  $$('.open-route').forEach(b => b.onclick = () => openRoute(Number(b.dataset.id)));
  $$('.delete-route').forEach(b => b.onclick = async () => {
    const id = Number(b.dataset.id);
    if (!confirm(`Excluir a rota "${b.dataset.name}"? Esta ação não pode ser desfeita.`)) return;
    const reason=prompt('Informe o motivo da exclusão:','')?.trim(); if(!reason)return;
    try {
      await api(`/api/routes/${id}`, {method:'DELETE',body:{reason}});
      toast('Rota excluída.','success');
      go(state.page);
    } catch (e) { toast(e.message,'error'); }
  });
}

async function renderPevs() {
  state.pevs = (await api('/api/pevs')).items;
  const canEdit = ['admin','commercial'].includes(state.user.role);
  $('#page').innerHTML = `
    <div class="page-head"><div><span class="eyebrow">Cadastros</span><h1>PEVs / Locais</h1><p class="muted">Endereços permanentes, responsáveis, horários e coordenadas.</p></div>${canEdit?`<div class="page-head-actions"><button id="addPev" class="btn primary">+ Novo PEV</button>${state.user.role==='admin'?'<button id="geocodeMissingPevs" class="btn secondary">Atualizar coordenadas</button><button id="pevTrash" class="btn secondary">Lixeira</button>':''}</div>`:''}</div>
    <div class="card"><div class="toolbar"><input id="pevSearch" class="search" placeholder="Pesquisar nome, bairro, cidade ou responsável"><select id="pevFilter"><option value="all">Todos</option><option value="favorite">Favoritos</option></select></div><div id="pevList"></div></div>`;
  if ($('#addPev')) $('#addPev').onclick = () => openPevModal();
  if ($('#geocodeMissingPevs')) $('#geocodeMissingPevs').onclick = async () => {
    const btn=$('#geocodeMissingPevs');
    if(!confirm('Localizar automaticamente as PEVs que ainda estão sem latitude/longitude?\n\nO sistema usa endereço completo no OpenStreetMap/Nominatim e, se necessário, o CEP pela BrasilAPI.')) return;
    const oldText=btn.textContent;btn.disabled=true;btn.textContent='Localizando...';
    try{
      const r=await api('/api/pevs/geocode-missing',{method:'POST',body:{}});
      const falhas=(r.failed||[]).length;
      toast(`${(r.updated||[]).length} PEV(s) atualizada(s)${falhas?` • ${falhas} não localizada(s)`:''}.`,falhas?'error':'success');
      await renderPevs();
    }catch(e){toast(e.message,'error');}
    finally{if(btn && document.body.contains(btn)){btn.disabled=false;btn.textContent=oldText;}}
  };
  if ($('#pevTrash')) $('#pevTrash').onclick = openPevTrash;
  $('#pevSearch').oninput = drawPevList; $('#pevFilter').onchange = drawPevList;
  drawPevList();
}

function drawPevList() {
  const q = ($('#pevSearch')?.value||'').toLowerCase();
  const fav = $('#pevFilter')?.value === 'favorite';
  const items = state.pevs.filter(p => (!fav || p.favorite) && `${p.name} ${p.district} ${p.city} ${p.contact_name}`.toLowerCase().includes(q));
  $('#pevList').innerHTML = items.length ? `<div class="list">${items.map(p=>`
    <div class="list-item">
      <div class="list-item-main"><strong>${p.favorite?'<span class="favorite">★</span> ':''}${esc(p.name)}</strong><span>${esc(p.street)}, ${esc(p.number||'s/n')} • ${esc(p.city)}/${esc(p.state)}</span><span>${p.contact_name ? `Responsável: ${esc(p.contact_name)}${p.phone?` • ${esc(p.phone)}`:''}` : 'Responsável não informado'}</span></div>
      <div class="actions">${!p.location_confirmed?'<span class="badge high">Localização não confirmada</span>':''}<span class="badge ${p.default_priority}">${priorityLabel[p.default_priority]}</span>${state.user.role==='commercial'?`<button class="btn secondary small request-pev" data-id="${p.id}">Solicitar</button>`:''}${['admin','commercial'].includes(state.user.role)?`<button class="btn ghost small edit-pev" data-id="${p.id}">Editar</button><button class="btn danger small delete-pev" data-id="${p.id}" data-name="${esc(p.name)}">Excluir</button>`:''}</div>
    </div>`).join('')}</div>` : `<div class="empty">Nenhum PEV encontrado.</div>`;
  $$('.edit-pev').forEach(b => b.onclick = () => openPevModal(state.pevs.find(p => p.id === Number(b.dataset.id))));
  $$('.request-pev').forEach(b => b.onclick = () => openRequestModal(state.pevs.find(p => p.id === Number(b.dataset.id))));
  $$('.delete-pev').forEach(b => b.onclick = async () => {
    const name=b.dataset.name||'este PEV';
    if(!confirm(`Excluir ${name}?\n\nEle será enviado para a lixeira. Rotas e solicitações antigas continuarão preservadas.`)) return;
    const reason=prompt('Informe o motivo da exclusão:','')?.trim(); if(!reason)return;
    try {
      await api(`/api/pevs/${b.dataset.id}`, {method:'DELETE',body:{reason}});
      toast('PEV excluído. O histórico foi preservado.','success');
      await renderPevs();
    } catch(err){ toast(err.message,'error'); }
  });
}

async function openPevTrash(){
  try{
    const items=(await api('/api/pevs?trash=1')).items;
    const dlg=modal(`<div class="modal-box"><div class="modal-head"><div><span class="eyebrow">Cadastros</span><h2>Lixeira de PEVs</h2><p class="muted">PEVs excluídos podem ser restaurados sem perder o histórico.</p></div><button class="icon-btn modal-close">×</button></div>${items.length?`<div class="list">${items.map(p=>`<div class="list-item"><div class="list-item-main"><strong>${esc(p.name)}</strong><span>${esc(p.street)}, ${esc(p.number||'s/n')} • ${esc(p.city)}/${esc(p.state)}</span><span>Excluído em ${fmtDateTime(p.deleted_at)}</span></div><button class="btn success small restore-pev" data-id="${p.id}">Restaurar</button></div>`).join('')}</div>`:'<div class="empty">A lixeira está vazia.</div>'}<div class="form-actions"><button class="btn ghost modal-close">Fechar</button></div></div>`);
    $$('.restore-pev').forEach(b=>b.onclick=async()=>{try{await api(`/api/pevs/${b.dataset.id}/restore`,{method:'POST',body:{}});toast('PEV restaurado.','success');dlg.close();renderPevs();}catch(e){toast(e.message,'error')}});
  }catch(e){toast(e.message,'error')}
}

function openPevModal(pev=null) {
  const p = pev || {address_mode:'cep',default_priority:'normal',whatsapp:true,favorite:false};
  modal(`<form id="pevForm" class="modal-box">
    <div class="modal-head"><div><span class="eyebrow">${pev?'Editar':'Novo'} cadastro</span><h2>${pev?'Editar PEV':'Cadastrar PEV'}</h2></div><button type="button" class="icon-btn modal-close">×</button></div>
    <div class="form-grid">
      <label class="field span-2"><span>Nome do PEV / local *</span><input name="name" value="${esc(p.name||'')}" required placeholder="Ex.: Residencial Plaza Mazon"></label>
      <div class="span-2"><span class="field-label">Forma de preenchimento</span><div class="mode-toggle"><label><input type="radio" name="address_mode" value="cep" ${p.address_mode!=='manual'?'checked':''}> Buscar por CEP</label><label><input type="radio" name="address_mode" value="manual" ${p.address_mode==='manual'?'checked':''}> Endereço manual</label></div></div>
      <label class="field" id="cepWrap"><span>CEP</span><div class="input-action"><input name="cep" inputmode="numeric" value="${esc(p.cep||'')}" placeholder="00000-000"><button id="lookupCep" type="button" class="btn secondary">Buscar</button></div></label>
      <label class="field"><span>Número</span><input name="number" value="${esc(p.number||'')}" placeholder="600"></label>
      <label class="field span-2"><span>Logradouro *</span><input name="street" value="${esc(p.street||'')}" required></label>
      <label class="field"><span>Bairro</span><input name="district" value="${esc(p.district||'')}"></label>
      <label class="field"><span>Complemento</span><input name="complement" value="${esc(p.complement||'')}"></label>
      <label class="field"><span>Cidade *</span><input name="city" value="${esc(p.city||'')}" required></label>
      <label class="field"><span>UF *</span><input name="state" maxlength="2" value="${esc(p.state||'')}" required></label>
      <div class="span-2"><hr><h3>Responsável pelo local</h3></div>
      <label class="field"><span>Nome do responsável</span><input name="contact_name" value="${esc(p.contact_name||'')}" placeholder="Osmir Torres"></label>
      <label class="field"><span>Cargo / função</span><input name="contact_role" value="${esc(p.contact_role||'')}" placeholder="Síndico"></label>
      <label class="field"><span>Telefone</span><input name="phone" value="${esc(p.phone||'')}" placeholder="(15) 99999-9999"></label>
      <label class="field"><span>Contato tem WhatsApp?</span><select name="whatsapp"><option value="1" ${p.whatsapp?'selected':''}>Sim</option><option value="0" ${!p.whatsapp?'selected':''}>Não</option></select></label>
      <div class="span-2"><hr><h3>Operação</h3></div>
      <label class="field"><span>Atendimento a partir de</span><input type="time" name="service_start" value="${esc(p.service_start||'')}"></label>
      <label class="field"><span>Atendimento até</span><input type="time" name="service_end" value="${esc(p.service_end||'')}"></label>
      <label class="field"><span>Prioridade padrão</span><select name="default_priority">${priorityOptions(p.default_priority)}</select></label>
      <label class="field"><span>Favorito</span><select name="favorite"><option value="1" ${p.favorite?'selected':''}>Sim</option><option value="0" ${!p.favorite?'selected':''}>Não</option></select></label>
      <label class="field span-2"><span>Observações para o motorista</span><textarea name="notes" placeholder="Ex.: ligar antes de chegar, entrada pela portaria lateral...">${esc(p.notes||'')}</textarea></label>
      <label class="field span-2"><span>Observação interna</span><textarea name="internal_notes" placeholder="Visível apenas para equipe administrativa/comercial">${esc(p.internal_notes||'')}</textarea></label>
      <div class="span-2"><hr><h3>Localização confirmada (opcional)</h3><p class="muted">Útil para área rural, condomínio grande ou cidade com CEP genérico. Se preenchida, a rota usa estas coordenadas acima do endereço.</p></div>
      <label class="field"><span>Latitude</span><input name="lat" inputmode="decimal" value="${p.lat??''}" placeholder="-23.500000"></label>
      <label class="field"><span>Longitude</span><input name="lng" inputmode="decimal" value="${p.lng??''}" placeholder="-47.450000"></label>
      <button id="useCurrentPevPos" type="button" class="btn secondary span-2">Usar minha localização atual neste PEV</button>
    </div>
    <div class="form-actions"><button type="button" class="btn ghost modal-close">Cancelar</button><button class="btn primary" type="submit">Salvar PEV</button></div>
  </form>`);
  const form = $('#pevForm');
  function clearStaleCoords(){
    // Se o endereço mudar, coordenadas antigas não podem continuar sendo usadas
    // silenciosamente para otimização da rota. O usuário pode informar/confirmar
    // uma nova coordenada depois da alteração.
    form.lat.value=''; form.lng.value='';
  }
  ['cep','number','street','district','city','state'].forEach(name=>{
    const el=form.elements[name]; if(el) el.addEventListener('input',clearStaleCoords);
  });
  function modeChanged(){ $('#cepWrap').classList.toggle('hidden', form.address_mode.value === 'manual'); }
  $$('input[name=address_mode]', form).forEach(x=>x.onchange=modeChanged); modeChanged();
  $('#lookupCep').onclick = async () => {
    try { const d=await api(`/api/cep/${digits(form.cep.value)}`); clearStaleCoords(); form.cep.value=d.cep; form.street.value=d.street; form.district.value=d.district; form.city.value=d.city; form.state.value=d.state; toast('CEP localizado.','success'); }
    catch(e){toast(e.message,'error');}
  };
  $('#useCurrentPevPos').onclick = async () => { try { const pos=await getPosition(true); form.lat.value=pos.lat.toFixed(7); form.lng.value=pos.lng.toFixed(7); toast(`Coordenada salva com precisão aproximada de ${Math.round(pos.accuracy)} m.`,'success'); } catch(e){toast(e.message,'error');} };
  form.onsubmit = async e => {
    e.preventDefault();
    const fd=new FormData(form); const body=Object.fromEntries(fd.entries());
    body.whatsapp=body.whatsapp==='1'; body.favorite=body.favorite==='1';
    body.service_start=body.service_start||null; body.service_end=body.service_end||null;
    body.lat=body.lat||null; body.lng=body.lng||null;
    try { const r=await api(pev?`/api/pevs/${pev.id}`:'/api/pevs',{method:pev?'PUT':'POST',body}); $('#modal').close(); toast(r.geocode_warning?'PEV salvo. Coordenadas serão tentadas novamente ao planejar a rota.':'PEV salvo.','success'); renderPevs(); } catch(err){toast(err.message,'error');}
  };
}
async function renderRequests(){
  [state.requests,state.pevs]=await Promise.all([api('/api/requests').then(x=>x.items),api('/api/pevs').then(x=>x.items)]);
  const admin=state.user.role==='admin';
  const commercial=state.user.role==='commercial';
  const pending=state.requests.filter(r=>r.status==='pending').length;
  const waiting=state.requests.filter(r=>r.status==='pending').length;
  $('#page').innerHTML=`<div class="page-head"><div><span class="eyebrow">Comercial</span><h1>Solicitações de agendamento</h1><p class="muted">O Comercial cria as solicitações. O Administrador usa as solicitações no planejamento das rotas. O Gerente Comercial acompanha em modo consulta.</p></div><div class="page-head-actions">${commercial?'<button id="newRequest" class="btn primary">+ Nova solicitação</button>':''}${admin?'<button id="planSelectedRequests" class="btn success">Planejar selecionadas</button>':''}</div></div>
    <div class="grid stats" style="margin-bottom:16px"><div class="card stat-card"><span>Pendentes</span><strong>${pending}</strong></div><div class="card stat-card"><span>Aguardando rota</span><strong>${waiting}</strong></div><div class="card stat-card"><span>Em rota</span><strong>${state.requests.filter(r=>r.status==='scheduled').length}</strong></div><div class="card stat-card"><span>Concluídas</span><strong>${state.requests.filter(r=>r.status==='completed').length}</strong></div></div>
    <div class="card"><div class="toolbar"><input id="requestSearch" class="search" placeholder="Pesquisar PEV, comercial ou cidade"><select id="requestFilter"><option value="active">Ativas</option><option value="pending">Pendentes</option><option value="scheduled">Em rota</option><option value="completed">Concluídas</option><option value="all">Todas</option></select></div><div id="requestList"></div></div>`;
  if(commercial)$('#newRequest').onclick=()=>openRequestModal();
  $('#requestSearch').oninput=drawRequestList; $('#requestFilter').onchange=drawRequestList;
  if(admin)$('#planSelectedRequests').onclick=planSelectedRequests;
  drawRequestList();
}

function drawRequestList(){
  const admin=state.user.role==='admin';
  const commercial=state.user.role==='commercial';
  const q=($('#requestSearch')?.value||'').toLowerCase(); const filter=$('#requestFilter')?.value||'active';
  const items=state.requests.filter(r=>{
    const match=`${r.pev_name} ${r.requested_by_name} ${r.city} ${r.notes||''}`.toLowerCase().includes(q);
    const statusOk=filter==='all'||(filter==='active'&&['pending','scheduled','in_service'].includes(r.status))||r.status===filter;
    return match&&statusOk;
  });
  $('#requestList').innerHTML=items.length?`<div class="list">${items.map(r=>`<div class="list-item request-item">
    ${admin&&r.status==='pending'?`<input class="request-select" type="checkbox" value="${r.id}" style="width:18px;height:18px">`:''}
    <div class="list-item-main"><strong>${esc(r.pev_name)}</strong><span>${fmtDate(r.requested_date)}${r.exact_time?` • ⏰ ${esc(r.exact_time)}`:(r.window_start||r.window_end?` • ${esc(r.window_start||'—')}–${esc(r.window_end||'—')}`:'')} • ${esc(r.city)}/${esc(r.state)}</span><span>Solicitado por: ${esc(r.requested_by_name)}${r.notes?` • ${esc(r.notes)}`:''}</span></div>
    <div class="actions"><span class="badge ${r.status}">${requestStatusLabel[r.status]||r.status}</span><span class="badge ${r.priority}">${priorityLabel[r.priority]}</span>${commercial&&r.status==='pending'?`<button class="btn danger small cancel-request" data-id="${r.id}">Cancelar</button>`:''}</div>
  </div>`).join('')}</div>`:'<div class="empty">Nenhuma solicitação encontrada.</div>';
  $$('.cancel-request').forEach(b=>b.onclick=async()=>{if(!confirm('Cancelar esta solicitação?'))return;const reason=prompt('Informe o motivo do cancelamento:','')?.trim();if(!reason)return;try{await api(`/api/requests/${b.dataset.id}`,{method:'DELETE',body:{reason}});toast('Solicitação cancelada.','success');renderRequests();}catch(e){toast(e.message,'error');}});
}

function planSelectedRequests(){
  if(state.user.role!=='admin') return;
  const ids=$$('.request-select:checked').map(x=>Number(x.value)); if(!ids.length)return toast('Selecione pelo menos uma solicitação.','error');
  const reqs=state.requests.filter(r=>ids.includes(r.id));
  state.requestSelection=reqs;
  go('planner');
}

function openRequestModal(pev=null){
  if(state.user.role!=='commercial') return toast('Somente o Comercial pode criar solicitações.','error');
  const today=new Date().toISOString().slice(0,10);
  modal(`<form id="requestForm" class="modal-box"><div class="modal-head"><div><span class="eyebrow">Agendamento</span><h2>Nova solicitação</h2></div><button type="button" class="icon-btn modal-close">×</button></div><div class="form-grid">
    <label class="field span-2"><span>PEV / Local *</span><select name="pev_id" required><option value="">Selecione</option>${state.pevs.map(p=>`<option value="${p.id}" ${pev&&pev.id===p.id?'selected':''}>${esc(p.name)} — ${esc(p.city)}/${esc(p.state)}</option>`).join('')}</select></label>
    <label class="field"><span>Data solicitada *</span><input type="date" name="requested_date" value="${today}" required></label><label class="field"><span>Prioridade</span><select name="priority">${priorityOptions(pev?.default_priority||'normal')}</select></label>
    <label class="field span-2"><span>Horário específico para esta coleta</span><input type="time" name="exact_time"><small class="muted">Opcional. Use quando for necessário chegar neste PEV em um horário combinado apenas nesta data.</small></label>
    <label class="field"><span>Janela inicial</span><input type="time" name="window_start" value="${esc(pev?.service_start||'')}"></label><label class="field"><span>Janela final</span><input type="time" name="window_end" value="${esc(pev?.service_end||'')}"></label>
    <div class="info span-2">Se houver horário específico, ele terá prioridade sobre a janela normal para organizar a rota daquele dia.</div>
    <label class="field span-2"><span>Observações para o agendamento</span><textarea name="notes" placeholder="Ex.: cliente pediu coleta pela manhã, ligar antes de ir..."></textarea></label>
    <label class="field span-2"><span>Observação interna</span><textarea name="internal_notes" placeholder="Informação interna, não exibida ao motorista"></textarea></label>
  </div><div class="form-actions"><button type="button" class="btn ghost modal-close">Cancelar</button><button class="btn primary">Enviar solicitação</button></div></form>`);
  $('#requestForm').onsubmit=async e=>{e.preventDefault();try{await api('/api/requests',{method:'POST',body:Object.fromEntries(new FormData(e.target))});$('#modal').close();toast('Solicitação enviada.','success');go('requests');}catch(err){toast(err.message,'error');}};
}



function priorityOptions(selected='normal') { return Object.entries(priorityLabel).map(([v,l])=>`<option value="${v}" ${selected===v?'selected':''}>${l}</option>`).join(''); }

async function renderPlanner() {
  if(state.user.role!=='admin') return go(state.user.role==='commercial_manager'?'dashboard':'requests');
  await Promise.all([api('/api/pevs').then(x=>state.pevs=x.items), api('/api/drivers').then(x=>state.drivers=x.items), api('/api/templates').then(x=>state.templates=x.items)]);
  state.routePreview = null;
  const selectedRequests=state.requestSelection||[];
  const preselectedIds=[...new Set(selectedRequests.map(r=>r.pev_id))];
  const requestByPev=Object.fromEntries(selectedRequests.map(r=>[r.pev_id,r]));
  const today = selectedRequests.length ? selectedRequests.map(r=>r.requested_date).sort()[0] : new Date().toISOString().slice(0,10);
  $('#page').innerHTML = `
    <div class="page-head"><div><span class="eyebrow">Planejamento</span><h1>Nova rota</h1><p class="muted">Selecione os PEVs, otimize, revise e só depois libere ao motorista.</p></div></div>
    <div class="route-builder">
      <div class="card">
        <div class="form-grid">
          <label class="field"><span>Data</span><input id="routeDate" type="date" value="${today}"></label>
          <label class="field"><span>Motorista</span><select id="routeDriver"><option value="">Selecione</option>${state.drivers.map(d=>`<option value="${d.id}">${esc(d.name)}</option>`).join('')}</select></label>
          <label class="field span-2"><span>Nome da rota</span><input id="routeName" value="Rota ${new Date().toLocaleDateString('pt-BR')}"></label>
          <label class="field span-2"><span>Modelo recorrente</span><select id="templateSelect"><option value="">Nenhum</option>${state.templates.map(t=>`<option value="${t.id}">${esc(t.name)}</option>`).join('')}</select></label>
        </div>
        ${selectedRequests.length?`<div class="info" style="margin-top:14px">${selectedRequests.length} solicitação(ões) comercial(is) carregada(s) para esta rota.</div>`:''}
        <div style="margin:14px 0"><label><input id="returnOrigin" type="checkbox" checked> Retornar à base no final</label></div>
        <div class="toolbar"><input id="selectSearch" class="search" placeholder="Pesquisar PEV"><button id="selectFavorites" class="btn ghost small">Somente favoritos</button><span id="selectedPevCount" class="muted" style="margin-left:auto;font-weight:700">0 PEVs selecionados</span></div>
        <div id="pevSelector" class="pev-selector"></div>
      </div>
      <div class="card sticky-card">
        <div class="modal-head"><div><span class="eyebrow">Sequência</span><h2>Prévia da rota</h2></div></div>
        <div id="routePreview"><div class="empty">Selecione os PEVs e clique em otimizar.</div></div>
        <div class="form-actions"><button id="nearestOptimize" class="btn secondary">Mais próximo → próximo</button><button id="bestOptimize" class="btn primary">Otimizar rota</button></div>
      </div>
    </div>`;
  let favOnly=false;
  state.plannerSelection = new Set(preselectedIds);
  state.plannerPriorities = {};
  state.pevs.forEach(p=>{
    const rq=requestByPev[p.id];
    state.plannerPriorities[p.id]=rq?.priority||p.default_priority||'normal';
  });
  function updateSelectedCount(){
    const n=state.plannerSelection.size;
    const el=$('#selectedPevCount');
    if(el) el.textContent=`${n} ${n===1?'PEV selecionado':'PEVs selecionados'}`;
  }
  function drawSelector(){
    const q=$('#selectSearch').value.toLowerCase();
    const items=state.pevs.filter(p=>(!favOnly||p.favorite)&&`${p.name} ${p.city} ${p.district}`.toLowerCase().includes(q));
    $('#pevSelector').innerHTML=items.map(p=>`<label class="pev-check"><input type="checkbox" data-id="${p.id}" ${state.plannerSelection.has(p.id)?'checked':''}><div><div class="name">${p.favorite?'★ ':''}${esc(p.name)}</div><div class="addr">${esc(p.street)}, ${esc(p.number||'s/n')} • ${esc(p.city)}/${esc(p.state)}</div></div><select class="pev-priority" data-id="${p.id}" title="Prioridade">${priorityOptions(state.plannerPriorities[p.id]||requestByPev[p.id]?.priority||p.default_priority)}</select></label>`).join('') || `<div class="empty">Nenhum PEV encontrado. As seleções anteriores continuam mantidas.</div>`;
    $$('.pev-check input[type=checkbox]').forEach(x=>x.onchange=()=>{
      const id=Number(x.dataset.id);
      if(x.checked) state.plannerSelection.add(id); else state.plannerSelection.delete(id);
      updateSelectedCount();
    });
    $$('.pev-priority').forEach(x=>x.onchange=()=>{state.plannerPriorities[Number(x.dataset.id)]=x.value;});
    updateSelectedCount();
  }
  drawSelector();
  $('#selectSearch').oninput=drawSelector;
  $('#selectFavorites').onclick=()=>{favOnly=!favOnly; $('#selectFavorites').textContent=favOnly?'Mostrar todos':'Somente favoritos'; drawSelector();};
  $('#templateSelect').onchange=()=>{
    const t=state.templates.find(t=>t.id===Number($('#templateSelect').value));
    if(!t){state.plannerSelection=new Set(preselectedIds);drawSelector();return;}
    state.plannerSelection=new Set(t.pevs.map(p=>Number(p.pev_id)));
    t.pevs.forEach(p=>{state.plannerPriorities[Number(p.pev_id)]=p.priority||state.plannerPriorities[Number(p.pev_id)]||'normal';});
    drawSelector();
  };
  $('#nearestOptimize').onclick=()=>optimizePlanner('nearest'); $('#bestOptimize').onclick=()=>optimizePlanner('best');
}

async function optimizePlanner(mode) {
  const selected=[...(state.plannerSelection||new Set())];
  if(!selected.length)return toast('Selecione pelo menos um PEV.','error');
  const priorities={};
  selected.forEach(id=>{
    const pev=state.pevs.find(p=>p.id===id);
    const rq=(state.requestSelection||[]).find(r=>r.pev_id===id);
    priorities[id]=state.plannerPriorities?.[id]||rq?.priority||pev?.default_priority||'normal';
  });
  $('#routePreview').innerHTML='<div class="empty">Calculando sequência...</div>';
  try {
    const data=await api('/api/optimize',{method:'POST',body:{pev_ids:selected,return_origin:$('#returnOrigin').checked,mode,start_time:localHHMM(),stops:selected.map(id=>{const rq=(state.requestSelection||[]).find(r=>r.pev_id===id);return {pev_id:id,request_id:rq?.id||null,priority:priorities[id]||'normal',window_start:rq?.window_start||'',window_end:rq?.window_end||'',exact_time:rq?.exact_time||''};})}});
    state.routePreview=data; drawRoutePreview();
  } catch(e){$('#routePreview').innerHTML=`<div class="warning">${esc(e.message)}</div>`;}
}

function drawRoutePreview(){
  const d=state.routePreview; if(!d)return;
  $('#routePreview').innerHTML=`
    <div class="summary-strip"><div class="summary-box"><span>Distância</span><strong>${fmtKm(d.total_distance_m)}</strong></div><div class="summary-box"><span>Deslocamento</span><strong>${fmtDuration(d.total_duration_s)}</strong></div><div class="summary-box"><span>Paradas</span><strong>${d.stops.length}</strong></div></div>
    <div class="route-preview">${d.stops.map(s=>`<div class="route-stop"><div class="stop-number">${s.sequence}</div><div><strong>${esc((s.pev||s).name)}</strong><div class="stop-meta">${fmtKm(s.distance_m)} • ${fmtDuration(s.duration_s)} • ${esc((s.pev||s).city)}/${esc((s.pev||s).state)}</div></div><span class="badge ${s.priority}">${priorityLabel[s.priority]}</span></div>`).join('')}</div>
    <div class="info">A sequência fica sob controle do sistema. O motorista abre Google Maps ou Waze apenas para a próxima parada.</div>
    <div class="form-actions"><button id="saveDraft" class="btn primary">Salvar como rascunho</button></div>`;
  $('#saveDraft').onclick=saveDraft;
}

async function saveDraft(){
  const driver_id=$('#routeDriver').value; if(!driver_id)return toast('Selecione o motorista.','error');
  const d=state.routePreview;
  const reqs=state.requestSelection||[]; const reqByPev=Object.fromEntries(reqs.map(r=>[r.pev_id,r]));
  const body={name:$('#routeName').value,route_date:$('#routeDate').value,driver_id,return_origin:$('#returnOrigin').checked,total_distance_m:d.total_distance_m,total_duration_s:d.total_duration_s,request_ids:reqs.map(r=>r.id),stops:d.stops.map(s=>{const p=s.pev||s;const rq=reqByPev[p.id];return {pev_id:p.id,request_id:rq?.id||s.request_id||null,priority:s.priority,distance_m:s.distance_m,duration_s:s.duration_s,window_start:rq?.window_start||p.service_start||'',window_end:rq?.window_end||p.service_end||'',exact_time:rq?.exact_time||s.exact_time||''};})};
  try { const route=await api('/api/routes',{method:'POST',body}); state.requestSelection=[]; toast('Rota salva como rascunho. Solicitações vinculadas à rota.','success'); openRoute(route.id); } catch(e){toast(e.message,'error');}
}

async function renderRoutes() {
  state.routes=(await api('/api/routes')).items;
  const admin=state.user.role==='admin';
  $('#page').innerHTML=`<div class="page-head"><div><span class="eyebrow">Operação</span><h1>Rotas</h1><p class="muted">Rascunho → liberada → em andamento → finalizada.</p></div>${admin?'<button id="newRoute" class="btn primary">+ Nova rota</button>':''}</div><div class="card">${routeListHtml(state.routes)}</div>`;
  if($('#newRoute'))$('#newRoute').onclick=()=>go('planner'); bindRouteOpeners();
}

async function openRoute(id) {
  try {
    const r=await api(`/api/routes/${id}`);
    const canRelease=state.user.role==='admin'&&r.status==='draft';
    const canDelete=state.user.role==='admin'&&['draft','finished','cancelled'].includes(r.status);
    const dlg=modal(`<div class="modal-box"><div class="modal-head"><div><span class="eyebrow">Rota #${r.id}</span><h2>${esc(r.name)}</h2><p class="muted">${fmtDate(r.route_date)} • ${esc(r.driver_name)}</p></div><button class="icon-btn modal-close">×</button></div>
      <div class="summary-strip"><div class="summary-box"><span>Status</span><strong>${statusLabel[r.status]}</strong></div><div class="summary-box"><span>Distância</span><strong>${fmtKm(r.total_distance_m)}</strong></div><div class="summary-box"><span>Tempo estimado</span><strong>${fmtDuration(r.total_duration_s)}</strong></div></div>
      <div class="route-preview">${r.stops.map(s=>`<div class="route-stop"><div class="stop-number">${s.sequence}</div><div><strong>${esc(s.pev_name)}</strong><div class="stop-meta">${esc(s.street)}, ${esc(s.number||'s/n')} • ${esc(s.city)}/${esc(s.state)}${s.contact_name?`<br>Responsável: ${esc(s.contact_name)} ${s.phone?`• ${esc(s.phone)}`:''}`:''}${s.exact_time?`<br><strong>Horário específico: ${esc(s.exact_time)}</strong>`:''}</div></div><span class="badge ${s.status==='failed'?'failed':s.priority}">${s.status==='completed'?'Concluída':s.status==='failed'?'Não realizada':priorityLabel[s.priority]}</span></div>`).join('')}</div>
      ${r.schedule_warnings?.length?`<div class="warning"><strong>Atenção ao horário</strong><br>${r.schedule_warnings.map(esc).join('<br>')}</div>`:''}${r.started_at?`<div class="info">Início: ${fmtDateTime(r.started_at)}${r.finished_at?` • Fim: ${fmtDateTime(r.finished_at)}`:''}</div>`:''}
      <div class="form-actions"><button class="btn ghost modal-close">Fechar</button>${canDelete?'<button id="deleteRoute" class="btn danger">Excluir rota</button>':''}${canRelease?'<button id="releaseRoute" class="btn success">Liberar para motorista</button>':''}</div></div>`);
    if(canDelete)$('#deleteRoute').onclick=async()=>{
      if(!confirm(`Excluir a rota "${r.name}"? Esta ação não pode ser desfeita.`))return;
      const reason=prompt('Informe o motivo da exclusão:','')?.trim();if(!reason)return;
      try{await api(`/api/routes/${r.id}`,{method:'DELETE',body:{reason}});toast('Rota excluída.','success');dlg.close();go(state.page);}catch(e){toast(e.message,'error');}
    };
    if(canRelease)$('#releaseRoute').onclick=async()=>{if(r.schedule_warnings?.length&&!confirm(`Existe alerta de horário nesta rota:\n\n${r.schedule_warnings.join('\n')}\n\nDeseja liberar mesmo assim?`))return;try{await api(`/api/routes/${r.id}/release`,{method:'POST',body:{}});toast('Rota liberada para o motorista.','success');dlg.close();go(state.page);}catch(e){toast(e.message,'error');}};
  } catch(e){toast(e.message,'error');}
}

async function renderTemplates(){
  [state.templates,state.pevs]=await Promise.all([api('/api/templates').then(x=>x.items),api('/api/pevs').then(x=>x.items)]);
  $('#page').innerHTML=`<div class="page-head"><div><span class="eyebrow">Favoritos e recorrência</span><h1>Rotas recorrentes</h1><p class="muted">Crie modelos reutilizáveis sem gerar rotas automaticamente.</p></div><button id="addTemplate" class="btn primary">+ Novo modelo</button></div><div class="card">${state.templates.length?`<div class="list">${state.templates.map(t=>`<div class="list-item"><div class="list-item-main"><strong>★ ${esc(t.name)}</strong><span>${t.pevs.length} PEVs</span></div></div>`).join('')}</div>`:'<div class="empty">Nenhum modelo salvo.</div>'}</div>`;
  $('#addTemplate').onclick=()=>openTemplateModal();
}
function openTemplateModal(){
  modal(`<form id="templateForm" class="modal-box"><div class="modal-head"><div><span class="eyebrow">Modelo</span><h2>Nova rota recorrente</h2></div><button type="button" class="icon-btn modal-close">×</button></div><label class="field"><span>Nome</span><input name="name" required placeholder="Ex.: Condomínios Osmir"></label><div style="margin-top:14px" class="pev-selector">${state.pevs.map(p=>`<label class="pev-check"><input type="checkbox" value="${p.id}"><div><div class="name">${p.favorite?'★ ':''}${esc(p.name)}</div><div class="addr">${esc(p.city)}/${esc(p.state)}</div></div></label>`).join('')}</div><div class="form-actions"><button type="button" class="btn ghost modal-close">Cancelar</button><button class="btn primary">Salvar modelo</button></div></form>`);
  $('#templateForm').onsubmit=async e=>{e.preventDefault();const ids=$$('#templateForm input[type=checkbox]:checked').map(x=>Number(x.value));try{await api('/api/templates',{method:'POST',body:{name:new FormData(e.target).get('name'),pev_ids:ids}});$('#modal').close();toast('Modelo salvo.','success');renderTemplates();}catch(err){toast(err.message,'error');}};
}

async function renderUsers(){
  state.users=(await api('/api/users')).items;
  $('#page').innerHTML=`<div class="page-head"><div><span class="eyebrow">Administração</span><h1>Usuários</h1><p class="muted">Gerencie acessos sem apagar o histórico operacional.</p></div><button id="addUser" class="btn primary">+ Novo usuário</button></div>
  <div class="card"><div class="toolbar"><input id="userSearch" class="search" placeholder="Pesquisar nome ou usuário"><select id="userRoleFilter"><option value="all">Todos os perfis</option><option value="admin">Administrador</option><option value="commercial">Comercial</option><option value="commercial_manager">Gerente Comercial</option><option value="driver">Motorista</option></select></div><div id="userList"></div></div>`;
  $('#addUser').onclick=openUserModal; $('#userSearch').oninput=drawUsers; $('#userRoleFilter').onchange=drawUsers; drawUsers();
}
function drawUsers(){
  const q=($('#userSearch')?.value||'').toLowerCase(),rf=$('#userRoleFilter')?.value||'all';
  const items=state.users.filter(u=>(rf==='all'||u.role===rf)&&`${u.name} ${u.username}`.toLowerCase().includes(q));
  $('#userList').innerHTML=items.length?`<div class="list">${items.map(u=>`<div class="list-item"><div class="list-item-main"><strong>${esc(u.name)}</strong><span>@${esc(u.username)} • ${roleLabel[u.role]||u.role}${u.phone?` • ${esc(u.phone)}`:''}</span><span>Último acesso: ${u.last_seen_at?fmtDateTime(u.last_seen_at):'Nunca'}${u.must_change_password?' • troca de senha pendente':''}</span></div><div class="actions"><span class="badge ${u.active?'normal':'cancelled'}">${u.active?'Ativo':'Inativo'}</span><button class="btn ghost small edit-user" data-id="${u.id}">Editar</button><button class="btn secondary small reset-user" data-id="${u.id}">Redefinir senha</button>${u.id!==state.user.id?`<button class="btn ${u.active?'danger':'success'} small toggle-user" data-id="${u.id}" data-active="${u.active?'1':'0'}">${u.active?'Desativar':'Reativar'}</button><button class="btn danger small delete-user" data-id="${u.id}">Excluir</button>`:''}</div></div>`).join('')}</div>`:'<div class="empty">Nenhum usuário encontrado.</div>';
  $$('.edit-user').forEach(b=>b.onclick=()=>openEditUser(state.users.find(x=>x.id===b.dataset.id)));
  $$('.reset-user').forEach(b=>b.onclick=()=>resetUserPassword(b.dataset.id));
  $$('.toggle-user').forEach(b=>b.onclick=async()=>{const active=b.dataset.active==='1';if(!confirm(`${active?'Desativar':'Reativar'} este usuário?`))return;try{await api(`/api/users/${b.dataset.id}`,{method:'PUT',body:{active:!active}});toast(active?'Usuário desativado.':'Usuário reativado.','success');renderUsers();}catch(e){toast(e.message,'error')}});
  $$('.delete-user').forEach(b=>b.onclick=async()=>{if(!confirm('Excluir definitivamente este usuário? Isso só será permitido se ele não possuir histórico.'))return;try{await api(`/api/users/${b.dataset.id}`,{method:'DELETE'});toast('Usuário excluído.','success');renderUsers();}catch(e){toast(e.message,'error')}});
}
function openUserModal(){
  modal(`<form id="userForm" class="modal-box"><div class="modal-head"><div><span class="eyebrow">Acesso</span><h2>Novo usuário</h2></div><button type="button" class="icon-btn modal-close">×</button></div><div class="form-grid"><label class="field"><span>Nome</span><input name="name" required></label><label class="field"><span>Usuário</span><input name="username" minlength="3" required></label><label class="field"><span>Senha inicial</span><input name="password" type="password" minlength="8" required><small class="muted">No primeiro acesso o usuário deverá trocar a senha.</small></label><label class="field"><span>Telefone</span><input name="phone" placeholder="(15) 99999-9999"></label><label class="field"><span>Perfil</span><select name="role"><option value="commercial">Comercial</option><option value="commercial_manager">Gerente Comercial</option><option value="driver">Motorista</option><option value="admin">Administrador</option></select></label></div><div class="form-actions"><button type="button" class="btn ghost modal-close">Cancelar</button><button class="btn primary">Criar usuário</button></div></form>`);
  $('#userForm').onsubmit=async e=>{e.preventDefault();try{await api('/api/users',{method:'POST',body:Object.fromEntries(new FormData(e.target))});$('#modal').close();toast('Usuário criado.','success');renderUsers();}catch(err){toast(err.message,'error')}};
}
function openEditUser(u){
  modal(`<form id="editUserForm" class="modal-box"><div class="modal-head"><div><span class="eyebrow">Usuário</span><h2>Editar ${esc(u.name)}</h2></div><button type="button" class="icon-btn modal-close">×</button></div><div class="form-grid"><label class="field"><span>Nome</span><input name="name" value="${esc(u.name)}" required></label><label class="field"><span>Telefone</span><input name="phone" value="${esc(u.phone||'')}"></label><label class="field"><span>Perfil</span><select name="role">${Object.entries(roleLabel).map(([v,l])=>`<option value="${v}" ${u.role===v?'selected':''}>${l}</option>`).join('')}</select></label></div><div class="form-actions"><button type="button" class="btn ghost modal-close">Cancelar</button><button class="btn primary">Salvar</button></div></form>`);
  $('#editUserForm').onsubmit=async e=>{e.preventDefault();try{await api(`/api/users/${u.id}`,{method:'PUT',body:Object.fromEntries(new FormData(e.target))});$('#modal').close();toast('Usuário atualizado.','success');renderUsers();}catch(err){toast(err.message,'error')}};
}
function resetUserPassword(id){
  modal(`<form id="resetPasswordForm" class="modal-box"><div class="modal-head"><div><span class="eyebrow">Segurança</span><h2>Redefinir senha</h2></div><button type="button" class="icon-btn modal-close">×</button></div><label class="field"><span>Nova senha provisória</span><input name="password" type="password" minlength="8" required></label><div class="info" style="margin-top:12px">O usuário será obrigado a trocar esta senha no próximo acesso.</div><div class="form-actions"><button type="button" class="btn ghost modal-close">Cancelar</button><button class="btn primary">Redefinir</button></div></form>`);
  $('#resetPasswordForm').onsubmit=async e=>{e.preventDefault();try{await api(`/api/users/${id}/reset-password`,{method:'POST',body:{password:new FormData(e.target).get('password')}});$('#modal').close();toast('Senha redefinida.','success');renderUsers();}catch(err){toast(err.message,'error')}};
}

async function renderActivities(){
  if(state.user.role!=='admin')return go('dashboard');
  const items=(await api('/api/audit')).items;
  $('#page').innerHTML=`<div class="page-head"><div><span class="eyebrow">Auditoria</span><h1>Histórico de atividades</h1><p class="muted">Registro automático das principais alterações no sistema.</p></div></div><div class="card"><div class="toolbar"><input id="auditSearch" class="search" placeholder="Pesquisar usuário, ação ou módulo"><select id="auditType"><option value="all">Todos os módulos</option>${[...new Set(items.map(x=>x.entity_type))].sort().map(x=>`<option value="${esc(x)}">${esc(x)}</option>`).join('')}</select></div><div id="auditList"></div></div>`;
  function draw(){const q=($('#auditSearch').value||'').toLowerCase(),tp=$('#auditType').value;const xs=items.filter(x=>(tp==='all'||x.entity_type===tp)&&`${x.actor_name} ${x.action} ${x.entity_type} ${x.summary}`.toLowerCase().includes(q));$('#auditList').innerHTML=xs.length?`<div class="list">${xs.map(x=>`<div class="list-item"><div class="list-item-main"><strong>${esc(x.actor_name||'Sistema')} • ${esc(x.summary||x.action)}</strong><span>${fmtDateTime(x.created_at)} • ${esc(x.entity_type)} #${esc(x.entity_id||'—')}</span>${x.metadata&&Object.keys(x.metadata).length?`<span>${esc(JSON.stringify(x.metadata))}</span>`:''}</div></div>`).join('')}</div>`:'<div class="empty">Nenhum registro encontrado.</div>';}
  $('#auditSearch').oninput=draw;$('#auditType').onchange=draw;draw();
}
function openPasswordModal(forced=false){
  const dlg=modal(`<form id="myPasswordForm" class="modal-box"><div class="modal-head"><div><span class="eyebrow">Segurança</span><h2>${forced?'Troca obrigatória de senha':'Alterar minha senha'}</h2></div>${forced?'':'<button type="button" class="icon-btn modal-close">×</button>'}</div><label class="field"><span>Senha atual</span><input name="current_password" type="password" required></label><label class="field" style="margin-top:12px"><span>Nova senha</span><input name="new_password" type="password" minlength="8" required></label><label class="field" style="margin-top:12px"><span>Confirmar nova senha</span><input name="confirm_password" type="password" minlength="8" required></label>${forced?'<div class="warning" style="margin-top:12px">Sua senha foi criada ou redefinida pelo Administrador. Para continuar, defina uma senha pessoal.</div>':''}<div class="form-actions">${forced?'':'<button type="button" class="btn ghost modal-close">Cancelar</button>'}<button class="btn primary">Salvar nova senha</button></div></form>`);
  if(forced)dlg.addEventListener('cancel',e=>e.preventDefault(),{once:true});
  $('#myPasswordForm').onsubmit=async e=>{e.preventDefault();const fd=new FormData(e.target),n=String(fd.get('new_password')),c=String(fd.get('confirm_password'));if(n!==c)return toast('As novas senhas não coincidem.','error');try{await api('/api/change-password',{method:'POST',body:{current_password:fd.get('current_password'),new_password:n}});state.user.must_change_password=false;dlg.close();toast('Senha alterada.','success');}catch(err){toast(err.message,'error')}};
}

async function renderSettings(){
  state.settings=await api('/api/settings'); const s=state.settings;
  $('#page').innerHTML=`<div class="page-head"><div><span class="eyebrow">Administração</span><h1>Configurações</h1><p class="muted">Defina a base usada como ponto inicial das rotas.</p></div><button id="backupBtn" class="btn secondary">Exportar backup</button></div><div class="card"><form id="settingsForm" class="form-grid"><label class="field"><span>Nome do sistema / empresa</span><input name="company_name" value="${esc(s.company_name)}"></label><label class="field"><span>Nome da base</span><input name="origin_name" value="${esc(s.origin_name)}"></label><label class="field"><span>CEP</span><div class="input-action"><input name="origin_cep" value="${esc(s.origin_cep)}"><button type="button" id="originCepBtn" class="btn secondary">Buscar</button></div></label><label class="field"><span>Número</span><input name="origin_number" value="${esc(s.origin_number)}"></label><label class="field span-2"><span>Logradouro</span><input name="origin_street" value="${esc(s.origin_street)}" required></label><label class="field"><span>Bairro</span><input name="origin_district" value="${esc(s.origin_district)}"></label><label class="field"><span>Complemento</span><input name="origin_complement" value="${esc(s.origin_complement)}"></label><label class="field"><span>Cidade</span><input name="origin_city" value="${esc(s.origin_city)}" required></label><label class="field"><span>UF</span><input name="origin_state" value="${esc(s.origin_state)}" maxlength="2" required></label><label class="field"><span>Latitude confirmada</span><input name="origin_lat" value="${s.origin_lat??''}"></label><label class="field"><span>Longitude confirmada</span><input name="origin_lng" value="${s.origin_lng??''}"></label><div class="span-2 form-actions"><button class="btn primary">Salvar configurações</button></div></form></div>`;
  const form=$('#settingsForm');
  $('#backupBtn').onclick=async()=>{try{const d=await api('/api/backup');const blob=new Blob([JSON.stringify(d,null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`rota-proxima-backup-${new Date().toISOString().slice(0,10)}.json`;a.click();URL.revokeObjectURL(a.href);toast('Backup exportado.','success');}catch(e){toast(e.message,'error')}};
  $('#originCepBtn').onclick=async()=>{try{const d=await api(`/api/cep/${digits(form.origin_cep.value)}`);form.origin_cep.value=d.cep;form.origin_street.value=d.street;form.origin_district.value=d.district;form.origin_city.value=d.city;form.origin_state.value=d.state;toast('CEP localizado.','success');}catch(e){toast(e.message,'error');}};
  form.onsubmit=async e=>{e.preventDefault();try{await api('/api/settings',{method:'PUT',body:Object.fromEntries(new FormData(form))});toast('Configurações salvas.','success');}catch(err){toast(err.message,'error');}};
}

async function renderDriverHome(){
  state.routes=(await api('/api/routes')).items;
  const active=state.routes.find(r=>r.status==='in_progress') || state.routes.find(r=>r.status==='released');
  if(!active){
    $('#page').innerHTML=`<div class="driver-page"><div class="driver-hero"><span class="eyebrow">Motorista</span><h1>Minha rota</h1><p>Não existe rota liberada para você neste momento.</p></div><div class="empty">Quando o Administrador liberar uma rota, ela aparecerá aqui.</div></div>`;return;
  }
  const r=await api(`/api/routes/${active.id}`); drawDriverRoute(r);
}

function drawDriverRoute(r){
  const done=r.stops.filter(s=>['completed','failed','skipped'].includes(s.status)).length; const total=r.stops.length;
  const next=r.stops.find(s=>['pending','arrived'].includes(s.status));
  const pct=total?Math.round(done/total*100):0;
  $('#page').innerHTML=`<div class="driver-page">
    <div class="driver-hero"><span class="eyebrow">${statusLabel[r.status]}</span><h1>${esc(r.name)}</h1><p>${fmtDate(r.route_date)} • ${done} de ${total} paradas encerradas</p><div class="driver-progress"><span style="width:${pct}%"></span></div></div>
    ${r.status==='released'?`<div class="card next-stop"><h2>Rota pronta</h2><p class="muted">Ao iniciar, registraremos data, hora e sua localização.</p><button id="startRoute" class="btn success wide">Iniciar rota</button></div>`:''}
    ${r.status==='in_progress' && next ? driverNextStopHtml(next) : ''}
    ${r.status==='in_progress' && !next ? `<div class="card"><h2>Todas as paradas foram encerradas</h2><p class="muted">Finalize a rota para registrar o horário e a localização de término.</p><button id="finishRoute" class="btn success wide">Finalizar rota</button></div>`:''}
    <div class="card" style="margin-top:16px"><h2>Sequência</h2><div class="timeline">${r.stops.map(s=>`<div class="timeline-item"><div class="timeline-dot ${s.status==='completed'?'done':s.status==='failed'?'bad':''}">${s.status==='completed'?'✓':s.status==='failed'?'!':s.sequence}</div><div><strong>${esc(s.pev_name)}</strong><div class="stop-meta">${esc(s.city)}/${esc(s.state)}${s.completed_at?` • ${fmtDateTime(s.completed_at)}`:''}</div></div><span class="badge ${s.status==='failed'?'failed':s.priority}">${s.status==='completed'?'Feita':s.status==='failed'?'Não feita':priorityLabel[s.priority]}</span></div>`).join('')}</div></div>
  </div>`;
  if($('#startRoute'))$('#startRoute').onclick=async()=>{try{const pos=await getPosition();const updated=await api(`/api/routes/${r.id}/start`,{method:'POST',body:{...pos,local_time:localHHMM()}});toast(updated.schedule_warnings?.length?updated.schedule_warnings[0]:'Rota iniciada e sequência ajustada pelo horário atual.',updated.schedule_warnings?.length?'error':'success');drawDriverRoute(updated);}catch(e){toast(e.message,'error');}};
  if($('#finishRoute'))$('#finishRoute').onclick=async()=>{try{const pos=await getPosition();const updated=await api(`/api/routes/${r.id}/finish`,{method:'POST',body:pos});toast('Rota finalizada.','success');drawDriverRoute(updated);}catch(e){toast(e.message,'error');}};
  bindDriverStopActions(r,next);
}

function driverNextStopHtml(s){
  const addr=`${esc(s.street)}, ${esc(s.number||'s/n')}${s.complement?` - ${esc(s.complement)}`:''}<br>${s.district?`${esc(s.district)} • `:''}${esc(s.city)}/${esc(s.state)}`;
  return `<div class="card next-stop"><span class="eyebrow">Próxima parada • ${s.sequence}</span><h2>${esc(s.pev_name)}</h2><div class="next-stop-address">${addr}</div>
    ${s.contact_name||s.phone?`<div class="contact-box"><strong>Responsável</strong><div>${esc(s.contact_name||'Não informado')}${s.contact_role?` • ${esc(s.contact_role)}`:''}</div>${s.phone?`<div style="margin-top:4px">${esc(s.phone)}</div>`:''}<div class="actions" style="margin-top:9px">${s.phone?`<a class="btn secondary small" href="${phoneHref(s.phone)}">Ligar</a>`:''}${s.phone&&s.whatsapp?`<a class="btn success small" target="_blank" href="${whatsHref(s.phone)}">WhatsApp</a>`:''}</div></div>`:''}
    ${s.exact_time?`<div class="warning"><strong>Horário específico de hoje: ${esc(s.exact_time)}</strong><br>Esta parada foi agendada para esse horário.</div>`:(s.window_start||s.window_end?`<div class="info">Horário do local: ${esc(s.window_start||'—')} até ${esc(s.window_end||'—')}</div>`:'')}
    ${s.notes?`<div class="warning" style="margin-top:9px">${esc(s.notes)}</div>`:''}
    <div class="driver-actions"><button id="googleNav" class="btn blue">Google Maps</button><button id="wazeNav" class="btn secondary">Waze</button>${s.status==='pending'?'<button id="arriveStop" class="btn secondary full">Cheguei ao local</button>':''}<button id="completeStop" class="btn success full">✓ Finalizar parada</button><button id="failStop" class="btn danger">Não realizada</button><button id="recalcRoute" class="btn ghost">Recalcular restante</button></div></div>`;
}

function bindDriverStopActions(route,next){
  if(!next)return;
  // Navegação usa o endereço postal completo (principalmente NÚMERO + CEP).
  // As coordenadas de p.lat/p.lng podem ter sido obtidas automaticamente apenas para
  // otimização e, em alguns logradouros, representam o centro da rua em vez do imóvel.
  const fullAddress=[
    `${next.street}${next.number ? `, ${next.number}` : ''}`,
    next.district||'',
    `${next.city} - ${next.state}`,
    next.cep||'',
    'Brasil'
  ].filter(Boolean).join(', ');
  const address=encodeURIComponent(fullAddress);
  if($('#googleNav'))$('#googleNav').onclick=()=>window.open(`https://www.google.com/maps/dir/?api=1&destination=${address}&travelmode=driving&dir_action=navigate`,'_blank');
  if($('#wazeNav'))$('#wazeNav').onclick=()=>window.open(`https://waze.com/ul?q=${address}&navigate=yes`,'_blank');
  if($('#arriveStop'))$('#arriveStop').onclick=async()=>{try{const pos=await getPosition();const updated=await api(`/api/stops/${next.id}/arrive`,{method:'POST',body:pos});toast('Chegada registrada.','success');drawDriverRoute(updated);}catch(e){toast(e.message,'error');}};
  if($('#completeStop'))$('#completeStop').onclick=async()=>{try{const pos=await getPosition();const updated=await api(`/api/stops/${next.id}/complete`,{method:'POST',body:{...pos,note:''}});toast('Parada finalizada.','success');drawDriverRoute(updated);}catch(e){toast(e.message,'error');}};
  if($('#failStop'))$('#failStop').onclick=()=>openFailModal(next,route);
  if($('#recalcRoute'))$('#recalcRoute').onclick=async()=>{try{const pos=await getPosition(true);const updated=await api(`/api/routes/${route.id}/recalculate`,{method:'POST',body:{...pos,local_time:localHHMM()}});toast(updated.schedule_warnings?.length?updated.schedule_warnings[0]:'Paradas restantes recalculadas respeitando os horários específicos.',updated.schedule_warnings?.length?'error':'success');drawDriverRoute(updated);}catch(e){toast(e.message,'error');}};
}

function openFailModal(stop,route){
  modal(`<form id="failForm" class="modal-box"><div class="modal-head"><div><span class="eyebrow">Parada ${stop.sequence}</span><h2>Não foi possível realizar</h2></div><button type="button" class="icon-btn modal-close">×</button></div><label class="field"><span>Motivo</span><select name="reason"><option>Local fechado</option><option>Responsável ausente</option><option>Material indisponível</option><option>Endereço incorreto</option><option>Outro</option></select></label><label class="field" style="margin-top:12px"><span>Observação</span><textarea name="note"></textarea></label><div class="form-actions"><button type="button" class="btn ghost modal-close">Cancelar</button><button class="btn danger">Registrar</button></div></form>`);
  $('#failForm').onsubmit=async e=>{e.preventDefault();try{const pos=await getPosition();const body={...Object.fromEntries(new FormData(e.target)),...pos};const updated=await api(`/api/stops/${stop.id}/fail`,{method:'POST',body});$('#modal').close();toast('Ocorrência registrada.','success');drawDriverRoute(updated);}catch(err){toast(err.message,'error');}};
}

async function renderHistory(){
  const routes=(await api('/api/routes')).items.filter(r=>r.status==='finished');
  $('#page').innerHTML=`<div class="page-head"><div><span class="eyebrow">Motorista</span><h1>Histórico</h1></div></div><div class="card">${routeListHtml(routes)}</div>`; bindRouteOpeners();
}

if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('/service-worker.js').catch(()=>{}));
boot();
