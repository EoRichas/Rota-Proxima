// Local state belongs to the open form: switching PEV invalidates pending lookups.
function pickupCoords(a) {
  return a && Number.isFinite(a.lat) && Number.isFinite(a.lng)
    ? a.lat.toFixed(5)+', '+a.lng.toFixed(5) : '';
}

function pickupHistoryMarkup() {
  return '<details class="pickup-history"><summary>Locais já visitados</summary><div class="pickup-visits" aria-live="polite"></div></details>';
}

function bindPickupHistory(details, pevId, useAddress) {
  const list=details.querySelector('.pickup-visits');
  let loading=false, loaded=false;
  details.ontoggle=async()=>{
    if(!details.open||loading||loaded)return;
    loading=true;list.textContent='Buscando visitas…';
    try{
      const {items}=await api('/api/pickup-history'+(pevId==null?'':'/'+Number(pevId)));
      list.replaceChildren();
      if(!items.length) list.textContent='Nenhum local visitado registrado.';
      for(const a of items){
        const row=document.createElement('div'), label=document.createElement('span');
        const coords=pickupCoords(a);
        label.textContent=(a.street?[a.street+', '+a.number,a.city, a.cep].filter(Boolean).join(' · '):'Visita anterior · GPS da chegada')+' · '+fmtDateTime(a.visited_at);
        row.append(label);
        if(useAddress&&a.street){
          const button=document.createElement('button');
          button.type='button';button.className='btn secondary small';button.textContent='Usar endereço';
          button.onclick=()=>{useAddress(a);details.open=false;};row.append(button);
        }else if(!a.street && coords){
          const link=document.createElement('a');link.href='https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(coords);
          link.target='_blank';link.rel='noopener noreferrer';link.textContent='Ver ponto da visita';row.append(link);
        }
        list.append(row);
      }
      loaded=true;
    }catch{list.textContent='Não foi possível carregar. Feche e abra o histórico para tentar novamente.';}
    finally{loading=false;}
  };
}

function setupPickupRequest(form,pevs){
  const fields=form.querySelector('#pickupFields'),status=fields.querySelector('.pickup-postal-status');
  const {pev_id:selector,pickup_cep:cep,pickup_street:street,pickup_number:number}=form.elements;
  let version=0, lastCep='',autoStreet='';
  function clear(){
    ++version;lastCep='';autoStreet='';cep.value=street.value=number.value=status.textContent='';
  }
  function sync(){
    clear();
    const pev=pevs.find(p=>String(p.id)===selector.value);
    fields.hidden=fields.disabled=!pev?.requires_pickup_address;
    const host=fields.querySelector('.pickup-history-host');host.replaceChildren();
    if(fields.disabled)return;
    host.innerHTML=pickupHistoryMarkup();
    bindPickupHistory(host.firstElementChild,pev.id,a=>{
      ++version;cep.value=a.cep;lastCep=digits(a.cep);street.value=autoStreet=a.street;number.value=a.number;
      status.textContent=[a.district,a.city,a.state].filter(Boolean).join(' · ')+' · Endereço recuperado do histórico.';
    });
  }
  cep.oninput=async()=>{
    const code=digits(cep.value);
    if(code===lastCep)return;
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
