-- Esquema base que espelha o banco real ANTES das migrations do projeto
-- (consultado via MCP do Supabase em 2026-11-18). Usado pelos testes SQL
-- em PGlite. Inclui a simulação mínima do Supabase: roles, auth.users,
-- auth.uid() e default privileges que concedem EXECUTE a anon.

create role anon nologin;
create role authenticated nologin;
create role service_role nologin;

create schema auth;
create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;

alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;

create table public.categorias (
  id serial primary key,
  nome varchar(50) not null,
  percentual_ideal integer
);

create table public.parcelamentos (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references auth.users (id),
  nome varchar(255) not null,
  total_parcelas integer not null,
  valor_total numeric(10,2) not null,
  created_at timestamptz default now()
);

create table public.transacoes (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references auth.users (id),
  nome varchar(255) not null,
  mes_referencia varchar(7) not null,
  valor_estimado numeric(10,2) not null,
  valor_real numeric(10,2),
  tipo varchar(10) not null check (tipo::text = any (array['receita', 'despesa']::text[])),
  categoria_id integer references public.categorias (id),
  parcelamento_id uuid constraint transacoes_parcelamento_id_fkey
    references public.parcelamentos (id) on delete cascade,
  numero_parcela integer,
  created_at timestamptz default now()
);

alter table public.categorias enable row level security;
alter table public.parcelamentos enable row level security;
alter table public.transacoes enable row level security;

create policy "Usuário gerencia seus parcelamentos" on public.parcelamentos
  for all using (auth.uid() = usuario_id);
create policy "Usuário gerencia suas próprias transações" on public.transacoes
  for all using (auth.uid() = usuario_id);

grant usage on schema public to anon, authenticated;
grant usage on sequence categorias_id_seq to anon, authenticated;

insert into public.categorias (nome, percentual_ideal) values
  ('Necessidades', 50), ('Estilo de Vida', 30), ('Projetos e Poupança', 20);
