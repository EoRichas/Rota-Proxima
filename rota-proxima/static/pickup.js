// Local state belongs to the open form: switching PEV invalidates pending lookups.
function pickupCoords(a) {
  return a && Number.isFinite(a.lat) && Number.isFinite(a.lng)
    ? a.lat.toFixed(5)+', '+a.lng.toFixed(5) : '';
}

function pickupHistoryMarkup() {
  return '<div class="pickup-history"><label class="field"><span>Locais já visitados</span><select></select></label><small class="muted" role="status"></small></div>';
}

function bindPickupHistory(host, pevId, useAddress) {
  const select=host.querySelector('select'),hint=host.querySelector('small');
  const first=useAddress?'Informar novo local':'Selecione um local';
  let items=[];
  async function load(){
    select.replaceChildren(new Option(first,''));hint.textContent='Buscando visitas…';
    try{
      const data=await api('/api/pickup-history'+(pevId==null?'':'/'+Number(pevId)));
      if(!host.isConnected)return;
      items=data.items;
      items.forEach((a,i)=>{
        const where=a.street?[a.street+', '+a.number,a.city,a.cep].filter(Boolean).join(' · '):'GPS da chegada';
        select.add(new Option(where+' — '+fmtDateTime(a.visited_at),String(i)));
      });
      hint.textContent=items.length?'':'Nenhum local visitado registrado.';
    }catch{
      hint.textContent='Histórico indisponível. ';
      const retry=document.createElement('button');retry.type='button';retry.className='btn ghost small';
      retry.textContent='Tentar novamente';retry.onclick=load;hint.append(retry);
    }
  }
  select.onchange=()=>{
    const a=select.value===''?null:items[Number(select.value)];
    hint.replaceChildren();
    if(useAddress)useAddress(a?.street?a:null);
    if(a && !a.street && pickupCoords(a)){
      hint.append('Visita sem endereço salvo. ');
      const link=document.createElement('a');link.textContent='Ver GPS da chegada';
      link.href='https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(pickupCoords(a));
      link.target='_blank';link.rel='noopener noreferrer';hint.append(link);
    }else if(a && !useAddress){
      hint.textContent=[a.district,a.city,a.state,a.contact_name,a.phone].filter(Boolean).join(' · ');
    }
  };
  load();
}

function setupPickupRequest(form,pevs){
  const fields=form.querySelector('#pickupFields'),status=fields.querySelector('.pickup-postal-status');
  const {pev_id:selector,pickup_cep:cep,pickup_street:street,pickup_number:number}=form.elements;
  const {pickup_contact_name:name,pickup_phone:phone,pickup_whatsapp:wa}=form.elements;
  function syncPhone(){
    const raw=phone.value.trim(), n=digits(raw);
    const valid= /^(?:55)?[1-9][0-9]{9,10}$/.test(n) && /^[+0-9() .-]+$/.test(raw);
    phone.setCustomValidity(!raw||valid?'':'Informe um telefone com DDD.');
    wa.disabled=!valid;if(!valid)wa.checked=false;
  }
  phone.oninput=syncPhone;
  function clearContact(){name.value=phone.value='';wa.checked=false;syncPhone();}
  let version=0, lastCep='',autoStreet='';
  function clear(){
    clearContact();++version;lastCep='';autoStreet='';cep.value=street.value=number.value=status.textContent='';
  }
  function sync(){
    clear();
    const pev=pevs.find(p=>String(p.id)===selector.value);
    fields.hidden=fields.disabled=!pev?.requires_pickup_address;
    const host=fields.querySelector('.pickup-history-host');host.replaceChildren();
    if(fields.disabled)return;
    host.innerHTML=pickupHistoryMarkup();
    bindPickupHistory(host.firstElementChild,pev.id,a=>{
      clear();
      if(!a)return;
      name.value=a.contact_name||'';phone.value=a.phone||'';syncPhone();wa.checked=!wa.disabled&&a.whatsapp===true;
      cep.value=a.cep;lastCep=digits(a.cep);street.value=autoStreet=a.street;number.value=a.number;
      status.textContent=[a.district,a.city,a.state].filter(Boolean).join(' · ')+' · Endereço recuperado do histórico.';
    });
  }
  function detachAddress(){
    const history=fields.querySelector('.pickup-history select');
    if(history?.value){history.value='';clearContact();fields.querySelector('.pickup-history small').replaceChildren();}
  }
  street.addEventListener('input',detachAddress);
  number.addEventListener('input',detachAddress);
  cep.oninput=async()=>{
    const code=digits(cep.value);
    if(code===lastCep)return;
    detachAddress();
    if(lastCep.length===8){number.value='';street.value='';}
    const ticket=++version;lastCep=code;status.textContent='';
    if(street.value===autoStreet)street.value='';
    autoStreet='';
    if(!/^[0-9]{8}$/.test(code))return;
    const before=street.value;
    status.textContent='Consultando CEP…';
    try{
      const a=await api('/api/pickup-postal/'+code);
      if(ticket!==version||fields.disabled)return;
      if(a.street&&!before&&street.value===before)street.value=autoStreet=a.street;
      const coords=pickupCoords(a);
      status.textContent=[[a.district,a.city,a.state].filter(Boolean).join(' · '),
        coords?'Referência do CEP: '+coords:'',
        a.street?'Confira a rua e informe o número.':'CEP sem rua definida. Informe a rua e o número.'].filter(Boolean).join(' · ');
    }catch{
      if(ticket===version)status.textContent='CEP não localizado agora. Confira o CEP e preencha a rua.';
    }
  };
  selector.addEventListener('change',sync);sync();
}
