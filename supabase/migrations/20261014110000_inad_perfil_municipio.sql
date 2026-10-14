-- Resumo por município para a aba Inadimplência Rural (uma linha por município; leitura rápida no carregamento).
-- Mantém separados: produção (IBGE, ano de referência) e crédito contratado (Sicor, último ano completo).
-- security_invoker: respeita o RLS das tabelas inad_*.
create or replace view public.inad_perfil_municipio with (security_invoker = true) as
with ult as (
  select max(ano) as ano from public.inad_credito_cobertura where ate_mes = 12
)
select
  m.cod_ibge,
  pa.ano                       as agro_ano,
  pa.valor_mil_reais           as producao_valor_mil,
  pa.area_colhida_ha,
  pa.area_plantada_ha,
  top.produto                  as principal_cultura,
  top.valor_mil_reais          as principal_cultura_valor_mil,
  rb.ano                       as pecuaria_ano,
  rb.valor                     as bovinos,
  cr.ano                       as credito_ano,
  cr.valor                     as credito_valor,
  cr.contratos                 as credito_contratos
from public.inad_municipios m
left join lateral (
  select ano, valor_mil_reais, area_colhida_ha, area_plantada_ha
  from public.inad_agro_producao
  where cod_ibge = m.cod_ibge and produto = 'Total'
  order by ano desc limit 1
) pa on true
left join lateral (
  select produto, valor_mil_reais
  from public.inad_agro_producao
  where cod_ibge = m.cod_ibge and ano = pa.ano and produto <> 'Total' and valor_mil_reais is not null
  order by valor_mil_reais desc limit 1
) top on true
left join lateral (
  select ano, valor
  from public.inad_agro_pecuaria
  where cod_ibge = m.cod_ibge and item = 'Bovino' and indicador = 'efetivo'
  order by ano desc limit 1
) rb on true
left join lateral (
  select a.ano, sum(a.valor) as valor, sum(a.contratos)::bigint as contratos
  from public.inad_credito_anual a, ult
  where a.cod_ibge = m.cod_ibge and a.ano = ult.ano
  group by a.ano
) cr on true;

revoke all on public.inad_perfil_municipio from anon, authenticated;
grant select on public.inad_perfil_municipio to authenticated;
