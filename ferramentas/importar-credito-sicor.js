// Crédito rural CONTRATADO por município, ano e finalidade, a partir dos microdados do Sicor (Banco Central).
// Uso: node --max-old-space-size=3000 ferramentas/importar-credito-sicor.js <pasta> <saida.json> [anoInicial] [anoFinal]
//   <pasta> precisa conter SICOR_COMPLEMENTO_OPERACAO_BASICA.gz (município por REF_BACEN+NU_ORDEM);
//   guarda Empreendimento.csv e parciais por ano (retomável). As operações vêm em fluxo direto do servidor do BCB.
// Fonte: https://www.bcb.gov.br/estabilidadefinanceira/tabelas-credito-rural-proagro
//   SICOR_OPERACAO_BASICA_ESTADO_<ano>: DT_EMISSAO, CD_ESTADO, CD_EMPREENDIMENTO, VL_PARC_CREDITO (valor da parcela de crédito)
//   Empreendimento.csv: CODIGO -> FINALIDADE (Custeio, Investimento, Comercialização, Industrialização)
// Valor contratado é FLUXO de crédito; não tem relação direta com o saldo inadimplente (estoque).
// Contrato = REF_BACEN distinto dentro de (município, ano, finalidade).
const fs = require('fs');
const zlib = require('zlib');
const https = require('https');
const readline = require('readline');
const path = require('path');

const [dir, saida, anoIni = '2021', anoFim = String(new Date().getFullYear())] = process.argv.slice(2);
if (!dir || !saida) { console.error('uso: node importar-credito-sicor.js <pasta> <saida.json> [anoInicial] [anoFinal]'); process.exit(1); }

const BCB = 'https://www.bcb.gov.br/htms/sicor';
const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0' };
const baixar = (url) => new Promise((res, rej) => {
  https.get(url, { headers: UA }, (r) => (r.statusCode === 200 ? res(r) : rej(new Error(`${url} HTTP ${r.statusCode}`)))).on('error', rej);
});
const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const FIN = { custeio: 'Custeio', investimento: 'Investimento', comercializacao: 'Comercialização', industrializacao: 'Industrialização' };
const FIN_IDX = { Custeio: 0, Investimento: 1, 'Comercialização': 2, 'Industrialização': 3 };

// Tabela hash aberta REF_BACEN*1000+NU_ORDEM -> código IBGE
const CAP = 1 << 25;
const keys = new Float64Array(CAP);
const vals = new Int32Array(CAP);
const slot = (k) => (Math.imul((k % 2147483647) | 0, 0x9E3779B1) >>> 6) & (CAP - 1);
const put = (k, v) => { let i = slot(k); while (keys[i] !== 0) { if (keys[i] === k) return; i = (i + 1) & (CAP - 1); } keys[i] = k; vals[i] = v; };
const get = (k) => { let i = slot(k); while (keys[i] !== 0) { if (keys[i] === k) return vals[i]; i = (i + 1) & (CAP - 1); } return 0; };
const linhasDe = (input) => readline.createInterface({ input: input.pipe(zlib.createGunzip()), crlfDelay: Infinity });

(async () => {
  // domínio Empreendimento -> finalidade
  const emp = path.join(dir, 'Empreendimento.csv');
  if (!fs.existsSync(emp)) {
    await new Promise((res, rej) => baixar(`${BCB}/Empreendimento.csv`).then((r) => r.pipe(fs.createWriteStream(emp)).on('finish', res).on('error', rej), rej));
  }
  const finDe = new Map();
  fs.readFileSync(emp).toString('latin1').split(/\r?\n/).slice(1).forEach((l) => {
    const c = l.split(';').map((x) => x.replace(/^"|"$/g, ''));
    const f = FIN[norm(c[3] || '')];
    if (c[0] && f) finDe.set(c[0], f);
  });
  console.error('empreendimentos com finalidade:', finDe.size);

  let primeira = true, n = 0;
  for await (const l of linhasDe(fs.createReadStream(path.join(dir, 'SICOR_COMPLEMENTO_OPERACAO_BASICA.gz')))) {
    if (primeira) { primeira = false; continue; }
    const c = l.split(';');
    const ref = Number(c[0]), ord = Number(c[1]), ibge = Number(c[4]);
    if (ref && ibge) { put(ref * 1000 + ord, ibge); n++; }
  }
  console.error('complemento carregado:', n);

  const final = { gerado_em: new Date().toISOString(), anos: {} };
  for (let ano = Number(anoIni); ano <= Number(anoFim); ano++) {
    const parcial = path.join(dir, `credito_${ano}.json`);
    if (fs.existsSync(parcial)) { final.anos[ano] = JSON.parse(fs.readFileSync(parcial, 'utf8')); console.error('parcial reaproveitado:', ano); continue; }
    let input;
    try { input = await baixar(`${BCB}/DadosBrutos/SICOR_OPERACAO_BASICA_ESTADO_${ano}.gz`); } catch (e) { console.error('sem arquivo', ano, e.message); continue; }
    const mun = new Map();          // 'ibge|finalidade' -> [valor, parcelas]
    const contratos = new Map();    // 'ibge|finalidade' -> Set de REF_BACEN
    const semMun = { valor: 0, parcelas: 0 }, comMun = { valor: 0, parcelas: 0 };
    const contSem = new Set(), contCom = new Set();
    let ateMes = 0, linhasN = 0, semFin = 0;
    primeira = true;
    for await (const l of linhasDe(input)) {
      if (primeira) { primeira = false; continue; }
      linhasN++;
      const c = l.split(';');
      const fin = finDe.get(c[12]);
      const valor = parseFloat(c[27]) || 0;
      const mes = Number((c[3] || '').slice(3, 5)) || 0;
      if (mes > ateMes && c[3].slice(6, 10) === String(ano)) ateMes = mes;
      if (!fin) { semFin++; continue; }
      const ref = Number(c[0]);
      const ibge = get(ref * 1000 + Number(c[1]));
      const ck = ref * 4 + FIN_IDX[fin];
      if (!ibge) { semMun.valor += valor; semMun.parcelas++; contSem.add(ck); continue; }
      comMun.valor += valor; comMun.parcelas++; contCom.add(ck);
      const k = `${ibge}|${fin}`;
      let a = mun.get(k);
      if (!a) { a = [0, 0]; mun.set(k, a); contratos.set(k, new Set()); }
      a[0] += valor; a[1]++;
      contratos.get(k).add(ref);
    }
    const res = {
      ate_mes: ateMes, linhas: linhasN, sem_finalidade: semFin,
      cobertura: { valor_com: Math.round(comMun.valor * 100) / 100, valor_sem: Math.round(semMun.valor * 100) / 100, contratos_com: contCom.size, contratos_sem: contSem.size },
      municipios: [...mun].map(([k, a]) => { const [ibge, fin] = k.split('|'); return [ibge, fin, Math.round(a[0] * 100) / 100, contratos.get(k).size]; })
    };
    fs.writeFileSync(parcial, JSON.stringify(res));
    final.anos[ano] = res;
    console.error('ano', ano, 'linhas', linhasN, 'até mês', ateMes, 'valor com município R$', (comMun.valor / 1e9).toFixed(1), 'bi; sem R$', (semMun.valor / 1e9).toFixed(1), 'bi');
  }
  fs.writeFileSync(saida, JSON.stringify(final));
})().catch((e) => { console.error('ERRO', e.message); process.exit(1); });
