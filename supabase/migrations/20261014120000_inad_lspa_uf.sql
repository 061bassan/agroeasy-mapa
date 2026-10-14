-- Estimativa da safra do ano corrente por UF (IBGE/LSPA). Tabela nova, independente das comerciais.
-- É estimativa estadual: não substitui nem se soma à PAM municipal (dado consolidado, em inad_agro_producao).
begin;

create table if not exists public.inad_lspa_uf (
  uf                 char(2) not null check (uf ~ '^[A-Z]{2}$'),
  periodo            date not null check (periodo = date_trunc('month', periodo)::date),  -- mês de referência da estimativa
  produto            text not null,
  area_plantada_ha   numeric check (area_plantada_ha >= 0),
  area_colhida_ha    numeric check (area_colhida_ha >= 0),
  producao_t         numeric check (producao_t >= 0),
  rendimento_kg_ha   numeric check (rendimento_kg_ha >= 0),
  carga_id           text not null references public.inad_cargas (id),
  primary key (uf, periodo, produto)
);

alter table public.inad_lspa_uf enable row level security;
revoke all on public.inad_lspa_uf from anon, authenticated;
grant select on public.inad_lspa_uf to authenticated;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'inad_lspa_uf' and policyname = 'leitura para usuarios autorizados') then
    create policy "leitura para usuarios autorizados" on public.inad_lspa_uf
      for select to authenticated using ((select private.tem_acesso()));
  end if;
end $$;

commit;
