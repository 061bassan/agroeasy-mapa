-- =====================================================================
-- Mapa AgroEasy: dados protegidos por login
-- Todas as tabelas são SOMENTE LEITURA para o site e só retornam dados
-- para usuários logados cujo e-mail está na lista de acessos (private.acessos).
-- Alterações de dados são feitas pelo painel do Supabase (service role).
-- =====================================================================

-- Esquema privado: não é exposto pela API do Supabase
create schema if not exists private;
revoke all on schema private from public, anon;

-- ---------------------------------------------------------------------
-- Lista de quem pode ver o mapa (e-mails em minúsculo)
-- ---------------------------------------------------------------------
create table private.acessos (
  email      text primary key check (email = lower(btrim(email)) and email like '%_@_%._%'),
  nome       text,
  ativo      boolean not null default true,
  criado_em  timestamptz not null default now()
);
comment on table private.acessos is 'E-mails autorizados a ver o mapa. Para bloquear alguém: ativo = false.';

-- Verifica se o usuário logado está autorizado (roda com privilégio do dono,
-- mas só olha o e-mail do próprio token do usuário)
create or replace function private.tem_acesso()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from private.acessos a
    where a.ativo
      and a.email = lower(coalesce((select auth.jwt()) ->> 'email', ''))
  );
$$;
revoke all on function private.tem_acesso() from public, anon;
grant usage on schema private to authenticated;
grant execute on function private.tem_acesso() to authenticated;

-- ---------------------------------------------------------------------
-- Dados do mapa
-- ---------------------------------------------------------------------
create table public.bases (
  id               text primary key check (id in ('leads', 'clientes', 'parceiros')),
  titulo           text not null,
  singular         text not null,
  plural           text not null,
  fonte            text not null default '',
  nota_percentual  text not null default '',
  total_com_uf     integer not null check (total_com_uf >= 0)
);

create table public.indicadores (
  id       bigint generated always as identity primary key,
  base_id  text not null references public.bases (id) on delete cascade,
  ordem    smallint not null,
  rotulo   text not null,
  valor    integer not null check (valor >= 0),
  sub      text not null default '',
  status   text check (status in ('ativo', 'inativo')),
  unique (base_id, ordem)
);

create table public.estado_totais (
  base_id     text not null references public.bases (id) on delete cascade,
  uf          char(2) not null check (uf ~ '^[A-Z]{2}$'),
  total       integer not null check (total >= 0),
  percentual  text not null default '',
  nota        text not null default '',
  ordem       smallint not null,
  primary key (base_id, uf)
);

create table public.municipio_registros (
  id          bigint generated always as identity primary key,
  base_id     text not null references public.bases (id) on delete cascade check (base_id in ('leads', 'clientes')),
  uf          char(2) not null check (uf ~ '^[A-Z]{2}$'),
  municipio   text not null,
  quantidade  integer not null check (quantidade > 0),
  ordem       smallint not null,
  unique (base_id, uf, municipio)
);

create table public.parceiros (
  id         bigint generated always as identity primary key,
  nome       text not null,
  municipio  text not null,
  uf         char(2) not null check (uf ~ '^[A-Z]{2}$'),
  status     text not null check (status in ('Ativo', 'Inativo')),
  ordem      smallint not null
);
create index parceiros_uf_ordem_idx on public.parceiros (uf, ordem);

create table public.municipio_coordenadas (
  uf           char(2) not null check (uf ~ '^[A-Z]{2}$'),
  municipio    text not null,
  x            real not null,
  y            real not null,
  lat          double precision not null,
  lon          double precision not null,
  cod_ibge     text,
  nome_oficial text,
  primary key (uf, municipio)
);

-- ---------------------------------------------------------------------
-- Segurança: RLS + somente leitura para usuários autorizados
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['bases', 'indicadores', 'estado_totais', 'municipio_registros', 'parceiros', 'municipio_coordenadas']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format(
      'create policy "leitura para usuarios autorizados" on public.%I for select to authenticated using ((select private.tem_acesso()))',
      t
    );
  end loop;
end $$;
