/* Pointer events support dragging with mouse and touch; arrows support keyboard. */
function pendingRouteOrder(route) {
  return route.stops.filter(stop=>stop.status==='pending').map(stop=>Number(stop.id));
}

function movedStopOrder(ids, from, to) {
  const result=ids.slice();
  if(from<0||to<0||from>=result.length||to>=result.length)return result;
  const [id]=result.splice(from,1);result.splice(to,0,id);return result;
}

function installRouteReorder(route, root, onSaved) {
  const allowed=state.user?.role==='admin'||(state.user?.role==='driver'&&route.driver_id===state.user.id);
  const ids=pendingRouteOrder(route);
  if(state.user?.role==='driver'&&route.status!=='in_progress')return;
  if(!root||!allowed||!['released','in_progress'].includes(route.status)||ids.length<2)return;
  const sequence=root.querySelector('.driver-sequence-card .timeline')||root.querySelector('.route-preview');
  if(!sequence)return;
  const rows=[...sequence.children];
  const editable=new Map();
  route.stops.forEach((stop,index)=>{
    if(stop.status!=='pending'||!rows[index])return;
    const row=rows[index];row.dataset.stopId=stop.id;
    const handle=document.createElement('button');handle.type='button';handle.className='route-drag-handle';
    handle.setAttribute('aria-label',`Mover ${stop.pev_name}. Use as setas para cima ou para baixo.`);
    handle.title='Arraste para mudar a ordem; ou use as setas do teclado';handle.textContent='☰';
    row.prepend(handle);row.classList.add('route-reorder-row');editable.set(Number(stop.id),row);
  });
  const live=document.createElement('div');live.className='muted reorder-status';live.setAttribute('aria-live','polite');
  sequence.before(live);live.textContent='Arraste pelos três traços para ajustar as paradas pendentes.';
  let saving=false;
  async function persist(next){
    if(saving||next.every((id,index)=>id===ids[index]))return;
    saving=true;live.textContent='Salvando a nova sequência...';
    for(const row of editable.values())row.querySelector('button').disabled=true;
    try{
      const updated=await api(`/api/routes/${route.id}/reorder`,{method:'POST',body:{stop_ids:next,expected_ids:ids}});
      toast('Ordem atualizada. Paradas encerradas foram preservadas.','success');onSaved(updated);
    }catch(error){live.textContent=error.message;toast(error.message,'error');}
    finally{saving=false;for(const row of editable.values())row.querySelector('button').disabled=false;}
  }
  for(const [stopId,row] of editable){
    const handle=row.querySelector('.route-drag-handle');
    handle.onkeydown=event=>{
      if(!['ArrowUp','ArrowDown'].includes(event.key))return;
      event.preventDefault();const from=ids.indexOf(stopId);
      persist(movedStopOrder(ids,from,from+(event.key==='ArrowUp'?-1:1)));
    };
    handle.onpointerdown=event=>{
      if(saving||event.button!==0)return;
      event.preventDefault();handle.setPointerCapture(event.pointerId);row.classList.add('is-dragging');
      let targetId=stopId;
      handle.onpointermove=move=>{
        const target=document.elementFromPoint(move.clientX,move.clientY)?.closest('[data-stop-id]');
        if(target&&editable.has(Number(target.dataset.stopId))){
          for(const item of editable.values())item.classList.remove('drag-target');
          target.classList.add('drag-target');targetId=Number(target.dataset.stopId);
        }
        const scroll=sequence.closest('.modal-box')||document.scrollingElement;
        if(move.clientY<70)scroll.scrollTop-=16;
        if(move.clientY>window.innerHeight-70)scroll.scrollTop+=16;
      };
      const finish=cancel=>{
        row.classList.remove('is-dragging');for(const item of editable.values())item.classList.remove('drag-target');
        handle.onpointermove=null;handle.onpointerup=null;handle.onpointercancel=null;
        if(!cancel)persist(movedStopOrder(ids,ids.indexOf(stopId),ids.indexOf(targetId)));
      };
      handle.onpointerup=()=>finish(false);handle.onpointercancel=()=>finish(true);
    };
  }
}
