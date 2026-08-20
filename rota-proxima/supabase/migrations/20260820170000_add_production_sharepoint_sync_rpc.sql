-- Permite que somente o autor da evidência (ou o administrador) registre
-- o resultado da sincronização com o SharePoint. Não movimenta dados.

set local lock_timeout = '5s';
set local statement_timeout = '60s';

create or replace function private.update_own_evidence_sync(
  p_evidence_id bigint,
  p_status text,
  p_item_id text,
  p_url text,
  p_path text,
  p_sha256 text,
  p_synced_at timestamptz,
  p_last_error text,
  p_storage_deleted_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text := private.current_app_role();
  v_created_by uuid;
  v_current_status text;
begin
  if v_role not in ('admin','driver','production') then
    raise exception 'Sem permissão';
  end if;
  if p_status is not null and p_status not in ('syncing','synced','error') then
    raise exception 'Status de sincronização inválido';
  end if;

  select created_by, sharepoint_status
    into v_created_by, v_current_status
  from public.route_evidences
  where id = p_evidence_id;

  if not found or (v_role <> 'admin' and v_created_by is distinct from auth.uid()) then
    raise exception 'Evidência não encontrada ou sem permissão';
  end if;
  if v_current_status = 'synced' and p_status in ('syncing','error') then
    raise exception 'Evidência já sincronizada';
  end if;
  if p_storage_deleted_at is not null
     and v_current_status <> 'synced'
     and p_status is distinct from 'synced' then
    raise exception 'A limpeza exige sincronização confirmada';
  end if;

  update public.route_evidences
     set sharepoint_status = coalesce(p_status, sharepoint_status),
         sharepoint_item_id = case when p_status = 'synced' then p_item_id else sharepoint_item_id end,
         sharepoint_url = case when p_status = 'synced' then p_url else sharepoint_url end,
         sharepoint_path = case when p_status = 'synced' then p_path else sharepoint_path end,
         sharepoint_sha256 = case when p_status = 'synced' then p_sha256 else sharepoint_sha256 end,
         sharepoint_synced_at = case
           when p_status = 'synced' then coalesce(p_synced_at, now())
           else sharepoint_synced_at
         end,
         sharepoint_started_at = case
           when p_status = 'syncing' then now()
           else sharepoint_started_at
         end,
         sharepoint_attempts = sharepoint_attempts + case when p_status = 'syncing' then 1 else 0 end,
         sharepoint_last_error = case
           when p_status in ('syncing','synced') then null
           when p_status = 'error' then left(coalesce(p_last_error,''), 1000)
           else sharepoint_last_error
         end,
         storage_deleted_at = coalesce(p_storage_deleted_at, storage_deleted_at)
   where id = p_evidence_id;

  return jsonb_build_object('ok', true, 'id', p_evidence_id);
end
$$;

revoke all on function private.update_own_evidence_sync(bigint,text,text,text,text,text,timestamptz,text,timestamptz) from public;
revoke all on function private.update_own_evidence_sync(bigint,text,text,text,text,text,timestamptz,text,timestamptz) from anon;
grant execute on function private.update_own_evidence_sync(bigint,text,text,text,text,text,timestamptz,text,timestamptz) to authenticated;

create or replace function public.update_own_evidence_sync(
  p_evidence_id bigint,
  p_status text default null,
  p_item_id text default null,
  p_url text default null,
  p_path text default null,
  p_sha256 text default null,
  p_synced_at timestamptz default null,
  p_last_error text default null,
  p_storage_deleted_at timestamptz default null
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.update_own_evidence_sync(
    p_evidence_id,
    p_status,
    p_item_id,
    p_url,
    p_path,
    p_sha256,
    p_synced_at,
    p_last_error,
    p_storage_deleted_at
  )
$$;

revoke all on function public.update_own_evidence_sync(bigint,text,text,text,text,text,timestamptz,text,timestamptz) from public;
revoke all on function public.update_own_evidence_sync(bigint,text,text,text,text,text,timestamptz,text,timestamptz) from anon;
grant execute on function public.update_own_evidence_sync(bigint,text,text,text,text,text,timestamptz,text,timestamptz) to authenticated;

notify pgrst, 'reload schema';
