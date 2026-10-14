-- Carga rápida da aba Inadimplência Rural: devolve, em UMA consulta, os municípios com os indicadores do período.
-- Substitui ~18 requisições paginadas (PostgREST limita 1000 linhas por resposta).
-- security invoker: respeita o RLS das tabelas inad_* (mesma regra de acesso do app). Somente leitura.
-- Linhas compactas (arrays) na ordem de "campos".
create or replace function public.inad_painel(p_periodo date default null)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with per as (
    select coalesce(p_periodo, (select max(periodo) from public.inad_municipio_mensal)) as p
  )
  select jsonb_build_object(
    'periodo', (select p from per),
    'campos', jsonb_build_array(
      'cod', 'uf', 'nome', 'x', 'y', 'reg', 'saldo_inad', 'n_inad', 'saldo_atraso', 'n_atraso',
      'saldo_ativo', 'n_ativas', 'prod_mil', 'area_colhida', 'cultura', 'cultura_mil', 'bovinos',
      'agro_ano', 'cred', 'cred_contratos', 'cred_ano'
    ),
    'linhas', coalesce(jsonb_agg(jsonb_build_array(
      m.cod_ibge, m.uf, m.nome, m.x, m.y, (a.cod_ibge is not null),
      a.saldo_inad, a.n_inad, a.saldo_atraso, a.n_atraso, a.saldo_ativo, a.n_ativas,
      pf.producao_valor_mil, pf.area_colhida_ha, pf.principal_cultura, pf.principal_cultura_valor_mil, pf.bovinos,
      pf.agro_ano, pf.credito_valor, pf.credito_contratos, pf.credito_ano
    ) order by m.cod_ibge), '[]'::jsonb)
  )
  from public.inad_municipios m
  left join public.inad_municipio_mensal a
    on a.cod_ibge = m.cod_ibge and a.periodo = (select p from per)
  left join public.inad_perfil_municipio pf on pf.cod_ibge = m.cod_ibge;
$$;

revoke all on function public.inad_painel(date) from public, anon;
grant execute on function public.inad_painel(date) to authenticated;
