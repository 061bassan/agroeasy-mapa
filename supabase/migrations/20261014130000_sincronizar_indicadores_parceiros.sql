-- Sincroniza os indicadores armazenados de parceiros (Ativos/Inativos) com os registros reais.
-- Os valores são calculados a partir de public.parceiros (excluido_em IS NULL), então rodar de novo é inofensivo.
-- Não altera parceiros (nome, município, UF, ID, status) nem outros indicadores.
begin;

update public.indicadores i
set valor = c.n
from (
  select
    count(*) filter (where status = 'Ativo')   as ativos,
    count(*) filter (where status = 'Inativo') as inativos
  from public.parceiros
  where excluido_em is null
) r
cross join lateral (values ('Ativos', r.ativos), ('Inativos', r.inativos)) as c(rotulo, n)
where i.base_id = 'parceiros'
  and i.rotulo = c.rotulo
  and i.valor is distinct from c.n;

commit;
