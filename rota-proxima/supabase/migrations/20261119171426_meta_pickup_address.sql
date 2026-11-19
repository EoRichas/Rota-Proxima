-- Resolve one existing active PEV once. The generated flag cannot be changed by
-- editing a PEV or by creating a namesake. With no match all flags remain false.
do $$
declare target_id bigint := (select id from public.pevs
  where lower(btrim(name)) = 'meta reciclagem' and active and deleted_at is null);
begin
  execute format('alter table public.pevs add column requires_pickup_address boolean
    generated always as (coalesce(id = %L::bigint, false)) stored', target_id);
end $$;

alter table public.scheduling_requests add column pickup_address jsonb;
alter table public.route_stops add column pickup_address jsonb;

create function private.check_request_pickup() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare needs_address boolean; a jsonb := new.pickup_address;
begin
  select requires_pickup_address into strict needs_address from public.pevs where id = new.pev_id;
  if needs_address and (a is null or jsonb_typeof(a) <> 'object'
     or coalesce(a->>'cep','') !~ '^[0-9]{5}-?[0-9]{3}$'
     or length(btrim(coalesce(a->>'street',''))) not between 1 and 160
     or length(btrim(coalesce(a->>'number',''))) not between 1 and 20) then
    raise exception 'Informe CEP, rua e número da coleta.';
  elsif not needs_address and a is not null then
    raise exception 'Esta PEV usa o endereço do cadastro.';
  end if;
  return new;
end $$;
create trigger check_request_pickup before insert or update of pev_id,pickup_address
on public.scheduling_requests for each row execute function private.check_request_pickup();

-- The driver can read the stop under its existing RLS, even if the request is
-- not visible to that role or is subsequently deleted by an administrator.
create function private.snapshot_stop_pickup() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  new.pickup_address := null;
  if new.request_id is not null then
    select r.pickup_address into strict new.pickup_address from public.scheduling_requests r
    where r.id = new.request_id and r.pev_id = new.pev_id;
    if new.pickup_address is not null and
       (jsonb_typeof(new.pickup_address->'lat') is distinct from 'number' or
        jsonb_typeof(new.pickup_address->'lng') is distinct from 'number') then
      raise exception 'Calcule a rota para localizar o endereço desta coleta.';
    end if;
  end if;
  return new;
end $$;
create trigger snapshot_stop_pickup before insert on public.route_stops
for each row execute function private.snapshot_stop_pickup();

revoke all on function private.check_request_pickup(), private.snapshot_stop_pickup() from public;
notify pgrst, 'reload schema';
