-- Módulo Clientes (CRM) y WhatsApp. Se ejecuta una vez, después de cotizaciones.sql.

-- Teléfono en formato internacional sin "+": 8 dígitos bolivianos → 591XXXXXXXX
create or replace function public.tel_normal(t text) returns text
language sql immutable set search_path = public as $$
  select case
    when t is null or regexp_replace(t, '\D', '', 'g') = '' then null
    when length(regexp_replace(t, '\D', '', 'g')) = 8 then '591' || regexp_replace(t, '\D', '', 'g')
    else regexp_replace(t, '\D', '', 'g')
  end
$$;

create table if not exists public.clientes (
  id bigint generated always as identity primary key,
  vendedor_id uuid not null default auth.uid() references public.profiles(id),
  empresa text not null,
  contacto text,
  cargo text,
  telefono text,
  telefono_wa text generated always as (public.tel_normal(telefono)) stored,
  email text,
  rubro text,
  tipo text not null default 'empresa' check (tipo in ('empresa', 'personal')),
  flota int not null default 1 check (flota > 0),
  origen text,
  etapa text not null default 'Prospecto' check (etapa in ('Prospecto', 'Contactado', 'Cotizado', 'Negociación', 'Ganado', 'Perdido')),
  motivo_perdida text,
  notas text,
  etiquetas bigint[] not null default '{}',       -- etiquetas para clasificar (producto, tamaño, etc.)
  valor_estimado numeric,                          -- valor mensual estimado; vacío = se calcula con el tarifario de GPS vehicular
  wa_no_leidos int not null default 0,
  wa_ultimo_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists clientes_vendedor_idx on public.clientes (vendedor_id);
create index if not exists clientes_tel_idx on public.clientes (telefono_wa);

-- Etiquetas para clasificar clientes, agrupadas (Producto, Tamaño, ...). Las administra el administrador.
create table if not exists public.etiquetas (
  id bigint generated always as identity primary key,
  grupo text not null default 'General',
  nombre text not null,
  color text not null default 'gris',
  de_cotizacion boolean not null default false,  -- se pone sola a los clientes que reciben una cotización
  activo boolean not null default true,
  orden int not null default 0,
  created_at timestamptz not null default now(),
  unique (grupo, nombre)
);
insert into public.etiquetas (grupo, nombre, color, de_cotizacion, orden) values
  ('Producto', 'GPS vehicular', 'rojo', true, 1),
  ('Producto', 'GPS ganado', 'verde', false, 2),
  ('Producto', 'Starlink', 'azul', false, 3),
  ('Tamaño', 'Pequeño (1 a 5)', 'gris', false, 4),
  ('Tamaño', 'Mediano (6 a 20)', 'ambar', false, 5),
  ('Tamaño', 'Grande (21 o más)', 'morado', false, 6)
on conflict (grupo, nombre) do nothing;
create index if not exists clientes_etiquetas_idx on public.clientes using gin (etiquetas);

create table if not exists public.actividades (
  id bigint generated always as identity primary key,
  cliente_id bigint not null references public.clientes(id) on delete cascade,
  vendedor_id uuid references public.profiles(id),
  tipo text not null check (tipo in ('llamada', 'whatsapp', 'visita', 'correo', 'cotizacion', 'nota', 'etapa', 'venta')),
  texto text not null,
  fecha timestamptz not null default now()
);
create index if not exists actividades_cliente_idx on public.actividades (cliente_id, fecha desc);

create table if not exists public.seguimientos (
  id bigint generated always as identity primary key,
  cliente_id bigint not null references public.clientes(id) on delete cascade,
  vendedor_id uuid references public.profiles(id),
  fecha date not null,
  texto text not null,
  automatico boolean not null default false,
  hecho boolean not null default false,
  hecho_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists seguimientos_cliente_idx on public.seguimientos (cliente_id);
create index if not exists seguimientos_pend_idx on public.seguimientos (vendedor_id, fecha) where not hecho;

-- Números de WhatsApp conectados (uno por vendedor). La clave de acceso NO va aquí:
-- se guarda como secreto en Supabase (WA_TOKEN para Meta directo, o el nombre indicado en "secreto" para 360dialog).
create table if not exists public.wa_numeros (
  id bigint generated always as identity primary key,
  numero text not null unique,
  phone_number_id text not null unique,
  vendedor_id uuid references public.profiles(id),
  proveedor text not null default 'meta' check (proveedor in ('meta', '360dialog')),
  secreto text,
  activo boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.wa_mensajes (
  id bigint generated always as identity primary key,
  wa_numero_id bigint references public.wa_numeros(id) on delete set null,
  cliente_id bigint references public.clientes(id) on delete cascade,
  telefono text not null,
  direccion text not null check (direccion in ('entrante', 'saliente')),
  origen text not null default 'cliente' check (origen in ('cliente', 'crm', 'celular', 'historial')),
  tipo text not null default 'text',
  texto text,
  media_id text,
  media_mime text,
  archivo_nombre text,
  wamid text unique,
  estado text,
  error text,
  enviado_por uuid references public.profiles(id),
  fecha timestamptz not null default now()
);
create index if not exists wa_mensajes_cliente_idx on public.wa_mensajes (cliente_id, fecha);
create index if not exists wa_mensajes_tel_idx on public.wa_mensajes (telefono, direccion, fecha desc);

alter table public.cotizaciones add column if not exists cliente_id bigint references public.clientes(id) on delete set null;

-- ---------- Automatismos
create or replace function public.crm_touch() returns trigger
language plpgsql set search_path = public as $$
begin new.updated_at := now(); return new; end $$;
drop trigger if exists clientes_touch on public.clientes;
create trigger clientes_touch before update on public.clientes for each row execute function public.crm_touch();

-- Actividades y seguimientos quedan a nombre del vendedor del cliente si no se indica otro
create or replace function public.crm_vendedor_del_cliente() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.vendedor_id is null then
    select vendedor_id into new.vendedor_id from public.clientes where id = new.cliente_id;
  end if;
  return new;
end $$;
drop trigger if exists actividades_vendedor on public.actividades;
create trigger actividades_vendedor before insert on public.actividades for each row execute function public.crm_vendedor_del_cliente();
drop trigger if exists seguimientos_vendedor on public.seguimientos;
create trigger seguimientos_vendedor before insert on public.seguimientos for each row execute function public.crm_vendedor_del_cliente();

-- Al guardar una cotización: se vincula al cliente (o se crea) por su WhatsApp
create or replace function public.cotizacion_vincular_cliente() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_id bigint;
begin
  if new.cliente_id is not null then return new; end if;
  if public.tel_normal(new.telefono) is not null then
    select id into v_id from public.clientes
    where vendedor_id = new.vendedor_id and telefono_wa = public.tel_normal(new.telefono)
    order by id limit 1;
  end if;
  if v_id is null then
    insert into public.clientes (vendedor_id, empresa, contacto, telefono, email, tipo, flota, origen, etapa, etiquetas)
    values (new.vendedor_id, new.cliente, nullif(new.atencion, ''), new.telefono, new.email, new.tipo, new.unidades, 'Cotización', 'Prospecto',
            coalesce((select array_agg(id) from public.etiquetas where de_cotizacion and activo), '{}'))
    returning id into v_id;
  end if;
  new.cliente_id := v_id;
  return new;
end $$;
drop trigger if exists cotizaciones_cliente on public.cotizaciones;
create trigger cotizaciones_cliente before insert or update on public.cotizaciones
for each row execute function public.cotizacion_vincular_cliente();

-- Al enviar una cotización: el cliente pasa a "Cotizado", queda en el historial y se agenda el seguimiento a 3 días
create or replace function public.cotizacion_al_enviar() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.cliente_id is null or new.estado <> 'Enviada' then return new; end if;
  update public.clientes set etapa = 'Cotizado'
  where id = new.cliente_id and etapa in ('Prospecto', 'Contactado');
  -- La cotización es de GPS vehicular: se agregan las etiquetas "de cotización" si el cliente no las tenía
  update public.clientes c set etiquetas = array(select distinct x from unnest(c.etiquetas || coalesce((select array_agg(id) from public.etiquetas where de_cotizacion and activo), '{}')) x)
  where c.id = new.cliente_id;
  insert into public.actividades (cliente_id, vendedor_id, tipo, texto)
  values (new.cliente_id, new.vendedor_id, 'cotizacion',
    'Cotización ' || new.numero || ' enviada' || coalesce(' por ' || new.enviada_por, '') || ' · ' || new.unidades ||
    case when new.unidades = 1 then ' vehículo' else ' vehículos' end || ' · Bs ' || to_char(new.total_mensual, 'FM999G999D00') || '/mes.');
  if not exists (select 1 from public.seguimientos where cliente_id = new.cliente_id and automatico and not hecho) then
    insert into public.seguimientos (cliente_id, vendedor_id, fecha, texto, automatico)
    values (new.cliente_id, new.vendedor_id, current_date + 3, 'Seguimiento de la cotización ' || new.numero, true);
  end if;
  return new;
end $$;
drop trigger if exists cotizaciones_enviada on public.cotizaciones;
create trigger cotizaciones_enviada after insert or update of enviada_por, total_mensual, unidades on public.cotizaciones
for each row execute function public.cotizacion_al_enviar();

-- Pasar a Comisiones también marca al cliente como ganado
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

  update public.cotizaciones set estado = 'Vendida', fecha_venta = coalesce(p_fecha, current_date) where id = c.id;
  select cliente_id into c.cliente_id from public.cotizaciones where id = c.id;
  if c.cliente_id is not null then
    update public.clientes set etapa = 'Ganado' where id = c.cliente_id;
    insert into public.actividades (cliente_id, vendedor_id, tipo, texto)
    values (c.cliente_id, c.vendedor_id, 'venta', 'Ganado: se crearon ' || n || case when n = 1 then ' venta' else ' ventas' end || ' en Comisiones desde la cotización ' || c.numero || '.');
    update public.seguimientos set hecho = true, hecho_at = now() where cliente_id = c.cliente_id and not hecho;
  end if;
  return n;
end $$;
revoke execute on function public.vender_cotizacion(bigint, text, boolean, date, jsonb) from anon, public;
grant execute on function public.vender_cotizacion(bigint, text, boolean, date, jsonb) to authenticated;

revoke execute on function public.crm_touch(), public.crm_vendedor_del_cliente(), public.cotizacion_vincular_cliente(), public.cotizacion_al_enviar() from anon, public, authenticated;

-- ---------- Seguridad: cada vendedor ve solo sus clientes; el administrador ve todo
alter table public.clientes enable row level security;
alter table public.actividades enable row level security;
alter table public.seguimientos enable row level security;
alter table public.wa_numeros enable row level security;
alter table public.etiquetas enable row level security;
alter table public.wa_mensajes enable row level security;

create or replace function public.es_mi_cliente(p bigint) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin() or exists (select 1 from public.clientes c where c.id = p and c.vendedor_id = (select auth.uid()))
$$;
revoke execute on function public.es_mi_cliente(bigint) from anon, public;
grant execute on function public.es_mi_cliente(bigint) to authenticated;

drop policy if exists cli_all on public.clientes;
create policy cli_all on public.clientes for all to authenticated
  using (public.is_admin() or vendedor_id = (select auth.uid()))
  with check (public.is_admin() or vendedor_id = (select auth.uid()));
drop policy if exists act_all on public.actividades;
create policy act_all on public.actividades for all to authenticated
  using (public.es_mi_cliente(cliente_id)) with check (public.es_mi_cliente(cliente_id));
drop policy if exists seg_all on public.seguimientos;
create policy seg_all on public.seguimientos for all to authenticated
  using (public.es_mi_cliente(cliente_id)) with check (public.es_mi_cliente(cliente_id));
-- Los mensajes solo se leen desde la web; los escribe el servidor
drop policy if exists wam_sel on public.wa_mensajes;
create policy wam_sel on public.wa_mensajes for select to authenticated using (public.es_mi_cliente(cliente_id));
drop policy if exists etq_sel on public.etiquetas;
create policy etq_sel on public.etiquetas for select to authenticated using (true);
drop policy if exists etq_adm on public.etiquetas;
create policy etq_adm on public.etiquetas for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists wan_sel on public.wa_numeros;
create policy wan_sel on public.wa_numeros for select to authenticated using (true);
drop policy if exists wan_adm on public.wa_numeros;
create policy wan_adm on public.wa_numeros for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Mensajes nuevos en vivo en la pantalla
do $$ begin
  alter publication supabase_realtime add table public.wa_mensajes;
exception when duplicate_object then null; end $$;
