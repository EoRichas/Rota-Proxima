-- Índices de relacionamento e políticas com auth avaliado uma vez por consulta.

set local lock_timeout = '5s';
set local statement_timeout = '60s';

create index if not exists route_evidences_route_idx
on public.route_evidences (route_id);

create index if not exists route_evidences_pev_idx
on public.route_evidences (pev_id);

create index if not exists route_evidences_created_by_idx
on public.route_evidences (created_by);

create index if not exists route_weighings_route_idx
on public.route_weighings (route_id);

create index if not exists route_weighings_pev_idx
on public.route_weighings (pev_id);

create index if not exists route_weighings_evidence_idx
on public.route_weighings (evidence_id);

create index if not exists route_weighings_created_by_idx
on public.route_weighings (created_by);

drop policy if exists routes_read on public.routes;
create policy routes_read on public.routes
for select to authenticated
using (
  (select can_view_management())
  or (
    (select current_app_role()) = 'driver'
    and driver_id = (select auth.uid())
  )
  or (
    (select current_app_role()) = 'commercial'
    and private.commercial_owns_route(id, (select auth.uid()))
  )
  or private.production_can_access_route(id)
);

drop policy if exists stops_read on public.route_stops;
create policy stops_read on public.route_stops
for select to authenticated
using (
  exists (
    select 1
    from public.routes route
    where route.id = route_stops.route_id
      and (
        (select can_view_management())
        or (
          (select current_app_role()) = 'driver'
          and route.driver_id = (select auth.uid())
        )
      )
  )
  or (
    (select current_app_role()) = 'commercial'
    and private.commercial_owns_pev(pev_id, (select auth.uid()))
  )
  or private.production_can_access_stop(id)
);

drop policy if exists pevs_read on public.pevs;
create policy pevs_read on public.pevs
for select to authenticated
using (
  (
    deleted_at is null
    and (
      (select current_app_role()) in ('admin','commercial_manager')
      or (
        (select current_app_role()) = 'commercial'
        and commercial_owner_id = (select auth.uid())
      )
      or private.driver_can_access_pev(id, (select auth.uid()))
      or private.production_can_access_pev(id)
    )
  )
  or (
    deleted_at is not null
    and (select current_app_role()) in ('admin','commercial_manager')
  )
);

drop policy if exists evidence_insert on public.route_evidences;
create policy evidence_insert on public.route_evidences
for insert to authenticated
with check (
  (
    (select current_app_role()) = 'driver'
    and created_by = (select auth.uid())
    and evidence_type in ('stop_location','drum')
    and exists (
      select 1
      from public.route_stops stop
      join public.routes route on route.id = stop.route_id
      where stop.id = route_evidences.stop_id
        and stop.route_id = route_evidences.route_id
        and stop.pev_id = route_evidences.pev_id
        and stop.status in ('pending','arrived')
        and route.status = 'in_progress'
        and route.driver_id = (select auth.uid())
    )
  )
  or private.production_can_insert_evidence(route_id, stop_id, pev_id, evidence_type, created_by)
);

drop policy if exists evidence_read on public.route_evidences;
create policy evidence_read on public.route_evidences
for select to authenticated
using (
  (select can_view_management())
  or exists (
    select 1
    from public.routes route
    where route.id = route_evidences.route_id
      and route.driver_id = (select auth.uid())
  )
  or (
    (select current_app_role()) = 'commercial'
    and private.commercial_owns_pev(pev_id, (select auth.uid()))
  )
  or (
    (select current_app_role()) = 'production'
    and created_by = (select auth.uid())
    and evidence_type = 'weighing_scale'
  )
);

drop policy if exists weighing_read on public.route_weighings;
create policy weighing_read on public.route_weighings
for select to authenticated
using (
  (select can_view_management())
  or exists (
    select 1
    from public.routes route
    where route.id = route_weighings.route_id
      and route.driver_id = (select auth.uid())
  )
  or (
    (select current_app_role()) = 'commercial'
    and private.commercial_owns_pev(pev_id, (select auth.uid()))
  )
  or (
    (select current_app_role()) = 'production'
    and created_by = (select auth.uid())
  )
);

drop policy if exists evidence_storage_insert on storage.objects;
create policy evidence_storage_insert on storage.objects
for insert to authenticated
with check (
  bucket_id = 'rota-evidencias'
  and (select current_app_role()) in ('driver','production')
  and owner_id = (select auth.uid())::text
);

drop policy if exists evidence_storage_read on storage.objects;
create policy evidence_storage_read on storage.objects
for select to authenticated
using (
  bucket_id = 'rota-evidencias'
  and (
    (select current_app_role()) in ('admin','commercial_manager','commercial')
    or (
      (select current_app_role()) in ('driver','production')
      and owner_id = (select auth.uid())::text
    )
  )
);

drop policy if exists evidence_storage_update on storage.objects;
create policy evidence_storage_update on storage.objects
for update to authenticated
using (
  bucket_id = 'rota-evidencias'
  and (select current_app_role()) in ('driver','production')
  and owner_id = (select auth.uid())::text
)
with check (
  bucket_id = 'rota-evidencias'
  and (select current_app_role()) in ('driver','production')
  and owner_id = (select auth.uid())::text
);

drop policy if exists evidence_storage_delete_own on storage.objects;
create policy evidence_storage_delete_own on storage.objects
for delete to authenticated
using (
  bucket_id = 'rota-evidencias'
  and (select current_app_role()) in ('driver','production')
  and owner_id = (select auth.uid())::text
);
