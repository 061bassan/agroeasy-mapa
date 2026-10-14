// Compara o ranking de oportunidades (top N) entre duas versões do código do app, com os dados reais do banco.
// Uso: SUPABASE_ACCESS_TOKEN=... node ferramentas/comparar-ranking.js <project-ref> [--base <git-ref>] [--top 100] [--saida arq.json]
//   --base: versão anterior do public/js/inadimplencia.js (padrão: 153ef45). A versão "depois" é o arquivo atual.
// A função `pontuar` é extraída do próprio arquivo do app, então o resultado é exatamente o que a tela calcula.
// Leitura apenas; o token fica só no ambiente.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const args = process.argv.slice(2);
const ref = args[0];
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const base = opt('--base', '153ef45'), TOP = Number(opt('--top', '100')), saida = opt('--saida', null);
const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!ref || !token) { console.error('uso: SUPABASE_ACCESS_TOKEN=... node comparar-ranking.js <project-ref> [--base git-ref]'); process.exit(1); }
const PEQUENA = 1e6;

async function sql(query) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query })
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`${r.status} ${t.slice(0, 300)}`);
  return JSON.parse(t);
}
const norm = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

// extrai o trecho de pontuação de um arquivo do app (a partir do comentário/função até "let nacionalPronto")
function carregarPontuar(fonte) {
  let i = fonte.indexOf('  // Percentil (0-100) de cada município');
  if (i < 0) i = fonte.indexOf('  function pontuar(conjunto, chave) {');
  const j = fonte.indexOf('  let nacionalPronto = false;');
  if (i < 0 || j < 0) throw new Error('trecho de pontuação não encontrado');
  return new Function(fonte.slice(i, j) + '\nreturn pontuar;')();
}

(async () => {
  const cargas = await sql("select data_base::text d from public.inad_cargas where id like 'sicor_saldos_%' order by data_base desc limit 1");
  const periodo = cargas[0].d;
  const [muns, mensal, perfil, reg, coords, parc] = await Promise.all([
    sql('select cod_ibge, uf, nome from public.inad_municipios'),
    sql(`select cod_ibge, saldo_inad, saldo_ativo from public.inad_municipio_mensal where periodo = '${periodo}'`),
    sql('select cod_ibge, producao_valor_mil, credito_valor from public.inad_perfil_municipio'),
    sql('select base_id, uf, municipio, quantidade from public.municipio_registros'),
    sql('select uf, municipio, cod_ibge from public.municipio_coordenadas'),
    sql('select nome, municipio, uf, status from public.parceiros where excluido_em is null')
  ]);
  const porNome = new Map(muns.map((m) => [`${m.uf}|${norm(m.nome)}`, m.cod_ibge]));
  const porCoord = new Map(coords.map((c) => [`${c.uf}|${c.municipio}`, c.cod_ibge]));
  const resolve = (uf, n) => porCoord.get(`${uf}|${n}`) || porNome.get(`${uf}|${norm(n)}`) || null;
  const pres = new Map();
  const get = (c) => pres.get(c) || (pres.set(c, { leads: 0, clientes: 0, pAtivos: 0, pInativos: 0 }), pres.get(c));
  reg.forEach((r) => { const c = resolve(r.uf, r.municipio); if (c) get(c)[r.base_id === 'leads' ? 'leads' : 'clientes'] += r.quantidade; });
  parc.forEach((p) => { const c = resolve(p.uf, p.municipio); if (c) get(c)[p.status === 'Ativo' ? 'pAtivos' : 'pInativos']++; });
  const m_ = new Map(mensal.map((r) => [r.cod_ibge, r]));
  const pf = new Map(perfil.map((r) => [r.cod_ibge, r]));
  const num = (v) => (v == null ? null : Number(v));
  const todos = muns.map((m) => {
    const a = m_.get(m.cod_ibge), p = pf.get(m.cod_ibge) || {};
    return {
      cod: m.cod_ibge, uf: m.uf, nome: m.nome, pres: pres.get(m.cod_ibge) || null,
      saldoInad: a ? Number(a.saldo_inad) : 0, carteira: a ? Number(a.saldo_ativo) : 0,
      producao: num(p.producao_valor_mil) == null ? null : Number(p.producao_valor_mil) * 1000, credito: num(p.credito_valor)
    };
  });
  const sem = (m) => !m.pres || !(m.pres.leads || m.pres.clientes || m.pres.pAtivos);
  const elegiveis = todos.filter((m) => sem(m) && m.saldoInad > 0 && m.carteira >= PEQUENA);

  const fonteDepois = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'inadimplencia.js'), 'utf8');
  if (!/^[A-Za-z0-9._/-]+$/.test(base)) throw new Error('referência git inválida');
  const fonteAntes = execFileSync('git', ['show', `${base}:public/js/inadimplencia.js`], { cwd: path.join(__dirname, '..'), maxBuffer: 64 * 1024 * 1024 }).toString('utf8');
  const rodar = (fonte) => {
    const pontuar = carregarPontuar(fonte);
    const copia = elegiveis.map((m) => ({ ...m }));
    pontuar(copia, 'nac', true);
    return copia.sort((a, b) => (b.nac ?? -1) - (a.nac ?? -1) || b.saldoInad - a.saldoInad);
  };
  const A = rodar(fonteAntes), D = rodar(fonteDepois);
  const cont = (L) => L.slice(0, TOP).reduce((o, m) => (o[m.uf] = (o[m.uf] || 0) + 1, o), {});
  const ca = cont(A), cd = cont(D);
  const comum = A.slice(0, TOP).filter((m) => D.slice(0, TOP).some((x) => x.cod === m.cod)).length;
  const prodUF = {};
  todos.forEach((m) => { prodUF[m.uf] = (prodUF[m.uf] || 0) + (m.producao || 0); });
  const totProd = Object.values(prodUF).reduce((a, b) => a + b, 0);

  console.log(`Período ${periodo} · elegíveis ${elegiveis.length} · base ${base}`);
  console.log(`Top ${TOP} em comum: ${comum}/${TOP}`);
  console.log('UF   produção%   antes → depois');
  Object.keys(prodUF).sort((a, b) => prodUF[b] - prodUF[a]).slice(0, 12).forEach((u) => {
    console.log(`${u.padEnd(4)} ${(prodUF[u] / totProd * 100).toFixed(1).padStart(6)}%    ${String(ca[u] || 0).padStart(3)} → ${String(cd[u] || 0).padStart(3)}`);
  });
  if (saida) fs.writeFileSync(saida, JSON.stringify({ periodo, base, top: TOP, elegiveis: elegiveis.length, em_comum: comum, antes: ca, depois: cd, top15_depois: D.slice(0, 15).map((m) => ({ nome: m.nome, uf: m.uf, pontuacao: m.nac })) }, null, 1));
})().catch((e) => { console.error('ERRO', e.message); process.exit(1); });
