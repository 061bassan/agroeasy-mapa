// Baixa a produção agropecuária municipal do IBGE (SIDRA) e gera agregados por município.
// Uso: node ferramentas/importar-ibge.js <pasta-cache> <saida.json> [UFs, ex.: GO,MG,TO | all]
// Tabelas (ano mais recente disponível; o ano vem do próprio dado):
//   PAM 5457: lavouras temporárias e permanentes (área plantada 8331, área colhida 216, quantidade 214, valor 215 em mil reais)
//   PPM 3939: efetivo dos rebanhos (105)    PPM 74: produção de origem animal (106 quantidade, 215 valor)
// Retomável: cada requisição fica em cache na pasta; valores ".." / "X" / "..." são tratados como ausentes (nunca como zero).
const fs = require('fs');
const path = require('path');

const [dir, saida, ufsArg = 'GO,MG,TO'] = process.argv.slice(2);
if (!dir || !saida) { console.error('uso: node importar-ibge.js <pasta-cache> <saida.json> [UFs|all]'); process.exit(1); }
fs.mkdirSync(dir, { recursive: true });

const COD = { RO: 11, AC: 12, AM: 13, RR: 14, PA: 15, AP: 16, TO: 17, MA: 21, PI: 22, CE: 23, RN: 24, PB: 25, PE: 26, AL: 27, SE: 28, BA: 29, MG: 31, ES: 32, RJ: 33, SP: 35, PR: 41, SC: 42, RS: 43, MS: 50, MT: 51, GO: 52, DF: 53 };
const UFS = ufsArg === 'all' ? Object.keys(COD) : ufsArg.split(',');
const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0' };
const codigosUF = (uf) => {
  global.window = { AGRO_MUN: {} };
  const f = path.join(__dirname, '..', 'public', 'assets', 'municipios', uf.toLowerCase() + '.js');
  delete require.cache[require.resolve(f)];
  require(f);
  const cods = window.AGRO_MUN[uf].map((m) => String(m[0]));
  // municípios da geometria complementar (criados depois da malha base do app)
  try {
    global.window = { AGRO_MUN_EXTRA: {} };
    const fe = path.join(__dirname, '..', 'public', 'assets', 'inad', 'municipios-extra.js');
    delete require.cache[require.resolve(fe)];
    require(fe);
    (window.AGRO_MUN_EXTRA[uf] || []).forEach((m) => { if (!cods.includes(String(m[0]))) cods.push(String(m[0])); });
  } catch { /* sem complemento */ }
  return cods;
};
const lotes = (a, n) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));
const LOTE = 40; // limite do SIDRA: 50 mil valores por requisição
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function sidra(chave, caminho) {
  const arq = path.join(dir, `${chave}.json`);
  if (fs.existsSync(arq)) return JSON.parse(fs.readFileSync(arq, 'utf8'));
  for (let t = 1; t <= 4; t++) {
    try {
      const r = await fetch(`https://apisidra.ibge.gov.br/values/${caminho}`, { headers: UA });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      if (!Array.isArray(j) || j.length < 1) throw new Error('resposta inesperada');
      fs.writeFileSync(arq, JSON.stringify(j));
      return j;
    } catch (e) {
      console.error(`  tentativa ${t} falhou (${chave}): ${e.message}`);
      await sleep(2000 * t);
    }
  }
  throw new Error(`falha definitiva: ${chave}`);
}
async function sidraLotes(chave, uf, tabela, vars, cls) {
  const out = [null];
  let i = 0;
  for (const lote of lotes(codigosUF(uf), LOTE)) {
    const j = await sidra(`${chave}_${uf}_${i++}`, `t/${tabela}/n6/${lote.join(',')}/v/${vars}/p/last/${cls}/all`);
    out.push(...j.slice(1));
  }
  return out;
}
const num = (v) => (/^-?\d+(\.\d+)?$/.test(String(v).trim()) ? Number(v) : null); // "-", "..", "X" -> null
const linhas = (j) => j.slice(1);

(async () => {
  const producao = new Map(); // 'cod|produto' -> objeto
  const pecuaria = [];
  const anos = { pam: new Set(), ppm_rebanho: new Set(), ppm_origem: new Set() };
  const faltantes = { pam: 0, ppm: 0 };

  for (const uf of UFS) {
    const n3 = COD[uf];
    if (!n3) throw new Error('UF inválida ' + uf);
    console.error('UF', uf);
    const campos = { 8331: 'area_plantada_ha', 216: 'area_colhida_ha', 214: 'qtd_toneladas', 215: 'valor_mil_reais' };
    for (const [v, campo] of Object.entries(campos)) {
      const j = await sidraLotes(`pam_${v}`, uf, 5457, v, 'c782');
      for (const r of linhas(j)) {
        const cod = r.D1C, ano = Number(r.D3C), produto = r.D4N;
        anos.pam.add(ano);
        const val = num(r.V);
        if (val === null) { if (r.V !== '-') faltantes.pam++; continue; }
        const k = `${cod}|${produto}`;
        let o = producao.get(k);
        if (!o) { o = { cod, ano, produto }; producao.set(k, o); }
        o[campo] = val;
      }
    }
    const reb = await sidraLotes('ppm3939_105', uf, 3939, '105', 'c79');
    for (const r of linhas(reb)) {
      anos.ppm_rebanho.add(Number(r.D3C));
      const val = num(r.V);
      if (val === null) { if (r.V !== '-') faltantes.ppm++; continue; }
      if (val > 0) pecuaria.push({ cod: r.D1C, ano: Number(r.D3C), item: r.D4N, indicador: 'efetivo', valor: val, unidade: r.MN });
    }
    const org = await sidraLotes('ppm74', uf, 74, '106,215', 'c80');
    for (const r of linhas(org)) {
      anos.ppm_origem.add(Number(r.D3C));
      const val = num(r.V);
      if (val === null) { if (r.V !== '-') faltantes.ppm++; continue; }
      if (val > 0) pecuaria.push({ cod: r.D1C, ano: Number(r.D3C), item: r.D4N, indicador: r.D2C === '215' ? 'valor' : 'quantidade', valor: val, unidade: r.MN });
    }
  }
  const out = {
    gerado_em: new Date().toISOString(),
    ufs: UFS,
    anos: Object.fromEntries(Object.entries(anos).map(([k, s]) => [k, [...s].sort()])),
    ausentes_nao_numericos: faltantes,
    producao: [...producao.values()],
    pecuaria
  };
  fs.writeFileSync(saida, JSON.stringify(out));
  console.error('producao:', out.producao.length, 'pecuaria:', out.pecuaria.length, 'anos:', JSON.stringify(out.anos));
})().catch((e) => { console.error('ERRO', e.message); process.exit(1); });
