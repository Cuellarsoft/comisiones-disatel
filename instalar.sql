-- COMISIONES DISATEL · Script de instalación completo
-- Pegar todo en Supabase → SQL Editor → Run (una sola vez)

-- =========================================================
-- COMISIONES DISATEL — esquema, reglas y seguridad
-- =========================================================

-- ---------- Parámetros del plan de compensación (una sola fila)
create table public.parametros (
  id int primary key default 1 check (id = 1),
  comision_prepago_pct  numeric not null default 0.5,
  precio_prepago        numeric not null default 80,
  comision_postpago_pct numeric not null default 0.5,
  precio_postpago       numeric not null default 130,
  plazo_pago_dias       int     not null default 30,
  clawback_baja jsonb not null default '[1, 0.5, 0.25]',
  bonos jsonb not null default
    '[{"min":20,"bono":300},{"min":30,"bono":600},{"min":40,"bono":1000},{"min":50,"bono":1500},{"min":60,"bono":2000}]',
  sueldo_fijo_default numeric not null default 3300,
  updated_at timestamptz not null default now()
);
insert into public.parametros default values;

-- ---------- Usuarios (admin / vendedor)
create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  nombre text not null,
  email text not null,
  rol text not null default 'vendedor' check (rol in ('admin','vendedor')),
  sueldo_fijo numeric not null default 3300,
  activo boolean not null default true,
  created_at timestamptz not null default now()
);

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and rol = 'admin' and activo)
$$;

-- ---------- Liquidaciones (pago mensual de variable a cada vendedor)
create table public.liquidaciones (
  id bigint generated always as identity primary key,
  vendedor_id uuid not null references public.profiles(id),
  periodo date not null,                       -- primer día del mes liquidado
  sueldo_fijo numeric not null default 0,
  unidades int not null default 0,             -- instaladas en el mes (para bono)
  comisiones numeric not null default 0,
  bono numeric not null default 0,
  clawbacks numeric not null default 0,        -- neto: positivo descuenta
  saldo_anterior numeric not null default 0,   -- saldo negativo arrastrado (<= 0)
  total_variable numeric not null default 0,   -- comisiones + bono - clawbacks + saldo_anterior
  a_pagar numeric not null default 0,          -- max(0, total_variable)
  estado text not null default 'borrador' check (estado in ('borrador','pagada')),
  fecha_pago date,
  notas text,
  created_at timestamptz not null default now(),
  unique (vendedor_id, periodo)
);

-- ---------- Ventas (una fila por vehículo / unidad)
create table public.ventas (
  id bigint generated always as identity primary key,
  vendedor_id uuid not null default auth.uid() references public.profiles(id),
  fecha_captacion date not null default current_date,
  cliente text not null,
  empresa text,
  vehiculo text not null,
  modalidad text not null check (modalidad in ('Prepago','Postpago')),
  precio_mensual numeric not null,
  contrato boolean not null default false,
  fecha_instalacion date,
  activado boolean not null default false,
  fecha_primer_pago date,
  estado text not null default 'Activo' check (estado in ('Activo','Baja','Cancelado')),
  fecha_baja date,
  causa_baja text check (causa_baja in ('Voluntaria','Incumplimiento','Competencia','Causa Disatel / excepción','Otra')),
  comision numeric,
  liquidacion_id bigint references public.liquidaciones(id) on delete set null,
  notas text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.ventas (vendedor_id);
create index on public.ventas (liquidacion_id);

-- ---------- Clawbacks (libro de descuentos / reintegros)
create table public.clawbacks (
  id bigint generated always as identity primary key,
  venta_id bigint not null references public.ventas(id) on delete cascade,
  vendedor_id uuid not null references public.profiles(id),
  motivo text not null check (motivo in ('no_pago','baja','reintegro')),
  porcentaje numeric not null,
  monto numeric not null,                 -- positivo = descuento, negativo = devolución
  detalle text,
  liquidacion_id bigint references public.liquidaciones(id) on delete set null,
  created_at timestamptz not null default now()
);
create index on public.clawbacks (vendedor_id);
create index on public.clawbacks (venta_id);
create index on public.clawbacks (liquidacion_id);

-- =========================================================
-- Reglas
-- =========================================================

-- Antes de guardar una venta: protege campos que solo el admin puede tocar
-- y calcula la comisión con los parámetros vigentes.
create or replace function public.ventas_before() returns trigger
language plpgsql set search_path = public as $$
declare
  p public.parametros;
  adm boolean := public.is_admin() or coalesce(auth.role(), 'service') not in ('authenticated','anon');
begin
  select * into p from public.parametros where id = 1;

  if not adm then
    if tg_op = 'INSERT' then
      new.vendedor_id := auth.uid();
      new.fecha_instalacion := null; new.activado := false; new.fecha_primer_pago := null;
      new.estado := 'Activo'; new.fecha_baja := null; new.causa_baja := null;
      new.comision := null; new.liquidacion_id := null;
    else
      if old.fecha_instalacion is not null then
        raise exception 'Esta venta ya fue instalada: solo el administrador puede modificarla';
      end if;
      new.vendedor_id := old.vendedor_id; new.fecha_instalacion := old.fecha_instalacion;
      new.activado := old.activado; new.fecha_primer_pago := old.fecha_primer_pago;
      new.estado := old.estado; new.fecha_baja := old.fecha_baja; new.causa_baja := old.causa_baja;
      new.liquidacion_id := old.liquidacion_id;
    end if;
  end if;

  if new.precio_mensual is null then
    new.precio_mensual := case new.modalidad when 'Prepago' then p.precio_prepago else p.precio_postpago end;
  end if;

  if new.comision is null
     or (tg_op = 'UPDATE' and new.liquidacion_id is null
         and (new.precio_mensual is distinct from old.precio_mensual or new.modalidad is distinct from old.modalidad)
         and new.comision is not distinct from old.comision) then
    new.comision := round(new.precio_mensual *
      case new.modalidad when 'Prepago' then p.comision_prepago_pct else p.comision_postpago_pct end, 2);
  end if;

  new.updated_at := now();
  return new;
end $$;

create trigger ventas_before before insert or update on public.ventas
for each row execute function public.ventas_before();

create or replace function public.ventas_before_delete() returns trigger
language plpgsql set search_path = public as $$
begin
  if old.liquidacion_id is not null then
    raise exception 'No se puede borrar: la comisión de esta venta ya está en una liquidación';
  end if;
  return old;
end $$;
create trigger ventas_before_delete before delete on public.ventas
for each row execute function public.ventas_before_delete();

-- Recalcula clawbacks pendientes. Idempotente:
--  * borra los pendientes (sin liquidación) y los vuelve a calcular
--  * lo ya aplicado en liquidaciones queda fijo; si el cliente regulariza
--    se genera un "reintegro" (monto negativo)
create or replace function public.sync_clawbacks(p_venta bigint default null, p_vendedor uuid default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  p public.parametros; v record;
  pct_np numeric; pct_baja numeric; pct numeric; mes int;
  deseado numeric; aplicado numeric; delta numeric; mot text; det text;
begin
  select * into p from public.parametros where id = 1;

  delete from public.clawbacks c
   where c.liquidacion_id is null
     and (p_venta is null or c.venta_id = p_venta)
     and (p_vendedor is null or c.vendedor_id = p_vendedor);

  for v in
    select * from public.ventas
     where (p_venta is null or id = p_venta)
       and (p_vendedor is null or vendedor_id = p_vendedor)
       and (fecha_instalacion is not null and activado
            or exists (select 1 from public.clawbacks c where c.venta_id = ventas.id))
  loop
    pct_np := 0; pct_baja := 0; mes := null;

    if v.fecha_instalacion is not null and v.activado then
      -- Regla 1: instalado y sin ningún pago pasado el plazo -> 100 %
      if v.fecha_primer_pago is null and current_date > v.fecha_instalacion + p.plazo_pago_dias then
        pct_np := 1;
      end if;
      -- Regla 2: baja en los primeros meses (salvo causa Disatel)
      if v.estado in ('Baja','Cancelado') and coalesce(v.causa_baja,'') <> 'Causa Disatel / excepción' then
        mes := greatest(1,
          (extract(year  from age(coalesce(v.fecha_baja, current_date), v.fecha_instalacion)) * 12
         + extract(month from age(coalesce(v.fecha_baja, current_date), v.fecha_instalacion)))::int + 1);
        pct_baja := coalesce((p.clawback_baja ->> (mes - 1))::numeric, 0);
      end if;
    end if;

    pct := greatest(pct_np, pct_baja);
    deseado := round(coalesce(v.comision, 0) * pct, 2);
    select coalesce(sum(monto), 0) into aplicado from public.clawbacks where venta_id = v.id;
    delta := deseado - aplicado;

    if delta <> 0 then
      if delta < 0 then
        mot := 'reintegro'; det := 'Cliente regularizado: se devuelve lo descontado';
      elsif pct_np >= pct_baja then
        mot := 'no_pago'; det := format('Sin primer pago a %s días de instalado', p.plazo_pago_dias);
      else
        mot := 'baja'; det := format('Baja en el mes %s (%s)', mes, coalesce(v.causa_baja, 'sin causa'));
      end if;
      insert into public.clawbacks (venta_id, vendedor_id, motivo, porcentaje, monto, detalle)
      values (v.id, v.vendedor_id, mot, pct, delta, det);
    end if;
  end loop;
end $$;

create or replace function public.ventas_after() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.sync_clawbacks(new.id);
  return new;
end $$;

create trigger ventas_after
after insert or update of fecha_instalacion, activado, fecha_primer_pago, estado, fecha_baja, causa_baja, comision
on public.ventas for each row execute function public.ventas_after();

-- Bono según unidades instaladas en el mes
create or replace function public.bono_para(n int) returns numeric
language sql stable set search_path = public as $$
  select coalesce(max((b->>'bono')::numeric) filter (where n >= (b->>'min')::int), 0)
    from public.parametros, jsonb_array_elements(bonos) b where id = 1
$$;

-- Calcula (y opcionalmente guarda) la liquidación de un vendedor para un mes.
-- Incluye: comisiones de ventas instaladas y activadas hasta fin de mes aún no liquidadas,
-- bono por unidades instaladas en el mes, clawbacks pendientes y saldo negativo anterior.
create or replace function public.calcular_liquidacion(p_vendedor uuid, p_periodo date, p_guardar boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  ini date := date_trunc('month', p_periodo)::date;
  fin date := (date_trunc('month', p_periodo) + interval '1 month - 1 day')::date;
  prof public.profiles; ya boolean;
  v_unid int; v_com numeric; v_bono numeric; v_cb numeric; v_saldo numeric; v_total numeric; v_id bigint;
begin
  if not (public.is_admin() or (auth.uid() = p_vendedor and not p_guardar)) then
    raise exception 'No autorizado';
  end if;
  select * into prof from public.profiles where id = p_vendedor;
  if prof.id is null then raise exception 'Vendedor no encontrado'; end if;

  perform public.sync_clawbacks(null, p_vendedor);

  select exists (select 1 from public.liquidaciones where vendedor_id = p_vendedor and periodo = ini) into ya;
  if p_guardar and ya then
    raise exception 'Ya existe una liquidación de % para %', to_char(ini, 'MM/YYYY'), prof.nombre;
  end if;
  if p_guardar and exists (select 1 from public.liquidaciones where vendedor_id = p_vendedor and periodo > ini) then
    raise exception 'Ya existe una liquidación posterior para %', prof.nombre;
  end if;

  select count(*) into v_unid from public.ventas
   where vendedor_id = p_vendedor and activado and fecha_instalacion between ini and fin;
  v_bono := case when ya then 0 else public.bono_para(v_unid) end;

  select coalesce(sum(comision), 0) into v_com from public.ventas
   where vendedor_id = p_vendedor and activado and fecha_instalacion is not null
     and fecha_instalacion <= fin and liquidacion_id is null;

  select coalesce(sum(monto), 0) into v_cb from public.clawbacks
   where vendedor_id = p_vendedor and liquidacion_id is null;

  select least(0, total_variable) into v_saldo from public.liquidaciones
   where vendedor_id = p_vendedor and periodo < ini order by periodo desc limit 1;
  v_saldo := coalesce(v_saldo, 0);

  v_total := v_com + v_bono - v_cb + v_saldo;

  if p_guardar then
    insert into public.liquidaciones (vendedor_id, periodo, sueldo_fijo, unidades, comisiones, bono, clawbacks,
                                      saldo_anterior, total_variable, a_pagar)
    values (p_vendedor, ini, prof.sueldo_fijo, v_unid, v_com, v_bono, v_cb, v_saldo, v_total, greatest(0, v_total))
    returning id into v_id;
    update public.clawbacks set liquidacion_id = v_id where vendedor_id = p_vendedor and liquidacion_id is null;
    update public.ventas set liquidacion_id = v_id
     where vendedor_id = p_vendedor and activado and fecha_instalacion is not null
       and fecha_instalacion <= fin and liquidacion_id is null;
  end if;

  return jsonb_build_object(
    'id', v_id, 'periodo', ini, 'vendedor', prof.nombre, 'sueldo_fijo', prof.sueldo_fijo,
    'unidades', v_unid, 'comisiones', v_com, 'bono', v_bono, 'clawbacks', v_cb,
    'saldo_anterior', v_saldo, 'total_variable', v_total, 'a_pagar', greatest(0, v_total),
    'ya_existe', ya);
end $$;

create or replace function public.eliminar_liquidacion(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
declare l public.liquidaciones;
begin
  if not public.is_admin() then raise exception 'No autorizado'; end if;
  select * into l from public.liquidaciones where id = p_id;
  if l.estado = 'pagada' then raise exception 'No se puede eliminar una liquidación pagada'; end if;
  if exists (select 1 from public.liquidaciones where vendedor_id = l.vendedor_id and periodo > l.periodo) then
    raise exception 'Primero elimine las liquidaciones posteriores de este vendedor';
  end if;
  delete from public.liquidaciones where id = p_id;
  perform public.sync_clawbacks(null, l.vendedor_id);
end $$;

-- =========================================================
-- Seguridad (RLS)
-- =========================================================
alter table public.parametros    enable row level security;
alter table public.profiles      enable row level security;
alter table public.ventas        enable row level security;
alter table public.clawbacks     enable row level security;
alter table public.liquidaciones enable row level security;

create policy par_sel on public.parametros for select to authenticated using (true);
create policy par_upd on public.parametros for update to authenticated using (public.is_admin()) with check (public.is_admin());

create policy prof_sel on public.profiles for select to authenticated using (id = (select auth.uid()) or public.is_admin());
create policy prof_upd on public.profiles for update to authenticated using (public.is_admin()) with check (public.is_admin());

create policy ven_sel on public.ventas for select to authenticated
  using (vendedor_id = (select auth.uid()) or public.is_admin());
create policy ven_ins on public.ventas for insert to authenticated
  with check (public.is_admin() or vendedor_id = (select auth.uid()));
create policy ven_upd on public.ventas for update to authenticated
  using (public.is_admin() or (vendedor_id = (select auth.uid()) and fecha_instalacion is null))
  with check (public.is_admin() or vendedor_id = (select auth.uid()));
create policy ven_del on public.ventas for delete to authenticated
  using (public.is_admin() or (vendedor_id = (select auth.uid()) and fecha_instalacion is null));

create policy cb_sel on public.clawbacks for select to authenticated
  using (vendedor_id = (select auth.uid()) or public.is_admin());

create policy liq_sel on public.liquidaciones for select to authenticated
  using (vendedor_id = (select auth.uid()) or public.is_admin());
create policy liq_upd on public.liquidaciones for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

revoke execute on all functions in schema public from anon, public;
grant execute on function public.is_admin(), public.calcular_liquidacion(uuid, date, boolean),
  public.eliminar_liquidacion(bigint), public.sync_clawbacks(bigint, uuid), public.bono_para(int) to authenticated;
revoke execute on function public.ventas_before(), public.ventas_after(), public.ventas_before_delete() from authenticated;

-- Recalcular clawbacks todos los días (02:00 hora Bolivia)
create extension if not exists pg_cron;
select cron.schedule('sync-clawbacks', '0 6 * * *', 'select public.sync_clawbacks()');

-- =========================================================
-- Gestión de usuarios desde la app (solo admin) + carga inicial
-- =========================================================
create index if not exists liquidaciones_vendedor_idx on public.liquidaciones (vendedor_id);
create extension if not exists pgcrypto with schema extensions;

create or replace function public.puede_administrar() returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin() or coalesce(auth.role(), 'service') not in ('authenticated','anon')
$$;

create or replace function public.admin_crear_usuario(p_email text, p_password text, p_nombre text,
  p_rol text default 'vendedor', p_sueldo numeric default 3300)
returns uuid language plpgsql security definer set search_path = public, extensions, auth as $$
declare uid uuid := gen_random_uuid(); e text := lower(trim(p_email));
begin
  if not public.puede_administrar() then raise exception 'Solo el administrador puede crear usuarios'; end if;
  if coalesce(trim(p_nombre), '') = '' or e !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Nombre y correo válido son obligatorios'; end if;
  if length(coalesce(p_password, '')) < 8 then raise exception 'La contraseña debe tener al menos 8 caracteres'; end if;
  if exists (select 1 from auth.users where email = e) then raise exception 'Ya existe un usuario con ese correo'; end if;

  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change, email_change_token_new, email_change_token_current,
    phone_change, phone_change_token, reauthentication_token)
  values ('00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated', e,
    extensions.crypt(p_password, extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}', jsonb_build_object('nombre', p_nombre), now(), now(),
    '', '', '', '', '', '', '', '');

  insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (gen_random_uuid(), uid, uid::text,
    jsonb_build_object('sub', uid::text, 'email', e, 'email_verified', true), 'email', now(), now(), now());

  insert into public.profiles (id, nombre, email, rol, sueldo_fijo)
  values (uid, trim(p_nombre), e, case when p_rol = 'admin' then 'admin' else 'vendedor' end, coalesce(p_sueldo, 3300));
  return uid;
end $$;

create or replace function public.admin_password(p_user uuid, p_password text) returns void
language plpgsql security definer set search_path = public, extensions, auth as $$
begin
  if not public.puede_administrar() then raise exception 'No autorizado'; end if;
  if length(coalesce(p_password, '')) < 8 then raise exception 'La contraseña debe tener al menos 8 caracteres'; end if;
  update auth.users set encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf')), updated_at = now()
   where id = p_user;
end $$;

create or replace function public.admin_email(p_user uuid, p_email text) returns void
language plpgsql security definer set search_path = public, extensions, auth as $$
declare e text := lower(trim(p_email));
begin
  if not public.puede_administrar() then raise exception 'No autorizado'; end if;
  if e !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Correo inválido'; end if;
  if exists (select 1 from auth.users where email = e and id <> p_user) then raise exception 'Ese correo ya está en uso'; end if;
  update auth.users set email = e, email_confirmed_at = coalesce(email_confirmed_at, now()), updated_at = now() where id = p_user;
  update auth.identities set identity_data = jsonb_set(identity_data, '{email}', to_jsonb(e)), updated_at = now()
   where user_id = p_user and provider = 'email';
  update public.profiles set email = e where id = p_user;
end $$;

create or replace function public.admin_estado(p_user uuid, p_activo boolean) returns void
language plpgsql security definer set search_path = public, auth as $$
begin
  if not public.puede_administrar() then raise exception 'No autorizado'; end if;
  if p_user = auth.uid() then raise exception 'No puede desactivar su propio usuario'; end if;
  update auth.users set banned_until = case when p_activo then null else now() + interval '100 years' end, updated_at = now()
   where id = p_user;
  if not p_activo then delete from auth.sessions where user_id = p_user; end if;
  update public.profiles set activo = p_activo where id = p_user;
end $$;

revoke execute on function public.admin_crear_usuario(text, text, text, text, numeric), public.admin_password(uuid, text),
  public.admin_email(uuid, text), public.admin_estado(uuid, boolean), public.puede_administrar() from anon, public;
grant execute on function public.admin_crear_usuario(text, text, text, text, numeric), public.admin_password(uuid, text),
  public.admin_email(uuid, text), public.admin_estado(uuid, boolean), public.puede_administrar() to authenticated;

-- ---------- Carga inicial: administrador, Jhon y sus ventas de la planilla
do $$
declare jhon uuid; liq bigint;
begin
  perform public.admin_crear_usuario('fernando@cuellar.com', 'Disatel-aMprq6si', 'Fernando Cuéllar', 'admin', 0);
  jhon := public.admin_crear_usuario('jhon.guzman@cambiar-correo.bo', 'Jhon-0r6czY6R', 'Jhon Guzmán', 'vendedor', 3300);

  -- Fecha de instalación = fecha de captación (la planilla no tenía fecha de instalación)
  insert into public.ventas (vendedor_id, fecha_captacion, cliente, empresa, vehiculo, modalidad, precio_mensual,
                             contrato, fecha_instalacion, activado, fecha_primer_pago) values
  (jhon, '2026-08-22', 'Daniela Tambare',         'Gewinner Srl',         '4462TUS', 'Postpago', 150, false, '2026-08-22', true, '2026-09-05'),
  (jhon, '2026-08-26', 'Wilfredo Salvatierra',    'Indatta',              '5599IGA', 'Postpago', 135, false, '2026-08-26', true, '2026-09-01'),
  (jhon, '2026-09-02', 'Daniel Nogales',          'Luma Marelli',         '5641ZLB', 'Postpago', 150, false, '2026-09-02', true, null),
  (jhon, '2026-09-08', 'Leonela Yabeta',          'Trinuts',              '6663KDD', 'Postpago', 150, false, '2026-09-08', true, null),
  (jhon, '2026-09-08', 'Hernany Jimenez Cardona', null,                   '5294AFC', 'Prepago',   80, false, '2026-09-08', true, '2026-09-08'),
  (jhon, '2026-09-08', 'Antonio Medrano',         null,                   '6479CCA', 'Prepago',   80, false, '2026-09-08', true, '2026-09-08'),
  (jhon, '2026-09-14', 'Angel Vargas Baptista',   null,                   '6247LZP', 'Prepago',   80, false, '2026-09-14', true, '2026-09-14'),
  (jhon, '2026-09-18', 'Javier Gomez Garcia',     'Trans G3 e hijos srl', '3109HFT', 'Prepago',   80, false, '2026-09-18', true, '2026-09-18'),
  (jhon, '2026-09-18', 'Javier Gomez Garcia',     'Trans G3 e hijos srl', '6456ZFG', 'Prepago',   80, false, '2026-09-18', true, '2026-09-18'),
  (jhon, '2026-09-21', 'Javier Gomez Garcia',     'Trans G3 e hijos srl', '6453LDI', 'Prepago',   80, false, '2026-09-21', true, '2026-09-21'),
  (jhon, '2026-09-22', 'Ivan Callisaya',          'Prens Solid',          '6459EEK', 'Prepago',   80, false, '2026-09-22', true, null);

  -- Comisión de Daniela Tambare ya pagada el 01/10/2026 según la planilla
  insert into public.liquidaciones (vendedor_id, periodo, sueldo_fijo, unidades, comisiones, bono, clawbacks,
                                    saldo_anterior, total_variable, a_pagar, estado, fecha_pago, notas)
  values (jhon, '2026-08-01', 3300, 2, 75, 0, 0, 0, 75, 75, 'pagada', '2026-10-01', 'Importada de la planilla Excel')
  returning id into liq;
  update public.ventas set liquidacion_id = liq where vendedor_id = jhon and vehiculo = '4462TUS';

  perform public.sync_clawbacks();
end $$;
