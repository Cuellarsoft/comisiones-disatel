-- Módulo de cotizaciones (se ejecuta una vez en Supabase → SQL Editor, después de instalar.sql)
-- Guarda cada cotización enviada y permite pasarla a Comisiones cuando se vende.

create table if not exists public.cotizaciones (
  id bigint generated always as identity primary key,
  numero text not null unique,
  vendedor_id uuid not null default auth.uid() references public.profiles(id),
  fecha date not null default current_date,
  cliente text not null,
  atencion text,
  telefono text,
  email text,
  tipo text not null check (tipo in ('personal', 'empresa')),
  unidades int not null check (unidades > 0),
  con_roaming int not null default 0 check (con_roaming >= 0),
  datos jsonb not null,               -- formulario completo: accesorios, bonificación, notas, presentación
  total_inicial numeric not null default 0,
  total_mensual numeric not null default 0,
  estado text not null default 'Enviada' check (estado in ('Enviada', 'Vendida', 'Perdida')),
  enviada_por text,                   -- whatsapp | correo | pdf
  fecha_venta date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists cotizaciones_vendedor_idx on public.cotizaciones (vendedor_id);

-- Cada venta puede venir de una cotización
alter table public.ventas add column if not exists cotizacion_id bigint references public.cotizaciones(id) on delete set null;

create or replace function public.cotizaciones_touch() returns trigger
language plpgsql set search_path = public as $$
begin new.updated_at := now(); return new; end $$;
drop trigger if exists cotizaciones_touch on public.cotizaciones;
create trigger cotizaciones_touch before update on public.cotizaciones
for each row execute function public.cotizaciones_touch();

alter table public.cotizaciones enable row level security;
drop policy if exists cot_sel on public.cotizaciones;
drop policy if exists cot_ins on public.cotizaciones;
drop policy if exists cot_upd on public.cotizaciones;
drop policy if exists cot_del on public.cotizaciones;
create policy cot_sel on public.cotizaciones for select to authenticated
  using (vendedor_id = (select auth.uid()) or public.is_admin());
create policy cot_ins on public.cotizaciones for insert to authenticated
  with check (vendedor_id = (select auth.uid()) or public.is_admin());
-- Una cotización vendida ya no se modifica (salvo el administrador)
create policy cot_upd on public.cotizaciones for update to authenticated
  using (public.is_admin() or (vendedor_id = (select auth.uid()) and estado <> 'Vendida'))
  with check (public.is_admin() or vendedor_id = (select auth.uid()));
create policy cot_del on public.cotizaciones for delete to authenticated
  using (public.is_admin() or (vendedor_id = (select auth.uid()) and estado <> 'Vendida'));

-- Pasa una cotización vendida a Comisiones: crea una venta por vehículo, todo o nada.
-- p_vehiculos: [{"vehiculo": "...", "precio_mensual": 85}, ...]
create or replace function public.vender_cotizacion(
  p_cotizacion bigint, p_modalidad text, p_contrato boolean, p_fecha date, p_vehiculos jsonb
) returns int
language plpgsql security invoker set search_path = public as $$
declare
  c public.cotizaciones;
  v jsonb;
  n int := 0;
begin
  select * into c from public.cotizaciones where id = p_cotizacion for update;
  if not found then raise exception 'Cotización no encontrada'; end if;
  if c.estado = 'Vendida' then raise exception 'Esta cotización ya fue pasada a comisiones'; end if;
  if jsonb_array_length(p_vehiculos) = 0 then raise exception 'Indique al menos un vehículo'; end if;

  for v in select * from jsonb_array_elements(p_vehiculos) loop
    insert into public.ventas (vendedor_id, fecha_captacion, cliente, empresa, vehiculo, modalidad,
                               precio_mensual, contrato, notas, cotizacion_id)
    values (c.vendedor_id, coalesce(p_fecha, current_date),
            coalesce(nullif(c.atencion, ''), c.cliente), c.cliente,
            upper(trim(v->>'vehiculo')), p_modalidad, (v->>'precio_mensual')::numeric,
            coalesce(p_contrato, false), 'Desde cotización ' || c.numero, c.id);
    n := n + 1;
  end loop;

  update public.cotizaciones set estado = 'Vendida', fecha_venta = coalesce(p_fecha, current_date)
  where id = c.id;
  return n;
end $$;

revoke execute on function public.vender_cotizacion(bigint, text, boolean, date, jsonb) from anon, public;
grant execute on function public.vender_cotizacion(bigint, text, boolean, date, jsonb) to authenticated;

-- Configuración editable de precios y condiciones (una sola fila)
create table if not exists public.config_cotizaciones (
  id int primary key default 1 check (id = 1),
  datos jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.config_cotizaciones enable row level security;
drop policy if exists cfgc_sel on public.config_cotizaciones;
drop policy if exists cfgc_ins on public.config_cotizaciones;
drop policy if exists cfgc_upd on public.config_cotizaciones;
create policy cfgc_sel on public.config_cotizaciones for select to authenticated using (true);
create policy cfgc_ins on public.config_cotizaciones for insert to authenticated with check (public.is_admin());
create policy cfgc_upd on public.config_cotizaciones for update to authenticated using (public.is_admin()) with check (public.is_admin());
