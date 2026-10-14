(() => {
  'use strict';

  const GEO = window.BR_GEO;
  const RAW = window.AGRO_DATA;
  const CATS = ['leads', 'clientes', 'parceiros'];
  const MODES = ['todos', ...CATS];
  const SVGNS = 'http://www.w3.org/2000/svg';

  if (!GEO || !RAW) {
    document.body.textContent = 'Não foi possível carregar os dados do mapa.';
    return;
  }

  // ======================================================================
  // Segurança: todo HTML é montado por templates que escapam por padrão.
  // Só passa sem escape o que já foi produzido por html`` (classe Safe).
  // ======================================================================
  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;', '=': '&#61;' };
  const esc = (s) => String(s).replace(/[&<>"'`=]/g, (c) => ESC[c]);
  class Safe { constructor(s) { this.s = s; } toString() { return this.s; } }
  const val = (v) => (v == null || v === false ? '' : v instanceof Safe ? v.s : Array.isArray(v) ? v.map(val).join('') : esc(v));
  const html = (strs, ...vals) => new Safe(strs.reduce((o, s, i) => o + s + (i < vals.length ? val(vals[i]) : ''), ''));

  // Larguras e cores dinâmicas são aplicadas via CSSOM (permitido pela CSP, ao contrário de style="" inline)
  const HEX = /^#[0-9a-f]{6}$/i;
  function setHTML(node, h) {
    node.innerHTML = val(h); // Safe passa direto; listas são combinadas; o resto é escapado
    node.querySelectorAll('[data-w]').forEach((e) => {
      e.style.width = `${Math.max(0, Math.min(100, Number(e.dataset.w) || 0))}%`;
    });
    node.querySelectorAll('[data-color]').forEach((e) => {
      if (HEX.test(e.dataset.color)) e.style.background = e.dataset.color;
    });
  }

  // ======================================================================
  // Dados: validação, saneamento e congelamento
  // Qualquer erro de digitação em data.js aparece como aviso no console (F12).
  // ======================================================================
  const UF_LIST = GEO.states.map((s) => s.uf);
  const UF_SET = new Set(UF_LIST);
  const isInt = (n) => Number.isInteger(n) && n >= 0;
  const isStr = (s) => typeof s === 'string' && s.trim().length > 0 && s.length <= 160;
  const PCT = /^\d{1,3},\d%$/;

  function deepFreeze(o) {
    Object.values(o).forEach((v) => { if (v && typeof v === 'object') deepFreeze(v); });
    return Object.freeze(o);
  }

  function sanitize(raw) {
    const warn = (...m) => console.warn('[AgroEasy] dados:', ...m);
    const out = { estados: {} };
    UF_LIST.forEach((uf) => { out.estados[uf] = isStr(raw.estados && raw.estados[uf]) ? raw.estados[uf] : uf; });

    CATS.forEach((cat) => {
      const src = raw[cat] || {};
      const d = {
        titulo: String(src.titulo || cat), singular: String(src.singular || cat), plural: String(src.plural || cat),
        fonte: String(src.fonte || ''), notaPercentual: String(src.notaPercentual || ''),
        totalComUF: isInt(src.totalComUF) ? src.totalComUF : 0,
        kpis: (Array.isArray(src.kpis) ? src.kpis : []).filter((k) => k && isStr(k.rotulo) && isInt(k.valor))
          .map((k) => ({ rotulo: k.rotulo, valor: k.valor, sub: String(k.sub || ''), status: k.status === 'ativo' || k.status === 'inativo' ? k.status : '' })),
        porEstado: {}
      };
      let soma = 0;
      Object.entries(src.porEstado || {}).forEach(([uf, r]) => {
        if (!UF_SET.has(uf)) return warn(`${cat}: UF desconhecida "${uf}" ignorada`);
        if (!r || !isInt(r.total)) return warn(`${cat}/${uf}: total inválido`);
        const e = { total: r.total, pct: PCT.test(r.pct) ? r.pct : '', nota: isStr(r.nota) ? r.nota : '' };
        if (cat === 'parceiros') {
          e.pessoas = (r.pessoas || []).filter((p) => Array.isArray(p) && isStr(p[0]) && isStr(p[1]) && (p[2] === 'Ativo' || p[2] === 'Inativo') && Number.isSafeInteger(p[3]) && (p[3] > 0 || p[3] <= -100))
            .map((p) => [p[0], p[1], p[2], p[3]]);
          if (e.pessoas.length !== e.total) warn(`${cat}/${uf}: total ${e.total}, mas ${e.pessoas.length} parceiros válidos listados`);
        } else {
          e.municipios = (r.municipios || []).filter((m) => Array.isArray(m) && isStr(m[0]) && isInt(m[1])).map((m) => [m[0], m[1]]);
          const s = e.municipios.reduce((a, m) => a + m[1], 0);
          if (s !== e.total && !e.nota) warn(`${cat}/${uf}: total ${e.total}, mas municípios somam ${s}`);
        }
        soma += e.total;
        d.porEstado[uf] = e;
      });
      if (soma !== d.totalComUF) warn(`${cat}: soma por estado (${soma}) difere do total com UF (${d.totalComUF})`);
      out[cat] = d;
    });
    return deepFreeze(out);
  }

  const DATA = sanitize(RAW);

  // ======================================================================
  // Referências geográficas
  // ======================================================================
  const REGIAO = {
    AC: 'Norte', AM: 'Norte', AP: 'Norte', PA: 'Norte', RO: 'Norte', RR: 'Norte', TO: 'Norte',
    AL: 'Nordeste', BA: 'Nordeste', CE: 'Nordeste', MA: 'Nordeste', PB: 'Nordeste', PE: 'Nordeste', PI: 'Nordeste', RN: 'Nordeste', SE: 'Nordeste',
    DF: 'Centro-Oeste', GO: 'Centro-Oeste', MS: 'Centro-Oeste', MT: 'Centro-Oeste',
    ES: 'Sudeste', MG: 'Sudeste', RJ: 'Sudeste', SP: 'Sudeste',
    PR: 'Sul', RS: 'Sul', SC: 'Sul'
  };
  // Preposição correta para cada estado ("no Acre", "na Bahia", "em Goiás")
  const PREP = {
    AC: 'no', AL: 'em', AM: 'no', AP: 'no', BA: 'na', CE: 'no', DF: 'no', ES: 'no', GO: 'em', MA: 'no', MG: 'em', MS: 'em', MT: 'em', PA: 'no',
    PB: 'na', PE: 'em', PI: 'no', PR: 'no', RJ: 'no', RN: 'no', RO: 'em', RR: 'em', RS: 'no', SC: 'em', SE: 'em', SP: 'em', TO: 'no'
  };
  // Posição dos rótulos: estados pequenos ganham rótulo fora do mapa com linha guia.
  const LABEL_POS = {
    GO: { p: [566, 548] },
    DF: { p: [676, 486], out: true },
    ES: { p: [884, 626], out: true },
    RJ: { p: [800, 714], out: true },
    SE: { p: [962, 404], out: true },
    AL: { p: [990, 370], out: true },
    PE: { p: [1012, 334], out: true },
    PB: { p: [1016, 300], out: true },
    RN: { p: [1004, 262], out: true },
    SC: { p: [572, 806] }
  };

  const BASE_VB = [-10, -10, GEO.w + 80, GEO.h + 20];
  const COLOR_EMPTY = '#444545';
  // Cores semânticas fortes para manter as três bases distinguíveis no mapa.
  const CAT_COR = { leads: ['#174F78', '#36A9FF'], clientes: ['#006B5F', '#00E5C4'], parceiros: ['#1D573B', '#35D07F'] };
  const PRESENCE = [COLOR_EMPTY, '#665738', '#A18343', '#D6B55F'];

  // ---------- Consultas (pré-calculadas) ----------
  const nome = (uf) => DATA.estados[uf];
  const noEstado = (uf) => `${PREP[uf]} ${nome(uf)}`;
  const reg = (cat, uf) => DATA[cat].porEstado[uf] || null;
  const total = (cat, uf) => (reg(cat, uf) ? reg(cat, uf).total : 0);
  const MAX = {}, NUF = {};
  CATS.forEach((c) => {
    const vals = Object.values(DATA[c].porEstado).map((r) => r.total);
    MAX[c] = Math.max(1, ...vals);
    NUF[c] = vals.length;
  });
  const baseTotal = (c) => (DATA[c].kpis[0] ? DATA[c].kpis[0].valor : DATA[c].totalComUF);
  const posicao = (cat, uf) => 1 + Object.values(DATA[cat].porEstado).filter((r) => r.total > total(cat, uf)).length;
  const presenca = (uf) => CATS.filter((c) => total(c, uf) > 0).length;
  // Três tamanhos: mini (ícones), media (cabeçalho do estado) e grande (preenchimento no mapa)
  const FLAG_DIR = { mini: 'mini/', media: 'media/', grande: '' };
  const flagSrc = (uf, tam = 'grande') => (UF_SET.has(uf) ? `assets/bandeiras/${FLAG_DIR[tam] || ''}${uf.toLowerCase()}.png` : '');
  const flag = (uf, size = 'xs') => html`<img class="flag ${size}" src="${flagSrc(uf, size === 'lg' ? 'media' : 'mini')}" alt="Bandeira ${PREP[uf] === 'na' ? 'da' : PREP[uf] === 'no' ? 'do' : 'de'} ${nome(uf)}" width="${size === 'lg' ? 96 : 24}" height="${size === 'lg' ? 67 : 17}" decoding="async">`;

  const plural = (cat, n) => (n === 1 ? DATA[cat].singular : DATA[cat].plural);
  const fmt = (n) => n.toLocaleString('pt-BR');
  const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const VIEWS = ['areas', 'pinos', 'cobertura'];
  const state = { mode: 'todos', view: 'areas', gap: 'conversao', uf: null, statusFilter: 'todos', sort: { col: 'leads', dir: -1 } };

  // ======================================================================
  // Pinos e cobertura ("buracos")
  // Cada pino é um município (coordenadas oficiais do IBGE em coords.js).
  // Cobertura = distância em linha reta até o parceiro ATIVO mais próximo.
  // ======================================================================
  const COORDS = window.AGRO_COORDS || { k: 1, pontos: {}, interpretados: {}, semLocalizacao: [] };
  const PONTOS = (() => {
    const byPos = {};
    const get = (uf, m) => {
      const c = COORDS.pontos[`${uf}|${m}`];
      if (!c) return null;
      const id = `${uf}-${c[2]}_${c[3]}`;
      return byPos[id] || (byPos[id] = { id, uf, nome: COORDS.interpretados[`${uf}|${m}`] || m, x: c[0], y: c[1], lat: c[2], lon: c[3], cod: c[4], leads: 0, clientes: 0, pa: 0, pi: 0, parceiros: [], keys: [] });
    };
    ['leads', 'clientes'].forEach((cat) => Object.entries(DATA[cat].porEstado).forEach(([uf, r]) => r.municipios.forEach(([m, n]) => {
      const p = get(uf, m);
      if (p) { p[cat] += n; p.keys.push(`${cat}:${uf}:${m}`); }
    })));
    Object.entries(DATA.parceiros.porEstado).forEach(([uf, r]) => r.pessoas.forEach(([nm, m, st, id]) => {
      const p = get(uf, m);
      if (!p) return;
      p[st === 'Ativo' ? 'pa' : 'pi']++;
      const key = `parceiros:${id}`;
      p.parceiros.push([nm, st, key, id]);
      p.keys.push(key);
    }));
    return Object.values(byPos);
  })();
  const PIN_BY_ID = Object.fromEntries(PONTOS.map((p) => [p.id, p]));
  const PIN_BY_KEY = {};
  PONTOS.forEach((p) => p.keys.forEach((k) => { PIN_BY_KEY[k] = p.id; }));
  const PIN_BY_COD = {};
  PONTOS.forEach((p) => { if (p.cod) PIN_BY_COD[p.cod] = p; });
  // "Demanda" = o que existe no município, conforme a base selecionada
  const demanda = (p) => (state.mode === 'leads' ? p.leads : state.mode === 'clientes' ? p.clientes : p.leads + p.clientes);
  const activeCats = () => (state.mode === 'todos' ? CATS : [state.mode]);
  const hasData = (uf) => activeCats().some((c) => total(c, uf) > 0);

  // Ordem usada nas setas anterior/próximo
  function navOrder() {
    if (state.mode === 'todos') {
      return UF_LIST.filter((uf) => presenca(uf) > 0).sort((a, b) => nome(a).localeCompare(nome(b), 'pt-BR'));
    }
    return Object.keys(DATA[state.mode].porEstado);
  }

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  const ICON = {
    back: html`<svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg>`,
    next: html`<svg viewBox="0 0 24 24"><path d="M9 18l6-6-6-6"/></svg>`,
    info: html`<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 8h.01M11 12h1v5h1"/></svg>`
  };
  const catIcon = (c) => html`<svg class="cat-ic" aria-hidden="true"><use href="#ic-${c}"/></svg>`;

  // Bandeira que falhar ao carregar some sem quebrar o layout (sem onerror inline, por causa da CSP)
  document.addEventListener('error', (e) => {
    if (e.target instanceof HTMLImageElement && e.target.classList.contains('flag')) e.target.classList.add('flag-missing');
  }, true);

  // ---------- Cores ----------
  const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const mix = (a, b, t) => {
    const A = hex(a), B = hex(b);
    return '#' + A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, '0')).join('');
  };
  function fillFor(uf) {
    if (state.view !== 'areas') return hasData(uf) ? '#55554E' : '#3E3F3F';
    if (state.mode === 'todos') return PRESENCE[presenca(uf)];
    const n = total(state.mode, uf);
    return n ? mix(CAT_COR[state.mode][0], CAT_COR[state.mode][1], Math.sqrt(n / MAX[state.mode])) : COLOR_EMPTY;
  }

  // ======================================================================
  // Mapa
  // ======================================================================
  const svg = $('#map');
  const paths = {};
  const labels = {};
  let vb = BASE_VB.slice();
  let sel, hoverOutline, gMun, gMunLbl;
  const pinEls = [];

  const bboxCache = {};
  const bbox = (uf) => bboxCache[uf] || (bboxCache[uf] = paths[uf].getBBox());

  function el(tag, attrs = {}, parent) {
    const n = document.createElementNS(SVGNS, tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }

  function buildMap() {
    svg.setAttribute('viewBox', vb.join(' '));
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    const defs = el('defs', {}, svg);
    const clip = el('clipPath', { id: 'selClip' }, defs);
    const clipPath = el('path', {}, clip);

    const gStates = el('g', { class: 'states' }, svg);
    gMun = el('g', { class: 'mun-layer' }, svg);
    // Camada do estado selecionado: bandeira recortada no formato do estado + contorno
    const gSel = el('g', { class: 'sel-layer', 'aria-hidden': 'true' }, svg);
    sel = {
      g: gSel,
      clipPath,
      img: el('image', { 'clip-path': 'url(#selClip)', preserveAspectRatio: 'xMidYMid slice' }, gSel),
      shade: el('path', { class: 'sel-shade' }, gSel),
      outline: el('path', { class: 'sel-outline' }, gSel)
    };

    // Contorno de hover numa camada própria (mais leve que filtros CSS nos estados)
    hoverOutline = el('path', { class: 'hover-outline', 'aria-hidden': 'true' }, svg);
    const gLines = el('g', { class: 'lines' }, svg);
    const gLabels = el('g', { class: 'labels' }, svg);

    // Pinos: um grupo por município, um círculo por tipo (visibilidade controlada por CSS)
    const gPins = el('g', { class: 'pins' }, svg);
    const OFF = { leads: [-1, 0.7], clientes: [1, 0.7], pa: [-0.7, -1], pi: [0.7, -1] };
    PONTOS.forEach((p) => {
      const kinds = ['leads', 'clientes', 'pa', 'pi'].filter((k) => p[k] > 0);
      const g = el('g', { class: 'pin', 'data-id': p.id }, gPins);
      kinds.forEach((k) => {
        const [ox, oy] = kinds.length > 1 ? OFF[k] : [0, 0];
        const kind = el('g', { class: `pin-kind k-${k}`, transform: `translate(${ox * 8},${oy * 8})` }, g);
        el('path', { class: 'pin-marker', d: 'M0-5.4C-3-5.4-5.6-3.1-5.6-.2c0 3.8 5.6 10.2 5.6 10.2S5.6 3.6 5.6-.2C5.6-3.2 3-5.4 0-5.4Z' }, kind);
        el('circle', { class: 'pin-core', cx: 0, cy: -.9, r: 1.35 }, kind);
      });
      pinEls.push({ p, g });
    });

    GEO.states.forEach((s) => {
      paths[s.uf] = el('path', { d: s.d, class: 'uf', 'data-uf': s.uf, tabindex: 0, role: 'button' }, gStates);
      const conf = LABEL_POS[s.uf] || {};
      const [x, y] = conf.p || s.c;
      if (conf.out) el('line', { class: 'lbl-line', x1: s.c[0], y1: s.c[1], x2: x - 10, y2: y }, gLines);
      const g = el('g', { class: 'lbl' + (conf.out ? ' outside' : ''), transform: `translate(${x},${y})` }, gLabels);
      const inner = el('g', { class: 'lbl-inner' }, g);
      el('rect', { class: 'lbl-bg', x: -14, y: -10, width: 28, height: 20, rx: 6 }, inner);
      el('text', { class: 'lbl-uf', x: 0, y: 0 }, inner).textContent = s.uf;
      const badge = el('g', { class: 'badge', transform: 'translate(0,20)' }, inner);
      labels[s.uf] = { g, inner, badge };
    });
    gMunLbl = el('g', { class: 'mun-labels', 'aria-hidden': 'true' }, svg);
    svg.appendChild(gPins);

    svg.addEventListener('click', (e) => {
      const mun = e.target.closest('.mun');
      if (mun) { abrirCartao(mun.dataset.cod); return; }
      const pin = e.target.closest('.pin');
      if (pin) {
        const p = PIN_BY_ID[pin.dataset.id];
        go({ uf: p.uf, mode: state.mode === 'todos' ? 'todos' : state.mode }, { scroll: true }).then(() => flashKeys(p.keys));
        return;
      }
      const p = e.target.closest('.uf');
      if (p) go({ uf: p.dataset.uf }, { scroll: true });
    });
    svg.addEventListener('keydown', (e) => {
      const p = e.target.closest('.uf');
      if (p && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); go({ uf: p.dataset.uf }, { scroll: true }); }
    });
    svg.addEventListener('pointermove', onHover, { passive: true });
    svg.addEventListener('pointerleave', () => hoverState(null));
    svg.addEventListener('focusin', (e) => { const p = e.target.closest('.uf'); if (p) hoverState(p.dataset.uf); });
    svg.addEventListener('focusout', () => hoverState(null));
  }

  // ======================================================================
  // Municípios do estado selecionado (contornos oficiais do IBGE, carregados sob demanda)
  // ======================================================================
  const munCarregando = {};
  let munLbls = [];
  let munAtual = null;
  function carregarMunicipios(uf) {
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
  // Quantidade a mostrar no município conforme base e filtro
  function munValor(p) {
    if (!p) return 0;
    if (state.mode === 'leads') return p.leads;
    if (state.mode === 'clientes') return p.clientes;
    if (state.mode === 'parceiros') return state.statusFilter === 'ativo' ? p.pa : state.statusFilter === 'inativo' ? p.pi : p.pa + p.pi;
    return p.leads + p.clientes + p.pa + p.pi;
  }
  function munCor(p, max) {
    const n = munValor(p);
    if (!n) return '#3F403C';
    if (state.view !== 'areas') return '#4A4A44';
    if (state.mode === 'parceiros') {
      const at = state.statusFilter === 'inativo' ? 0 : p.pa;
      return at ? CAT_COR.parceiros[1] : '#FF764A';
    }
    if (state.mode === 'todos') {
      const tipos = [p.leads, p.clientes, p.pa + p.pi].filter(Boolean).length;
      return PRESENCE[tipos];
    }
    return mix(CAT_COR[state.mode][0], CAT_COR[state.mode][1], Math.sqrt(n / max));
  }
  function showMunicipios(uf) {
    while (gMun.firstChild) gMun.firstChild.remove();
    while (gMunLbl.firstChild) gMunLbl.firstChild.remove();
    munLbls = [];
    munAtual = null;
    fecharCartao();
    svg.classList.remove('mun-on');
    if (!uf) return;
    carregarMunicipios(uf).then((lista) => {
      if (!lista || state.uf !== uf) return;
      munAtual = { uf, lista, els: {} };
      const frag = document.createDocumentFragment();
      lista.forEach(([cod, nomeM, d]) => {
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
    const pts = munAtual.lista.map(([cod]) => PIN_BY_COD[cod]).filter(Boolean);
    const max = Math.max(1, ...pts.map(munValor));
    while (gMunLbl.firstChild) gMunLbl.firstChild.remove();
    munLbls = [];
    munAtual.lista.forEach(([cod, nomeM, , cx, cy]) => {
      const p = PIN_BY_COD[cod];
      const elp = munAtual.els[cod];
      const n = munValor(p);
      elp.style.fill = munCor(p, max);
      elp.classList.toggle('tem', n > 0);
      // nome das cidades com registro (na visão Estados)
      if (n > 0 && state.view === 'areas') {
        const g = el('g', { class: 'mun-lbl' }, gMunLbl);
        el('text', { class: 'ml-nome', x: 0, y: -2 }, g).textContent = nomeM;
        el('text', { class: 'ml-num', x: 0, y: 11 }, g).textContent = String(n);
        munLbls.push({ x: cx, y: cy, g, n, nome: nomeM });
      }
    });
    scaleLabels();
    evitarSobreposicao();
  }
  // Nomes que colidiriam ficam ocultos (prioridade para quem tem mais registros);
  // a cidade continua pintada e abre o cartão ao clicar
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

  // Cartão do município (clique/toque): o jeito mais simples de "clicar e ver"
  const cartao = document.createElement('div');
  cartao.className = 'mun-card';
  cartao.hidden = true;
  cartao.setAttribute('role', 'dialog');
  cartao.setAttribute('aria-label', 'Detalhes do município');
  function fecharCartao() {
    cartao.hidden = true;
    if (munSel) munSel.classList.remove('sel');
    munSel = null;
  }
  let munSel = null;
  function abrirCartao(cod) {
    if (!munAtual) return;
    const item = munAtual.lista.find((m) => m[0] === cod);
    if (!item) return;
    const p = PIN_BY_COD[cod];
    if (munSel) munSel.classList.remove('sel');
    munSel = munAtual.els[cod];
    munSel.classList.add('sel');
    munSel.parentNode.appendChild(munSel);
    const linha = (rot, n, cls) => (n ? html`<li><span class="dot ${cls}"></span>${rot}<b>${n}</b></li>` : '');
    const tem = p && (p.leads || p.clientes || p.pa || p.pi);
    setHTML(cartao, html`<div class="mc-head"><div><b>${item[1]}</b><span class="muted"> · ${munAtual.uf}</span></div>
        <button class="mc-close" data-action="fechar-cartao" aria-label="Fechar">×</button></div>
      ${tem ? html`<ul class="mc-rows">${linha('Leads', p.leads, 'k-leads')}${linha('Clientes', p.clientes, 'k-clientes')}${linha('Parceiros ativos', p.pa, 'ativo')}${linha('Parceiros inativos', p.pi, 'inativo')}</ul>
        ${p.parceiros.length ? html`<p class="mc-nomes">${p.parceiros.map((x) => x[0]).join(', ')}</p>` : ''}
        <button class="mc-ver" data-action="ver-lista">Ver na lista ao lado</button>`
        : html`<p class="mc-vazio">Nenhum lead, cliente ou parceiro nesta cidade.</p>`}`);
    cartao.dataset.cod = cod;
    cartao.hidden = false;
  }
  cartao.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.action === 'fechar-cartao') fecharCartao();
    if (b.dataset.action === 'ver-lista') {
      const p = PIN_BY_COD[cartao.dataset.cod];
      if (p) {
        if (window.innerWidth <= 960) panel.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
        flashKeys(p.keys);
      }
    }
  });

  // Contorno do estado selecionado
  function updateSelectionLayer() {
    sel.g.classList.remove('on');
    const uf = state.uf;
    if (!uf) return;
    const p = paths[uf];
    const d = p.getAttribute('d');
    const b = bbox(uf);
    [sel.clipPath, sel.shade, sel.outline].forEach((n) => n.setAttribute('d', d));
    sel.img.setAttribute('x', b.x); sel.img.setAttribute('y', b.y);
    sel.img.setAttribute('width', b.width); sel.img.setAttribute('height', b.height);
    sel.g.classList.add('on');
  }

  // Só o que muda ao selecionar um estado (barato)
  function updateSelection() {
    UF_LIST.forEach((uf) => {
      const on = state.uf === uf;
      paths[uf].classList.toggle('is-selected', on);
      paths[uf].setAttribute('aria-pressed', String(on));
      labels[uf].g.classList.toggle('is-selected', on);
    });
    svg.classList.toggle('has-selection', !!state.uf);
    svg.dataset.status = state.statusFilter;
    pinEls.forEach(({ p, g }) => g.classList.toggle('off', !!state.uf && p.uf !== state.uf));
    updateSelectionLayer();
    showMunicipios(state.uf);
  }

  // Cores, selos e legenda: só quando a base (modo) muda
  function updateMap() {
    const cats = activeCats();
    pintarMunicipios();
    svg.dataset.mode = state.mode;
    svg.dataset.view = state.view;
    UF_LIST.forEach((uf) => {
      const p = paths[uf];
      const has = hasData(uf);
      p.style.fill = fillFor(uf);
      p.classList.toggle('is-empty', !has);
      p.setAttribute('aria-label', `${nome(uf)}: ${cats.map((c) => `${total(c, uf)} ${plural(c, total(c, uf))}`).join(', ')}`);

      const L = labels[uf];
      L.g.classList.toggle('is-empty', !has);
      L.g.classList.toggle('has-data', has);
      while (L.badge.firstChild) L.badge.firstChild.remove();
      if (!has) return;
      if (state.mode === 'todos') {
        el('rect', { x: -27, y: -10, width: 54, height: 20, rx: 10 }, L.badge);
        const t = el('text', { x: 0, y: 0.5 }, L.badge);
        CATS.forEach((c, i) => {
          el('tspan', { class: total(c, uf) ? `t-${c}` : 'dim', dx: i ? 5 : 0 }, t).textContent = c[0].toUpperCase();
        });
      } else {
        const n = String(total(state.mode, uf));
        const w = 16 + n.length * 8;
        el('rect', { x: -w / 2, y: -10, width: w, height: 20, rx: 10 }, L.badge);
        el('text', { x: 0, y: 0.5 }, L.badge).textContent = n;
      }
    });
    renderLegend();
  }

  function renderLegend() {
    if (state.view !== 'areas') {
      const k = (cat) => state.mode === 'todos' || state.mode === cat;
      setHTML($('#legend'), html`
        ${k('leads') ? html`<span class="sw"><i class="pin-sw" data-color="#36A9FF"></i>Leads</span>` : ''}
        ${k('clientes') ? html`<span class="sw"><i class="pin-sw" data-color="#00E5C4"></i>Clientes</span>` : ''}
        ${k('parceiros') ? html`<span class="sw"><i class="pin-sw" data-color="#35D07F"></i>Parceiro ativo</span><span class="sw"><i class="pin-sw" data-color="#FF764A"></i>Parceiro inativo</span>` : ''}
        <span>Cada pino mostra a presença no município; passe o cursor para ver quantidades</span>`);
      if (state.view === 'cobertura') {
        const L = {
          conversao: html`<span class="sw"><i class="pin-sw" data-color="#36A9FF"></i>Cidade com leads e nenhum cliente</span>`,
          parceiros: html`<span class="sw"><i class="pin-sw" data-color="#FF764A"></i>Parceiro inativo</span>`,
          presenca: html`<span class="sw"><i data-color="#6B3B3B"></i>Estado sem presença</span>`
        };
        setHTML($('#legend'), html`<span class="legend-title">${GAPS[state.gap].titulo}:</span>${L[state.gap]}`);
      }
      return;
    }
    if (state.mode === 'todos') {
      setHTML($('#legend'), html`
        <span class="sw"><i data-color="${PRESENCE[3]}"></i>Nas 3 bases</span>
        <span class="sw"><i data-color="${PRESENCE[2]}"></i>Em 2 bases</span>
        <span class="sw"><i data-color="${PRESENCE[1]}"></i>Em 1 base</span>
        <span class="sw"><i data-color="${COLOR_EMPTY}"></i>Sem registro</span>
        <span>Selo <b class="gold">L C P</b> = leads, clientes, parceiros (apagado = ausente)</span>`);
    } else {
      const d = DATA[state.mode];
      setHTML($('#legend'), html`
        <span class="scale">Menos <span class="ramp ramp-${state.mode}"></span> Mais</span>
        <span class="sw"><i data-color="${COLOR_EMPTY}"></i>Sem ${d.plural}</span>
        <span>Número no estado = quantidade de ${d.plural}</span>`);
    }
  }

  // Mapa da visão "Oportunidades": mostra apenas o tipo escolhido
  function renderCoverage() {
    svg.dataset.gap = state.gap;
    const on = state.view === 'cobertura';
    const a = on ? analise(state.uf) : null;
    const hit = new Set();
    if (on && state.gap === 'conversao') a.conversao.forEach((p) => hit.add(p.id));
    if (on && state.gap === 'parceiros') a.parados.forEach((x) => x.pin && hit.add(x.pin));
    pinEls.forEach(({ p, g }) => g.classList.toggle('hit', hit.has(p.id)));
    const semPresenca = new Set(on && state.gap === 'presenca' ? a.presenca : []);
    UF_LIST.forEach((uf) => paths[uf].classList.toggle('gap-uf', semPresenca.has(uf)));
  }

  // Destaca no mapa o pino ligado a um item do painel
  let pinHL = null;
  function highlightPin(id) {
    if ((pinHL ? pinHL.dataset.id : null) === (id || null)) return;
    if (pinHL) pinHL.classList.remove('hl');
    pinHL = null;
    const pe = id && pinEls.find((x) => x.p.id === id);
    if (!pe) return;
    pinHL = pe.g;
    pinHL.classList.add('hl');
    pinHL.parentNode.appendChild(pinHL); // traz para frente
  }

  // ---------- Tooltip ----------
  const tip = $('#tooltip');
  let hovered = null;
  // Processa o hover no máximo uma vez por frame e só com mouse (no toque não há hover)
  let lastMove = null, moveRaf = 0;
  function onHover(e) {
    if (e.pointerType && e.pointerType !== 'mouse') return;
    lastMove = e;
    if (moveRaf) return;
    moveRaf = requestAnimationFrame(() => {
      moveRaf = 0;
      if (zooming) return;
      const mun = lastMove.target.closest && lastMove.target.closest('.mun');
      if (mun) { munHover(mun.dataset.cod); placeTip(lastMove.clientX, lastMove.clientY); return; }
      const pin = lastMove.target.closest && lastMove.target.closest('.pin');
      if (pin) { pinHover(PIN_BY_ID[pin.dataset.id]); placeTip(lastMove.clientX, lastMove.clientY); return; }
      const p = lastMove.target.closest && lastMove.target.closest('.uf');
      hoverState(p ? p.dataset.uf : null);
      if (p) placeTip(lastMove.clientX, lastMove.clientY);
    });
  }
  // Mantém o tooltip dentro da área do mapa
  // Tooltip ao lado do cursor (acima e à direita); troca de lado se faltar espaço — nunca cobre o ponteiro
  function placeTip(cx, cy) {
    const r = svg.parentElement.getBoundingClientRect();
    const w = tip.offsetWidth || 180, h = tip.offsetHeight || 90;
    const x = cx - r.left, y = cy - r.top;
    let left = x + 16, top = y - h - 12;
    if (left + w > r.width - 4) left = x - w - 16; // sem espaço à direita: vai para a esquerda
    if (top < 4) top = y + 26; // sem espaço acima: vai para baixo da seta do mouse
    if (top + h > r.height - 4) top = Math.max(4, r.height - h - 4);
    tip.style.left = `${Math.max(4, left)}px`;
    tip.style.top = `${top}px`;
  }
  function munHover(cod) {
    const id = 'mun:' + cod;
    if (hovered === id || !munAtual) return;
    hoverState(null);
    hovered = id;
    const item = munAtual.lista.find((m) => m[0] === cod);
    const p = PIN_BY_COD[cod];
    const row = (label, n) => (n ? html`<div class="tt-row"><span>${label}</span><strong>${n}</strong></div>` : '');
    setHTML(tip, html`<div class="tt-title"><span><b>${munAtual.uf}</b>${item ? item[1] : ''}</span></div>
      ${p ? html`${row('Leads', p.leads)}${row('Clientes', p.clientes)}${row('Parceiros ativos', p.pa)}${row('Parceiros inativos', p.pi)}` : html`<div class="tt-note">Sem registros</div>`}
      <div class="tt-cta">Clique para ver detalhes</div>`);
    tip.hidden = false;
  }
  function pinHover(p) {
    const id = 'pin:' + p.id;
    if (hovered === id) return;
    hoverState(null);
    hovered = id;
    const row = (label, n) => (n ? html`<div class="tt-row"><span>${label}</span><strong>${n}</strong></div>` : '');
    const nomes = p.parceiros.slice(0, 3).map((x) => x[0]).join(', ') + (p.parceiros.length > 3 ? '…' : '');
    setHTML(tip, html`<div class="tt-title">${flag(p.uf)}<span><b>${p.uf}</b>${p.nome}</span></div>
      ${row('Leads', p.leads)}${row('Clientes', p.clientes)}${row('Parceiros ativos', p.pa)}${row('Parceiros inativos', p.pi)}
      ${p.parceiros.length ? html`<div class="tt-note">${nomes}</div>` : ''}
      <div class="tt-cta">Clique para ver detalhes</div>`);
    tip.hidden = false;
  }
  function hoverState(uf) {
    if (hovered === uf) return;
    if (hovered) $$(`tr[data-uf="${hovered}"]`).forEach((r) => r.classList.remove('is-hover'));
    hovered = uf;
    if (!uf) { tip.hidden = true; hoverOutline.removeAttribute('d'); return; }
    hoverOutline.setAttribute('d', paths[uf].getAttribute('d'));
    $$(`tr[data-uf="${uf}"]`).forEach((r) => r.classList.add('is-hover'));

    const rows = activeCats().map((c) => {
      const r = reg(c, uf);
      return html`<div class="tt-row"><span>${DATA[c].titulo}</span><strong>${r ? html`${r.total} <span class="muted">(${r.pct})</span>` : '—'}</strong></div>`;
    });
    setHTML(tip, html`<div class="tt-title">${flag(uf)}<span><b>${uf}</b>${nome(uf)}</span></div>${rows}
      <div class="tt-cta">${state.uf === uf ? 'Selecionado' : 'Clique para ver detalhes'}</div>`);
    tip.hidden = false;
    if (document.activeElement === paths[uf]) {
      // posiciona o tooltip sobre o estado quando a navegação é por teclado
      const b = paths[uf].getBoundingClientRect();
      placeTip(b.left + b.width / 2, b.top + b.height / 2);
    }
  }

  // ---------- Zoom fluido ----------
  // Em vez de redesenhar o SVG a cada frame (lento), troca o viewBox uma única vez e
  // anima apenas um transform CSS, que roda na GPU. A aproximação já é desenhada na
  // resolução final (nítida); o afastamento parte da imagem atual (também nítida).
  const ZOOM_MS = 520;
  const ZOOM_EASE = 'cubic-bezier(.22,.61,.36,1)';
  let zoomAnim = null, zoomCommit = null, zooming = false;

  // Projeção de um viewBox no elemento (preserveAspectRatio: meet)
  function proj(v, r) {
    const k = Math.min(r.width / v[2], r.height / v[3]);
    return { k, ox: (r.width - v[2] * k) / 2 - v[0] * k, oy: (r.height - v[3] * k) / 2 - v[1] * k };
  }
  // Transform que faz um SVG desenhado com o viewBox R parecer exibir o viewBox B
  function transformFor(R, B, r) {
    const a = proj(R, r), b = proj(B, r);
    const k = b.k / a.k;
    return `translate(${b.ox - k * a.ox}px, ${b.oy - k * a.oy}px) scale(${k})`;
  }
  function setVB(v) {
    vb = v.slice();
    svg.setAttribute('viewBox', vb.join(' '));
    scaleLabels();
  }
  function zoomTo(target) {
    hoverState(null);
    // zoom anterior ainda rodando: conclui na hora (de forma síncrona) antes do próximo
    if (zoomAnim) { const a = zoomAnim; zoomCommit(); a.cancel(); }
    $('#resetZoom').hidden = target === BASE_VB;
    if (target.every((v, i) => Math.abs(v - vb[i]) < 0.5)) return;
    const r = svg.getBoundingClientRect();
    if (reduceMotion || !r.width || !svg.animate) { setVB(target); return; }

    const from = vb.slice();
    const zoomIn = target[2] < from[2];
    let frames;
    if (zoomIn) {
      setVB(target); // desenha já no zoom final e anima a partir do enquadramento anterior
      frames = [{ transform: transformFor(target, from, r) }, { transform: 'none' }];
    } else {
      svg.classList.add('zoom-out'); // rótulos somem no afastamento e voltam no fim
      frames = [{ transform: 'none' }, { transform: transformFor(from, target, r) }];
    }
    zooming = true;
    const anim = svg.animate(frames, { duration: ZOOM_MS, easing: ZOOM_EASE });
    zoomAnim = anim;
    const done = () => {
      if (zoomAnim !== anim) return;
      zoomAnim = null;
      zoomCommit = null;
      zooming = false;
      if (!zoomIn) setVB(target);
      svg.classList.remove('zoom-out');
    };
    zoomCommit = done;
    anim.onfinish = done;
  }
  // Rótulos mantêm tamanho legível no zoom e em telas estreitas
  function scaleLabels() {
    const z = BASE_VB[2] / vb[2];
    const narrow = Math.min(2, Math.max(1, 640 / (svg.clientWidth || 640)));
    const s = Math.pow(narrow, 0.8) / Math.pow(z, 0.75);
    for (const uf in labels) labels[uf].inner.setAttribute('transform', `scale(${s.toFixed(3)})`);
    const ps = (Math.pow(narrow, 0.6) / Math.pow(z, 0.85)).toFixed(3);
    pinEls.forEach(({ p, g }) => g.setAttribute('transform', `translate(${p.x},${p.y}) scale(${ps})`));
    const px = Math.min((svg.clientWidth || 600) / vb[2], (svg.clientHeight || 600) / vb[3]);
    const ms = (1 / px).toFixed(4);
    munLbls.forEach(({ x, y, g }) => g.setAttribute('transform', `translate(${x},${y}) scale(${ms})`));
  }
  function zoomToState(uf) {
    const b = bbox(uf);
    const aspect = BASE_VB[3] / BASE_VB[2];
    // foco total: o estado preenche a área do mapa (com uma pequena margem)
    const w = Math.max(b.width * 1.1, (b.height * 1.1) / aspect, 16);
    const h = w * aspect;
    const x = b.x + b.width / 2 - w / 2;
    const y = b.y + b.height / 2 - h / 2;
    zoomTo([x, y, w, h]);
  }

  // ======================================================================
  // Painel
  // ======================================================================
  const panel = $('#panel');
  function showPanel(content) {
    setHTML(panel, content);
    panel.scrollTop = 0;
    countUp(panel);
  }

  // Três tipos de oportunidade, cada um com significado e ação claros
  const GAPS = {
    conversao: { titulo: 'Leads sem cliente' },
    parceiros: { titulo: 'Parceiros inativos' },
    presenca: { titulo: 'Sem presença' }
  };

  const analiseCache = new Map();
  function analise(uf) {
    const ck = state.mode + '|' + (uf || '');
    if (!analiseCache.has(ck)) { if (analiseCache.size > 40) analiseCache.clear(); analiseCache.set(ck, calcAnalise(uf)); }
    return analiseCache.get(ck);
  }
  function calcAnalise(uf) {
    const pts = PONTOS.filter((p) => !uf || p.uf === uf);
    const parados = [];
    Object.entries(DATA.parceiros.porEstado).forEach(([u, r]) => {
      if (uf && u !== uf) return;
      r.pessoas.forEach(([nm, cidade, st, id]) => {
        if (st !== 'Inativo') return;
        const key = `parceiros:${id}`;
        parados.push({ uf: u, nome: nm, cidade, key, pin: PIN_BY_KEY[key] || '' });
      });
    });
    return {
      conversao: state.mode === 'clientes' ? [] : pts.filter((p) => p.leads > 0 && p.clientes === 0).sort((x, y) => y.leads - x.leads),
      parados,
      presenca: uf ? [] : UF_LIST.filter((u) => !hasData(u)).sort((x, y) => nome(x).localeCompare(nome(y), 'pt-BR'))
    };
  }
  const qtd = (n, cat) => `${n} ${plural(cat, n)}`;

  function gapLi(uf, titulo, sub, num, keys, pin, dot) {
    return html`<li data-goto-uf="${uf}" data-keys="${keys.join('||')}" data-pin="${pin || ''}" tabindex="0">
      ${dot ? html`<span class="dot ${dot}"></span>` : flag(uf)}
      <span class="g-main"><span class="g-name">${titulo} <span class="muted">· ${uf}</span></span><span class="g-sub">${sub}</span></span>
      <span class="g-num">${num != null ? num : ''}</span></li>`;
  }
  // Cada buraco vira uma frase direta, com a ação recomendada ao lado.
  const nCidades = (n) => (n === 1 ? '1 cidade' : `${n} cidades`);
  const OPP_ICON = {
    conversao: html`<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.2"/></svg>`,
    parceiros: html`<svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="4"/><path d="M2 21c0-4 3-7 7-7s7 3 7 7"/><path d="M17 8v6M21 8v6"/></svg>`,
    presenca: html`<svg viewBox="0 0 24 24"><path d="M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3z"/><path d="M9 3v15M15 6v15"/></svg>`
  };
  function oppFrase(k, a) {
    if (k === 'conversao') {
      const n = a.conversao.length;
      return n ? html`<b>${nCidades(n)}</b> ${n === 1 ? 'tem' : 'têm'} leads, mas nenhum cliente` : html`Toda cidade com leads já tem cliente`;
    }
    if (k === 'parceiros') {
      const n = a.parados.length;
      return n ? html`<b>${n === 1 ? '1 parceiro inativo' : `${n} parceiros inativos`}</b> para reativar` : html`Todos os parceiros estão ativos`;
    }
    const n = a.presenca.length;
    const oque = state.mode === 'todos' ? 'nenhum lead, cliente ou parceiro' : `nenhum ${DATA[state.mode].singular}`;
    return n ? html`<b>${n === 1 ? '1 estado' : `${n} estados`}</b> sem ${oque}` : html`Presença em todos os estados`;
  }
  const OPP_ACAO = { conversao: 'Converter leads', parceiros: 'Reativar parceiro', presenca: 'Prospectar' };

  function gapList(a) {
    if (state.gap === 'presenca') {
      return a.presenca.length ? html`<div class="flags-row">${a.presenca.map((u) => html`<span>${flag(u)}${nome(u)}</span>`)}</div>` : '';
    }
    const itens = {
      conversao: () => a.conversao.map((p) => gapLi(p.uf, p.nome, `${qtd(p.leads, 'leads')}, nenhum cliente`, p.leads, p.keys, p.id)),
      parceiros: () => a.parados.map((x) => gapLi(x.uf, x.nome, `${x.cidade} · Inativo`, null, [x.key], x.pin, 'inativo'))
    }[state.gap]();
    const LIM = 8;
    if (!itens.length) return '';
    const curto = !state.verTodos && itens.length > LIM;
    return html`<ul class="gap-list">${curto ? itens.slice(0, LIM) : itens}</ul>${curto ? html`<button class="ver-todos" data-action="ver-todos">Ver todas (${itens.length})</button>` : ''}`;
  }
  function gapsSection(uf) {
    if (uf && state.gap === 'presenca') state.gap = 'conversao';
    const a = analise(uf);
    const tipos = Object.keys(GAPS).filter((k) => !(uf && k === 'presenca'));
    const qtdTipo = (k) => (k === 'parceiros' ? a.parados : a[k]).length;
    const linhas = tipos.map((k) => {
      const n = qtdTipo(k), aberto = state.gap === k;
      return html`<div class="opp ${n ? '' : 'resolvido'} ${aberto ? 'aberto' : ''}">
        <button class="opp-head" data-gap="${k}" aria-expanded="${aberto}">
          <span class="opp-ic">${OPP_ICON[k]}</span>
          <span class="opp-frase">${oppFrase(k, a)}</span>
          ${n ? html`<span class="opp-acao">${OPP_ACAO[k]}</span>` : html`<span class="opp-ok">✓</span>`}
        </button>
        ${aberto ? html`<div class="opp-body">
          ${gapList(a)}
        </div>` : ''}
      </div>`;
    });
    return html`<section class="gaps" id="gapsBox">
      <h3>${uf ? `O que fazer ${noEstado(uf)}` : 'O que fazer: oportunidades no mapa'}</h3>
      <p class="gaps-hint">Toque numa linha para ver as cidades no mapa e na lista.</p>
      <div class="opps">${linhas}</div>
    </section>`;
  }
  function refreshGaps() {
    const box = $('#gapsBox');
    if (!box) return;
    const tmp = document.createElement('div');
    setHTML(tmp, gapsSection(state.uf));
    box.replaceWith(tmp.firstElementChild);
  }
  function setGap(k) {
    if (!GAPS[k] || state.gap === k) return;
    state.gap = k;
    state.verTodos = false;
    renderCoverage();
    renderLegend();
    refreshGaps();
  }
  function flashKeys(keys) {
    const set = new Set(keys);
    const els = $$('[data-key]', panel).filter((n) => set.has(n.dataset.key));
    if (!els.length) return;
    setTimeout(() => {
      els[0].scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' });
      els.forEach((e) => { e.classList.remove('flash'); void e.offsetWidth; e.classList.add('flash'); });
    }, 450);
  }

  function renderOverview() {
    if (state.mode === 'todos') {
      const cards = CATS.map((c) => {
        const d = DATA[c];
        return html`<button class="ov-card" data-goto-mode="${c}">${catIcon(c)}<div class="ov-num" data-count-to="${baseTotal(c)}">${fmt(baseTotal(c))}</div>
          <div class="ov-title">${d.titulo}</div><div class="ov-sub">${NUF[c]} estados</div></button>`;
      });
      const ufs = UF_LIST.filter((uf) => presenca(uf) > 0);
      const { col, dir } = state.sort;
      const byName = (a, b) => nome(a).localeCompare(nome(b), 'pt-BR');
      ufs.sort((a, b) => (col === 'uf' ? dir * byName(a, b) : dir * (total(col, a) - total(col, b)) || byName(a, b)));
      const th = (c, label) => html`<th class="${c === 'uf' ? '' : 'num'}" ${col === c ? html`aria-sort="${dir < 0 ? 'descending' : 'ascending'}"` : ''}><button data-sort="${c}" aria-label="Ordenar por ${label}">${CATS.includes(c) ? html`<svg class="th-ic" aria-hidden="true"><use href="#ic-${c}"/></svg>` : ''}<span class="th-full">${label}</span>${col === c ? (dir < 0 ? ' ↓' : ' ↑') : ''}</button></th>`;
      const rows = ufs.map((uf) => html`<tr data-uf="${uf}" tabindex="0"><td class="uf-cell">${flag(uf)}${uf}</td><td class="st-name">${nome(uf)}</td>
        ${CATS.map((c) => html`<td class="num ${total(c, uf) ? '' : 'zero'}">${total(c, uf) || '—'}</td>`)}</tr>`);
      showPanel(html`
        <div><p class="eyebrow">Visão geral</p><h2>Resumo por estado</h2></div>
        ${state.view === 'cobertura' ? gapsSection(null) : ''}
        <div class="overview-cards">${cards}</div>
        <div><table class="rank"><thead><tr><th>UF</th>${th('uf', 'Estado')}${th('leads', 'Leads')}${th('clientes', 'Clientes')}${th('parceiros', 'Parceiros')}</tr></thead>
          <tbody>${rows}</tbody>
          <tfoot><tr><td></td><td>Total com UF</td>${CATS.map((c) => html`<td class="num">${DATA[c].totalComUF}</td>`)}</tr></tfoot></table>
          <p class="table-note">Totais com UF identificada, conforme cada mapa. Clique no cabeçalho para ordenar.</p></div>`);
    } else {
      const c = state.mode, d = DATA[c];
      const rows = Object.entries(d.porEstado).map(([uf, r]) => html`<tr data-uf="${uf}" tabindex="0">
        <td class="uf-cell">${flag(uf)}${uf}</td><td class="st-name">${nome(uf)}</td><td class="num">${r.total}</td><td class="num muted">${r.pct}</td>
        <td class="bar-cell"><div class="bar"><i data-w="${(r.total / MAX[c]) * 100}"></i></div></td></tr>`);
      showPanel(html`
        <div><p class="eyebrow">${catIcon(c)}${d.titulo} · ${NUF[c]} estados</p><h2>Resumo por estado</h2></div>
        ${state.view === 'cobertura' ? gapsSection(null) : ''}
        <div><table class="rank rank-${c}"><thead><tr><th>UF</th><th>Estado</th><th class="num">${d.titulo}</th><th class="num">%</th><th class="bar-cell"></th></tr></thead>
          <tbody>${rows}</tbody><tfoot><tr><td></td><td>Total com UF</td><td class="num">${d.totalComUF}</td><td></td><td class="bar-cell"></td></tr></tfoot></table>
          <p class="table-note">${d.notaPercentual}</p></div>`);
    }
  }

  function catSection(cat, uf) {
    const d = DATA[cat];
    const r = reg(cat, uf);
    if (!r) {
      const outras = CATS.filter((c) => c !== cat && total(c, uf) > 0);
      return html`<section class="cat is-empty" id="sec-${cat}">
        <div class="cat-head"><h3>${catIcon(cat)}${d.titulo}</h3><span class="cat-total dim">0</span></div>
        <div class="cat-empty">Nenhum ${d.singular} ${noEstado(uf)} no mapa de ${d.plural}.
          ${state.mode !== 'todos' && outras.length ? html`<div class="also">Este estado aparece em:
            ${outras.map((c) => html`<button data-goto-mode="${c}">${catIcon(c)}${DATA[c].titulo} (${total(c, uf)})</button>`)}</div>` : ''}
        </div></section>`;
    }
    const head = html`<div class="cat-head"><div><h3>${catIcon(cat)}${d.titulo}</h3><div class="cat-meta left">${posicao(cat, uf)}º de ${NUF[cat]} estados</div></div>
      <div class="cat-figs"><div class="cat-meta"><strong>${r.pct}</strong><br>Do total com UF</div><span class="cat-total" data-count-to="${r.total}">${r.total}</span></div></div>`;
    let body;
    if (cat === 'parceiros') {
      body = parceirosBody(uf);
    } else {
      const mmax = Math.max(1, ...r.municipios.map((m) => m[1]));
      body = html`<div class="cat-body">
        ${r.municipios.length ? html`<ul class="muni">${r.municipios.map(([m, n]) => html`<li data-key="${cat}:${uf}:${m}">
          <span class="m-name">${m}</span><span class="m-n">${n}</span><span class="m-bar"><i data-w="${(n / mmax) * 100}"></i></span></li>`)}</ul>` : ''}
        ${r.nota ? html`<div class="note">${ICON.info}<span>${r.nota}</span></div>` : ''}</div>`;
    }
    return html`<section class="cat" id="sec-${cat}">${head}${body}</section>`;
  }

  function parceirosBody(uf) {
    const pessoas = reg('parceiros', uf).pessoas;
    const at = pessoas.filter((p) => p[2] === 'Ativo').length;
    const ina = pessoas.length - at;
    const f = state.statusFilter;
    const list = pessoas.map((p, i) => [p, i]).filter(([p]) => f === 'todos' || p[2].toLowerCase() === f);
    const btn = (v, label, dot) => html`<button data-status="${v}" aria-pressed="${f === v}">${dot ? html`<span class="dot ${v}"></span>` : ''}${label}</button>`;
    const pct = (n) => (pessoas.length ? (n / pessoas.length) * 100 : 0);
    return html`<div class="cat-body" id="parceirosBody">
      <div class="status-bar" title="${at} ativos, ${ina} inativos"><span class="a" data-w="${pct(at)}"></span><span class="i" data-w="${pct(ina)}"></span></div>
      <div class="filters" role="group" aria-label="Filtrar por status">${btn('todos', `Todos (${pessoas.length})`)}${btn('ativo', `Ativos (${at})`, true)}${btn('inativo', `Inativos (${ina})`, true)}</div>
      ${list.length
        ? html`<ul class="people">${list.map(([p]) => {
          const st = p[2].toLowerCase();
          const alvo = st === 'ativo' ? 'Inativo' : 'Ativo';
          return html`<li data-key="parceiros:${p[3]}"><span class="dot ${st}"></span><span class="p-name">${p[0]}</span>
            <span class="p-city">${p[1]}</span><span class="partner-state"><span class="p-status ${st}">${p[2]}</span>
              ${window.AGRO_CAN_EDIT_PARTNERS && p[3] > 0 ? html`<button type="button" class="partner-toggle ${st === 'ativo' ? 'to-inactive' : 'to-active'}" data-partner-status="${alvo}" data-partner-id="${p[3]}" data-expected-status="${p[2]}" aria-label="Marcar ${p[0]} como ${alvo.toLowerCase()}">${st === 'ativo' ? 'Inativar' : 'Ativar'}</button>` : ''}
            </span></li>`;
        })}</ul>`
        : html`<p class="muted small">Nenhum parceiro ${f} ${noEstado(uf)}.</p>`}
    </div>`;
  }

  function renderState(uf) {
    const order = navOrder();
    const idx = order.indexOf(uf);
    const summary = state.mode === 'todos'
      ? html`<div class="summary">${CATS.map((c) => html`<button data-jump="${c}" class="${total(c, uf) ? '' : 'zero'}">
          ${catIcon(c)}<div class="s-num" data-count-to="${total(c, uf)}">${total(c, uf)}</div><div class="s-lbl">${DATA[c].titulo}</div></button>`)}</div>`
      : '';
    showPanel(html`
      <div class="state-nav"><button class="back-btn" data-action="home">${ICON.back}Visão geral</button>
        <div class="arrows">
          <button class="icon-btn" data-nav="-1" aria-label="Estado anterior" ${idx <= 0 ? html`disabled` : ''}>${ICON.back}</button>
          <span class="nav-pos">${idx >= 0 ? `${idx + 1}/${order.length}` : ''}</span>
          <button class="icon-btn" data-nav="1" aria-label="Próximo estado" ${idx === -1 || idx >= order.length - 1 ? html`disabled` : ''}>${ICON.next}</button>
        </div></div>
      <div class="state-hero">
        <img class="hero-bg" src="${flagSrc(uf, 'mini')}" alt="" aria-hidden="true">
        <div class="hero-content">${flag(uf, 'lg')}
          <div><p class="eyebrow">Região ${REGIAO[uf]} · ${uf}</p><h2>${nome(uf)}</h2></div></div>
      </div>
      ${summary}
      ${state.view === 'cobertura' ? gapsSection(uf) : ''}
      ${activeCats().map((c) => catSection(c, uf))}`);
  }

  const renderPanel = () => (state.uf ? renderState(state.uf) : renderOverview());

  // Animação de contagem nos números (respeita "reduzir movimento")
  function countUp(root) {
    if (reduceMotion || document.body.classList.contains('welcome-open')) return;
    $$('[data-count-to]', root).forEach((e) => {
      const to = Number(e.dataset.countTo) || 0;
      if (to < 2) return;
      const t0 = performance.now(), D = 650;
      const tick = (now) => {
        const t = Math.min(1, (now - t0) / D);
        e.textContent = fmt(Math.round(to * (1 - Math.pow(1 - t, 3))));
        if (t < 1) requestAnimationFrame(tick);
      };
      e.textContent = '0';
      requestAnimationFrame(tick);
    });
  }

  // ---------- KPIs e fonte ----------
  function renderKpis() {
    const kpis = $('#kpis');
    const parceirosAtivos = Object.values(DATA.parceiros.porEstado).flatMap((r) => r.pessoas).filter((p) => p[2] === 'Ativo').length;
    const parceirosInativos = DATA.parceiros.totalComUF - parceirosAtivos;
    setHTML(kpis, activeCats().map((c) => {
      const d = DATA[c];
      return html`<div class="kpi-group" data-cat="${c}"><h4><span class="kg-title">${catIcon(c)}${d.titulo}</span></h4><div class="kpi-row">
        ${d.kpis.map((k) => {
          const valor = c === 'parceiros' && k.status === 'ativo' ? parceirosAtivos : c === 'parceiros' && k.status === 'inativo' ? parceirosInativos : k.valor;
          return html`<div class="kpi ${k.status}"><div class="k-lbl">${k.rotulo}</div><div class="k-val" data-count-to="${valor}">${fmt(valor)}</div><div class="k-sub">${k.sub}</div></div>`;
        })}
      </div></div>`;
    }));
    countUp(kpis);
    setHTML($('#fonte'), activeCats().map((c) => html`<p><b>Fonte (${DATA[c].plural}):</b> ${DATA[c].fonte}</p>`));
  }

  // ======================================================================
  // Navegação (com histórico do navegador: voltar/avançar funcionam)
  // ======================================================================
  const HASH = /^#(todos|leads|clientes|parceiros)(?:\/([A-Za-z]{2}))?(?:\+(pinos|cobertura))?$/;
  const hashFor = (mode, uf, view) => `#${mode}${uf ? '/' + uf : ''}${view && view !== 'areas' ? '+' + view : ''}`;
  function parseHash() {
    const m = HASH.exec(location.hash);
    if (!m) return null;
    const uf = m[2] ? m[2].toUpperCase() : null;
    return { mode: m[1], uf: uf && UF_SET.has(uf) ? uf : null, view: m[3] || 'areas' };
  }

  // Ponto único de mudança de estado da aplicação
  let renderToken = 0;
  function go(next, { push = true, scroll = false } = {}) {
    const mode = next.mode !== undefined ? (MODES.includes(next.mode) ? next.mode : 'todos') : state.mode;
    const uf = next.uf !== undefined ? (next.uf && UF_SET.has(next.uf) ? next.uf : null) : state.uf;
    const modeChanged = mode !== state.mode;
    const ufChanged = uf !== state.uf;
    const view = next.view !== undefined && VIEWS.includes(next.view) ? next.view : state.view;
    const viewChanged = view !== state.view;
    if (!modeChanged && !ufChanged && !viewChanged && !next.force) return Promise.resolve();
    state.view = view;
    $$('.views button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === view)));

    state.mode = mode;
    state.uf = uf;
    if (ufChanged || modeChanged) state.statusFilter = 'todos';

    $$('.modes button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.mode === mode)));
    $('#mapTitle').textContent = mode === 'todos' ? 'Leads, clientes e parceiros' : `${DATA[mode].titulo} por estado`;
    document.title = `${uf ? nome(uf) + ' · ' : ''}${mode === 'todos' ? 'Todas as bases' : DATA[mode].titulo} · AgroEasy`;

    // a animação do zoom começa primeiro; o resto renderiza enquanto ela roda na GPU
    if (ufChanged || next.force) {
      if (uf) zoomToState(uf); else zoomTo(BASE_VB);
    }
    if (modeChanged || viewChanged || next.force) { updateMap(); renderCoverage(); }
    updateSelection();
    const token = ++renderToken;
    const renderRest = () => {
      if (token !== renderToken) return; // um clique mais recente já vai desenhar
      renderPanel();
      if (modeChanged || next.force) renderKpis();
    };
    const deferred = zoomAnim && !next.force;
    if (deferred) requestAnimationFrame(() => setTimeout(renderRest, 0)); else renderRest();

    const h = hashFor(mode, uf, view);
    if (location.hash !== h) history[push ? 'pushState' : 'replaceState'](null, '', h);
    const painelPronto = new Promise((res) => (deferred ? requestAnimationFrame(() => setTimeout(res, 0)) : res()));
    if (scroll && uf && window.innerWidth <= 960) {
      setTimeout(() => { if (state.uf === uf) panel.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' }); }, reduceMotion ? 0 : 380);
    }
    return painelPronto;
  }

  window.addEventListener('popstate', () => {
    const h = parseHash();
    if (h) { hideWelcome(); go(h, { push: false }); } else showWelcome();
  });

  function step(delta) {
    const order = navOrder();
    const next = order[order.indexOf(state.uf) + delta];
    if (next) go({ uf: next });
  }

  // ---------- Eventos do painel (delegação) ----------
  panel.addEventListener('click', (e) => {
    const t = e.target.closest('button, tr[data-uf], li[data-goto-uf]');
    if (!t) return;
    const ds = t.dataset;
    if (ds.partnerStatus && ds.partnerId) return savePartnerStatus(t);
    if (ds.gotoUf) {
      const keys = ds.keys ? ds.keys.split('||') : [];
      return go({ uf: ds.gotoUf, mode: keys.length ? 'todos' : state.mode }, { scroll: true }).then(() => flashKeys(keys));
    }
    if (ds.action === 'home') return go({ uf: null });
    if (ds.action === 'ver-todos') { state.verTodos = true; return refreshGaps(); }
    if (ds.nav) return step(Number(ds.nav));
    if (ds.gap) return setGap(ds.gap);
    if (ds.status) {
      state.statusFilter = ds.status;
      svg.dataset.status = ds.status;
      pintarMunicipios();
      const tmp = document.createElement('div');
      setHTML(tmp, parceirosBody(state.uf));
      $('#parceirosBody').replaceWith(tmp.firstElementChild);
      return;
    }
    if (ds.jump) {
      const s = $(`#sec-${ds.jump}`);
      s.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
      s.classList.remove('flash'); void s.offsetWidth; s.classList.add('flash');
      return;
    }
    if (ds.gotoMode) return go({ mode: ds.gotoMode });
    if (ds.sort) {
      const c = ds.sort;
      state.sort = { col: c, dir: state.sort.col === c ? -state.sort.dir : (c === 'uf' ? 1 : -1) };
      return renderOverview();
    }
    if (t.matches('tr[data-uf]')) go({ uf: ds.uf }, { scroll: true });
  });
  panel.addEventListener('keydown', (e) => {
    const tr = e.target.closest('tr[data-uf], li[data-goto-uf]');
    if (tr && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); tr.click(); }
  });
  panel.addEventListener('mouseover', (e) => {
    const tr = e.target.closest('tr[data-uf]');
    if (tr) hoverState(tr.dataset.uf);
    const it = e.target.closest('[data-pin], [data-key]');
    highlightPin(it ? (it.dataset.pin || PIN_BY_KEY[it.dataset.key] || null) : null);
  });
  panel.addEventListener('mouseout', (e) => {
    const tr = e.target.closest('tr[data-uf]');
    if (tr && !tr.contains(e.relatedTarget)) hoverState(null);
    if (!panel.contains(e.relatedTarget)) highlightPin(null);
  });

  $$('.modes button').forEach((b) => b.addEventListener('click', () => go({ mode: b.dataset.mode, ...(b.dataset.mode === 'todos' ? { view: 'pinos' } : {}) })));
  $$('.views button').forEach((b) => b.addEventListener('click', () => go({ view: b.dataset.view })));
  $('#resetZoom').addEventListener('click', () => go({ uf: null }));
  $('.brand').addEventListener('click', (e) => { e.preventDefault(); go({ uf: null }); });

  // ---------- Compartilhar ----------
  const toast = $('#toast');
  let toastTimer;
  function showToast(msg) {
    toast.textContent = msg;
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.hidden = true; }, 2400);
  }
  async function savePartnerStatus(button) {
    if (button.disabled || !window.AGRO_CAN_EDIT_PARTNERS || !window.AGRO_ACTIONS) return;
    const { partnerId, partnerStatus, expectedStatus } = button.dataset;
    const original = button.textContent;
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    button.textContent = 'Salvando…';
    let result;
    try {
      result = await window.AGRO_ACTIONS.setPartnerStatus(Number(partnerId), partnerStatus, expectedStatus);
    } catch {
      result = { error: { code: 'NETWORK_ERROR' } };
    }
    const { data, error } = result;
    if (error) {
      button.disabled = false;
      button.removeAttribute('aria-busy');
      button.textContent = original;
      if (error.code === '40001') {
        showToast('Este parceiro mudou em outra sessão. Atualizando os dados…');
        setTimeout(() => location.reload(), 700);
      } else if (error.code === '42501') {
        showToast('Sua conta não tem permissão para alterar parceiros.');
      } else {
        showToast('Não foi possível salvar. Verifique sua conexão e tente novamente.');
      }
      return;
    }
    const statusSalvo = data && data.status;
    if (statusSalvo !== 'Ativo' && statusSalvo !== 'Inativo') {
      button.disabled = false;
      button.removeAttribute('aria-busy');
      button.textContent = original;
      showToast('O banco não confirmou o novo status. Atualize a tela e tente novamente.');
      return;
    }
    try { sessionStorage.setItem('agroeasy-partner-status-feedback', `Parceiro atualizado para ${statusSalvo.toLowerCase()}.`); } catch { /* o refresh ainda sincroniza todos os dados */ }
    location.reload();
  }
  $('#shareBtn').addEventListener('click', async () => {
    const url = location.href;
    try {
      await navigator.clipboard.writeText(url);
      showToast('Link copiado! Ele abre exatamente nesta visualização.');
    } catch {
      // Fallback para contextos sem Clipboard API (ex.: arquivo aberto direto do computador)
      const ta = document.createElement('textarea');
      ta.value = url; ta.setAttribute('readonly', ''); ta.className = 'offscreen';
      document.body.appendChild(ta); ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch { ok = false; }
      ta.remove();
      showToast(ok ? 'Link copiado!' : 'Não foi possível copiar o link.');
    }
  });

  // ======================================================================
  // Busca
  // ======================================================================
  const searchIndex = [];
  UF_LIST.forEach((uf) => searchIndex.push({ tipo: 'Estado', uf, hl: nome(uf), txt: norm(`${nome(uf)} ${uf}`) }));
  ['leads', 'clientes'].forEach((cat) => {
    Object.entries(DATA[cat].porEstado).forEach(([uf, r]) => r.municipios.forEach(([m, n]) =>
      searchIndex.push({ tipo: DATA[cat].titulo, cat, uf, key: `${cat}:${uf}:${m}`, hl: m, extra: ` · ${n} ${plural(cat, n)}`, txt: norm(m) })));
  });
  Object.entries(DATA.parceiros.porEstado).forEach(([uf, r]) => r.pessoas.forEach(([p, m, s, id]) =>
    searchIndex.push({ tipo: 'Parceiro', cat: 'parceiros', uf, key: `parceiros:${id}`, hl: p, extra: ` · ${m} (${s.toLowerCase()})`, txt: norm(`${p} ${m}`) })));

  // Destaca o trecho encontrado (escapado com segurança)
  function highlight(text, q) {
    const n = norm(text);
    const i = n.indexOf(q);
    if (i < 0 || n.length !== text.length) return html`${text}`;
    return html`${text.slice(0, i)}<mark>${text.slice(i, i + q.length)}</mark>${text.slice(i + q.length)}`;
  }

  const input = $('#search'), results = $('#searchResults');
  let found = [], cursor = -1;
  function setOpen(open) { results.hidden = !open; input.setAttribute('aria-expanded', String(open)); }
  function runSearch() {
    const q = norm(input.value.trim()).slice(0, 60);
    if (q.length < 2) return setOpen(false);
    found = searchIndex.filter((it) => it.txt.includes(q))
      .sort((a, b) => (a.txt.startsWith(q) ? 0 : 1) - (b.txt.startsWith(q) ? 0 : 1) || (a.tipo === 'Estado' ? -1 : 0) - (b.tipo === 'Estado' ? -1 : 0))
      .slice(0, 14);
    cursor = found.length ? 0 : -1;
    setHTML(results, found.length
      ? found.map((it, i) => html`<li role="option" id="sr-${i}" data-i="${i}" aria-selected="${i === cursor}">${flag(it.uf)}<span class="sr-uf">${it.uf}</span>
          <span class="sr-main">${highlight(it.hl, q)}${it.extra || ''}</span><span class="sr-tag">${it.tipo}</span></li>`)
      : html`<li class="sr-empty">Nada encontrado nos mapas.</li>`);
    if (cursor >= 0) input.setAttribute('aria-activedescendant', 'sr-0'); else input.removeAttribute('aria-activedescendant');
    setOpen(true);
  }
  function pick(it) {
    setOpen(false);
    input.value = '';
    input.blur();
    const mode = it.cat && state.mode !== 'todos' && state.mode !== it.cat ? it.cat : state.mode;
    go({ mode, uf: it.uf }, { scroll: true }).then(() => {
      if (!it.key || state.uf !== it.uf) return;
      // se o estado já estava aberto com filtro, volta para "todos" para o item aparecer
      if (it.cat === 'parceiros' && state.statusFilter !== 'todos') { state.statusFilter = 'todos'; renderState(state.uf); }
      const target = $$('[data-key]', panel).find((n) => n.dataset.key === it.key);
      if (!target) return;
      setTimeout(() => {
        target.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' });
        target.classList.remove('flash'); void target.offsetWidth; target.classList.add('flash');
      }, 450);
    });
  }
  input.addEventListener('input', runSearch);
  input.addEventListener('focus', runSearch);
  input.addEventListener('keydown', (e) => {
    if (results.hidden || !found.length) { if (e.key === 'Escape') input.blur(); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      cursor = (cursor + (e.key === 'ArrowDown' ? 1 : -1) + found.length) % found.length;
      $$('li', results).forEach((li, i) => li.setAttribute('aria-selected', String(i === cursor)));
      input.setAttribute('aria-activedescendant', `sr-${cursor}`);
      $$('li', results)[cursor].scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter' && cursor >= 0) {
      e.preventDefault(); pick(found[cursor]);
    } else if (e.key === 'Escape') {
      setOpen(false); input.blur();
    }
  });
  results.addEventListener('mousedown', (e) => {
    const li = e.target.closest('li[data-i]');
    if (li) { e.preventDefault(); pick(found[Number(li.dataset.i)]); }
  });
  input.addEventListener('blur', () => setTimeout(() => setOpen(false), 100));

  // ======================================================================
  // Tela inicial
  // ======================================================================
  const welcome = $('#welcome');
  CATS.forEach((c) => {
    $(`[data-count="${c}"]`).textContent = fmt(baseTotal(c));
  });

  function hideWelcome() {
    welcome.classList.add('is-hidden');
    welcome.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('welcome-open');
  }
  function showWelcome() {
    welcome.classList.remove('is-hidden');
    welcome.removeAttribute('aria-hidden');
    document.body.classList.add('welcome-open');
    $('.welcome-options button').focus();
  }
  function chooseMode(mode) {
    hideWelcome();
    requestAnimationFrame(() => { countUp(panel); countUp($('#kpis')); });
    go({ mode, view: mode === 'todos' ? 'pinos' : state.view, uf: null, force: true });
  }
  function trapFocus(e) {
    const f = $$('button', welcome);
    const i = f.indexOf(document.activeElement);
    if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
    else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
  }
  $$('.welcome-options button').forEach((b) => b.addEventListener('click', () => chooseMode(b.dataset.mode)));

  document.addEventListener('keydown', (e) => {
    if (!welcome.classList.contains('is-hidden')) {
      if (e.key === 'Escape') chooseMode('todos');
      if (e.key === 'Tab') trapFocus(e);
      return;
    }
    if (e.target.matches('input, textarea')) return;
    if (e.key === 'Escape' && !cartao.hidden) { fecharCartao(); return; }
    if (e.key === 'Escape' && state.uf) go({ uf: null });
    if (state.uf && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) step(e.key === 'ArrowRight' ? 1 : -1);
    if (e.key === '/') { e.preventDefault(); input.focus(); }
  });

  svg.parentElement.appendChild(cartao);

  // ======================================================================
  // Início
  // ======================================================================
  const topbar = $('.topbar');
  const syncTopbar = () => document.documentElement.style.setProperty('--topbar-h', `${Math.round(topbar.getBoundingClientRect().height)}px`);
  syncTopbar();
  // Texto de busca mais curto em celulares estreitos
  const narrowQ = window.matchMedia('(max-width: 420px)');
  const syncPlaceholder = () => { input.placeholder = narrowQ.matches ? 'Buscar no mapa…' : 'Buscar estado, município ou parceiro'; };
  syncPlaceholder();
  if (narrowQ.addEventListener) narrowQ.addEventListener('change', syncPlaceholder);
  if (window.ResizeObserver) new ResizeObserver(syncTopbar).observe(topbar);

  buildMap();
  scaleLabels();
  let rz;
  window.addEventListener('resize', () => { cancelAnimationFrame(rz); rz = requestAnimationFrame(scaleLabels); });

  const initial = parseHash();
  if (initial) {
    hideWelcome();
    go({ ...initial, force: true }, { push: false });
  } else {
    go({ mode: 'todos', uf: null, force: true }, { push: false });
    if (location.hash) history.replaceState(null, '', location.pathname + location.search);
    showWelcome();
  }
})();
