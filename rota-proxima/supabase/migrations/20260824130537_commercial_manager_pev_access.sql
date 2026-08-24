-- Gerentes podem criar PEVs para Comerciais ativos, sem permissão de edição.

-- A função permanece SECURITY INVOKER e todas as policies existentes continuam ativas.

CREATE OR REPLACE FUNCTION public.save_pev(p_id bigint, p_data jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_role text := public.current_app_role();
  v_old public.pevs%rowtype;
  v_new public.pevs%rowtype;
  v_name text := trim(coalesce(p_data->>'name',''));
  v_address_mode text := coalesce(nullif(trim(p_data->>'address_mode'),''),'cep');
  v_cep text := coalesce(p_data->>'cep','');
  v_street text := trim(coalesce(p_data->>'street',''));
  v_number text := coalesce(p_data->>'number','');
  v_complement text := coalesce(p_data->>'complement','');
  v_district text := coalesce(p_data->>'district','');
  v_city text := trim(coalesce(p_data->>'city',''));
  v_state text := upper(trim(coalesce(p_data->>'state','')));
  v_contact_name text := coalesce(p_data->>'contact_name','');
  v_contact_role text := coalesce(p_data->>'contact_role','');
  v_phone text := coalesce(p_data->>'phone','');
  v_service_start time := nullif(trim(coalesce(p_data->>'service_start','')),'')::time;
  v_service_end time := nullif(trim(coalesce(p_data->>'service_end','')),'')::time;
  v_priority text := coalesce(nullif(trim(p_data->>'default_priority'),''),'normal');
  v_notes text := coalesce(p_data->>'notes','');
  v_internal_notes text := coalesce(p_data->>'internal_notes','');
  v_whatsapp boolean := coalesce((p_data->>'whatsapp')::boolean,false);
  v_favorite boolean := coalesce((p_data->>'favorite')::boolean,false);
  v_lat double precision := nullif(trim(coalesce(p_data->>'lat','')),'')::double precision;
  v_lng double precision := nullif(trim(coalesce(p_data->>'lng','')),'')::double precision;
  v_owner uuid;
  v_owner_role text;
  v_dup_name text;
begin
  if v_role not in ('admin','commercial','commercial_manager') then raise exception 'Sem permissão'; end if;
  if v_name = '' or v_street = '' or v_city = '' or v_state = '' then raise exception 'Informe nome, logradouro, cidade e UF'; end if;
  if v_address_mode not in ('cep','manual') then raise exception 'Modo de endereço inválido'; end if;
  if v_priority not in ('urgent','high','normal','low') then raise exception 'Prioridade inválida'; end if;

  select name into v_dup_name from public.pevs
  where deleted_at is null and id <> coalesce(p_id,-1)
    and lower(street)=lower(v_street) and lower(coalesce(number,''))=lower(v_number)
    and lower(city)=lower(v_city) and lower(state)=lower(v_state) limit 1;
  if v_dup_name is not null then raise exception 'Já existe um PEV semelhante: %',v_dup_name; end if;

  if p_id is null then
    if v_role='commercial' then
      v_owner := auth.uid();
    else
      v_owner := nullif(trim(coalesce(p_data->>'commercial_owner_id','')),'')::uuid;
    end if;
  else
    if v_role='commercial_manager' then raise exception 'Gerente Comercial pode criar PEVs, mas não pode editá-las'; end if;
    select * into v_old from public.pevs where id=p_id;
    if not found then raise exception 'PEV não encontrado'; end if;
    if v_role='commercial' and v_old.commercial_owner_id is distinct from auth.uid() then raise exception 'Sem permissão para editar esta PEV'; end if;
    if v_role='admin' then v_owner := nullif(trim(coalesce(p_data->>'commercial_owner_id','')),'')::uuid;
    else v_owner := v_old.commercial_owner_id; end if;
  end if;

  if v_owner is not null then
    select role into v_owner_role from public.profiles where id=v_owner and active=true;
    if v_owner_role is distinct from 'commercial' then raise exception 'O responsável da PEV deve ser um usuário Comercial ativo'; end if;
  end if;

  if p_id is null then
    insert into public.pevs(name,address_mode,cep,street,number,complement,district,city,state,lat,lng,location_confirmed,contact_name,contact_role,phone,whatsapp,service_start,service_end,default_priority,notes,internal_notes,favorite,active,created_by,commercial_owner_id)
    values(v_name,v_address_mode,v_cep,v_street,v_number,v_complement,v_district,v_city,v_state,v_lat,v_lng,(v_lat is not null and v_lng is not null and coalesce((p_data->>'location_confirmed')::boolean,true)),v_contact_name,v_contact_role,v_phone,v_whatsapp,v_service_start,v_service_end,v_priority,v_notes,v_internal_notes,v_favorite,true,auth.uid(),v_owner)
    returning * into v_new;
    insert into public.audit_logs(actor_id,action,entity_type,entity_id,summary,before_data,after_data,metadata)
    values(auth.uid(),'create','pev',v_new.id::text,'PEV '||v_new.name||' criado',null,to_jsonb(v_new),'{}'::jsonb);
  else
    update public.pevs set name=v_name,address_mode=v_address_mode,cep=v_cep,street=v_street,number=v_number,complement=v_complement,district=v_district,city=v_city,state=v_state,lat=v_lat,lng=v_lng,location_confirmed=(v_lat is not null and v_lng is not null),contact_name=v_contact_name,contact_role=v_contact_role,phone=v_phone,whatsapp=v_whatsapp,service_start=v_service_start,service_end=v_service_end,default_priority=v_priority,notes=v_notes,internal_notes=v_internal_notes,favorite=v_favorite,commercial_owner_id=v_owner
    where id=p_id returning * into v_new;
    insert into public.audit_logs(actor_id,action,entity_type,entity_id,summary,before_data,after_data,metadata)
    values(auth.uid(),'update','pev',v_new.id::text,'PEV '||v_new.name||' alterado',to_jsonb(v_old),to_jsonb(v_new),'{}'::jsonb);
  end if;
  return to_jsonb(v_new);
end;
$function$;

alter policy pevs_insert
on public.pevs
with check (
  (select public.is_admin())
  or (
    (select public.current_app_role()) = 'commercial'
    and commercial_owner_id = (select auth.uid())
  )
  or (
    (select public.current_app_role()) = 'commercial_manager'
    and created_by = (select auth.uid())
    and (
      commercial_owner_id is null
      or exists (
        select 1
        from public.profiles as commercial_owner
        where commercial_owner.id = pevs.commercial_owner_id
          and commercial_owner.role = 'commercial'
          and commercial_owner.active = true
      )
    )
  )
);
