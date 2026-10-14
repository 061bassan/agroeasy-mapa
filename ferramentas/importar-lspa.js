// Estimativa da safra do ano corrente por UF (IBGE, LSPA — Levantamento Sistemático da Produção Agrícola).
// Uso: node ferramentas/importar-lspa.js <saida.json>
// Fonte: SIDRA tabela 6588 (mensal), níveis Brasil/Região/UF. É ESTIMATIVA estadual do ano em curso:
// não equivale à PAM municipal (dado consolidado) e não deve ser somada a ela.
// Variáveis: 109 área plantada, 216 área colhida, 35 produção, 36 rendimento médio. Valores ausentes ("..", "X") não viram zero.
const fs = require('fs');

const [saida] = process.argv.slice(2);
if (!saida) { console.error('uso: node importar-lspa.js <saida.json>'); process.exit(1); }
const UF = { 11: 'RO', 12: 'AC', 13: 'AM', 14: 'RR', 15: 'PA', 16: 'AP', 17: 'TO', 21: 'MA', 22: 'PI', 23: 'CE', 24: 'RN', 25: 'PB', 26: 'PE', 27: 'AL', 28: 'SE', 29: 'BA', 31: 'MG', 32: 'ES', 33: 'RJ', 35: 'SP', 41: 'PR', 42: 'SC', 43: 'RS', 50: 'MS', 51: 'MT', 52: 'GO', 53: 'DF' };
const num = (v) => (/^-?\d+(\.\d+)?$/.test(String(v).trim()) ? Number(v) : null);

(async () => {
  const r = await fetch('https://apisidra.ibge.gov.br/values/t/6588/n3/all/v/109,216,35,36/p/last/c48/all', { headers: { 'User-Agent': 'Mozilla/5.0 Chrome/124.0' } });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const j = (await r.json()).slice(1);
  const periodos = [...new Set(j.map((x) => x.D3C))];
  if (periodos.length !== 1) throw new Error('mais de um período: ' + periodos.join(','));
  const per = periodos[0]; // AAAAMM
  const mapa = new Map();
  const CAMPO = { 109: 'area_plantada_ha', 216: 'area_colhida_ha', 35: 'producao_t', 36: 'rendimento_kg_ha' };
  for (const x of j) {
    const uf = UF[x.D1C];
    if (!uf) continue;
    const produto = x.D4N.replace(/^\d+(\.\d+)*\s+/, '').trim();
    const k = uf + '|' + produto;
    let o = mapa.get(k);
    if (!o) { o = { uf, produto }; mapa.set(k, o); }
    const v = num(x.V);
    if (v !== null) o[CAMPO[x.D2C]] = v;
  }
  const linhas = [...mapa.values()].filter((o) => o.area_plantada_ha > 0 || o.producao_t > 0);
  fs.writeFileSync(saida, JSON.stringify({ gerado_em: new Date().toISOString(), periodo: per.slice(0, 4) + '-' + per.slice(4, 6), unidades: { area: 'ha', producao: 't', rendimento: 'kg/ha' }, linhas }));
  console.error('período', per, '| linhas', linhas.length, '| UFs', new Set(linhas.map((l) => l.uf)).size);
})().catch((e) => { console.error('ERRO', e.message); process.exit(1); });
