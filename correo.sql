-- Correo de cada vendedor (Zoho Mail u otro servidor SMTP) para enviar cotizaciones con el PDF adjunto.
-- La contraseña NO se guarda aquí: va como secreto de Supabase con el nombre indicado en "secreto".
create table if not exists public.correo_cuentas (
  id bigint generated always as identity primary key,
  vendedor_id uuid not null unique references public.profiles(id) on delete cascade,
  correo text not null,
  remitente text,
  servidor text not null default 'smtppro.zoho.com',
  puerto int not null default 465,
  secreto text not null,
  activo boolean not null default true,
  creado_at timestamptz not null default now()
);

alter table public.correo_cuentas enable row level security;

-- Cada vendedor ve su propia cuenta (para saber si el envío directo está activo); el administrador ve y edita todas
drop policy if exists cc_sel on public.correo_cuentas;
create policy cc_sel on public.correo_cuentas for select to authenticated using (vendedor_id = auth.uid() or public.is_admin());
drop policy if exists cc_adm on public.correo_cuentas;
create policy cc_adm on public.correo_cuentas for all to authenticated using (public.is_admin()) with check (public.is_admin());
