-- Inadimplência Rural: estruturas NOVAS e independentes (não toca nas tabelas comerciais).
-- Regra de integridade: nenhum número entra sem fonte e data-base (colunas NOT NULL + FK).
-- Sem dados pessoais: só totais por município/mês.
begin;

create table if not exists public.inad_fontes (
  id         text primary key check (id ~ '^[a-z0-9_]{2,60}$'),
  nome       text not null,
  orgao      text not null,
  url        text not null,
  descricao  text not null default ''
);

-- Uma linha por carga de dados: documenta de onde veio, até quando vale e como foi calculado
create table if not exists public.inad_cargas (
  id                 text primary key check (id ~ '^[a-z0-9_]{2,60}$'),
  fonte_id           text not null references public.inad_fontes (id),
  data_base          date not null,                 -- último período (mês) presente nos dados
  periodo_inicio     date not null,
  atualizado_em      timestamptz not null default now(),
  metodologia        text not null,
  cobertura          text not null,                 -- cobertura geográfica e limites
  status_validacao   text not null check (status_validacao in ('validado', 'parcial', 'pendente')),
  nota               text not null default ''
);

-- Municípios (código IBGE) com posição no mapa do app; independe de haver lead/cliente/parceiro
create table if not exists public.inad_municipios (
  cod_ibge  text primary key check (cod_ibge ~ '^[0-9]{7}$'),
  uf        char(2) not null check (uf ~ '^[A-Z]{2}$'),
  nome      text not null,
  x         real not null,
  y         real not null
);
create index if not exists inad_municipios_uf_idx on public.inad_municipios (uf);

create table if not exists public.inad_municipio_mensal (
  cod_ibge      text not null references public.inad_municipios (cod_ibge),
  periodo       date not null check (periodo = date_trunc('month', periodo)::date),
  n_inad        integer not null check (n_inad >= 0),     -- operações inadimplentes (situação 12)
  saldo_inad    numeric not null check (saldo_inad >= 0), -- saldo (R$) dessas operações
  n_atraso      integer not null check (n_atraso >= 0),   -- operações em atraso (situação 2)
  saldo_atraso  numeric not null check (saldo_atraso >= 0),
  n_ativas      integer not null check (n_ativas >= 0),   -- carteira ativa (operações)
  saldo_ativo   numeric not null check (saldo_ativo >= 0),
  carga_id      text not null references public.inad_cargas (id),
  primary key (cod_ibge, periodo)
);
create index if not exists inad_mm_periodo_idx on public.inad_municipio_mensal (periodo);

-- Quanto das operações ativas do país tem município identificado (limite declarado na tela)
create table if not exists public.inad_cobertura_periodo (
  periodo        date primary key,
  ops_com_mun    bigint not null,
  ops_sem_mun    bigint not null,
  saldo_com_mun  numeric not null,
  saldo_sem_mun  numeric not null,
  carga_id       text not null references public.inad_cargas (id)
);

do $$
declare t text;
begin
  foreach t in array array['inad_fontes', 'inad_cargas', 'inad_municipios', 'inad_municipio_mensal', 'inad_cobertura_periodo']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = 'leitura para usuarios autorizados') then
      execute format(
        'create policy "leitura para usuarios autorizados" on public.%I for select to authenticated using ((select private.tem_acesso()))',
        t
      );
    end if;
  end loop;
end $$;

commit;
