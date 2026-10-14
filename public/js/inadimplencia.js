// Aba "Inadimplência Rural": módulo independente. Só LÊ os agregados comerciais já carregados
// (window.AGRO_DATA / AGRO_COORDS) e carrega seus próprios dados (tabelas inad_*) ao abrir a aba.
// Se algo falhar aqui, as outras três abas não são afetadas.
(() => {
  'use strict';

  const GEO = window.BR_GEO;
  const SB = window.AGRO_SB;
  const DATA = window.AGRO_DATA;
  const COORDS = window.AGRO_COORDS || { pontos: {} };
  const tab = document.querySelector('.modes [data-extra="inadimplencia"]');
  const kpisApp = document.getElementById('kpis');
  if (!GEO || !tab || !kpisApp) return;

  const SVGNS = 'http://www.w3.org/2000/svg';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);
  const nf = new Intl.NumberFormat('pt-BR');
  const dec = (v, d) => v.toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });
  // R$ 1,11 bi · R$ 341 mi · R$ 71,2 mi · R$ 850 mil
  const money = (v) => {
    const n = Number(v) || 0;
    if (n >= 1e9) return `R$ ${dec(n / 1e9, 2)} bi`;
    if (n >= 1e8) return `R$ ${dec(n / 1e6, 0)} mi`;
    if (n >= 1e6) return `R$ ${dec(n / 1e6, 1)} mi`;
    if (n >= 1e3) return `R$ ${dec(n / 1e3, 0)} mil`;
    return `R$ ${dec(n, 0)}`;
  };
  const pct = (v) => (v == null ? '—' : `${dec(v, 2)}%`);
  const norm = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  const mesAno = (iso) => `${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
  const mesExtenso = (iso) => `${MESES[Number(iso.slice(5, 7)) - 1]} de ${iso.slice(0, 4)}`;
  const UF_NOME = (uf) => (DATA && DATA.estados && DATA.estados[uf]) || uf;
  const flag = (uf) => `<img class="flag xs" src="assets/bandeiras/mini/${esc(uf.toLowerCase())}.png" alt="" width="24" height="16" loading="lazy">`;
  const PEQUENA = 1e6; // carteira abaixo disso: taxa pouco representativa

  const st = { carregado: false, carregando: false, uf: null, mun: null, filtro: 'todos', metrica: 'saldo', view: 'estados', escopo: 'nacional' };
  let D = null;
  let root, svg, panel, kpis, legend, tip, vbBase, anterior = null;
  const pinEls = new Map();
  const ufEls = {};

  // ---------- Estrutura da página (criada uma única vez) ----------
  const ICON = {
    estados: '<path d="M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3z"/><path d="M9 3v15M15 6v15"/>',
    municipios: '<path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/>',
    oportunidades: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2"/>'
  };
  const VIEWS = { estados: 'Inadimplência', oportunidades: 'Oportunidades' };

  function montarCasca() {
    root = document.createElement('section');
    root.id = 'inad';
    root.className = 'inad';
    root.hidden = true;
    root.setAttribute('aria-label', 'Inadimplência Rural');
    root.innerHTML = `
      <main class="layout inad-layout">
        <section class="map-card" aria-label="Mapa da inadimplência rural">
          <div class="map-head"><div>
            <h1 id="inadTitulo">Inadimplência rural por estado</h1>
            <p class="muted" id="inadSub">Clique em um estado para ver os detalhes.</p>
          </div></div>
          <div class="views" id="inadViews" role="group" aria-label="Tipo de mapa">${Object.entries(VIEWS).map(([k, t]) =>
            `<button data-view="${k}" aria-pressed="${k === 'estados'}"><svg viewBox="0 0 24 24" aria-hidden="true">${ICON[k]}</svg>${t}</button>`).join('')}</div>
          <p class="inad-aviso" id="inadAviso" hidden></p>
          <div class="map-wrap">
            <svg id="inadMap" role="group" aria-label="Mapa do Brasil: inadimplência rural"></svg>
            <button id="inadVoltar" class="map-back" hidden><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>Voltar ao Brasil</button>
            <div id="inadTip" class="inad-tip" hidden></div>
          </div>
          <div id="inadLegend" class="legend"></div>
        </section>
        <aside id="inadPanel" class="panel" tabindex="-1" aria-live="polite"></aside>
      </main>
      <section id="inadKpis" class="kpis" aria-label="Indicadores de inadimplência rural"></section>
      <footer class="footer inad-footer"><div id="inadFontes" class="fonte"></div></footer>`;
    kpisApp.after(root);
    svg = $('#inadMap', root); panel = $('#inadPanel', root); kpis = $('#inadKpis', root);
    legend = $('#inadLegend', root); tip = $('#inadTip', root);
  }

  // ---------- Carga de dados (própria da aba) ----------
  // Busca todas as linhas (PostgREST devolve no máximo 1000 por requisição). A primeira página traz o total
  // (count exato) e as demais saem em paralelo; sem count, cai para o modo sequencial.
  async function pagina(consulta) {
    const p0 = await consulta().range(0, 999);
    if (p0.error) throw p0.error;
    const out = [...p0.data];
    if (p0.data.length < 1000) return out;
    if (typeof p0.count === 'number') {
      const n = Math.ceil(p0.count / 1000);
      const resto = await Promise.all(Array.from({ length: n - 1 }, (_, i) => consulta().range((i + 1) * 1000, (i + 1) * 1000 + 999)));
      resto.forEach((r) => { if (r.error) throw r.error; out.push(...r.data); });
      return out;
    }
    for (let i = 1000; ; i += 1000) {
      const r = await consulta().range(i, i + 999);
      if (r.error) throw r.error;
      out.push(...r.data);
      if (r.data.length < 1000) break;
    }
    return out;
  }
  const CONT = { count: 'exact' };
  // Etapa 1 (leve): cargas, fontes, série por UF, cobertura. Os municípios vêm na etapa 2 (uma única chamada).
  async function carregarBase() {
    if (!SB) throw new Error('indisponível');
    const [cargas, fontes, ufMes, cob, credCob] = await Promise.all([
      SB.from('inad_cargas').select('*').order('data_base', { ascending: false }),
      SB.from('inad_fontes').select('*'),
      pagina(() => SB.from('inad_uf_mensal').select('uf,periodo,municipios_com_inad,n_inad,saldo_inad,n_atraso,saldo_atraso,n_ativas,saldo_ativo', CONT).order('periodo')),
      pagina(() => SB.from('inad_cobertura_periodo').select('periodo,ops_com_mun,ops_sem_mun,saldo_com_mun,saldo_sem_mun', CONT).order('periodo')),
      pagina(() => SB.from('inad_credito_cobertura').select('*', CONT).order('ano')).catch(() => [])
    ]);
    if (cargas.error || fontes.error) throw cargas.error || fontes.error;
    const carga = cargas.data.find((c) => c.fonte_id === 'bcb_sicor' && /^sicor_saldos_/.test(c.id));
    if (!carga) return { vazio: true, fontes: fontes.data };
    return { carga, cargas: cargas.data, fontes: fontes.data, ufMes, cob, base: carga.data_base, credCob };
  }
  // Municípios do período numa só consulta (função inad_painel). Se ela não existir, volta ao modo paginado.
  async function carregarPainel(periodo) {
    try {
      const r = await SB.rpc('inad_painel', periodo ? { p_periodo: periodo } : {});
      if (r.error || !r.data || !Array.isArray(r.data.linhas)) throw r.error || new Error('rpc');
      const ix = Object.fromEntries(r.data.campos.map((n, i) => [n, i]));
      const municipios = [], atual = [], perfil = [];
      r.data.linhas.forEach((l) => {
        const g = (n) => l[ix[n]];
        municipios.push({ cod_ibge: g('cod'), uf: g('uf'), nome: g('nome'), x: g('x'), y: g('y') });
        if (g('reg')) atual.push({ cod_ibge: g('cod'), n_inad: g('n_inad'), saldo_inad: g('saldo_inad'), n_atraso: g('n_atraso'), saldo_atraso: g('saldo_atraso'), n_ativas: g('n_ativas'), saldo_ativo: g('saldo_ativo') });
        perfil.push({
          cod_ibge: g('cod'), producao_valor_mil: g('prod_mil'), area_colhida_ha: g('area_colhida'), principal_cultura: g('cultura'),
          principal_cultura_valor_mil: g('cultura_mil'), bovinos: g('bovinos'), agro_ano: g('agro_ano'),
          credito_valor: g('cred'), credito_contratos: g('cred_contratos'), credito_ano: g('cred_ano')
        });
      });
      return { municipios, atual, perfil, periodo: String(r.data.periodo).slice(0, 10) };
    } catch (e) {
      return carregarPainelPaginado(periodo);
    }
  }
  async function carregarPainelPaginado(periodo) {
    let p = periodo;
    if (!p) {
      const u = await SB.from('inad_municipio_mensal').select('periodo').order('periodo', { ascending: false }).limit(1);
      p = u.data && u.data[0] ? String(u.data[0].periodo).slice(0, 10) : null;
    }
    const [municipios, atual, perfil] = await Promise.all([
      pagina(() => SB.from('inad_municipios').select('cod_ibge,uf,nome,x,y', CONT).order('cod_ibge')),
      pagina(() => SB.from('inad_municipio_mensal').select('cod_ibge,n_inad,saldo_inad,n_atraso,saldo_atraso,n_ativas,saldo_ativo', CONT).eq('periodo', p).order('cod_ibge')),
      pagina(() => SB.from('inad_perfil_municipio').select('*', CONT).order('cod_ibge')).catch(() => [])
    ]);
    return { municipios, atual, perfil, periodo: p };
  }

  // ---------- Presença comercial AgroEasy (somente leitura) ----------
  function presencaPorCod(municipios) {
    const porNome = new Map();
    municipios.forEach((m) => porNome.set(`${m.uf}|${norm(m.nome)}`, m.cod_ibge));
    const out = new Map();
    let semPareamento = 0;
    const slot = (uf, nome) => {
      const c = COORDS.pontos && COORDS.pontos[`${uf}|${nome}`];
      return (c && c[4]) || porNome.get(`${uf}|${norm(nome)}`) || null;
    };
    const get = (cod) => out.get(cod) || (out.set(cod, { leads: 0, clientes: 0, pAtivos: 0, pInativos: 0 }), out.get(cod));
    const ufsCarregadas = new Set(municipios.map((m) => m.uf));
    ['leads', 'clientes'].forEach((cat) => {
      Object.entries((DATA[cat] && DATA[cat].porEstado) || {}).forEach(([uf, r]) => {
        if (!ufsCarregadas.has(uf)) return;
        (r.municipios || []).forEach(([nome, n]) => {
          const cod = slot(uf, nome);
          if (cod) get(cod)[cat] += n; else semPareamento += n;
        });
      });
    });
    Object.entries((DATA.parceiros && DATA.parceiros.porEstado) || {}).forEach(([uf, r]) => {
      if (!ufsCarregadas.has(uf)) return;
      (r.pessoas || []).forEach(([, nome, status]) => {
        const cod = slot(uf, nome);
        if (!cod) { semPareamento += 1; return; }
        get(cod)[status === 'Ativo' ? 'pAtivos' : 'pInativos']++;
      });
    });
    return { map: out, semPareamento };
  }
  const semPresenca = (p) => !p || !(p.leads || p.clientes || p.pAtivos);
  const classe = (p) => (!semPresenca(p) ? 'com' : (p && p.pInativos ? 'inativo' : 'sem'));
  const FILTROS = {
    todos: { t: 'Todos', f: () => true },
    sem: { t: 'Sem presença', f: (m) => semPresenca(m.pres) },
    semcli: { t: 'Sem clientes', f: (m) => !(m.pres && m.pres.clientes) },
    com: { t: 'Com presença', f: (m) => !!m.pres && (m.pres.leads + m.pres.clientes + m.pres.pAtivos + m.pres.pInativos) > 0 }
  };

  // ---------- Modelo derivado ----------
  function modelar(raw) {
    const { map: pres, semPareamento } = presencaPorCod(raw.municipios);
    const atual = new Map(raw.atual.map((r) => [r.cod_ibge, r]));
    const perfil = new Map((raw.perfil || []).map((r) => [r.cod_ibge, r]));
    const n = (v) => (v == null ? null : Number(v));
    const muns = raw.municipios.map((m) => {
      const a = atual.get(m.cod_ibge);
      const p = perfil.get(m.cod_ibge) || {};
      const carteira = a ? Number(a.saldo_ativo) : 0;
      return {
        cod: m.cod_ibge, uf: m.uf, nome: m.nome, x: m.x, y: m.y, pres: pres.get(m.cod_ibge) || null, semRegistro: !a,
        saldoInad: a ? Number(a.saldo_inad) : 0, nInad: a ? a.n_inad : 0,
        saldoAtraso: a ? Number(a.saldo_atraso) : 0, nAtraso: a ? a.n_atraso : 0,
        carteira, nAtivas: a ? a.n_ativas : 0,
        taxa: carteira > 0 ? (Number(a.saldo_inad) / carteira) * 100 : null,
        producao: n(p.producao_valor_mil) == null ? null : Number(p.producao_valor_mil) * 1000, // R$
        areaColhida: n(p.area_colhida_ha), principalCultura: p.principal_cultura || null,
        principalCulturaValor: n(p.principal_cultura_valor_mil) == null ? null : Number(p.principal_cultura_valor_mil) * 1000,
        bovinos: n(p.bovinos), agroAno: p.agro_ano || null,
        credito: n(p.credito_valor), creditoContratos: n(p.credito_contratos), creditoAno: p.credito_ano || null
      };
    });
    const ufs = {};
    raw.ufMes.forEach((r) => { (ufs[r.uf] || (ufs[r.uf] = [])).push(r); });
    const ufAtual = {};
    Object.entries(ufs).forEach(([uf, serie]) => {
      const u = serie.find((x) => String(x.periodo).slice(0, 7) === raw.base.slice(0, 7));
      if (u) ufAtual[uf] = {
        saldoInad: Number(u.saldo_inad), nInad: Number(u.n_inad), saldoAtraso: Number(u.saldo_atraso), nAtraso: Number(u.n_atraso),
        carteira: Number(u.saldo_ativo), nAtivas: Number(u.n_ativas), munsComInad: Number(u.municipios_com_inad),
        taxa: Number(u.saldo_ativo) > 0 ? (Number(u.saldo_inad) / Number(u.saldo_ativo)) * 100 : null
      };
    });
    return { ...raw, muns, ufs, ufAtual, semPareamento, porCod: new Map(muns.map((m) => [m.cod, m])) };
  }

  // ---------- Mapa (mesmas classes e escala do mapa das outras abas) ----------
  const LABEL_POS = {
    GO: { p: [566, 548] }, DF: { p: [676, 486], out: true }, ES: { p: [884, 626], out: true }, RJ: { p: [800, 714], out: true },
    SE: { p: [962, 404], out: true }, AL: { p: [990, 370], out: true }, PE: { p: [1012, 334], out: true },
    PB: { p: [1016, 300], out: true }, RN: { p: [1004, 262], out: true }, SC: { p: [572, 806] }
  };
  const PIN_D = 'M0-5.4C-3-5.4-5.6-3.1-5.6-.2c0 3.8 5.6 10.2 5.6 10.2S5.6 3.6 5.6-.2C5.6-3.2 3-5.4 0-5.4Z';
  const labels = {};
  const pinGs = [];
  const munCarregando = {};
  let vb = [0, 0, 1, 1], gMun, gMunLbl, gSel, selParts, munAtual = null, munLbls = [], anim = 0;

  function el(tag, attrs, parent) {
    const n = document.createElementNS(SVGNS, tag);
    Object.entries(attrs || {}).forEach(([k, v]) => n.setAttribute(k, v));
    if (parent) parent.appendChild(n);
    return n;
  }
  const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
  const rampa = (t) => { const c = mix([0x4A, 0x4B, 0x4B], [0xCB, 0xA1, 0x6C], Math.max(0, Math.min(1, t))); return `rgb(${c[0]},${c[1]},${c[2]})`; };
  const flagGrande = (uf) => `assets/bandeiras/${uf.toLowerCase()}.png`;

  function desenharMapa() {
    while (svg.firstChild) svg.firstChild.remove();
    vbBase = [-10, -10, GEO.w + 80, GEO.h + 20];
    vb = vbBase.slice();
    svg.setAttribute('viewBox', vb.join(' '));
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    const defs = el('defs', {}, svg);
    const clip = el('clipPath', { id: 'inadSelClip' }, defs);
    const gStates = el('g', { class: 'states' }, svg);
    gMun = el('g', { class: 'mun-layer' }, svg);
    gSel = el('g', { class: 'sel-layer', 'aria-hidden': 'true' }, svg);
    selParts = {
      clip: el('path', {}, clip),
      img: el('image', { 'clip-path': 'url(#inadSelClip)', preserveAspectRatio: 'xMidYMid slice' }, gSel),
      shade: el('path', { class: 'sel-shade' }, gSel),
      outline: el('path', { class: 'sel-outline' }, gSel)
    };
    const gLines = el('g', { class: 'lines' }, svg);
    const gLabels = el('g', { class: 'labels' }, svg);
    const gPins = el('g', { class: 'pins' }, svg);

    const max = Math.max(0.0001, ...Object.values(D.ufAtual).map((u) => u.taxa || 0));
    GEO.states.forEach((s) => {
      const u = D.ufAtual[s.uf];
      const p = el('path', { d: s.d, class: `uf${u ? '' : ' is-empty'}`, 'data-uf': s.uf, tabindex: u ? 0 : -1, role: 'button' }, gStates);
      p.setAttribute('aria-label', u ? `${UF_NOME(s.uf)}: taxa de inadimplência ${pct(u.taxa)}` : `${UF_NOME(s.uf)}: ainda sem dados`);
      p.style.fill = u ? rampa(Math.sqrt((u.taxa || 0) / max)) : '#3E3F3F';
      ufEls[s.uf] = p;
      const conf = LABEL_POS[s.uf] || {};
      const [x, y] = conf.p || s.c;
      if (conf.out) el('line', { class: 'lbl-line', x1: s.c[0], y1: s.c[1], x2: x - 10, y2: y }, gLines);
      const g = el('g', { class: `lbl${conf.out ? ' outside' : ''}${u ? ' has-data' : ' is-empty'}`, transform: `translate(${x},${y})` }, gLabels);
      const inner = el('g', { class: 'lbl-inner' }, g);
      el('rect', { class: 'lbl-bg', x: -14, y: -10, width: 28, height: 20, rx: 6 }, inner);
      el('text', { class: 'lbl-uf', x: 0, y: 0 }, inner).textContent = s.uf;
      const badge = el('g', { class: 'badge', transform: 'translate(0,20)' }, inner);
      if (u) {
        const t = `${dec(u.taxa, 1)}%`;
        const w = t.length * 8 + 14;
        el('rect', { x: -w / 2, y: -10, width: w, height: 20, rx: 10 }, badge);
        el('text', { x: 0, y: 0 }, badge).textContent = t;
      }
      labels[s.uf] = { g, inner };
    });
    gMunLbl = el('g', { class: 'mun-labels', 'aria-hidden': 'true' }, svg);

    const maxS = Math.max(1, ...D.muns.map((m) => m.saldoInad));
    D.muns.filter((m) => m.saldoInad > 0).sort((a, b) => a.saldoInad - b.saldoInad).forEach((m) => {
      const g = el('g', { class: 'pin', 'data-cod': m.cod }, gPins);
      const k = el('g', { class: `pin-kind k-${classe(m.pres)}` }, g);
      el('path', { class: 'pin-marker', d: PIN_D }, k);
      el('circle', { class: 'pin-core', cx: 0, cy: -0.9, r: 1.35 }, k);
      pinEls.set(m.cod, g);
      pinGs.push({ m, g, f: 0.75 + Math.sqrt(m.saldoInad / maxS) * 0.9 });
    });
    svg.appendChild(gPins);
    scaleLabels();
  }
  let pinsPs = 1, pinsSujos = false;
  function redesenharMapa() {
    cancelAnimationFrame(anim);
    while (svg.firstChild) svg.firstChild.remove();
    pinEls.clear();
    pinGs.length = 0;
    Object.keys(labels).forEach((k) => delete labels[k]);
    Object.keys(ufEls).forEach((k) => delete ufEls[k]);
    munAtual = null; munLbls = [];
    ufAnterior = undefined;
    desenharMapa();
  }
  function atualizarPinos() {
    pinGs.forEach(({ m, g, f }) => g.setAttribute('transform', `translate(${m.x},${m.y}) scale(${(pinsPs * f).toFixed(3)})`));
  }
  function scaleLabels() {
    const z = vbBase[2] / vb[2];
    const narrow = Math.min(2, Math.max(1, 640 / (svg.clientWidth || 640)));
    const s = Math.pow(narrow, 0.8) / Math.pow(z, 0.75);
    Object.values(labels).forEach((l) => l.inner.setAttribute('transform', `scale(${s.toFixed(3)})`));
    const ps = Math.pow(narrow, 0.6) / Math.pow(z, 0.85);
    pinsPs = ps;
    if (svg.classList.contains('pins-on') || pinsSujos) { pinsSujos = false; atualizarPinos(); } else pinsSujos = true;
    const px = Math.min((svg.clientWidth || 600) / vb[2], (svg.clientHeight || 600) / vb[3]);
    munLbls.forEach(({ x, y, g }) => g.setAttribute('transform', `translate(${x},${y}) scale(${(1 / px).toFixed(4)})`));
  }
  function zoomTo(alvo) {
    cancelAnimationFrame(anim);
    svg.classList.add('zooming');
    const de = vb.slice(), t0 = performance.now(), dur = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 420;
    const passo = (agora) => {
      const t = dur ? Math.max(0, Math.min(1, (agora - t0) / dur)) : 1, e = 1 - Math.pow(1 - t, 3);
      vb = de.map((v, i) => v + (alvo[i] - v) * e);
      svg.setAttribute('viewBox', vb.map((v) => v.toFixed(2)).join(' '));
      scaleLabels();
      if (t < 1) anim = requestAnimationFrame(passo); else { svg.classList.remove('zooming'); evitarSobreposicao(); }
    };
    anim = requestAnimationFrame(passo);
  }
  function zoomUF(uf) {
    const b = ufEls[uf].getBBox();
    const aspect = vbBase[3] / vbBase[2];
    const w = Math.max(b.width * 1.1, (b.height * 1.1) / aspect, 16);
    const h = w * aspect;
    zoomTo([b.x + b.width / 2 - w / 2, b.y + b.height / 2 - h / 2, w, h]);
  }

  // Contornos oficiais dos municípios do estado (carregados sob demanda, como nas outras abas)
  // Geometria complementar (municípios criados depois da malha base): só desta aba, sem mexer em window.AGRO_MUN
  let extrasP = null;
  function carregarExtras() {
    if (window.AGRO_MUN_EXTRA) return Promise.resolve(window.AGRO_MUN_EXTRA);
    if (!extrasP) {
      extrasP = new Promise((res) => {
        const sc = document.createElement('script');
        sc.src = 'assets/inad/municipios-extra.js';
        sc.async = true;
        sc.onload = () => res(window.AGRO_MUN_EXTRA || {});
        sc.onerror = () => res({});
        document.head.appendChild(sc);
      });
    }
    return extrasP;
  }
  async function carregarMunicipios(uf) {
    const base = await carregarMunicipiosBase(uf);
    const ex = (await carregarExtras())[uf];
    if (!base || !ex || !ex.length) return base;
    const tem = new Set(base.map((m) => m[0]));
    return base.concat(ex.filter((m) => !tem.has(m[0])));
  }
  function carregarMunicipiosBase(uf) {
    if (window.AGRO_MUN && window.AGRO_MUN[uf]) return Promise.resolve(window.AGRO_MUN[uf]);
    if (!munCarregando[uf]) {
      munCarregando[uf] = new Promise((res) => {
        const sc = document.createElement('script');
        sc.src = `assets/municipios/${uf.toLowerCase()}.js`;
        sc.async = true;
        sc.onload = () => res((window.AGRO_MUN && window.AGRO_MUN[uf]) || null);
        sc.onerror = () => { delete munCarregando[uf]; res(null); };
        document.head.appendChild(sc);
      });
    }
    return munCarregando[uf];
  }
  function limparMunicipios() {
    while (gMun.firstChild) gMun.firstChild.remove();
    while (gMunLbl.firstChild) gMunLbl.firstChild.remove();
    munLbls = [];
    munAtual = null;
    svg.classList.remove('mun-on');
  }
  function mostrarMunicipios(uf) {
    limparMunicipios();
    if (!uf) return;
    carregarMunicipios(uf).then((lista) => {
      if (!lista || st.uf !== uf) return;
      munAtual = { uf, lista, els: {} };
      const frag = document.createDocumentFragment();
      lista.forEach(([cod, , d]) => {
        const p = el('path', { d, class: 'mun', 'data-cod': cod });
        frag.appendChild(p);
        munAtual.els[cod] = p;
      });
      gMun.appendChild(frag);
      pintarMunicipios();
      svg.classList.add('mun-on');
    });
  }
  function pintarMunicipios() {
    if (!munAtual) return;
    while (gMunLbl.firstChild) gMunLbl.firstChild.remove();
    munLbls = [];
    const doUF = D.muns.filter((m) => m.uf === munAtual.uf && pinVisivel(m));
    const max = Math.max(1, ...doUF.map((m) => m.saldoInad));
    const cor = st.view === 'estados';
    munAtual.lista.forEach(([cod, nomeM, , cx, cy]) => {
      const m = D.porCod.get(cod);
      const p = munAtual.els[cod];
      const tem = !!m && m.saldoInad > 0 && pinVisivel(m);
      p.style.fill = !tem ? '#3F403C' : (cor ? rampa(Math.sqrt(m.saldoInad / max)) : '#4A4A44');
      p.classList.toggle('tem', tem);
      p.classList.toggle('sel', cod === st.mun);
    });
    if (cor) {
      // nomes dos municípios com maior saldo (como os nomes das cidades nas outras abas)
      doUF.filter((m) => m.saldoInad > 0).sort((a, b) => b.saldoInad - a.saldoInad).slice(0, 6).forEach((m) => {
        const item = munAtual.lista.find((x) => x[0] === m.cod);
        if (!item) return;
        const g = el('g', { class: 'mun-lbl' }, gMunLbl);
        el('text', { class: 'ml-nome', x: 0, y: -2 }, g).textContent = m.nome;
        el('text', { class: 'ml-num', x: 0, y: 11 }, g).textContent = money(m.saldoInad);
        munLbls.push({ x: item[3], y: item[4], g, n: m.saldoInad, nome: m.nome });
      });
    }
    scaleLabels();
    evitarSobreposicao();
  }
  function evitarSobreposicao() {
    const px = Math.min((svg.clientWidth || 600) / vb[2], (svg.clientHeight || 600) / vb[3]);
    const caixas = [];
    [...munLbls].sort((a, b) => b.n - a.n).forEach((l) => {
      const w = (l.nome.length * 6.4 + 8) / px, h = 28 / px;
      const c = { x0: l.x - w / 2, x1: l.x + w / 2, y0: l.y - h * 0.6, y1: l.y + h * 0.4 };
      const bate = caixas.some((o) => c.x0 < o.x1 && c.x1 > o.x0 && c.y0 < o.y1 && c.y1 > o.y0);
      l.g.classList.toggle('oculto', bate);
      if (!bate) caixas.push(c);
    });
  }
  function camadaSelecionada() {
    gSel.classList.remove('on');
    if (!st.uf) return;
    const p = ufEls[st.uf], b = p.getBBox(), d = p.getAttribute('d');
    [selParts.clip, selParts.shade, selParts.outline].forEach((n) => n.setAttribute('d', d));
    selParts.img.setAttribute('href', flagGrande(st.uf));
    selParts.img.setAttribute('x', b.x); selParts.img.setAttribute('y', b.y);
    selParts.img.setAttribute('width', b.width); selParts.img.setAttribute('height', b.height);
    gSel.classList.add('on');
  }
  const pinVisivel = (m) => {
    if (st.uf && m.uf !== st.uf) return false;
    if (st.view === 'oportunidades') return semPresenca(m.pres);
    return FILTROS[st.filtro].f(m);
  };
  let ufAnterior;
  function aplicarSelecao() {
    Object.entries(ufEls).forEach(([uf, p]) => {
      const on = st.uf === uf;
      p.classList.toggle('is-selected', on);
      p.setAttribute('aria-pressed', String(on));
      labels[uf].g.classList.toggle('is-selected', on);
    });
    svg.classList.toggle('has-selection', !!st.uf);
    svg.classList.toggle('pins-on', st.view !== 'estados');
    if (st.view !== 'estados' && pinsSujos) { pinsSujos = false; atualizarPinos(); }
    pinEls.forEach((g, cod) => {
      const m = D.porCod.get(cod);
      g.classList.toggle('off', !pinVisivel(m));
      g.classList.toggle('hl', cod === st.mun);
    });
    if (st.uf !== ufAnterior) {
      ufAnterior = st.uf;
      camadaSelecionada();
      if (st.uf) zoomUF(st.uf); else zoomTo(vbBase.slice());
      mostrarMunicipios(st.uf);
    } else pintarMunicipios();
    $('#inadVoltar', root).hidden = !st.uf;
    $$('#inadViews button', root).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === st.view)));
    $('#inadTitulo', root).textContent = st.uf ? `${UF_NOME(st.uf)}` : { estados: 'Inadimplência rural por estado', oportunidades: 'Oportunidades comerciais' }[st.view];
    $('#inadSub', root).textContent = st.uf ? 'Clique em um município para ver os detalhes.' : (st.view === 'estados' ? 'Clique em um estado para ver os detalhes.' : 'Cada pino é um município sem presença AgroEasy.');
    renderLegenda();
  }
  function renderLegenda() {
    const pinos = st.view !== 'estados';
    legend.innerHTML = pinos
      ? `<span class="sw"><i class="inad-sw sem"></i>Sem presença AgroEasy</span><span class="muted">Tamanho do pino = saldo inadimplente</span>`
      : `<span class="scale">Menos <span class="ramp ramp-inad"></span> Mais</span><span class="sw"><i class="inad-sw nd"></i>Sem dados ainda</span>
         <span class="muted">Número no estado = taxa de inadimplência</span>`;
  }

  // ---------- Painel: 3 níveis (visão geral → estado/município → detalhes opcionais) ----------
  const MES_ABR = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  const mesCurto = (iso) => `${MES_ABR[Number(String(iso).slice(5, 7)) - 1]}/${String(iso).slice(0, 4)}`;
  const filtroAtivo = () => (st.view === 'oportunidades' ? 'sem' : st.filtro);
  const UFS_TODAS = 27;
  const ufsCarregadas = () => Object.keys(D.ufAtual).sort();
  const escopo = () => (ufsCarregadas().length >= UFS_TODAS ? 'Brasil' : ufsCarregadas().join(', '));
  const SEM_PRES = 'Sem presença registrada na base AgroEasy.';
  const kpi = (l, v, s) => `<div class="kpi"><div class="k-lbl">${esc(l)}</div><div class="k-val">${esc(v)}</div><div class="k-sub">${esc(s)}</div></div>`;
  const selo = (t) => `<span class="inad-tag ${t}">${t === 'comprovada' ? 'Inadimplência registrada' : 'Potencial comercial'}</span>`;
  const aberto = (summary, lazy, extra = '') => `<details class="inad-mais" data-lazy="${lazy}" ${extra}><summary>${esc(summary)}</summary><div class="inad-lazy"><p class="table-note">Carregando…</p></div></details>`;

  function evolucao(serie, chave, titulo, rotulo = (p) => mesAno(String(p).slice(0, 10))) {
    if (!serie || !serie.length) return '';
    const ord = [...serie].sort((x, y) => (String(x.periodo) < String(y.periodo) ? -1 : 1));
    const max = Math.max(...ord.map((r) => Number(r[chave])), 0.0001);
    const linhas = ord.map((r) =>
      `<div class="inad-evo-row"><span>${esc(rotulo(r.periodo))}</span><i class="bar"><b data-w="${(Number(r[chave]) / max * 100).toFixed(1)}"></b></i><em>${esc(money(r[chave]))}</em></div>`).join('');
    return `<div class="inad-evo">${linhas}</div>`;
  }
  const tagPres = (p) => {
    const c = classe(p);
    return `<span class="inad-tag ${c}">${{ com: 'Com presença', inativo: 'Só parceiro inativo', sem: 'Sem presença AgroEasy' }[c]}</span>`;
  };
  const presResumo = (p) => {
    if (!p) return 'Sem presença AgroEasy';
    const o = [];
    if (p.clientes) o.push(`${p.clientes} cliente${p.clientes > 1 ? 's' : ''}`);
    if (p.leads) o.push(`${p.leads} lead${p.leads > 1 ? 's' : ''}`);
    if (p.pAtivos) o.push(`${p.pAtivos} parceiro${p.pAtivos > 1 ? 's' : ''} ativo${p.pAtivos > 1 ? 's' : ''}`);
    return o.length ? o.join(', ') : 'Sem presença AgroEasy';
  };
  const motivo = (m) => (semPresenca(m.pres) ? (m.pres && m.pres.pInativos ? `${SEM_PRES} (há parceiro inativo)` : SEM_PRES) : `Presença: ${presResumo(m.pres)}`);

  // ----- justificativas determinísticas (sem IA): usam só os indicadores já carregados -----
  // Nível relativo = posição do município entre TODOS os municípios do país com o indicador (>0 / presente).
  function distribuicoes() {
    if (D.dist) return D.dist;
    const ord = (get) => D.muns.map(get).filter((v) => v != null && v > 0).sort((a, b) => a - b);
    const porUF = {};
    D.muns.forEach((m) => { if (m.saldoInad > 0) (porUF[m.uf] || (porUF[m.uf] = [])).push(m.saldoInad); });
    Object.values(porUF).forEach((a) => a.sort((x, y) => x - y));
    D.dist = { saldo: ord((m) => m.saldoInad), saldoUF: porUF, prod: ord((m) => m.producao), cred: ord((m) => m.credito) };
    return D.dist;
  }
  function nivel(v, arr) {
    if (v == null || !arr.length) return null;
    let lo = 0, hi = arr.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (arr[mid] < v) lo = mid + 1; else hi = mid; }
    const p = lo / arr.length;
    return p >= 0.75 ? 'alto' : p >= 0.4 ? 'medio' : 'baixo';
  }
  // saldo comparado dentro da UF (mesma base da pontuação); UF com poucos municípios usa o país
  function nivelSaldo(m, d) {
    const a = d.saldoUF[m.uf];
    return nivel(m.saldoInad, a && a.length >= MIN_UF ? a : d.saldo);
  }
  const TXT = {
    saldo: { alto: 'inadimplência observada elevada no estado', medio: 'inadimplência observada', baixo: 'inadimplência observada baixa' },
    prod: { alto: 'atividade agropecuária relevante', medio: 'atividade agropecuária moderada', baixo: 'atividade agropecuária menor' },
    cred: { alto: 'volume expressivo de crédito rural', medio: 'volume moderado de crédito rural', baixo: 'volume menor de crédito rural' }
  };
  // Frase de uma linha para as listas
  function motivoCurto(m) {
    const d = distribuicoes();
    const p = [];
    const n = nivel(m.producao, d.prod), c = nivel(m.credito, d.cred), s = nivelSaldo(m, d);
    if (s === 'alto') p.push('inadimplência elevada no estado');
    if (n === 'alto') p.push('produção relevante');
    if (c === 'alto') p.push('crédito expressivo');
    if (!p.length) p.push(s ? 'inadimplência observada' : 'sem inadimplência registrada');
    return p.join(', ');
  }
  // Justificativa comercial do município (até 2 frases, linguagem simples)
  function justificativa(m) {
    const d = distribuicoes();
    const s = m.saldoInad > 0 ? nivelSaldo(m, d) : null;
    const n = nivel(m.producao, d.prod), c = nivel(m.credito, d.cred);
    const partes = [];
    if (n) partes.push(TXT.prod[n]);
    if (c) partes.push(TXT.cred[c]);
    if (s) partes.push(TXT.saldo[s]);
    const sem = semPresenca(m.pres);
    let fim;
    if (sem) fim = m.pres && m.pres.pInativos ? 'sem presença AgroEasy ativa registrada (há parceiro inativo)' : 'ausência de presença comercial registrada';
    else fim = `há presença AgroEasy registrada (${presResumo(m.pres)})`;
    if (!s) return `Município sem inadimplência registrada no período; ${fim}.`;
    const lista = partes.length === 1 ? partes[0] : partes.slice(0, -1).join(', ') + ' e ' + partes[partes.length - 1];
    const base = `Município com ${lista}; ${fim}.`;
    const pos = posicaoNacional(m);
    const topo = !pos.fora && pos.pos <= Math.ceil(pos.total * 0.25);
    return `${topo ? 'Oportunidade comercial: município' : 'Município'} com ${lista}; ${fim}.`;
  }

  // Itens das listas: posição à esquerda, saldo à direita, contexto curto
  function item(m, pos, modo) {
    const pequena = m.carteira > 0 && m.carteira < PEQUENA ? ' · carteira pequena' : '';
    const sub = modo === 'op'
      ? motivoCurto(m)
      : `Taxa ${pct(m.taxa)}${pequena} · ${semPresenca(m.pres) ? 'Sem presença AgroEasy' : presResumo(m.pres)}`;
    return `<li><button type="button" class="inad-it" data-cod="${esc(m.cod)}">
      <span class="inad-rk">${pos}</span>
      <span class="inad-nm"><b>${esc(m.nome)}</b> <span class="muted">${esc(m.uf)}</span><small>${esc(sub.charAt(0).toUpperCase() + sub.slice(1))}</small></span>
      <span class="inad-vl"><b>${esc(money(m.saldoInad))}</b><small>inadimplentes</small></span></button></li>`;
  }
  function lista(arr, vazio, modo, topo = 3) {
    if (!arr.length) return `<p class="table-note">${esc(vazio)}</p>`;
    const a = arr.slice(0, topo), resto = arr.slice(topo);
    return `<ol class="inad-list">${a.map((m, i) => item(m, i + 1, modo)).join('')}</ol>` +
      (resto.length ? `<details class="inad-mais"><summary>Ver os próximos ${resto.length}</summary><ol class="inad-list" start="${topo + 1}">${resto.map((m, i) => item(m, i + topo + 1, modo)).join('')}</ol></details>` : '');
  }

  // ----- ranking -----
  const baseMuns = () => D.muns.filter((m) => (!st.uf || m.uf === st.uf) && FILTROS[filtroAtivo()].f(m));
  const rankObservado = () => baseMuns().filter((m) => m.saldoInad > 0).sort((a, b) => b.saldoInad - a.saldoInad).slice(0, 10);
  // Pontuação (0-100) = média dos percentis de até 3 indicadores entre os elegíveis; ausente nunca vira zero.
  // Elegível = sem presença registrada + saldo inadimplente > 0 + carteira ativa >= R$ 1 mi.
  // Escopos com os mesmos critérios e pesos: nacional (todos os elegíveis do país) e estadual (só os da UF).
  // Percentil (0-100) de cada município em `grupo` para o indicador `get`; empates recebem a posição média.
  function percentis(grupo, get) {
    const com = grupo.filter((m) => get(m) != null).sort((a, b) => get(a) - get(b));
    const out = new Map();
    let i = 0;
    while (i < com.length) {
      let j = i;
      while (j + 1 < com.length && get(com[j + 1]) === get(com[i])) j++;
      const pc = com.length > 1 ? (((i + j) / 2) / (com.length - 1)) * 100 : 100;
      for (let k = i; k <= j; k++) out.set(com[k].cod, pc);
      i = j + 1;
    }
    return out;
  }
  // Piso de municípios elegíveis na UF para comparar o saldo dentro dela; abaixo disso usa o percentil do universo todo.
  const MIN_UF = 10;
  // saldoPorUF = true (pontuação nacional): o saldo é comparado dentro de cada UF (cobertura de município parecida),
  // enquanto produção e crédito são comparados no país. Na pontuação estadual o universo já é a UF.
  function pontuar(conjunto, chave, saldoPorUF = false) {
    const pSaldo = percentis(conjunto, (m) => m.saldoInad);
    if (saldoPorUF) {
      const porUF = new Map();
      conjunto.forEach((m) => { (porUF.get(m.uf) || porUF.set(m.uf, []).get(m.uf)).push(m); });
      porUF.forEach((grupo) => {
        if (grupo.length < MIN_UF) return; // UF pequena: mantém o percentil do universo
        percentis(grupo, (m) => m.saldoInad).forEach((v, k) => pSaldo.set(k, v));
      });
    }
    const pProd = percentis(conjunto, (m) => m.producao);
    const pCred = percentis(conjunto, (m) => m.credito);
    conjunto.forEach((m) => {
      const p = [pSaldo.get(m.cod), pProd.get(m.cod), pCred.get(m.cod)].filter((x) => x != null);
      m[chave + 'Crit'] = p.length;
      m[chave] = p.length >= 2 ? p.reduce((a, b) => a + b, 0) / p.length : null; // exige saldo + ao menos 1 outro critério
    });
  }
  let nacionalPronto = false;
  const porScore = (k) => (a, b) => (b[k] ?? -1) - (a[k] ?? -1) || b.saldoInad - a.saldoInad;
  const elegiveisPais = () => D.muns.filter((m) => semPresenca(m.pres) && m.saldoInad > 0 && m.carteira >= PEQUENA);
  function garantirNacional() {
    if (nacionalPronto) return;
    const todos = elegiveisPais();
    pontuar(todos, 'nac', true);
    D.ordemNac = [...todos].sort(porScore('nac'));
    nacionalPronto = true;
  }
  function rankOportunidades() {
    garantirNacional();
    const lista = st.uf ? D.ordemNac.filter((m) => m.uf === st.uf) : D.ordemNac;
    const estadual = !!st.uf && st.escopo === 'estadual';
    let ord = lista;
    if (estadual) { pontuar(lista, 'est'); ord = [...lista].sort(porScore('est')); }
    return { itens: ord.slice(0, 10), escopo: estadual ? 'estadual' : 'nacional', elegiveis: lista.length, elegiveisPais: D.ordemNac.length };
  }
  function posicaoNacional(m) {
    garantirNacional();
    const i = D.ordemNac.indexOf(m);
    if (i >= 0) return { pos: i + 1, total: D.ordemNac.length, score: m.nac, crit: m.nacCrit };
    let motivoFora = 'Fora do ranking';
    if (!semPresenca(m.pres)) motivoFora = 'Fora do ranking: há presença AgroEasy registrada';
    else if (m.saldoInad <= 0) motivoFora = 'Fora do ranking: sem inadimplência registrada';
    else if (m.carteira < PEQUENA) motivoFora = 'Fora do ranking: carteira abaixo de R$ 1 mi';
    return { fora: motivoFora };
  }

  // ----- controles e seções -----
  // ----- controles no padrão visual do app: seletor com menu animado (período) e segmentado com indicador (presença) -----
  const ICONE = {
    calendario: '<rect x="3.5" y="5" width="17" height="15" rx="3"/><path d="M8 3v4M16 3v4M3.5 10h17"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>'
  };
  const svgIc = (nome, cls = '') => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONE[nome]}</svg>`;
  const ddHTML = (id, rotulo, opcoes, valor, icone) => {
    const atual = opcoes.find((o) => o.v === valor) || opcoes[0];
    return `<div class="inad-dd" data-dd="${esc(id)}"><span class="inad-dd-lbl" id="${esc(id)}-l">${esc(rotulo)}</span>
      <button type="button" class="inad-dd-btn" id="${esc(id)}-b" aria-haspopup="listbox" aria-expanded="false" aria-labelledby="${esc(id)}-l ${esc(id)}-b">
        ${icone ? svgIc(icone, 'inad-dd-ic') : ''}<span class="inad-dd-val">${esc(atual.t)}${atual.sub ? `<em>${esc(atual.sub)}</em>` : ''}</span>
        <svg class="inad-dd-chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg></button>
      <ul class="inad-dd-menu" role="listbox" aria-labelledby="${esc(id)}-l">${opcoes.map((o) =>
        `<li role="option" tabindex="-1" data-v="${esc(o.v)}" aria-selected="${o.v === valor}"><span>${esc(o.t)}${o.sub ? `<em>${esc(o.sub)}</em>` : ''}</span>${svgIc('check', 'inad-dd-ok')}</li>`).join('')}</ul></div>`;
  };
  const menuAberto = (dd) => dd.dataset.open === '1';
  function fecharMenus(exceto) {
    $$('.inad-dd', root).forEach((dd) => {
      if (exceto && dd === exceto) return;
      if (!menuAberto(dd)) return;
      dd.dataset.open = '0';
      dd.querySelector('.inad-dd-btn').setAttribute('aria-expanded', 'false');
    });
  }
  function abrirMenu(dd) {
    const abrir = !menuAberto(dd);
    fecharMenus(abrir ? dd : null);
    dd.dataset.open = abrir ? '1' : '0';
    dd.querySelector('.inad-dd-btn').setAttribute('aria-expanded', String(abrir));
    if (abrir) {
      const m = dd.querySelector('.inad-dd-menu');
      const s = m.querySelector('[aria-selected="true"]') || m.firstElementChild;
      if (s) { s.scrollIntoView({ block: 'nearest' }); s.focus({ preventScroll: true }); }
    }
  }
  // Controle segmentado (mesmo visual de .views) com indicador que desliza entre as opções
  const segHTML = (id, rotulo, opcoes, valor) => `<div class="inad-segbox"><span class="inad-dd-lbl">${esc(rotulo)}</span>
    <div class="inad-seg" role="radiogroup" aria-label="${esc(rotulo)}" data-seg="${esc(id)}"><i class="inad-seg-ind" aria-hidden="true"></i>${opcoes.map((o) =>
      `<button type="button" role="radio" aria-checked="${o.v === valor}" data-segv="${esc(o.v)}">${esc(o.t)}</button>`).join('')}</div></div>`;
  const segUltimo = {};
  function animarSegmentos() {
    $$('.inad-seg', root).forEach((seg) => {
      const ind = seg.querySelector('.inad-seg-ind');
      const alvo = seg.querySelector('[aria-checked="true"]');
      if (!ind || !alvo) return;
      const pos = (b) => ({ x: b.offsetLeft, y: b.offsetTop, w: b.offsetWidth, h: b.offsetHeight });
      const set = (p) => { ind.style.width = `${p.w}px`; ind.style.height = `${p.h}px`; ind.style.transform = `translate(${p.x}px, ${p.y}px)`; };
      const novo = pos(alvo), ant = segUltimo[seg.dataset.seg];
      if (ant && !reduzMov) {
        ind.style.transition = 'none';
        set(ant);
        void ind.offsetWidth; // fixa a posição anterior antes de animar
        ind.style.transition = '';
      }
      set(novo);
      ind.classList.add('on');
      segUltimo[seg.dataset.seg] = novo;
    });
  }
  function escolher(id, v) {
    fecharMenus(null);
    // deixa o menu fechar suavemente e só então aplica
    setTimeout(() => {
      panel.classList.add('inad-quiet');
      if (id === 'periodo') return trocarPeriodo(v);
      if (id === 'presenca') { st.filtro = v; renderTudo(); }
    }, reduzMov ? 0 : 140);
  }

  function controlesHTML() {
    const per = (D.periodos || []).map((p) => ({ v: p, t: mesCurto(p), sub: p === D.baseMax ? 'mais recente' : '' }));
    const pres = Object.entries(FILTROS).map(([k, v]) => ({ v: k, t: v.t }));
    return `<div class="inad-ctrl">
      ${ddHTML('periodo', 'Período', per, D.base, 'calendario')}
      ${st.view === 'oportunidades' ? '' : segHTML('presenca', 'Presença AgroEasy', pres, st.filtro)}
    </div>`;
  }
  function escopoHTML(r) {
    const nome = st.uf ? UF_NOME(st.uf) : '';
    const seletor = st.uf ? `<div class="views inad-ord" role="group" aria-label="Comparar com">
        <button data-escopo="nacional" aria-pressed="${r.escopo === 'nacional'}">Brasil</button>
        <button data-escopo="estadual" aria-pressed="${r.escopo === 'estadual'}">${esc(st.uf)}</button></div>` : '';
    const txt = r.escopo === 'estadual'
      ? `Posição entre os ${nf.format(r.elegiveis)} municípios elegíveis de ${esc(nome)}; os três indicadores são comparados só dentro do estado${r.elegiveis < 10 ? ' (poucos municípios elegíveis)' : ''}.`
      : `Posição entre os ${nf.format(r.elegiveisPais)} municípios elegíveis do país: o saldo é comparado dentro de cada estado (cobertura parcial varia entre UFs); produção e crédito, no país.`;
    return `${seletor}<p class="table-note">${txt} Não é probabilidade de sucesso comercial.</p>`;
  }
  // Visão geral: as duas respostas lado a lado, em listas curtas e separadas
  const skelSec = (titulo) => `<section class="inad-sec"><div class="inad-sec-h"><h3>${esc(titulo)}</h3></div>
    <div class="inad-skel" aria-busy="true"><i></i><i></i><i></i></div></section>`;
  function secInadimplencia() {
    if (D.carregandoMun) return skelSec('Maiores saldos inadimplentes');
    return `<section class="inad-sec"><div class="inad-sec-h"><h3>Maiores saldos inadimplentes</h3>${selo('comprovada')}</div>
      ${lista(rankObservado(), 'Nenhum município com inadimplência registrada neste filtro.', 'ob')}</section>`;
  }
  function secOportunidades() {
    if (D.carregandoMun) return skelSec('Prioridades de prospecção');
    const r = rankOportunidades();
    return `<section class="inad-sec"><div class="inad-sec-h"><h3>Prioridades de prospecção</h3>${selo('potencial')}</div>
      ${escopoHTML(r)}${lista(r.itens, 'Nenhum município elegível neste recorte.', 'op')}</section>`;
  }
  function secRanking() {
    return st.view === 'oportunidades' ? secOportunidades() + secInadimplencia() : secInadimplencia() + secOportunidades();
  }
  function tabelaUFs() {
    const rows = Object.entries(D.ufAtual).sort((a, b) => b[1].saldoInad - a[1].saldoInad);
    const max = Math.max(...rows.map(([, u]) => u.saldoInad), 1);
    const tr = ([uf, u]) => `<tr data-uf="${esc(uf)}" tabindex="0"><td class="uf-cell">${flag(uf)}${esc(uf)}</td><td class="st-name">${esc(UF_NOME(uf))}</td>
        <td class="num">${esc(money(u.saldoInad))}</td><td class="num muted">${esc(pct(u.taxa))}</td>
        <td class="bar-cell"><div class="bar"><i data-w="${(u.saldoInad / max * 100).toFixed(1)}"></i></div></td></tr>`;
    const cab = '<thead><tr><th>UF</th><th>Estado</th><th class="num">Saldo inad.</th><th class="num">Taxa</th><th></th></tr></thead>';
    return `<table class="rank">${cab}<tbody>${rows.slice(0, 8).map(tr).join('')}</tbody></table>
      ${rows.length > 8 ? `<details class="inad-mais"><summary>Ver os outros ${rows.length - 8} estados</summary><table class="rank">${cab}<tbody>${rows.slice(8).map(tr).join('')}</tbody></table></details>` : ''}`;
  }
  function somarSeries() {
    const por = {};
    Object.values(D.ufs).flat().forEach((r) => {
      const t = por[r.periodo] || (por[r.periodo] = { periodo: r.periodo, saldo_inad: 0 });
      t.saldo_inad += Number(r.saldo_inad);
    });
    return Object.values(por).sort((a, b) => (a.periodo < b.periodo ? -1 : 1));
  }
  const cargaDe = (pref) => (D.cargas || []).find((x) => x.id.startsWith(pref));
  function sobreOsDados() {
    const cb = (D.cob || []).find((r) => String(r.periodo).slice(0, 7) === D.base.slice(0, 7));
    const s = cb ? (Number(cb.saldo_com_mun) / (Number(cb.saldo_com_mun) + Number(cb.saldo_sem_mun)) * 100).toFixed(0) : null;
    const o = cb ? (Number(cb.ops_com_mun) / (Number(cb.ops_com_mun) + Number(cb.ops_sem_mun)) * 100).toFixed(0) : null;
    const cr = cargaDe('sicor_credito_'), pam = cargaDe('ibge_pam_'), ppm = cargaDe('ibge_ppm_'), ls = cargaDe('ibge_lspa_');
    const c = D.carga;
    const l = (t, v) => `<dt>${esc(t)}</dt><dd>${v}</dd>`;
    return `<details class="inad-mais"><summary>Sobre os dados</summary>
      <dl class="inad-dl">
        ${l('Inadimplência', `Banco Central (Sicor) · ${esc(mesCurto(D.base))}${D.base !== D.baseMax ? '' : ', mês mais recente publicado'}`)}
        ${cr ? l('Crédito contratado', `Banco Central (Sicor) · ${esc(cr.periodo_inicio.slice(0, 4))} a ${esc(mesCurto(cr.data_base))} (último ano parcial)`) : ''}
        ${pam ? l('Produção agrícola', `IBGE (PAM) · ${esc(pam.data_base.slice(0, 4))}, último ano consolidado`) : ''}
        ${ppm ? l('Pecuária', `IBGE (PPM) · ${esc(ppm.data_base.slice(0, 4))}, último ano consolidado`) : ''}
        ${ls ? l('Safra do ano', `IBGE (LSPA) · estimativa estadual, ${esc(mesCurto(ls.data_base))}`) : ''}
      </dl>
      ${s ? `<p class="small"><b>Dados parciais:</b> o município é identificado em ${o}% das operações (${s}% do saldo). Os valores não representam toda a carteira rural, e a proporção varia entre estados.</p>` : ''}
      <p class="small">A pontuação de oportunidades indica posição relativa entre municípios elegíveis; não é probabilidade de inadimplência nem de conversão comercial. Crédito contratado é fluxo anual e não é saldo inadimplente.</p>
      <details class="inad-mais"><summary>Metodologia</summary>
        <p class="small"><b>Termos:</b> “inadimplente” é a operação classificada pelo banco como inadimplente (SOR12); “em atraso”, como em atraso (SOR02). Prorrogações e renegociações não contam. Saldo é o valor em aberto; taxa = saldo inadimplente ÷ carteira ativa. Quantidade de operações não é quantidade de produtores.</p>
        <p class="small"><b>Inadimplência:</b> ${esc(c.metodologia)} ${esc(c.cobertura)} ${esc(c.nota || '')}</p>
        ${cr ? `<p class="small"><b>Crédito:</b> ${esc(cr.metodologia)} ${esc(cr.cobertura)}</p>` : ''}
        ${pam ? `<p class="small"><b>Produção agrícola:</b> ${esc(pam.metodologia)}</p>` : ''}
        ${ls ? `<p class="small"><b>Safra do ano:</b> ${esc(ls.metodologia)}</p>` : ''}
        <p class="small"><b>Pontuação:</b> média simples da posição (percentil) entre os elegíveis em até 3 indicadores: saldo inadimplente, valor da produção (IBGE) e crédito contratado no último ano completo. Indicador ausente não entra na média e nunca é zero; exige saldo e ao menos mais um indicador. Elegível: sem presença registrada, saldo inadimplente e carteira ativa de pelo menos R$ 1 mi. Pontuação nacional: o saldo inadimplente é comparado dentro de cada UF (para reduzir a diferença de cobertura de município entre estados; UFs com menos de 10 elegíveis usam o país), e produção e crédito, no país. Pontuação estadual: os três indicadores são comparados só entre os elegíveis da UF. Empates recebem a posição média.</p>
        ${D.semPareamento ? `<p class="small muted">${nf.format(D.semPareamento)} registros comerciais não puderam ser ligados a um município pelo nome e não entram na presença.</p>` : ''}
      </details>
    </details>`;
  }

  // ----- níveis -----
  function renderPanel() {
    if (st.mun) return renderMunicipio(D.porCod.get(st.mun));
    const uf = st.uf, u = uf ? D.ufAtual[uf] : null;
    const topo = uf
      ? `<div class="state-nav"><button class="back-btn" data-act="home"><svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>Visão geral</button></div>
         <div><p class="eyebrow">${flag(uf)}${esc(uf)} · ${esc(mesCurto(D.base))}</p><h2>${esc(UF_NOME(uf))}</h2></div>`
      : `<div><p class="eyebrow">Inadimplência rural · ${esc(mesCurto(D.base))}</p><h2>Onde priorizar</h2>
         <p class="inad-lead">Municípios com mais atrasos no crédito rural e onde a AgroEasy ainda não tem presença registrada.</p></div>`;
    const kpis = u ? `<div class="inad-grid">
        ${kpi('Saldo inadimplente', money(u.saldoInad), mesCurto(D.base))}
        ${kpi('Taxa de inadimplência', pct(u.taxa), 'sobre a carteira ativa')}
        ${kpi('Operações inadimplentes', nf.format(u.nInad), 'contratos')}
        ${kpi('Municípios com inadimplência', nf.format(u.munsComInad), 'registro no Sicor')}</div>` : '';
    const sem = uf && !u ? '<p class="table-note">Sem dados de inadimplência para este estado no período.</p>' : '';
    const serie = uf ? (D.ufs[uf] || []).map((r) => ({ ...r, saldo_inad: Number(r.saldo_inad) })) : somarSeries();
    const resumoEstados = uf ? '' : `<details class="inad-mais"><summary>Resumo por estado</summary>${tabelaUFs()}</details>`;
    panel.innerHTML = `${topo}${kpis}${sem}${controlesHTML()}${secRanking()}${resumoEstados}
      <section class="inad-sec"><details class="inad-mais"><summary>Evolução do saldo inadimplente</summary>${evolucao(serie, 'saldo_inad', '')}</details>
      ${uf ? aberto('Safra do ano e produção', 'uf', `data-uf="${esc(uf)}"`) : ''}</section>
      ${sobreOsDados()}`;
    aplicarLarguras();
  }
  function fonteAgro(uf) {
    const l = D.muns.filter((m) => m.uf === uf);
    const prod = l.filter((m) => m.producao != null), cred = l.filter((m) => m.credito != null);
    const soma = (a, k) => a.reduce((t, m) => t + m[k], 0);
    const out = [];
    if (prod.length) out.push(kpi('Valor da produção', money(soma(prod, 'producao')), `IBGE · ${prod[0].agroAno} (último ano consolidado)`));
    if (cred.length) out.push(kpi('Crédito contratado', money(soma(cred, 'credito')), `Sicor · ${cred[0].creditoAno} (fluxo, não é saldo)`));
    return out.length ? `<div class="inad-grid">${out.join('')}</div>` : '';
  }
  function blocoLspa(uf, linhas) {
    const ls = cargaDe('ibge_lspa_');
    const per = ls ? mesCurto(ls.data_base) : '';
    const ign = new Set(['Total', 'Cereais, leguminosas e oleaginosas']);
    const top = linhas.filter((r) => !ign.has(r.produto) && r.area_plantada_ha != null).sort((a, b) => b.area_plantada_ha - a.area_plantada_ha).slice(0, 5);
    const li = (r) => `<li><span class="inad-nm"><b>${esc(r.produto)}</b><small>${esc(r.producao_t != null ? toneladas(Number(r.producao_t)) + ' estimadas' : 'produção n/d')}</small></span><span class="inad-vl"><b>${esc(ha(Number(r.area_plantada_ha)))}</b><small>área plantada</small></span></li>`;
    return `${fonteAgro(uf)}
      ${top.length ? `<p class="eyebrow">Safra ${esc(ls ? ls.data_base.slice(0, 4) : '')} · estimativa do IBGE (${esc(per)})</p><ul class="inad-simple">${top.map(li).join('')}</ul>
        <p class="table-note">Estimativa estadual do IBGE (LSPA), ainda não consolidada. Não equivale à produção municipal (PAM).</p>` : '<p class="table-note">Sem estimativa da safra disponível para este estado.</p>'}`;
  }
  function renderMunicipio(m) {
    const p = m.pres;
    const pos = posicaoNacional(m);
    const vazio = m.semRegistro;
    const perfil = [];
    if (m.producao != null) perfil.push(['Valor da produção agropecuária', money(m.producao), `IBGE · ${m.agroAno}`]);
    if (m.principalCultura) perfil.push(['Principal cultura', m.principalCultura.replace(/ \(.*\)$/, ''), m.principalCulturaValor != null ? `${money(m.principalCulturaValor)} · IBGE ${m.agroAno}` : `IBGE ${m.agroAno}`]);
    if (m.bovinos != null) perfil.push(['Rebanho bovino', `${nf.format(m.bovinos)} cabeças`, 'IBGE · 2025']);
    if (m.credito != null) perfil.push(['Crédito rural contratado', money(m.credito), `Sicor · ${m.creditoAno}`]);
    const perfilHTML = perfil.length
      ? `<div class="inad-grid">${perfil.map(([a, b, c]) => kpi(a, b, c)).join('')}</div>`
      : '<p class="table-note">Sem dados agropecuários ou de crédito carregados para este município.</p>';
    const porPos = pos.fora
      ? `<p class="table-note">${esc(pos.fora)}.</p>`
      : `<p class="table-note">Posição <b>${pos.pos}</b> de ${nf.format(pos.total)} municípios elegíveis no país (saldo comparado dentro do estado)${pos.score != null ? ` · pontuação ${pos.score.toFixed(0)}/100 (${pos.crit} de 3 critérios)` : ''}. Comparação relativa; não é probabilidade de conversão.</p>`;
    panel.innerHTML = `
      <div class="state-nav"><button class="back-btn" data-act="uf"><svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>${esc(UF_NOME(m.uf))}</button></div>
      <div><p class="eyebrow">${flag(m.uf)}${esc(m.uf)}</p><h2>${esc(m.nome)}</h2></div>
      <section class="inad-sec"><div class="inad-sec-h"><h3>Situação financeira</h3><span class="inad-per">Sicor · ${esc(mesCurto(D.base))}</span></div>
        ${vazio ? '<p class="table-note">Sem operações ativas deste município no Sicor no período. Isso é ausência de registro, não inadimplência zero.</p>' : `<div class="inad-grid cols3">
        ${kpi('Saldo inadimplente', money(m.saldoInad), 'valor em aberto')}
        ${kpi('Operações inadimplentes', nf.format(m.nInad), 'contratos')}
        ${kpi('Taxa de inadimplência', pct(m.taxa), m.carteira > 0 && m.carteira < PEQUENA ? 'carteira pequena: pouco representativa' : 'sobre a carteira ativa')}</div>`}
      </section>
      <section class="inad-sec"><div class="inad-sec-h"><h3>Perfil econômico</h3><span class="inad-per">anual · IBGE e Sicor</span></div>${perfilHTML}</section>
      <section class="inad-sec"><div class="inad-sec-h"><h3>Presença AgroEasy</h3>${tagPres(p)}</div>
        <div class="inad-grid cols3m">
          ${kpi('Leads', nf.format(p ? p.leads : 0), 'registrados')}
          ${kpi('Clientes', nf.format(p ? p.clientes : 0), 'registrados')}
          ${kpi('Parceiros ativos', nf.format(p ? p.pAtivos : 0), p && p.pInativos ? `${p.pInativos} inativo${p.pInativos > 1 ? 's' : ''}` : 'registrados')}</div>
      </section>
      <section class="inad-sec"><div class="inad-sec-h"><h3>Por que merece atenção</h3>${selo('potencial')}</div>
        <p class="inad-just">${esc(justificativa(m))}</p>${porPos}</section>
      <section class="inad-sec">
        ${aberto('Culturas e pecuária', 'agro', `data-cod="${esc(m.cod)}"`)}
        ${aberto('Crédito por ano e finalidade', 'cred', `data-cod="${esc(m.cod)}"`)}
        ${aberto('Evolução da inadimplência', 'evo', `data-cod="${esc(m.cod)}"`)}
      </section>
      ${sobreOsDados()}`;
    aplicarLarguras();
  }

  const LISTA_PEC = ['Bovino', 'Galináceos - total', 'Suíno - total', 'Ovino', 'Caprino', 'Equino', 'Bubalino'];
  const ha = (v) => `${dec(v, 0)} ha`;
  const toneladas = (v) => `${dec(v, 0)} t`;
  function blocoAgro(m, prod, pec) {
    const total = prod.find((r) => r.produto === 'Total');
    const cult = prod.filter((r) => r.produto !== 'Total' && r.valor_mil_reais != null).sort((a, b) => b.valor_mil_reais - a.valor_mil_reais);
    const ano = (total || cult[0] || {}).ano;
    const totalValor = total && total.valor_mil_reais != null ? Number(total.valor_mil_reais) * 1000 : null;
    const linha = (r) => {
      const v = Number(r.valor_mil_reais) * 1000;
      const part = totalValor ? ` · ${dec((v / totalValor) * 100, 0)}% do valor` : '';
      return `<li><span class="inad-nm"><b>${esc(r.produto)}</b><small>${esc((r.qtd_toneladas != null ? toneladas(Number(r.qtd_toneladas)) : 'quantidade n/d') + part)}</small></span><span class="inad-vl"><b>${esc(money(v))}</b></span></li>`;
    };
    const rebanhos = pec.filter((r) => r.indicador === 'efetivo').sort((a, b) => b.valor - a.valor);
    const leite = pec.find((r) => r.item === 'Leite' && r.indicador === 'quantidade');
    const pecLinhas = rebanhos.filter((r) => LISTA_PEC.includes(r.item)).slice(0, 3).map((r) =>
      `<li><span class="inad-nm"><b>${esc(r.item.replace(' - total', ''))}</b></span><span class="inad-vl"><b>${esc(nf.format(Number(r.valor)))}</b><small>${esc(r.unidade.toLowerCase())}</small></span></li>`);
    if (leite) pecLinhas.push(`<li><span class="inad-nm"><b>Leite</b><small>produção anual</small></span><span class="inad-vl"><b>${esc(nf.format(Number(leite.valor)))}</b><small>${esc(leite.unidade.toLowerCase())}</small></span></li>`);
    const kpis = [
      totalValor != null ? kpi('Valor da produção', money(totalValor), `IBGE · ${esc(ano)}`) : kpi('Valor da produção', 'indisponível', 'sem dado na PAM'),
      total && total.area_colhida_ha != null ? kpi('Área colhida', ha(Number(total.area_colhida_ha)), `IBGE · ${esc(ano)}`) : kpi('Área colhida', 'indisponível', 'sem dado na PAM')
    ].join('');
    return `<div class="inad-grid">${kpis}</div>
      ${cult.length ? `<p class="eyebrow">Principais culturas · ${esc(ano)}</p><ul class="inad-simple">${cult.slice(0, 3).map(linha).join('')}</ul>
        ${cult.length > 3 ? `<details class="inad-mais"><summary>Ver outras ${Math.min(cult.length - 3, 12)} culturas</summary><ul class="inad-simple">${cult.slice(3, 15).map(linha).join('')}</ul></details>` : ''}` : '<p class="table-note">Sem produção agrícola registrada pelo IBGE neste município.</p>'}
      ${pecLinhas.length ? `<p class="eyebrow">Pecuária · ${pec[0].ano}</p><ul class="inad-simple">${pecLinhas.join('')}</ul>` : '<p class="table-note">Sem dados de pecuária disponíveis.</p>'}
      <p class="table-note">Dado anual do IBGE, último ano consolidado (${esc(String(ano || (pec[0] && pec[0].ano) || '—'))}).</p>`;
  }
  function blocoCredito(m, cred) {
    if (!cred.length) return '<p class="table-note">Sem crédito rural contratado com este município identificado no Sicor.</p>';
    const anos = [...new Set(cred.map((r) => r.ano))].sort();
    const completos = (D.credCob || []).filter((c) => Number(c.ate_mes) === 12).map((c) => Number(c.ano));
    const anoRef = completos.length ? Math.max(...completos) : anos[anos.length - 1];
    const porAno = anos.map((a) => ({ periodo: `${a}-01-01`, valor: cred.filter((r) => r.ano === a).reduce((t, r) => t + Number(r.valor), 0) }));
    const ORD_FIN = ['Custeio', 'Investimento', 'Comercialização', 'Industrialização'];
    const fins = cred.filter((r) => r.ano === anoRef).sort((a, b) => ORD_FIN.indexOf(a.finalidade) - ORD_FIN.indexOf(b.finalidade));
    const totRef = fins.reduce((t, r) => t + Number(r.valor), 0);
    const parcial = (D.credCob || []).find((c) => Number(c.ano) === anos[anos.length - 1] && c.ate_mes < 12);
    return `<div class="inad-grid">
        ${kpi(`Contratado em ${anoRef}`, money(totRef), `${nf.format(fins.reduce((t, r) => t + r.contratos, 0))} contratos`)}</div>
      ${fins.length ? `<details class="inad-mais"><summary>Por finalidade (classificação ainda não conciliada)</summary><ul class="inad-simple">${fins.map((r) => `<li><span class="inad-nm"><b>${esc(r.finalidade)}</b><small>${nf.format(r.contratos)} contratos</small></span><span class="inad-vl"><b>${esc(money(r.valor))}</b></span></li>`).join('')}</ul></details>` : ''}
      <p class="eyebrow">Por ano</p>${evolucao(porAno.map((r) => ({ ...r, saldo_inad: r.valor })), 'saldo_inad', '', (p) => String(p).slice(0, 4))}
      <p class="table-note">Fluxo anual (ano civil), não é saldo inadimplente. Só operações com município identificado.${parcial ? ` ${esc(String(parcial.ano))} é parcial (até ${esc(MES_ABR[parcial.ate_mes - 1])}).` : ''}</p>`;
  }

  // Carregamento sob demanda dos blocos expansíveis
  async function carregarBloco(det) {
    const alvo = det.querySelector('.inad-lazy');
    if (!alvo || det.dataset.ok) return;
    det.dataset.ok = '1';
    const falha = () => { alvo.innerHTML = '<p class="table-note">Não foi possível carregar agora. Tente novamente.</p>'; det.dataset.ok = ''; };
    try {
      const tipo = det.dataset.lazy, cod = det.dataset.cod, uf = det.dataset.uf;
      if (tipo === 'uf') {
        const r = await SB.from('inad_lspa_uf').select('produto,area_plantada_ha,producao_t,periodo').eq('uf', uf).order('periodo');
        if (r.error) return falha();
        const per = r.data.length ? String(r.data[r.data.length - 1].periodo).slice(0, 10) : null;
        alvo.innerHTML = blocoLspa(uf, per ? r.data.filter((x) => String(x.periodo).slice(0, 10) === per) : []);
      } else if (tipo === 'agro') {
        const [a, b] = await Promise.all([
          SB.from('inad_agro_producao').select('ano,produto,area_colhida_ha,qtd_toneladas,valor_mil_reais').eq('cod_ibge', cod),
          SB.from('inad_agro_pecuaria').select('ano,item,indicador,valor,unidade').eq('cod_ibge', cod)
        ]);
        if (a.error || b.error) return falha();
        alvo.innerHTML = a.data.length || b.data.length ? blocoAgro(D.porCod.get(cod), a.data, b.data) : '<p class="table-note">Sem dados agropecuários do IBGE para este município.</p>';
      } else if (tipo === 'cred') {
        const r = await SB.from('inad_credito_anual').select('ano,finalidade,valor,contratos').eq('cod_ibge', cod).order('ano');
        if (r.error) return falha();
        alvo.innerHTML = blocoCredito(D.porCod.get(cod), r.data || []);
      } else if (tipo === 'evo') {
        const r = await SB.from('inad_municipio_mensal').select('periodo,saldo_inad').eq('cod_ibge', cod).order('periodo');
        if (r.error) return falha();
        alvo.innerHTML = r.data.length ? evolucao(r.data, 'saldo_inad', '') : '<p class="table-note">Sem série para este município.</p>';
      }
      aplicarLarguras();
    } catch { falha(); }
  }
  function aplicarLarguras() {
    $$('[data-w]', root).forEach((e) => { e.style.width = `${Math.max(0, Math.min(100, Number(e.dataset.w) || 0))}%`; });
  }

  // ---------- Período ----------
  const cachePeriodo = new Map();
  const COLS_MES = 'cod_ibge,n_inad,saldo_inad,n_atraso,saldo_atraso,n_ativas,saldo_ativo';
  function aplicarPeriodo(p, rows) {
    const por = new Map(rows.map((r) => [r.cod_ibge, r]));
    D.muns.forEach((m) => {
      const a = por.get(m.cod);
      const carteira = a ? Number(a.saldo_ativo) : 0;
      m.semRegistro = !a;
      m.saldoInad = a ? Number(a.saldo_inad) : 0; m.nInad = a ? a.n_inad : 0;
      m.saldoAtraso = a ? Number(a.saldo_atraso) : 0; m.nAtraso = a ? a.n_atraso : 0;
      m.carteira = carteira; m.nAtivas = a ? a.n_ativas : 0;
      m.taxa = carteira > 0 ? (Number(a.saldo_inad) / carteira) * 100 : null;
    });
    D.ufAtual = {};
    Object.entries(D.ufs).forEach(([uf, serie]) => {
      const u = serie.find((x) => String(x.periodo).slice(0, 7) === p.slice(0, 7));
      if (u) D.ufAtual[uf] = {
        saldoInad: Number(u.saldo_inad), nInad: Number(u.n_inad), saldoAtraso: Number(u.saldo_atraso), nAtraso: Number(u.n_atraso),
        carteira: Number(u.saldo_ativo), nAtivas: Number(u.n_ativas), munsComInad: Number(u.municipios_com_inad),
        taxa: Number(u.saldo_ativo) > 0 ? (Number(u.saldo_inad) / Number(u.saldo_ativo)) * 100 : null
      };
    });
    D.base = p;
    D.dist = null;
    nacionalPronto = false;
  }
  async function trocarPeriodo(p) {
    if (!D || p === D.base) return;
    panel.classList.add('is-loading');
    try {
      let rows = cachePeriodo.get(p);
      if (!rows) {
        rows = (await carregarPainel(p)).atual;
        cachePeriodo.set(p, rows);
      }
      aplicarPeriodo(p, rows);
      redesenharMapa();
      renderAviso();
      renderTudo();
    } catch {
      renderTudo();
    }
    panel.classList.remove('is-loading');
  }

  // ---------- KPIs e avisos ----------
  function renderKpis() {
    if (D.carregandoMun) {
      // prévia com os totais por estado, enquanto os municípios chegam
      const us = st.uf ? [D.ufAtual[st.uf]].filter(Boolean) : Object.values(D.ufAtual);
      const sI = us.reduce((a, u) => a + u.saldoInad, 0), sC = us.reduce((a, u) => a + u.carteira, 0), nI = us.reduce((a, u) => a + u.nInad, 0);
      const itens0 = [['Saldo inadimplente', money(sI), mesCurto(D.base)], ['Taxa de inadimplência', pct(sC > 0 ? sI / sC * 100 : null), 'sobre a carteira ativa'],
        ['Operações inadimplentes', nf.format(nI), 'contratos, não produtores'], ['Sem presença AgroEasy', '…', 'carregando municípios']];
      kpis.innerHTML = `<div class="kpi-group"><h4><span class="kg-title">${st.uf ? esc(UF_NOME(st.uf)) : esc(escopo())}</span></h4><div class="kpi-row">
        ${itens0.map(([a, b, c]) => `<div class="kpi"><div class="k-lbl">${esc(a)}</div><div class="k-val">${esc(b)}</div><div class="k-sub">${esc(c)}</div></div>`).join('')}</div></div>`;
      return;
    }
    const l = baseMuns();
    const soma = (k) => l.reduce((a, m) => a + m[k], 0);
    const saldoInad = soma('saldoInad'), carteira = soma('carteira');
    const itens = [
      ['Saldo inadimplente', money(saldoInad), mesCurto(D.base)],
      ['Taxa de inadimplência', pct(carteira > 0 ? saldoInad / carteira * 100 : null), 'sobre a carteira ativa'],
      ['Operações inadimplentes', nf.format(soma('nInad')), 'contratos, não produtores'],
      ['Sem presença AgroEasy', nf.format(l.filter((m) => m.saldoInad > 0 && semPresenca(m.pres)).length), `de ${nf.format(l.filter((m) => m.saldoInad > 0).length)} municípios com inadimplência`]
    ];
    const rotFiltro = filtroAtivo() === 'todos' ? '' : ' · ' + FILTROS[filtroAtivo()].t;
    kpis.innerHTML = `<div class="kpi-group"><h4><span class="kg-title">${st.uf ? esc(UF_NOME(st.uf)) : esc(escopo())}${esc(rotFiltro)}</span></h4><div class="kpi-row">
      ${itens.map(([a, b, c]) => `<div class="kpi"><div class="k-lbl">${esc(a)}</div><div class="k-val">${esc(b)}</div><div class="k-sub">${esc(c)}</div></div>`).join('')}</div></div>`;
  }
  function renderFontes() {
    $('#inadFontes', root).innerHTML = D.fontes.map((f) => `<p><b>Fonte:</b> ${esc(f.nome)} — ${esc(f.orgao)} · ${/^https:\/\//.test(f.url) ? `<a href="${esc(f.url)}" target="_blank" rel="noopener noreferrer">${esc(f.url.replace(/^https:\/\/(www\.)?/, '').split('/')[0])}</a>` : esc(f.url)}</p>`).join('');
  }
  function renderAviso() {
    const cb = D.cob.find((r) => String(r.periodo).slice(0, 7) === D.base.slice(0, 7));
    const a = $('#inadAviso', root);
    if (!cb) { a.hidden = true; return; }
    const s = (Number(cb.saldo_com_mun) / (Number(cb.saldo_com_mun) + Number(cb.saldo_sem_mun)) * 100).toFixed(0);
    a.innerHTML = `<b>Dados parciais</b> · município identificado em ${s}% do saldo (Sicor/Banco Central, ${esc(mesCurto(D.base))}).`;
    a.hidden = false;
  }
  function renderTudo() { renderKpis(); renderPanel(); aplicarSelecao(); animarSegmentos(); }

  // ---------- Eventos ----------
  const reduzMov = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const ir = (uf, mun = null) => {
    panel.classList.remove('inad-quiet');
    st.uf = uf; st.mun = mun; renderTudo();
    if (window.innerWidth <= 960) {
      requestAnimationFrame(() => (uf || mun ? panel : $('.map-card', root)).scrollIntoView({ behavior: reduzMov ? 'auto' : 'smooth', block: 'start' }));
    }
  };
  function ligarEventos() {
    svg.addEventListener('click', (e) => {
      const pin = e.target.closest('.pin');
      if (pin && !pin.classList.contains('off')) { const m = D.porCod.get(pin.dataset.cod); return ir(m.uf, m.cod); }
      const mun = e.target.closest('.mun');
      if (mun) { const m = D.porCod.get(mun.dataset.cod); return m ? ir(m.uf, m.cod) : undefined; }
      const p = e.target.closest('.uf:not(.is-empty)');
      if (p) ir(p.dataset.uf);
    });
    svg.addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.uf:not(.is-empty)')) { e.preventDefault(); ir(e.target.dataset.uf); }
    });
    svg.addEventListener('pointermove', (e) => {
      const pin = e.target.closest('.pin:not(.off)');
      const mun = !pin ? e.target.closest('.mun.tem') : null;
      const uf = !pin && !mun && !st.uf ? e.target.closest('.uf:not(.is-empty)') : null;
      const codM = pin ? pin.dataset.cod : (mun ? mun.dataset.cod : null);
      let h = '';
      if (codM) {
        const m = D.porCod.get(codM);
        h = `<b>${esc(m.nome)} · ${esc(m.uf)}</b><br>${esc(money(m.saldoInad))} inadimplentes · ${nf.format(m.nInad)} operações<br>Taxa ${esc(pct(m.taxa))}<br><span class="muted">${esc(motivo(m))}</span>`;
      } else if (uf) {
        const u = D.ufAtual[uf.dataset.uf];
        h = `<b>${esc(UF_NOME(uf.dataset.uf))}</b><br>${esc(money(u.saldoInad))} inadimplentes · ${nf.format(u.nInad)} operações<br>Taxa ${esc(pct(u.taxa))}<br><span class="muted">Clique para detalhar</span>`;
      }
      if (!h) { tip.hidden = true; return; }
      tip.innerHTML = h;
      const r = svg.parentElement.getBoundingClientRect();
      tip.style.left = `${Math.max(4, Math.min(e.clientX - r.left + 12, r.width - 250))}px`;
      tip.style.top = `${Math.max(4, Math.min(e.clientY - r.top + 12, r.height - 100))}px`;
      tip.hidden = false;
    }, { passive: true });
    svg.addEventListener('pointerleave', () => { tip.hidden = true; });
    $('#inadVoltar', root).addEventListener('click', () => ir(null));
    $('#inadViews', root).addEventListener('click', (e) => {
      const b = e.target.closest('[data-view]');
      if (b) { st.view = b.dataset.view; renderTudo(); }
    });
    panel.addEventListener('click', (e) => {
      const t = e.target.closest('button, tr[data-uf]');
      if (!t) return;
      if (t.dataset.cod) { const m = D.porCod.get(t.dataset.cod); return ir(m.uf, m.cod); }
      if (t.dataset.uf && t.tagName === 'TR') return ir(t.dataset.uf);
      if (t.dataset.act === 'home') return ir(null);
      if (t.dataset.act === 'uf') { st.mun = null; return renderTudo(); }
      if (t.dataset.escopo) { st.escopo = t.dataset.escopo; panel.classList.add('inad-quiet'); return renderPanel(); }
    });
    panel.addEventListener('click', (e) => {
      const btn = e.target.closest('.inad-dd-btn');
      if (btn) { e.stopPropagation(); return abrirMenu(btn.parentElement); }
      const op = e.target.closest('.inad-dd-menu li[data-v]');
      if (op) { e.stopPropagation(); return escolher(op.closest('.inad-dd').dataset.dd, op.dataset.v); }
      const sg = e.target.closest('.inad-seg button[data-segv]');
      if (sg && sg.getAttribute('aria-checked') !== 'true') {
        e.stopPropagation();
        st.filtro = sg.dataset.segv;
        panel.classList.add('inad-quiet');
        renderTudo();
      }
    }, true);
    panel.addEventListener('keydown', (e) => {
      const sg = e.target.closest && e.target.closest('.inad-seg button[data-segv]');
      if (sg && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
        const bs = [...sg.parentElement.querySelectorAll('button[data-segv]')];
        const alvo = bs[bs.indexOf(sg) + (e.key === 'ArrowRight' ? 1 : -1)];
        if (alvo) { e.preventDefault(); alvo.click(); const novo = panel.querySelector('.inad-seg button[aria-checked="true"]'); if (novo) novo.focus(); }
        return;
      }
      const dd = e.target.closest('.inad-dd');
      if (!dd) return;
      const m = dd.querySelector('.inad-dd-menu');
      if (e.key === 'Escape' && menuAberto(dd)) { e.preventDefault(); fecharMenus(null); dd.querySelector('.inad-dd-btn').focus(); return; }
      if (e.target.matches('.inad-dd-btn') && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { e.preventDefault(); if (!menuAberto(dd)) abrirMenu(dd); return; }
      if (e.target.matches('li[data-v]')) {
        const itens = [...m.children], i = itens.indexOf(e.target);
        if (e.key === 'ArrowDown') { e.preventDefault(); (itens[i + 1] || itens[i]).focus(); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); (itens[i - 1] || itens[i]).focus(); }
        else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); escolher(dd.dataset.dd, e.target.dataset.v); }
        else if (e.key === 'Tab') fecharMenus(null);
      }
    });
    document.addEventListener('click', (e) => { if (!e.target.closest('.inad-dd')) fecharMenus(null); });
    // aquece o contorno municipal do estado sob o cursor: o clique abre sem espera
    svg.addEventListener('pointerover', (e) => {
      const u = e.target.closest && e.target.closest('.uf:not(.is-empty)');
      if (u) carregarMunicipios(u.dataset.uf);
    }, { passive: true });
    // blocos expansíveis: busca os dados só quando o usuário abre
    panel.addEventListener('toggle', (e) => {
      const d = e.target;
      if (d && d.matches && d.matches('details[data-lazy]') && d.open) carregarBloco(d);
    }, true);
    panel.addEventListener('keydown', (e) => {
      const tr = e.target.closest('tr[data-uf]');
      if (tr && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); ir(tr.dataset.uf); }
    });
  }

  // ---------- Abertura / fechamento da aba ----------
  const outrasAbas = () => $$('.modes button[data-mode]');
  function abrir() {
    document.body.classList.add('inad-on');
    root.hidden = false;
    anterior = outrasAbas().find((b) => b.getAttribute('aria-selected') === 'true') || anterior;
    tab.setAttribute('aria-selected', 'true');
    outrasAbas().forEach((b) => b.setAttribute('aria-selected', 'false'));
    document.title = 'Inadimplência rural · AgroEasy';
    if (!st.carregado && !st.carregando) iniciar();
  }
  function fechar() {
    if (!document.body.classList.contains('inad-on')) return;
    document.body.classList.remove('inad-on');
    root.hidden = true;
    tab.setAttribute('aria-selected', 'false');
    if (anterior && !outrasAbas().some((b) => b.getAttribute('aria-selected') === 'true')) anterior.setAttribute('aria-selected', 'true');
  }
  function mensagem(titulo, texto, carregando = false) {
    panel.innerHTML = `<div class="inad-vazio">${carregando ? '<span class="spinner" aria-hidden="true"></span>' : ''}<h2>${esc(titulo)}</h2><p class="muted">${esc(texto)}</p></div>`;
    kpis.innerHTML = '';
  }
  // Mapa neutro e painel de carregamento aparecem na hora, antes de qualquer dado
  function esqueleto() {
    while (svg.firstChild) svg.firstChild.remove();
    svg.setAttribute('viewBox', [-10, -10, GEO.w + 80, GEO.h + 20].join(' '));
    const g = el('g', { class: 'states' }, svg);
    GEO.states.forEach((s) => el('path', { d: s.d, class: 'uf is-empty inad-esq' }, g));
    panel.innerHTML = `<div><p class="eyebrow">Inadimplência rural</p><h2>Onde priorizar</h2></div>
      <div class="inad-skel" aria-busy="true"><i></i><i></i><i></i><i></i><i></i></div>`;
    kpis.innerHTML = '';
  }
  async function iniciar() {
    st.carregando = true;
    esqueleto();
    try {
      const pBase = carregarBase();
      const pMun = carregarPainel(null); // sai junto com a etapa 1
      pMun.catch(() => {});
      const base = await pBase;
      if (base.vazio) { mensagem('Dados ainda não carregados', 'Nenhuma carga de inadimplência foi publicada. Nenhum número é exibido sem fonte e data-base.'); st.carregando = false; return; }
      // etapa 1: estados, indicadores e avisos já aparecem
      D = modelar({ ...base, municipios: [], atual: [], perfil: [] });
      D.baseMax = D.base;
      D.periodos = [...new Set(base.cob.map((r) => String(r.periodo).slice(0, 10)))].sort().reverse();
      D.carregandoMun = true;
      st.carregado = true;
      desenharMapa();
      ligarEventos();
      renderFontes();
      renderAviso();
      renderTudo();
      // etapa 2: municípios (rankings, pinos e perfis)
      const mun = await pMun;
      const completo = modelar({ ...base, municipios: mun.municipios, atual: mun.atual, perfil: mun.perfil });
      completo.baseMax = D.baseMax;
      completo.periodos = D.periodos;
      D = completo;
      nacionalPronto = false;
      redesenharMapa();
      renderTudo();
    } catch (err) {
      if (D) { D.carregandoMun = false; renderTudo(); }
      mensagem('Dados indisponíveis', 'Não foi possível carregar a inadimplência rural agora. As demais abas continuam funcionando; tente novamente em instantes.');
    }
    st.carregando = false;
  }

  window.addEventListener('resize', () => { if (st.carregado && !root.hidden) { scaleLabels(); evitarSobreposicao(); } });
  montarCasca();
  // atalho na tela inicial: fecha as boas-vindas (mesmo efeito do app) e abre a aba
  const atalho = document.querySelector('.wo-inad');
  if (atalho) {
    atalho.addEventListener('click', () => {
      const w = document.getElementById('welcome');
      if (w) { w.classList.add('is-hidden'); w.setAttribute('aria-hidden', 'true'); }
      document.body.classList.remove('welcome-open');
      abrir();
    });
  }
  tab.addEventListener('click', abrir);
  outrasAbas().forEach((b) => b.addEventListener('click', fechar));
  const obs = new MutationObserver(() => {
    if (outrasAbas().some((b) => b.getAttribute('aria-selected') === 'true')) fechar();
  });
  outrasAbas().forEach((b) => obs.observe(b, { attributes: true, attributeFilter: ['aria-selected'] }));
})();
