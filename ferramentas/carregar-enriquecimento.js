// Carrega no Supabase o perfil agropecuário (IBGE) e o crédito contratado (Sicor): tabelas inad_agro_*, inad_credito_*.
// Uso: SUPABASE_ACCESS_TOKEN=... node ferramentas/carregar-enriquecimento.js <ref> [--ibge ibge.json] [--credito credito.json]
// Idempotente (upsert por chave primária). Só carrega municípios que já existem em inad_municipios.
// O token fica só no ambiente do comando; nada é gravado em arquivo.
const fs = require('fs');

const args = process.argv.slice(2);
const ref = args[0];
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const arqIbge = opt('--ibge'), arqCred = opt('--credito'), arqAud = opt('--auditoria'), arqLspa = opt('--lspa');
const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!ref || !token || (!arqIbge && !arqCred && !arqLspa)) { console.error('uso: SUPABASE_ACCESS_TOKEN=... node carregar-enriquecimento.js <ref> [--ibge f] [--credito f]'); process.exit(1); }

const q = (v) => (v == null ? 'null' : typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
async function sql(query) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query })
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`${r.status} ${t.slice(0, 400)}`);
  return JSON.parse(t);
}
async function emLotes(linhas, tam, montar) {
  for (let i = 0; i < linhas.length; i += tam) await sql(montar(linhas.slice(i, i + tam)));
}

(async () => {
  const existentes = new Set((await sql('select cod_ibge from public.inad_municipios')).map((r) => r.cod_ibge));
  console.error('municípios no banco:', existentes.size);

  if (arqIbge) {
    const d = JSON.parse(fs.readFileSync(arqIbge, 'utf8'));
    const anoAgro = Math.max(...d.anos.pam), anoPec = Math.max(...d.anos.ppm_rebanho, ...d.anos.ppm_origem);
    const cargaAgro = `ibge_pam_${anoAgro}`, cargaPec = `ibge_ppm_${anoPec}`;
    await sql(`
insert into public.inad_fontes (id, nome, orgao, url, descricao) values
 ('ibge_pam', 'Produção Agrícola Municipal (PAM)', 'IBGE', 'https://www.ibge.gov.br/estatisticas/economicas/agricultura-e-pecuaria/9117.html', 'SIDRA tabela 5457: área plantada, área colhida, quantidade produzida e valor da produção das lavouras.'),
 ('ibge_ppm', 'Pesquisa da Pecuária Municipal (PPM)', 'IBGE', 'https://www.ibge.gov.br/estatisticas/economicas/agricultura-e-pecuaria/9107.html', 'SIDRA tabelas 3939 (efetivo dos rebanhos) e 74 (produção de origem animal).')
on conflict (id) do update set nome = excluded.nome, orgao = excluded.orgao, url = excluded.url, descricao = excluded.descricao;
insert into public.inad_cargas (id, fonte_id, data_base, periodo_inicio, periodicidade, atualizado_em, metodologia, cobertura, status_validacao, nota) values
 (${q(cargaAgro)}, 'ibge_pam', ${q(anoAgro + '-12-01')}, ${q(anoAgro + '-01-01')}, 'anual', now(),
  'Valores da PAM (IBGE/SIDRA 5457) por município e produto, ano de referência ${anoAgro}. Área plantada = área plantada ou destinada à colheita; valor em mil reais correntes do ano. Valores suprimidos ("X") ou não disponíveis ("..") não são tratados como zero.',
  ${q('Municípios das UFs: ' + d.ufs.join(', ') + '. Dado anual, sem relação direta com o mês de referência dos indicadores financeiros.')}, 'validado',
  'Soma municipal conferida com o total estadual do IBGE.'),
 (${q(cargaPec)}, 'ibge_ppm', ${q(anoPec + '-12-01')}, ${q(anoPec + '-01-01')}, 'anual', now(),
  'Valores da PPM (IBGE/SIDRA 3939 e 74) por município: efetivo dos rebanhos (cabeças) e produção de origem animal (quantidade e valor), ano de referência ${anoPec}.',
  ${q('Municípios das UFs: ' + d.ufs.join(', ') + '. Dado anual.')}, 'validado', '')
on conflict (id) do update set data_base = excluded.data_base, periodo_inicio = excluded.periodo_inicio, atualizado_em = now(),
  metodologia = excluded.metodologia, cobertura = excluded.cobertura, status_validacao = excluded.status_validacao, nota = excluded.nota;`);
    const prod = d.producao.filter((r) => existentes.has(r.cod));
    await emLotes(prod, 800, (l) => `insert into public.inad_agro_producao (cod_ibge, ano, produto, area_plantada_ha, area_colhida_ha, qtd_toneladas, valor_mil_reais, carga_id) values
      ${l.map((r) => `(${q(r.cod)},${r.ano},${q(r.produto)},${q(r.area_plantada_ha ?? null)},${q(r.area_colhida_ha ?? null)},${q(r.qtd_toneladas ?? null)},${q(r.valor_mil_reais ?? null)},${q(cargaAgro)})`).join(',')}
      on conflict (cod_ibge, ano, produto) do update set area_plantada_ha = excluded.area_plantada_ha, area_colhida_ha = excluded.area_colhida_ha, qtd_toneladas = excluded.qtd_toneladas, valor_mil_reais = excluded.valor_mil_reais, carga_id = excluded.carga_id;`);
    console.error('produção:', prod.length);
    const pec = d.pecuaria.filter((r) => existentes.has(r.cod));
    await emLotes(pec, 800, (l) => `insert into public.inad_agro_pecuaria (cod_ibge, ano, item, indicador, valor, unidade, carga_id) values
      ${l.map((r) => `(${q(r.cod)},${r.ano},${q(r.item)},${q(r.indicador)},${r.valor},${q(r.unidade)},${q(cargaPec)})`).join(',')}
      on conflict (cod_ibge, ano, item, indicador) do update set valor = excluded.valor, unidade = excluded.unidade, carga_id = excluded.carga_id;`);
    console.error('pecuária:', pec.length);
  }

  if (arqLspa) {
    const d = JSON.parse(fs.readFileSync(arqLspa, 'utf8'));
    const per = d.periodo + '-01';
    const cargaId = 'ibge_lspa_' + d.periodo.replace('-', '_');
    await sql(`
insert into public.inad_fontes (id, nome, orgao, url, descricao) values
 ('ibge_lspa', 'Levantamento Sistemático da Produção Agrícola (LSPA)', 'IBGE', 'https://www.ibge.gov.br/estatisticas/economicas/agricultura-e-pecuaria/9201-levantamento-sistematico-da-producao-agricola.html', 'SIDRA tabela 6588: estimativa mensal da safra do ano em curso por UF (área plantada, área colhida, produção e rendimento).')
on conflict (id) do update set nome = excluded.nome, orgao = excluded.orgao, url = excluded.url, descricao = excluded.descricao;
insert into public.inad_cargas (id, fonte_id, data_base, periodo_inicio, periodicidade, atualizado_em, metodologia, cobertura, status_validacao, nota) values (
 ${q(cargaId)}, 'ibge_lspa', ${q(per)}, ${q(d.periodo.slice(0, 4) + '-01-01')}, 'mensal', now(),
 'Estimativa da safra ${d.periodo.slice(0, 4)} publicada pelo IBGE (LSPA), por UF e produto, referente a ${d.periodo}. É estimativa, não resultado consolidado, e não equivale à PAM municipal.',
 'Nível estadual (27 UFs). Não há detalhe por município.', 'validado', 'Valores ausentes não são tratados como zero.')
on conflict (id) do update set data_base = excluded.data_base, atualizado_em = now(), metodologia = excluded.metodologia,
  cobertura = excluded.cobertura, status_validacao = excluded.status_validacao, nota = excluded.nota;`);
    await emLotes(d.linhas, 400, (l) => `insert into public.inad_lspa_uf (uf, periodo, produto, area_plantada_ha, area_colhida_ha, producao_t, rendimento_kg_ha, carga_id) values
      ${l.map((r) => `(${q(r.uf)},${q(per)},${q(r.produto)},${q(r.area_plantada_ha ?? null)},${q(r.area_colhida_ha ?? null)},${q(r.producao_t ?? null)},${q(r.rendimento_kg_ha ?? null)},${q(cargaId)})`).join(',')}
      on conflict (uf, periodo, produto) do update set area_plantada_ha = excluded.area_plantada_ha, area_colhida_ha = excluded.area_colhida_ha, producao_t = excluded.producao_t, rendimento_kg_ha = excluded.rendimento_kg_ha, carga_id = excluded.carga_id;`);
    console.error('LSPA (UF/produto):', d.linhas.length, 'período', d.periodo);
  }

  if (arqCred) {
    const d = JSON.parse(fs.readFileSync(arqCred, 'utf8'));
    const anos = Object.keys(d.anos).map(Number).sort();
    const ult = anos[anos.length - 1];
    const mesUlt = d.anos[ult].ate_mes;
    const cargaId = `sicor_credito_${ult}_${String(mesUlt).padStart(2, '0')}`;
    // Cobertura de município por finalidade e por UF (auditoria dos microdados brutos, opcional)
    let extraCob = '';
    if (arqAud) {
      const a = JSON.parse(fs.readFileSync(arqAud, 'utf8')).conjunto;
      const p = (x, t) => (t ? Math.round((x / t) * 100) : 0);
      const fin = Object.keys(a.finTotal).map((k) => `${k.toLowerCase()} ${p(a.porComMun.fin[k] || 0, a.finTotal[k])}%`).join(', ');
      const ufs = Object.keys(a.ufTotal).map((u) => [u, p(a.porComMun.uf[u] || 0, a.ufTotal[u])]).sort((x, y) => x[1] - y[1]);
      extraCob = ` Proporção do valor contratado com município identificado (2024 a 2026): ${fin}. Por UF varia de ${ufs[0][1]}% (${ufs[0][0]}) a ${ufs[ufs.length - 1][1]}% (${ufs[ufs.length - 1][0]}); por isso a divisão por finalidade e a comparação entre UFs não representam o mercado.`;
    }
    const pctV = (c) => (c.valor_com / (c.valor_com + c.valor_sem) * 100).toFixed(0);
    await sql(`
insert into public.inad_cargas (id, fonte_id, data_base, periodo_inicio, periodicidade, atualizado_em, metodologia, cobertura, status_validacao, nota) values (
 ${q(cargaId)}, 'bcb_sicor', ${q(ult + '-' + String(mesUlt).padStart(2, '0') + '-01')}, ${q(anos[0] + '-01-01')}, 'anual', now(),
 ${q('Crédito rural contratado (fluxo) a partir dos microdados do Sicor (SICOR_OPERACAO_BASICA_ESTADO): soma de VL_PARC_CREDITO por município (CD_IBGE_MUNICIPIO do complemento), ano de emissão e finalidade (domínio Empreendimento: custeio, investimento, comercialização, industrialização). Contrato = REF_BACEN distinto por finalidade. Não é saldo e não deve ser comparado com o saldo inadimplente. O serviço Olinda da MDCR estava instável na carga; os microdados são a mesma base de origem.')},
 ${q(`Município identificado em ${pctV(d.anos[ult].cobertura)}% do valor contratado de ${ult} (até o mês ${mesUlt}). Operações sem município ficam fora. ${ult} é ano parcial.${extraCob}`)},
 'parcial', 'Valores correntes (sem correção monetária).')
on conflict (id) do update set data_base = excluded.data_base, periodo_inicio = excluded.periodo_inicio, atualizado_em = now(),
  metodologia = excluded.metodologia, cobertura = excluded.cobertura, status_validacao = excluded.status_validacao, nota = excluded.nota;`);
    const linhas = [];
    anos.forEach((a) => d.anos[a].municipios.forEach(([ibge, fin, valor, contratos]) => { if (existentes.has(ibge)) linhas.push({ ibge, a, fin, valor, contratos }); }));
    await emLotes(linhas, 800, (l) => `insert into public.inad_credito_anual (cod_ibge, ano, finalidade, valor, contratos, carga_id) values
      ${l.map((r) => `(${q(r.ibge)},${r.a},${q(r.fin)},${r.valor},${r.contratos},${q(cargaId)})`).join(',')}
      on conflict (cod_ibge, ano, finalidade) do update set valor = excluded.valor, contratos = excluded.contratos, carga_id = excluded.carga_id;`);
    console.error('crédito (município/ano/finalidade):', linhas.length);
    const cobV = anos.map((a) => { const c = d.anos[a].cobertura; return `(${a},${c.valor_com},${c.valor_sem},${c.contratos_com},${c.contratos_sem},${d.anos[a].ate_mes},${q(cargaId)})`; }).join(',');
    await sql(`insert into public.inad_credito_cobertura (ano, valor_com_mun, valor_sem_mun, contratos_com, contratos_sem, ate_mes, carga_id) values ${cobV}
      on conflict (ano) do update set valor_com_mun = excluded.valor_com_mun, valor_sem_mun = excluded.valor_sem_mun, contratos_com = excluded.contratos_com, contratos_sem = excluded.contratos_sem, ate_mes = excluded.ate_mes, carga_id = excluded.carga_id;`);
    console.error('cobertura anual ok');
  }
})().catch((e) => { console.error('ERRO', e.message); process.exit(1); });
