-- Enriquecimento da aba Inadimplência Rural: perfil agropecuário (IBGE) e crédito contratado (Sicor).
-- Só tabelas novas (prefixo inad_). Crédito contratado (fluxo) fica SEPARADO do saldo inadimplente (estoque).
begin;

alter table public.inad_cargas add column if not exists periodicidade text not null default 'mensal'
  check (periodicidade in ('mensal', 'anual'));

-- Produção agrícola municipal (IBGE/PAM, tabela 5457): um registro por município, ano e produto
create table if not exists public.inad_agro_producao (
  cod_ibge          text not null references public.inad_municipios (cod_ibge),
  ano               smallint not null,
  produto           text not null,                 -- nome IBGE; 'Total' = total geral do município
  area_plantada_ha  numeric check (area_plantada_ha >= 0),
  area_colhida_ha   numeric check (area_colhida_ha >= 0),
  qtd_toneladas     numeric check (qtd_toneladas >= 0),
  valor_mil_reais   numeric check (valor_mil_reais >= 0),
  carga_id          text not null references public.inad_cargas (id),
  primary key (cod_ibge, ano, produto)
);

-- Pecuária municipal (IBGE/PPM, tabelas 3939 e 74)
create table if not exists public.inad_agro_pecuaria (
  cod_ibge   text not null references public.inad_municipios (cod_ibge),
  ano        smallint not null,
  item       text not null,                        -- ex.: Bovino, Galináceos, Leite
  indicador  text not null check (indicador in ('efetivo', 'quantidade', 'valor')),
  valor      numeric not null check (valor >= 0),
  unidade    text not null,
  carga_id   text not null references public.inad_cargas (id),
  primary key (cod_ibge, ano, item, indicador)
);

-- Crédito rural contratado por município, ano e finalidade (Sicor/BCB; fluxo, não saldo)
create table if not exists public.inad_credito_anual (
  cod_ibge    text not null references public.inad_municipios (cod_ibge),
  ano         smallint not null,
  finalidade  text not null check (finalidade in ('Custeio', 'Investimento', 'Comercialização', 'Industrialização')),
  valor       numeric not null check (valor >= 0),
  contratos   integer not null check (contratos >= 0),
  carga_id    text not null references public.inad_cargas (id),
  primary key (cod_ibge, ano, finalidade)
);

-- Quanto do crédito contratado do país tem município identificado (limite declarado na tela)
create table if not exists public.inad_credito_cobertura (
  ano            smallint primary key,
  valor_com_mun  numeric not null,
  valor_sem_mun  numeric not null,
  contratos_com  bigint not null,
  contratos_sem  bigint not null,
  ate_mes        smallint not null check (ate_mes between 1 and 12),  -- último mês com emissão no ano
  carga_id       text not null references public.inad_cargas (id)
);

do $$
declare t text;
begin
  foreach t in array array['inad_agro_producao', 'inad_agro_pecuaria', 'inad_credito_anual', 'inad_credito_cobertura']
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
