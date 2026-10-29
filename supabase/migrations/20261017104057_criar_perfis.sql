
create type public.perfil_escola as enum (
  'coordenador',
  'audiovisuais',
  'secretaria'
);

create table public.perfis (
  id uuid primary key references auth.users(id)
    on delete cascade,
  nome text not null,
  perfil public.perfil_escola not null,
  ativo boolean not null default false,
  criado_em timestamptz not null default now()
);

alter table public.perfis enable row level security;

create policy "Utilizador consulta o proprio perfil"
on public.perfis
for select
to authenticated
using ((select auth.uid()) = id);
