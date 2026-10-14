// Auditoria do crédito rural contratado (Sicor): duplicidades, períodos, finalidades e cobertura de município.
// Uso: node --max-old-space-size=3000 ferramentas/auditar-credito-sicor.js <pasta> <saida.json> [anoInicial] [anoFinal]
// <pasta> precisa ter SICOR_COMPLEMENTO_OPERACAO_BASICA.gz e Empreendimento.csv (gerados por importar-credito-sicor.js).
// Calcula, por ano de emissão (TODAS as linhas, com ou sem município): totais por mês, por finalidade, por UF,
// duplicidades (REF_BACEN+NU_ORDEM repetido no ano e entre anos), valores nulos/negativos e totais por safra (jul-jun).
const fs = require('fs');
const zlib = require('zlib');
const https = require('https');
const readline = require('readline');
const path = require('path');

const [dir, saida, anoIni = '2023', anoFim = String(new Date().getFullYear())] = process.argv.slice(2);
if (!dir || !saida) { console.error('uso: node auditar-credito-sicor.js <pasta> <saida.json> [anoInicial] [anoFinal]'); process.exit(1); }
const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0' };
const baixar = (url) => new Promise((res, rej) => https.get(url, { headers: UA }, (r) => (r.statusCode === 200 ? res(r) : rej(new Error(`${url} HTTP ${r.statusCode}`)))).on('error', rej));
const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const FIN = { custeio: 'Custeio', investimento: 'Investimento', comercializacao: 'Comercialização', industrializacao: 'Industrialização' };
const linhasDe = (input) => readline.createInterface({ input: input.pipe(zlib.createGunzip()), crlfDelay: Infinity });

const CAP = 1 << 25;
const keys = new Float64Array(CAP);
const slot = (k) => (Math.imul((k % 2147483647) | 0, 0x9E3779B1) >>> 6) & (CAP - 1);
const put = (k) => { let i = slot(k); while (keys[i] !== 0) { if (keys[i] === k) return false; i = (i + 1) & (CAP - 1); } keys[i] = k; return true; };
const has = (k) => { let i = slot(k); while (keys[i] !== 0) { if (keys[i] === k) return true; i = (i + 1) & (CAP - 1); } return false; };

(async () => {
  const finDe = new Map();
  fs.readFileSync(path.join(dir, 'Empreendimento.csv')).toString('latin1').split(/\r?\n/).slice(1).forEach((l) => {
    const c = l.split(';').map((x) => x.replace(/^"|"$/g, ''));
    const f = FIN[norm(c[3] || '')];
    if (c[0] && f) finDe.set(c[0], f);
  });
  const comMun = new Set(); // chaves com município no complemento (apenas as do período auditado, para poupar memória)
  const todas = [];
  for (let ano = Number(anoIni); ano <= Number(anoFim); ano++) todas.push(ano);

  // 1) carrega o complemento num Set compacto só com as operações emitidas nos anos auditados (passa 2: filtramos pelo ref)
  let primeira = true;
  const compl = new Map(); // ref*1000+ord -> ibge (apenas refs vistos nas operações; preenchido depois)
  // passa A: lê operações e guarda chaves por ano; passa B: complemento marca quem tem município
  const stat = {};
  const vistoAno = new Set();
  for (const ano of todas) {
    const s = stat[ano] = { linhas: 0, dupNoAno: 0, dupEntreAnos: 0, valorTotal: 0, valorNegativoOuNulo: 0, semFinalidade: { linhas: 0, valor: 0 }, mes: {}, finalidade: {}, finMes: {}, uf: {}, safra: {} };
    let input;
    try { input = await baixar(`https://www.bcb.gov.br/htms/sicor/DadosBrutos/SICOR_OPERACAO_BASICA_ESTADO_${ano}.gz`); } catch (e) { console.error('sem arquivo', ano, e.message); delete stat[ano]; continue; }
    primeira = true;
    const vistos = new Set();
    for await (const l of linhasDe(input)) {
      if (primeira) { primeira = false; continue; }
      const c = l.split(';');
      const k = Number(c[0]) * 1000 + Number(c[1]);
      s.linhas++;
      if (vistos.has(k)) s.dupNoAno++; else vistos.add(k);
      if (has(k)) s.dupEntreAnos++;
      const valor = parseFloat(c[27]) || 0;
      if (valor <= 0) s.valorNegativoOuNulo++;
      s.valorTotal += valor;
      const dt = c[3] || '';
      const mes = dt.slice(3, 5), anoE = dt.slice(6, 10);
      const chave = `${anoE}-${mes}`;
      s.mes[chave] = (s.mes[chave] || 0) + valor;
      const safra = Number(mes) >= 7 ? `${anoE}/${Number(anoE) + 1}` : `${Number(anoE) - 1}/${anoE}`;
      s.safra[safra] = (s.safra[safra] || 0) + valor;
      const fin = finDe.get(c[12]);
      if (!fin) { s.semFinalidade.linhas++; s.semFinalidade.valor += valor; }
      const fk = fin || 'sem finalidade';
      const f = s.finalidade[fk] || (s.finalidade[fk] = { valor: 0, linhas: 0, valorComMun: 0, linhasComMun: 0 });
      f.valor += valor; f.linhas++;
      const fm = s.finMes[fk] || (s.finMes[fk] = {});
      fm[chave] = (fm[chave] || 0) + valor;
      const u = s.uf[c[9]] || (s.uf[c[9]] = { valor: 0, valorComMun: 0, linhas: 0, linhasComMun: 0 });
      u.valor += valor; u.linhas++;
      compl.set(k, [fk, c[9], valor]);
    }
    vistos.forEach((k) => put(k));
    console.error('ano', ano, 'linhas', s.linhas, 'dup no ano', s.dupNoAno, 'dup entre anos', s.dupEntreAnos, 'valor R$ bi', (s.valorTotal / 1e9).toFixed(1));
  }
  // passa B: quais dessas operações têm município
  primeira = true;
  const anoDe = new Map();
  for await (const l of linhasDe(fs.createReadStream(path.join(dir, 'SICOR_COMPLEMENTO_OPERACAO_BASICA.gz')))) {
    if (primeira) { primeira = false; continue; }
    const c = l.split(';');
    const k = Number(c[0]) * 1000 + Number(c[1]);
    if (Number(c[4]) && compl.has(k)) comMun.add(k);
  }
  // distribui valores com município por ano (reprocessa em memória: compl guarda [fin, uf, valor])
  // (o ano da operação não foi guardado; usamos a data pela soma por ano já calculada abaixo)
  const porComMun = { fin: {}, uf: {}, valor: 0, valorTotalConsiderado: 0 };
  compl.forEach(([fk, uf, valor], k) => {
    porComMun.valorTotalConsiderado += valor;
    if (comMun.has(k)) {
      porComMun.valor += valor;
      porComMun.fin[fk] = (porComMun.fin[fk] || 0) + valor;
      porComMun.uf[uf] = (porComMun.uf[uf] || 0) + valor;
    }
  });
  const finTotal = {}, ufTotal = {};
  compl.forEach(([fk, uf, valor]) => { finTotal[fk] = (finTotal[fk] || 0) + valor; ufTotal[uf] = (ufTotal[uf] || 0) + valor; });
  fs.writeFileSync(saida, JSON.stringify({ gerado_em: new Date().toISOString(), anos: [anoIni, anoFim], stat, conjunto: { porComMun, finTotal, ufTotal } }));
  console.error('ok');
})().catch((e) => { console.error('ERRO', e.message); process.exit(1); });
