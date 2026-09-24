-- Aplicar em transação antes de publicar rota-admin e a interface.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table public.profiles drop constraint profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('admin','commercial','commercial_manager','driver','production','quality'));

-- Não incluir Qualidade em can_view_management: isso liberaria outras funções.
create policy quality_routes_read on public.routes for select to authenticated
using ((select public.current_app_role()) = 'quality' and status <> 'draft');

create policy quality_stops_read on public.route_stops for select to authenticated
using ((select public.current_app_role()) = 'quality' and exists (
  select 1 from public.routes r where r.id = route_stops.route_id and r.status <> 'draft'
));

-- PEVs e responsáveis alimentam os filtros e o comparativo do relatório.
create policy quality_pevs_read on public.pevs for select to authenticated
using ((select public.current_app_role()) = 'quality');
create policy quality_profiles_read on public.profiles for select to authenticated
using ((select public.current_app_role()) = 'quality' and role in ('driver','commercial'));
create policy quality_requests_read on public.scheduling_requests for select to authenticated
using ((select public.current_app_role()) = 'quality' and exists (
  select 1 from public.routes r where r.id = scheduling_requests.route_id and r.status <> 'draft'
));
create policy quality_weighings_read on public.route_weighings for select to authenticated
using ((select public.current_app_role()) = 'quality' and exists (
  select 1 from public.routes r where r.id = route_weighings.route_id and r.status <> 'draft'
));
create policy quality_evidences_read on public.route_evidences for select to authenticated
using ((select public.current_app_role()) = 'quality' and exists (
  select 1 from public.routes r where r.id = route_evidences.route_id and r.status = 'finished'
));
create policy quality_locations_read on public.driver_location_updates for select to authenticated
using ((select public.current_app_role()) = 'quality' and exists (
  select 1 from public.routes r where r.id = driver_location_updates.route_id and r.status = 'finished'
));
create policy quality_route_audit_read on public.audit_logs for select to authenticated
using ((select public.current_app_role()) = 'quality' and entity_type = 'route'
  and action = 'recalculate' and exists (
    select 1 from public.routes r where r.id::text = audit_logs.entity_id and r.status = 'finished'
  ));
create policy quality_evidence_storage_read on storage.objects for select to authenticated
using ((select public.current_app_role()) = 'quality' and bucket_id = 'rota-evidencias'
  and exists (select 1 from public.route_evidences e
    join public.routes r on r.id = e.route_id
    where e.storage_path = objects.name and r.status = 'finished'));

-- Protege inclusive um motorista existente convertido para Qualidade.
-- Políticas antigas por driver_id não podem manter permissão de escrita.
do $quality$
declare target text;
begin
  foreach target in array array[
    'public.profiles','public.pevs','public.routes','public.route_stops',
    'public.scheduling_requests','public.route_weighings','public.route_evidences',
    'public.driver_location_updates','public.audit_logs','public.settings',
    'public.route_templates','public.route_template_pevs','storage.objects'
  ] loop
    execute format('create policy quality_no_insert on %s as restrictive for insert to authenticated with check ((select public.current_app_role()) is distinct from ''quality'')', target);
    execute format('create policy quality_no_update on %s as restrictive for update to authenticated using ((select public.current_app_role()) is distinct from ''quality'') with check ((select public.current_app_role()) is distinct from ''quality'')', target);
    execute format('create policy quality_no_delete on %s as restrictive for delete to authenticated using ((select public.current_app_role()) is distinct from ''quality'')', target);
  end loop;
end;
$quality$;

create policy quality_no_settings on public.settings as restrictive for select to authenticated
using ((select public.current_app_role()) is distinct from 'quality');
create policy quality_finished_evidences on public.route_evidences as restrictive for select to authenticated
using ((select public.current_app_role()) is distinct from 'quality' or exists (
  select 1 from public.routes r where r.id = route_evidences.route_id and r.status = 'finished'
));
commit;
