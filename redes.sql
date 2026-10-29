-- Facebook e Instagram en el CRM: mensajes (Messenger / Direct) y comentarios en publicaciones.
-- La clave de la página NO se guarda aquí: va como secreto de Supabase con el nombre indicado en "secreto".

-- Cuentas conectadas: la página de Facebook y la cuenta de Instagram vinculada a ella
create table if not exists public.redes_cuentas (
  id bigint generated always as identity primary key,
  plataforma text not null check (plataforma in ('facebook', 'instagram')),
  cuenta_id text not null,            -- ID de la página de Facebook o de la cuenta profesional de Instagram
  nombre text not null,
  vendedor_id uuid references public.profiles(id) on delete set null, -- quién atiende lo que llega
  secreto text not null,              -- nombre del secreto con la clave de acceso de la página
  activo boolean not null default true,
  creado_at timestamptz not null default now(),
  unique (plataforma, cuenta_id)
);

-- Identificación del cliente en cada red y mensajes sin leer
alter table public.clientes add column if not exists fb_id text;
alter table public.clientes add column if not exists ig_id text;
alter table public.clientes add column if not exists redes_no_leidos int not null default 0;
create index if not exists clientes_fb_idx on public.clientes (vendedor_id, fb_id) where fb_id is not null;
create index if not exists clientes_ig_idx on public.clientes (vendedor_id, ig_id) where ig_id is not null;

-- Mensajes y comentarios
create table if not exists public.redes_mensajes (
  id bigint generated always as identity primary key,
  cuenta_id bigint not null references public.redes_cuentas(id) on delete cascade,
  plataforma text not null check (plataforma in ('facebook', 'instagram')),
  clase text not null check (clase in ('mensaje', 'comentario')),
  direccion text not null check (direccion in ('entrante', 'saliente')),
  origen text not null default 'cliente' check (origen in ('cliente', 'crm', 'pagina')),
  cliente_id bigint references public.clientes(id) on delete set null,
  usuario_id text,                    -- ID de la persona en esa red
  usuario_nombre text,
  texto text,
  adjunto_url text,
  adjunto_tipo text,
  mid text unique,                    -- ID del mensaje o del comentario en Meta
  responde_a text,                    -- comentario al que responde (respuestas públicas y privadas)
  publicacion_id text,
  publicacion_url text,
  respondido boolean not null default false,
  estado text,
  error text,
  enviado_por uuid references public.profiles(id) on delete set null,
  fecha timestamptz not null default now()
);
create index if not exists redes_msg_cliente_idx on public.redes_mensajes (cliente_id, fecha);
create index if not exists redes_msg_usuario_idx on public.redes_mensajes (cuenta_id, usuario_id, fecha);
create index if not exists redes_msg_clase_idx on public.redes_mensajes (clase, fecha desc);

alter table public.redes_cuentas enable row level security;
alter table public.redes_mensajes enable row level security;

-- Cuentas: el administrador las maneja; el vendedor ve las que atiende
drop policy if exists rc_sel on public.redes_cuentas;
create policy rc_sel on public.redes_cuentas for select to authenticated using (vendedor_id = auth.uid() or public.is_admin());
drop policy if exists rc_adm on public.redes_cuentas;
create policy rc_adm on public.redes_cuentas for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Mensajes: los ve el administrador, quien atiende la cuenta y el vendedor del cliente. Se escriben solo desde las funciones del servidor.
create or replace function public.atiendo_red(p bigint) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.redes_cuentas where id = p and vendedor_id = auth.uid())
$$;
revoke execute on function public.atiendo_red(bigint) from anon, public;
grant execute on function public.atiendo_red(bigint) to authenticated;

drop policy if exists rm_sel on public.redes_mensajes;
create policy rm_sel on public.redes_mensajes for select to authenticated
  using (public.is_admin() or public.atiendo_red(cuenta_id) or (cliente_id is not null and public.es_mi_cliente(cliente_id)));

-- Mensajes nuevos en vivo en la pantalla
do $$ begin
  alter publication supabase_realtime add table public.redes_mensajes;
exception when duplicate_object then null; end $$;
