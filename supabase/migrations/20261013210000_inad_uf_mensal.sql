-- Totais por UF e mês, derivados dos municípios (nada é estimado nem distribuído).
-- security_invoker: a view respeita o RLS das tabelas inad_* (mesma regra de acesso do app).
create or replace view public.inad_uf_mensal with (security_invoker = true) as
select
  m.uf,
  t.periodo,
  count(*) filter (where t.n_inad > 0)  as municipios_com_inad,
  sum(t.n_inad)::bigint                  as n_inad,
  sum(t.saldo_inad)                      as saldo_inad,
  sum(t.n_atraso)::bigint                as n_atraso,
  sum(t.saldo_atraso)                    as saldo_atraso,
  sum(t.n_ativas)::bigint                as n_ativas,
  sum(t.saldo_ativo)                     as saldo_ativo
from public.inad_municipio_mensal t
join public.inad_municipios m on m.cod_ibge = t.cod_ibge
group by m.uf, t.periodo;

revoke all on public.inad_uf_mensal from anon, authenticated;
grant select on public.inad_uf_mensal to authenticated;
