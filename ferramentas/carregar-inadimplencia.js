// Carrega no Supabase os agregados gerados por importar-sicor.js (tabelas inad_*).
// Uso: SUPABASE_ACCESS_TOKEN=... node ferramentas/carregar-inadimplencia.js <agg.json> <project-ref> [UFs, ex.: GO,MG,TO]
// O token fica só no ambiente do comando; nada é gravado em arquivo.
const fs = require('fs');
const path = require('path');

const [arq, ref, ufsArg = 'GO,MG,TO'] = process.argv.slice(2);
const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!arq || !ref || !token) { console.error('uso: SUPABASE_ACCESS_TOKEN=... node carregar-inadimplencia.js <agg.json> <ref> [UFs]'); process.exit(1); }

const COD_UF = { 11: 'RO', 12: 'AC', 13: 'AM', 14: 'RR', 15: 'PA', 16: 'AP', 17: 'TO', 21: 'MA', 22: 'PI', 23: 'CE', 24: 'RN', 25: 'PB', 26: 'PE', 27: 'AL', 28: 'SE', 29: 'BA', 31: 'MG', 32: 'ES', 33: 'RJ', 35: 'SP', 41: 'PR', 42: 'SC', 43: 'RS', 50: 'MS', 51: 'MT', 52: 'GO', 53: 'DF' };
const UFS = new Set(ufsArg.split(','));
const q = (v) => (v == null ? 'null' : typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`);

const agg = JSON.parse(fs.readFileSync(arq, 'utf8'));
const periodos = [...new Set(agg.municipio_mes.map((r) => r.periodo))].sort();
const dataBase = periodos[periodos.length - 1];
const cargaId = `sicor_saldos_${dataBase.replace('-', '_')}`;

// Municípios: código IBGE, nome oficial e posição (centro do retângulo da geometria do IBGE usada no mapa)
const municipios = [];
for (const uf of UFS) {
  const f = path.join(__dirname, '..', 'public', 'assets', 'municipios', `${uf.toLowerCase()}.js`);
  global.window = { AGRO_MUN: {} };
  delete require.cache[require.resolve(f)];
  require(f);
  for (const [cod, nome, d] of window.AGRO_MUN[uf]) {
    const n = (d.match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (let i = 0; i + 1 < n.length; i += 2) { x0 = Math.min(x0, n[i]); x1 = Math.max(x1, n[i]); y0 = Math.min(y0, n[i + 1]); y1 = Math.max(y1, n[i + 1]); }
    municipios.push({ cod: String(cod), uf, nome, x: Math.round(((x0 + x1) / 2) * 10) / 10, y: Math.round(((y0 + y1) / 2) * 10) / 10 });
  }
}
// geometria complementar (municípios criados depois da malha base do app; fonte IBGE, malha 2025)
try {
  global.window = { AGRO_MUN_EXTRA: {} };
  const fe = path.join(__dirname, '..', 'public', 'assets', 'inad', 'municipios-extra.js');
  delete require.cache[require.resolve(fe)];
  require(fe);
  for (const uf of UFS) for (const [cod, nome, , cx, cy] of (window.AGRO_MUN_EXTRA[uf] || [])) {
    if (!municipios.some((m) => m.cod === String(cod))) municipios.push({ cod: String(cod), uf, nome, x: cx, y: cy });
  }
} catch { /* sem geometria complementar */ }
// grafia oficial do IBGE (a geometria do app usa grafia antiga em alguns municípios)
try {
  const ov = JSON.parse(fs.readFileSync(path.join(__dirname, 'nomes-oficiais-ibge.json'), 'utf8')).nomes || {};
  municipios.forEach((m) => { if (ov[m.cod]) m.nome = ov[m.cod]; });
} catch { /* sem overrides */ }
const codSet = new Set(municipios.map((m) => m.cod));
const linhas = agg.municipio_mes.filter((r) => codSet.has(r.ibge));
const orfaos = new Set(agg.municipio_mes.filter((r) => UFS.has(COD_UF[r.ibge.slice(0, 2)]) && !codSet.has(r.ibge)).map((r) => r.ibge));
if (orfaos.size) console.error('AVISO: códigos IBGE sem geometria:', [...orfaos].join(','));
// municípios do Sicor sem geometria no app: ficam fora do mapa e são declarados na nota da carga
const orfInfo = [...orfaos].map((cod) => {
  const ult = agg.municipio_mes.filter((r) => r.ibge === cod && r.periodo === dataBase)[0];
  const mi = (v) => (v / 1e6).toFixed(1).replace('.', ',');
  return ult ? `${cod} (carteira ativa R$ ${mi(ult.saldo_ativo)} mi e saldo inadimplente R$ ${mi(ult.saldo_inad)} mi em ${dataBase})` : cod;
});
const notaOrfaos = orfInfo.length ? ` Fora do mapa por falta de geometria no app (município criado após a malha utilizada): ${orfInfo.join('; ')}. Não foram atribuídos a municípios vizinhos.` : '';

const cb = agg.cobertura_por_periodo[dataBase];
const pctOps = (cb[0] / (cb[0] + cb[1]) * 100).toFixed(1).replace('.', ',');
const pctSaldo = (cb[2] / (cb[2] + cb[3]) * 100).toFixed(1).replace('.', ',');

async function sql(query) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query })
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`${r.status} ${t.slice(0, 400)}`);
  return t;
}

(async () => {
  await sql(`
insert into public.inad_fontes (id, nome, orgao, url, descricao) values
 ('bcb_sicor', 'Sicor — Tabelas e microdados do crédito rural', 'Banco Central do Brasil', 'https://www.bcb.gov.br/estabilidadefinanceira/tabelas-credito-rural-proagro', 'Arquivos SICOR_SALDOS e SICOR_COMPLEMENTO_OPERACAO_BASICA (DadosBrutos).'),
 ('ibge_municipios', 'Divisão territorial e códigos dos municípios', 'IBGE', 'https://www.ibge.gov.br/explica/codigos-dos-municipios.php', 'Código IBGE (7 dígitos), nome oficial e malha municipal.')
on conflict (id) do update set nome = excluded.nome, orgao = excluded.orgao, url = excluded.url, descricao = excluded.descricao;
insert into public.inad_cargas (id, fonte_id, data_base, periodo_inicio, atualizado_em, metodologia, cobertura, status_validacao, nota) values (
 ${q(cargaId)}, 'bcb_sicor', ${q(dataBase + '-01')}, ${q(periodos[0] + '-01')}, now(),
 ${q('Operações do Sicor ligadas ao município (CD_IBGE_MUNICIPIO) por REF_BACEN + NU_ORDEM. Inadimplente = situação 12 (SOR12); em atraso = situação 2 (SOR02), conforme domínio SituacaoOperacao do BCB. Saldo = VL_ULTIMO_DIA do mês. Carteira ativa = situações 1, 2, 3, 4, 5 e 12. Taxa = saldo inadimplente / saldo da carteira ativa, calculada pelo aplicativo. Prorrogações e renegociações não são contadas como inadimplência. Quantidade de operações não é quantidade de produtores.')},
 ${q(`Município identificado em ${pctOps}% das operações ativas e ${pctSaldo}% do saldo do país em ${dataBase}; as demais não têm município no arquivo do BCB e ficam fora. Valores são parciais e não representam o total do mercado. UFs carregadas: ${[...UFS].join(', ')}. Anos de contratação lidos: ${agg.anos_contratacao.join('–')}.`)},
 'parcial', ${q('Não há dado de pessoa ou devedor.' + notaOrfaos)})
on conflict (id) do update set data_base = excluded.data_base, periodo_inicio = excluded.periodo_inicio, atualizado_em = now(),
  metodologia = excluded.metodologia, cobertura = excluded.cobertura, status_validacao = excluded.status_validacao, nota = excluded.nota;`);
  console.error('fontes e carga ok:', cargaId);

  for (let i = 0; i < municipios.length; i += 500) {
    const v = municipios.slice(i, i + 500).map((m) => `(${q(m.cod)},${q(m.uf)},${q(m.nome)},${m.x},${m.y})`).join(',');
    await sql(`insert into public.inad_municipios (cod_ibge, uf, nome, x, y) values ${v} on conflict (cod_ibge) do update set nome = excluded.nome, x = excluded.x, y = excluded.y;`);
  }
  console.error('municípios:', municipios.length);

  for (let i = 0; i < linhas.length; i += 800) {
    const v = linhas.slice(i, i + 800).map((r) => `(${q(r.ibge)},${q(r.periodo + '-01')},${r.n_inad},${r.saldo_inad},${r.n_atraso},${r.saldo_atraso},${r.n_ativas},${r.saldo_ativo},${q(cargaId)})`).join(',');
    await sql(`insert into public.inad_municipio_mensal (cod_ibge, periodo, n_inad, saldo_inad, n_atraso, saldo_atraso, n_ativas, saldo_ativo, carga_id) values ${v}
      on conflict (cod_ibge, periodo) do update set n_inad = excluded.n_inad, saldo_inad = excluded.saldo_inad, n_atraso = excluded.n_atraso, saldo_atraso = excluded.saldo_atraso, n_ativas = excluded.n_ativas, saldo_ativo = excluded.saldo_ativo, carga_id = excluded.carga_id;`);
  }
  console.error('linhas município/mês:', linhas.length);

  const cobVals = Object.entries(agg.cobertura_por_periodo).sort().map(([p, c]) => `(${q(p + '-01')},${c[0]},${c[1]},${Math.round(c[2] * 100) / 100},${Math.round(c[3] * 100) / 100},${q(cargaId)})`).join(',');
  await sql(`insert into public.inad_cobertura_periodo (periodo, ops_com_mun, ops_sem_mun, saldo_com_mun, saldo_sem_mun, carga_id) values ${cobVals}
    on conflict (periodo) do update set ops_com_mun = excluded.ops_com_mun, ops_sem_mun = excluded.ops_sem_mun, saldo_com_mun = excluded.saldo_com_mun, saldo_sem_mun = excluded.saldo_sem_mun, carga_id = excluded.carga_id;`);
  console.error('cobertura por período ok');
})().catch((e) => { console.error('ERRO', e.message); process.exit(1); });
