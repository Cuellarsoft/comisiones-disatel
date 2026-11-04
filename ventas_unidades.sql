-- Cantidad de equipos por venta (una venta puede incluir varios dispositivos del mismo cliente).
-- Cuenta para el bono: la liquidación suma unidades en vez de contar filas.
alter table public.ventas add column if not exists unidades int not null default 1 check (unidades >= 1);

do $$
declare d text;
begin
  select pg_get_functiondef('public.calcular_liquidacion(uuid,date,boolean)'::regprocedure) into d;
  d := replace(d, 'select count(*) into v_unid from public.ventas', 'select coalesce(sum(unidades), 0) into v_unid from public.ventas');
  execute d;
end $$;
