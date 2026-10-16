begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';
grant usage on schema private to service_role;

alter table public.pevs add column if not exists drum_installed boolean not null default false;
-- Preserve established PEVs: a completed collection also proves an existing drum.
update public.pevs p set drum_installed = true
where exists (select 1 from public.route_stops s where s.pev_id=p.id and s.status='completed');

create or replace function private.update_drum_inventory() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.status='completed' and old.status is distinct from new.status then
    update public.pevs set drum_installed=true where id=new.pev_id;
  end if;
  return new;
end $$;
revoke all on function private.update_drum_inventory() from public,anon,authenticated;
create trigger route_stop_update_drum_inventory after update of status on public.route_stops
for each row execute function private.update_drum_inventory();

create or replace function public.set_pev_drum_status(p_pev_id bigint,p_installed boolean) returns void
language plpgsql security invoker set search_path='' as $$
begin
  if public.current_app_role() is distinct from 'admin' then raise exception 'Sem permissão'; end if;
  update public.pevs set drum_installed=p_installed where id=p_pev_id;
  if not found then raise exception 'PEV não encontrado'; end if;
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,summary,metadata)
  values(auth.uid(),'drum_status','pev',p_pev_id::text,'Situação do tambor atualizada',jsonb_build_object('installed',p_installed));
end $$;
revoke all on function public.set_pev_drum_status(bigint,boolean) from public,anon;
grant execute on function public.set_pev_drum_status(bigint,boolean) to authenticated;

-- Only pending slots may move. The route lock serializes arrival, completion and reordering.
create or replace function private.reorder_pending_stops(p_route_id bigint,p_expected_ids bigint[],p_updates jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  r public.routes%rowtype; role_name text:=public.current_app_role();
  current_ids bigint[]; submitted_ids bigint[]; slots integer[]; supplied_slots integer[];
  offset_sequence integer; item jsonb;
begin
  if auth.uid() is null or role_name not in ('admin','driver') or role_name is null then raise exception 'Sem permissão'; end if;
  select * into r from public.routes where id=p_route_id for update;
  if not found or r.status not in ('released','in_progress') or
     (role_name='driver' and (r.driver_id is distinct from auth.uid() or r.status<>'in_progress')) then
    raise exception 'Rota indisponível para reordenação';
  end if;
  perform 1 from public.route_stops where route_id=p_route_id order by id for update;
  select array_agg(id order by sequence),array_agg(sequence order by sequence)
    into current_ids,slots from public.route_stops where route_id=p_route_id and status='pending';
  if current_ids is distinct from p_expected_ids then raise exception 'A rota mudou. Atualize antes de reordenar'; end if;
  if jsonb_typeof(p_updates)<>'array' or jsonb_array_length(p_updates)<>coalesce(cardinality(current_ids),0) then raise exception 'Sequência incompleta'; end if;
  select array_agg((v->>'id')::bigint order by (v->>'sequence')::integer),
         array_agg((v->>'sequence')::integer order by (v->>'sequence')::integer)
    into submitted_ids,supplied_slots from jsonb_array_elements(p_updates) v;
  if supplied_slots is distinct from slots or
     (select array_agg(x order by x) from unnest(submitted_ids) x) is distinct from
     (select array_agg(x order by x) from unnest(current_ids) x) then raise exception 'Paradas inválidas ou repetidas'; end if;
  select coalesce(max(sequence),0)+1000 into offset_sequence from public.route_stops where route_id=p_route_id;
  update public.route_stops set sequence=sequence+offset_sequence where route_id=p_route_id and status='pending';
  for item in select value from jsonb_array_elements(p_updates) loop
    if (item->>'planned_distance_m')::numeric<0 or (item->>'planned_duration_s')::numeric<0 then raise exception 'Trajeto inválido'; end if;
    update public.route_stops set sequence=(item->>'sequence')::integer,
      planned_distance_m=(item->>'planned_distance_m')::numeric,
      planned_duration_s=(item->>'planned_duration_s')::numeric
    where id=(item->>'id')::bigint and route_id=p_route_id and status='pending';
  end loop;
  update public.routes set total_distance_m=(select coalesce(sum(planned_distance_m),0) from public.route_stops where route_id=p_route_id),
    total_duration_s=(select coalesce(sum(planned_duration_s),0) from public.route_stops where route_id=p_route_id)
    where id=p_route_id;
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,summary,metadata)
  values(auth.uid(),'manual_reorder','route',p_route_id::text,'Ordem das paradas pendentes ajustada',jsonb_build_object('before',current_ids,'after',submitted_ids));
  return jsonb_build_object('ok',true);
end $$;
revoke all on function private.reorder_pending_stops(bigint,bigint[],jsonb) from public,anon;
grant execute on function private.reorder_pending_stops(bigint,bigint[],jsonb) to authenticated;
create or replace function public.reorder_pending_stops(p_route_id bigint,p_expected_ids bigint[],p_updates jsonb)
returns jsonb language sql security invoker set search_path='' as $$ select private.reorder_pending_stops(p_route_id,p_expected_ids,p_updates) $$;
revoke all on function public.reorder_pending_stops(bigint,bigint[],jsonb) from public,anon;
grant execute on function public.reorder_pending_stops(bigint,bigint[],jsonb) to authenticated;

alter table public.route_evidences add column if not exists sync_context jsonb;
alter table public.route_evidences add column if not exists next_retry_at timestamptz not null default now();
create index route_evidence_retry_idx on public.route_evidences(next_retry_at,id)
where sharepoint_status in ('pending','error','syncing');

create or replace function private.prepare_evidence_sync(p_evidence_id bigint,p_context jsonb) returns void
language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null or coalesce(public.current_app_role(),'') not in ('admin','driver','production') then raise exception 'Sem permissão'; end if;
  update public.route_evidences set sync_context=p_context where id=p_evidence_id
    and (created_by=auth.uid() or public.current_app_role()='admin') and sharepoint_status<>'synced';
end $$;
revoke all on function private.prepare_evidence_sync(bigint,jsonb) from public,anon;
grant execute on function private.prepare_evidence_sync(bigint,jsonb) to authenticated;
create or replace function public.prepare_evidence_sync(p_evidence_id bigint,p_context jsonb) returns void
language sql security invoker set search_path='' as $$ select private.prepare_evidence_sync(p_evidence_id,p_context) $$;
revoke all on function public.prepare_evidence_sync(bigint,jsonb) from public,anon;
grant execute on function public.prepare_evidence_sync(bigint,jsonb) to authenticated;

create or replace function private.claim_evidence_sync(p_limit integer,p_evidence_id bigint default null)
returns setof public.route_evidences language plpgsql security definer set search_path='' as $$
declare role_name text:=public.current_app_role(); service boolean:=coalesce(auth.jwt()->>'role'='service_role',false);
begin
  if not service and (auth.uid() is null or role_name is null or role_name not in ('admin','driver','production')) then raise exception 'Sem permissão'; end if;
  return query with candidates as (
    select e.id from public.route_evidences e
    where (service or role_name='admin' or e.created_by=auth.uid())
      and (p_evidence_id is null or e.id=p_evidence_id)
      and e.sharepoint_attempts<8 and e.next_retry_at<=now()
      and (e.sharepoint_status in ('pending','error') or (e.sharepoint_status='syncing' and e.sharepoint_started_at<now()-interval '10 minutes'))
    order by e.next_retry_at,e.id for update skip locked limit greatest(1,least(p_limit,3))
  ) update public.route_evidences e set sharepoint_status='syncing',sharepoint_started_at=now(),
      sharepoint_attempts=e.sharepoint_attempts+1,sharepoint_last_error=null
    from candidates c where e.id=c.id returning e.*;
end $$;
revoke all on function private.claim_evidence_sync(integer,bigint) from public,anon;
grant execute on function private.claim_evidence_sync(integer,bigint) to authenticated,service_role;
create or replace function public.claim_evidence_sync(p_limit integer default 3,p_evidence_id bigint default null)
returns setof public.route_evidences language sql security invoker set search_path='' as $$ select * from private.claim_evidence_sync(p_limit,p_evidence_id) $$;
revoke all on function public.claim_evidence_sync(integer,bigint) from public,anon;
grant execute on function public.claim_evidence_sync(integer,bigint) to authenticated,service_role;

create or replace function private.fail_evidence_sync(p_evidence_id bigint,p_error text) returns void
language plpgsql security definer set search_path='' as $$
declare role_name text:=public.current_app_role(); service boolean:=coalesce(auth.jwt()->>'role'='service_role',false);
begin
  if not service and (auth.uid() is null or role_name is null or role_name not in ('admin','driver','production')) then raise exception 'Sem permissão'; end if;
  update public.route_evidences set sharepoint_status='error',sharepoint_last_error=left(p_error,700),
    next_retry_at=now()+make_interval(secs=>least(3600,30*power(2,least(sharepoint_attempts,7))::integer))
  where id=p_evidence_id and sharepoint_status<>'synced' and (service or role_name='admin' or created_by=auth.uid());
end $$;
revoke all on function private.fail_evidence_sync(bigint,text) from public,anon;
grant execute on function private.fail_evidence_sync(bigint,text) to authenticated,service_role;
create or replace function public.fail_evidence_sync(p_evidence_id bigint,p_error text) returns void
language sql security invoker set search_path='' as $$ select private.fail_evidence_sync(p_evidence_id,p_error) $$;
revoke all on function public.fail_evidence_sync(bigint,text) from public,anon;
grant execute on function public.fail_evidence_sync(bigint,text) to authenticated,service_role;

-- An administrator can explicitly release exhausted or delayed errors for retry.
create or replace function private.reset_failed_evidence_sync() returns void
language plpgsql security definer set search_path='' as $$
begin
  if public.current_app_role() is distinct from 'admin' then raise exception 'Sem permissão'; end if;
  update public.route_evidences set next_retry_at=now(),sharepoint_attempts=0 where sharepoint_status='error';
end $$;
revoke all on function private.reset_failed_evidence_sync() from public,anon;
grant execute on function private.reset_failed_evidence_sync() to authenticated;
create or replace function public.reset_failed_evidence_sync() returns void
language sql security invoker set search_path='' as $$ select private.reset_failed_evidence_sync() $$;
revoke all on function public.reset_failed_evidence_sync() from public,anon;
grant execute on function public.reset_failed_evidence_sync() to authenticated;

-- Allow the scheduled worker, but never anonymous callers, to confirm a transfer.
create or replace function private.update_own_evidence_sync(
  p_evidence_id bigint,p_status text,p_item_id text,p_url text,p_path text,p_sha256 text,
  p_synced_at timestamptz,p_last_error text,p_storage_deleted_at timestamptz
) returns jsonb language plpgsql security definer set search_path='' as $$
declare e public.route_evidences%rowtype; role_name text:=public.current_app_role();
  service boolean:=coalesce(auth.jwt()->>'role'='service_role',false);
begin
  if not service and (auth.uid() is null or role_name is null or role_name not in ('admin','driver','production')) then raise exception 'Sem permissão'; end if;
  select * into e from public.route_evidences where id=p_evidence_id for update;
  if not found or (not service and role_name<>'admin' and e.created_by is distinct from auth.uid()) then raise exception 'Sem permissão'; end if;
  if p_status is not null and p_status not in ('syncing','synced','error') then raise exception 'Status inválido'; end if;
  if e.sharepoint_status='synced' and p_status in ('syncing','error') then raise exception 'Evidência já sincronizada'; end if;
  if p_storage_deleted_at is not null and e.sharepoint_status<>'synced' then raise exception 'A limpeza exige sincronização confirmada'; end if;
  update public.route_evidences set sharepoint_status=coalesce(p_status,sharepoint_status),
    sharepoint_item_id=coalesce(p_item_id,sharepoint_item_id),sharepoint_url=coalesce(p_url,sharepoint_url),
    sharepoint_path=coalesce(p_path,sharepoint_path),sharepoint_sha256=coalesce(p_sha256,sharepoint_sha256),
    sharepoint_synced_at=coalesce(p_synced_at,sharepoint_synced_at),
    sharepoint_last_error=p_last_error,storage_deleted_at=coalesce(p_storage_deleted_at,storage_deleted_at)
    where id=p_evidence_id;
  return jsonb_build_object('ok',true,'id',p_evidence_id);
end $$;
grant execute on function private.update_own_evidence_sync(bigint,text,text,text,text,text,timestamptz,text,timestamptz) to service_role;
grant execute on function public.update_own_evidence_sync(bigint,text,text,text,text,text,timestamptz,text,timestamptz) to service_role;
commit;
notify pgrst,'reload schema';
