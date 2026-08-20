-- Cobre a chave estrangeira usada pelas politicas de acesso do motorista.
create index if not exists driver_location_driver_idx
  on public.driver_location_updates (driver_id);
