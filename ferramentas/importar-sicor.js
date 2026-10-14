// Agrega os microdados públicos do Sicor (Banco Central) por município e mês.
// Uso: node --max-old-space-size=4096 ferramentas/importar-sicor.js <pasta> <saida.json> [anoInicial] [anoFinal]
//   <pasta> guarda o COMPLEMENTO (precisa existir) e os parciais por ano (retomável).
//   Os SALDOS são lidos em fluxo direto do servidor do BCB, sem gravar os arquivos grandes.
// Fonte: https://www.bcb.gov.br/estabilidadefinanceira/tabelas-credito-rural-proagro
//   COMPLEMENTO: (REF_BACEN, NU_ORDEM) -> CD_IBGE_MUNICIPIO
//   SALDOS_<ano> (ano de contratação): (REF_BACEN, NU_ORDEM, ANO_BASE, MES_BASE) -> CD_SITUACAO_OPERACAO, VL_ULTIMO_DIA
// Situação (domínio SituacaoOperacao): 2 = Em atraso, 12 = Inadimplente.
// Carteira ativa = situações 1,2,3,4,5,12 (curso normal, atraso, prorrogada, renegociadas sem substituição, inadimplente).
// Não grava nada de pessoa/devedor: só totais por município/mês.
const fs = require('fs');
const zlib = require('zlib');
const https = require('https');
const readline = require('readline');
const path = require('path');

const [dir, saida, anoIni = '2015', anoFim = String(new Date().getFullYear())] = process.argv.slice(2);
if (!dir || !saida) { console.error('uso: node importar-sicor.js <pasta> <saida.json> [anoInicial] [anoFinal]'); process.exit(1); }

const BASE = 'https://www.bcb.gov.br/htms/sicor/DadosBrutos';
const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0' };
const remoto = (nome) => new Promise((res, rej) => {
  https.get(`${BASE}/${nome}`, { headers: UA }, (r) => (r.statusCode === 200 ? res(r) : rej(new Error(`${nome} HTTP ${r.statusCode}`)))).on('error', rej);
});

// Tabela hash aberta (chave numérica -> código IBGE) para dezenas de milhões de operações
const CAP = 1 << 25; // 33,5 milhões de posições (~400 MB) para ~24 milhões de operações
const keys = new Float64Array(CAP);
const vals = new Int32Array(CAP);
const slot = (k) => (Math.imul((k % 2147483647) | 0, 0x9E3779B1) >>> 6) & (CAP - 1);
const put = (k, v) => {
  let i = slot(k);
  while (keys[i] !== 0) { if (keys[i] === k) return false; i = (i + 1) & (CAP - 1); }
  keys[i] = k; vals[i] = v; return true;
};
const get = (k) => {
  let i = slot(k);
  while (keys[i] !== 0) { if (keys[i] === k) return vals[i]; i = (i + 1) & (CAP - 1); }
  return 0;
};

const linhasDe = (input) => readline.createInterface({ input: input.pipe(zlib.createGunzip()), crlfDelay: Infinity });
const PER_MIN = '2025-01'; // janela publicada no app
const ATIVA = new Set([1, 2, 3, 4, 5, 12]);

(async () => {
  let nComp = 0, dup = 0, primeira = true;
  for await (const l of linhasDe(fs.createReadStream(path.join(dir, 'SICOR_COMPLEMENTO_OPERACAO_BASICA.gz')))) {
    if (primeira) { primeira = false; continue; }
    const c = l.split(';');
    const ref = Number(c[0]), ord = Number(c[1]), ibge = Number(c[4]);
    if (!ref || !ibge) continue;
    nComp++;
    if (!put(ref * 1000 + ord, ibge)) dup++;
  }
  console.error('complemento: operações com município =', nComp, '| chaves repetidas =', dup);

  const agg = new Map(); // 'ibge|periodo' -> [nInad, vInad, nAtr, vAtr, nAtiv, vAtiv]
  const cob = {};        // periodo -> [ativasComMunicipio, ativasSemMunicipio, saldoCom, saldoSem]
  const somar = (p) => {
    p.municipio_mes.forEach(([ibge, per, ...v]) => {
      const key = `${ibge}|${per}`;
      let t = agg.get(key);
      if (!t) { t = [0, 0, 0, 0, 0, 0]; agg.set(key, t); }
      v.forEach((x, i) => { t[i] += x; });
    });
    Object.entries(p.cobertura).forEach(([per, v]) => {
      const t = cob[per] || (cob[per] = [0, 0, 0, 0]);
      v.forEach((x, i) => { t[i] += x; });
    });
  };

  for (let ano = Number(anoIni); ano <= Number(anoFim); ano++) {
    const parcial = path.join(dir, `parcial_${ano}.json`);
    if (fs.existsSync(parcial)) { somar(JSON.parse(fs.readFileSync(parcial, 'utf8'))); console.error('parcial reaproveitado:', ano); continue; }
    const nome = `SICOR_SALDOS_${ano}.gz`;
    const local = path.join(dir, nome);
    let input;
    try { input = fs.existsSync(local) ? fs.createReadStream(local) : await remoto(nome); } catch (e) { console.error('sem arquivo', nome, e.message); continue; }
    const pAgg = new Map(), pCob = {};
    let n = 0;
    primeira = true;
    for await (const l of linhasDe(input)) {
      if (primeira) { primeira = false; continue; }
      if (++n % 20000000 === 0) console.error(nome, 'linhas', n);
      const c = l.split(';');
      const sit = Number(c[7]);
      if (!ATIVA.has(sit)) continue;
      const per = `${Number(c[2])}-${String(Number(c[3])).padStart(2, '0')}`;
      if (per < PER_MIN) continue;
      const saldo = parseFloat(c[5]) || 0;
      const ibge = get(Number(c[0]) * 1000 + Number(c[1]));
      const cb = pCob[per] || (pCob[per] = [0, 0, 0, 0]);
      if (!ibge) { cb[1]++; cb[3] += saldo; continue; }
      cb[0]++; cb[2] += saldo;
      const key = `${ibge}|${per}`;
      let t = pAgg.get(key);
      if (!t) { t = [0, 0, 0, 0, 0, 0]; pAgg.set(key, t); }
      t[4]++; t[5] += saldo;
      if (sit === 12) { t[0]++; t[1] += saldo; } else if (sit === 2) { t[2]++; t[3] += saldo; }
    }
    const p = { cobertura: pCob, municipio_mes: [...pAgg].map(([k, v]) => [...k.split('|'), ...v]) };
    fs.writeFileSync(parcial, JSON.stringify(p));
    somar(p);
    console.error('saldos processado:', nome, 'linhas', n);
  }

  const r2 = (x) => Math.round(x * 100) / 100;
  const out = {
    gerado_em: new Date().toISOString(),
    anos_contratacao: [Number(anoIni), Number(anoFim)],
    cobertura_por_periodo: cob,
    municipio_mes: [...agg].map(([k, a]) => {
      const [ibge, periodo] = k.split('|');
      return { ibge, periodo, n_inad: a[0], saldo_inad: r2(a[1]), n_atraso: a[2], saldo_atraso: r2(a[3]), n_ativas: a[4], saldo_ativo: r2(a[5]) };
    })
  };
  fs.writeFileSync(saida, JSON.stringify(out));
  console.error('linhas município/mês:', out.municipio_mes.length);
})();
