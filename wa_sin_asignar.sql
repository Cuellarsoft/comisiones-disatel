-- Conversaciones de WhatsApp sin asignar: chats (sobre todo del historial de coexistencia) de números que todavía
-- no son clientes. El vendedor que atiende el número los ve, y decide crear el prospecto o descartar la conversación.

-- ¿El usuario atiende este número de WhatsApp?
create or replace function public.atiendo_wa(p bigint) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.wa_numeros where id = p and vendedor_id = auth.uid())
$$;
revoke execute on function public.atiendo_wa(bigint) from anon, public;
grant execute on function public.atiendo_wa(bigint) to authenticated;

-- Los mensajes sin cliente los ve quien atiende el número (y el administrador)
drop policy if exists wam_sin_asignar on public.wa_mensajes;
create policy wam_sin_asignar on public.wa_mensajes for select to authenticated
  using (cliente_id is null and (public.is_admin() or public.atiendo_wa(wa_numero_id)));

-- Conversaciones descartadas (chats personales, proveedores, etc.): dejan de aparecer en la bandeja
create table if not exists public.wa_descartados (
  wa_numero_id bigint not null references public.wa_numeros(id) on delete cascade,
  telefono text not null,
  descartado_por uuid references public.profiles(id) on delete set null,
  fecha timestamptz not null default now(),
  primary key (wa_numero_id, telefono)
);
alter table public.wa_descartados enable row level security;
drop policy if exists wad_all on public.wa_descartados;
create policy wad_all on public.wa_descartados for all to authenticated
  using (public.is_admin() or public.atiendo_wa(wa_numero_id))
  with check (public.is_admin() or public.atiendo_wa(wa_numero_id));

-- Mensajes del historial de números que ya son clientes: quedan en su ficha
update public.wa_mensajes m set cliente_id = c.id
  from public.wa_numeros n, public.clientes c
 where m.cliente_id is null and n.id = m.wa_numero_id
   and c.vendedor_id = n.vendedor_id and c.telefono_wa = m.telefono;

-- Lista de conversaciones sin asignar (respeta los permisos de quien consulta)
create or replace function public.wa_sin_asignar()
returns table (wa_numero_id bigint, telefono text, mensajes int, entrantes int, ultima timestamptz,
               ultimo_texto text, ultimo_tipo text, ultima_direccion text)
language sql stable security invoker set search_path = public as $$
  with g as (
    select m.wa_numero_id, m.telefono, count(*)::int as mensajes,
           (count(*) filter (where m.direccion = 'entrante'))::int as entrantes, max(m.fecha) as ultima
      from public.wa_mensajes m
     where m.cliente_id is null
     group by 1, 2
  ), l as (
    select distinct on (m.wa_numero_id, m.telefono) m.wa_numero_id, m.telefono, m.texto, m.tipo, m.direccion
      from public.wa_mensajes m
     where m.cliente_id is null
     order by m.wa_numero_id, m.telefono, m.fecha desc
  )
  select g.wa_numero_id, g.telefono, g.mensajes, g.entrantes, g.ultima, l.texto, l.tipo, l.direccion
    from g join l using (wa_numero_id, telefono)
   where not exists (select 1 from public.wa_descartados d where d.wa_numero_id = g.wa_numero_id and d.telefono = g.telefono)
   order by g.ultima desc
$$;
grant execute on function public.wa_sin_asignar() to authenticated;

-- Crea el prospecto a partir de una conversación y le pasa todos sus mensajes
create or replace function public.wa_crear_prospecto(p_numero bigint, p_tel text, p_empresa text, p_contacto text)
returns bigint language plpgsql security definer set search_path = public as $$
declare
  v_vend uuid; v_id bigint; v_ult timestamptz;
begin
  if not (public.is_admin() or public.atiendo_wa(p_numero)) then
    raise exception 'No atiendes este número de WhatsApp';
  end if;
  select coalesce(vendedor_id, auth.uid()) into v_vend from public.wa_numeros where id = p_numero;
  if v_vend is null then raise exception 'Número de WhatsApp no encontrado'; end if;

  select id into v_id from public.clientes where vendedor_id = v_vend and telefono_wa = p_tel order by id limit 1;
  if v_id is null then
    insert into public.clientes (vendedor_id, empresa, contacto, telefono, tipo, origen, etapa)
    values (v_vend, coalesce(nullif(trim(p_empresa), ''), '+' || p_tel), nullif(trim(p_contacto), ''), p_tel,
            'empresa', 'WhatsApp', 'Prospecto')
    returning id into v_id;
    insert into public.actividades (cliente_id, vendedor_id, tipo, texto)
    values (v_id, v_vend, 'nota', 'Creado desde las conversaciones de WhatsApp sin asignar.');
  end if;

  update public.wa_mensajes set cliente_id = v_id
   where wa_numero_id = p_numero and telefono = p_tel and cliente_id is null;
  select max(fecha) into v_ult from public.wa_mensajes where cliente_id = v_id;
  update public.clientes set wa_ultimo_at = greatest(coalesce(wa_ultimo_at, v_ult), v_ult) where id = v_id;
  delete from public.wa_descartados where wa_numero_id = p_numero and telefono = p_tel;
  return v_id;
end $$;
revoke execute on function public.wa_crear_prospecto(bigint, text, text, text) from anon, public;
grant execute on function public.wa_crear_prospecto(bigint, text, text, text) to authenticated;
