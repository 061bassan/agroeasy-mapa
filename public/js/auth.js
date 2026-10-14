// Login, recuperação de senha e carregamento dos dados protegidos (Supabase).
// O mapa (app.js) só é carregado depois que o usuário entra e os dados chegam do banco.
(() => {
  'use strict';

  const CFG = window.AGRO_CONFIG || {};
  const $ = (s, r = document) => r.querySelector(s);
  const tela = $('#auth');
  const msg = $('#authMsg');
  const titulo = $('#authTitulo');

  const ESTADOS = {
    AC: 'Acre', AL: 'Alagoas', AM: 'Amazonas', AP: 'Amapá', BA: 'Bahia', CE: 'Ceará',
    DF: 'Distrito Federal', ES: 'Espírito Santo', GO: 'Goiás', MA: 'Maranhão',
    MG: 'Minas Gerais', MS: 'Mato Grosso do Sul', MT: 'Mato Grosso', PA: 'Pará',
    PB: 'Paraíba', PE: 'Pernambuco', PI: 'Piauí', PR: 'Paraná', RJ: 'Rio de Janeiro',
    RN: 'Rio Grande do Norte', RO: 'Rondônia', RR: 'Roraima', RS: 'Rio Grande do Sul',
    SC: 'Santa Catarina', SE: 'Sergipe', SP: 'São Paulo', TO: 'Tocantins'
  };
  const SENHA_MIN = 10;
  const DOMINIO = '@agroeasy.com.br';

  // Links dos e-mails (convite / recuperação) chegam com dados no endereço:
  // lemos o tipo antes de a biblioteca limpar a URL
  const hashInicial = location.hash;
  const tipoLink = (/[#&]type=(recovery|invite|signup)/.exec(hashInicial) || [])[1] || null;
  const linkComErro = /[#&]error(_code|_description)?=/.test(hashInicial);
  const limparHashDoLink = () => {
    if (/access_token=|error=|type=/.test(location.hash)) history.replaceState(null, '', location.pathname + location.search);
  };

  // ---------- Telas ----------
  const TITULOS = {
    entrar: 'Entrar', criar: 'Criar conta', esqueci: 'Recuperar senha', 'nova-senha': 'Criar nova senha',
    carregando: 'Carregando', 'sem-acesso': 'Acesso não liberado', config: 'Configuração pendente', erro: 'Algo deu errado'
  };
  function mostrar(painel, texto, tipo = 'info') {
    tela.querySelectorAll('[data-painel]').forEach((p) => { p.hidden = p.dataset.painel !== painel; });
    titulo.textContent = TITULOS[painel] || '';
    aviso(texto, tipo);
    const foco = tela.querySelector(`[data-painel="${painel}"] input`);
    if (foco) setTimeout(() => foco.focus(), 30);
  }
  function aviso(texto, tipo = 'info') {
    msg.hidden = !texto;
    msg.textContent = texto || '';
    msg.className = `auth-msg ${tipo}`;
  }
  function ocupado(form, sim) {
    form.querySelectorAll('button, input').forEach((e) => { e.disabled = sim; });
    const b = form.querySelector('[type="submit"]');
    if (b) b.classList.toggle('carregando', sim);
  }
  tela.addEventListener('click', (e) => {
    const b = e.target.closest('[data-ir]');
    if (!b) return;
    mostrar(b.dataset.ir);
  });
  // mostrar/ocultar senha
  tela.addEventListener('click', (e) => {
    const b = e.target.closest('.ver-senha');
    if (!b) return;
    const inp = b.parentElement.querySelector('input');
    const ver = inp.type === 'password';
    inp.type = ver ? 'text' : 'password';
    b.setAttribute('aria-pressed', String(ver));
    b.textContent = ver ? 'Ocultar' : 'Mostrar';
  });

  function senhaInvalida(senha, conf) {
    if (senha.length < SENHA_MIN) return `A senha precisa ter pelo menos ${SENHA_MIN} caracteres.`;
    if (!/[A-Za-z]/.test(senha) || !/\d/.test(senha)) return 'Use letras e números na senha.';
    if (senha !== conf) return 'As senhas não são iguais.';
    return '';
  }
  const emailValido = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) && v.length <= 254;

  // Mensagens de erro em português, sem revelar se um e-mail existe
  function traduzir(err) {
    if (!err) return '';
    const s = err.status, c = err.code || '', m = (err.message || '').toLowerCase();
    if (s === 429 || c === 'over_request_rate_limit' || c === 'over_email_send_rate_limit') return 'Muitas tentativas. Aguarde alguns minutos e tente de novo.';
    if (c === 'invalid_credentials' || m.includes('invalid login')) return 'E-mail ou senha incorretos.';
    if (c === 'email_not_confirmed') return 'Confirme seu e-mail pelo link que enviamos antes de entrar.';
    if (c === 'weak_password') return `Senha fraca: use pelo menos ${SENHA_MIN} caracteres, com letras e números.`;
    if (c === 'signup_disabled') return 'O cadastro está temporariamente fechado. Fale com o administrador.';
    if (c === 'email_address_not_authorized' || m.includes('not authorized')) return 'Não foi possível enviar o e-mail de confirmação agora. Fale com o administrador.';
    if (m.includes('agroeasy.com.br') || m.includes('database error saving new user')) return `Use seu e-mail ${DOMINIO}.`;
    if (c === 'same_password') return 'A nova senha precisa ser diferente da anterior.';
    if (c === 'session_not_found' || c === 'session_expired' || s === 401 || s === 403) return 'Sua sessão expirou. Entre novamente.';
    if (m.includes('fetch') || m.includes('network')) return 'Não foi possível conectar. Verifique sua internet e tente de novo.';
    return 'Não foi possível concluir agora. Tente novamente em instantes.';
  }

  // ---------- Sem configuração ----------
  if (!window.supabase || !CFG.url || !CFG.chave) {
    mostrar('config', 'O acesso ao banco de dados ainda não foi configurado.', 'erro');
    return;
  }

  const sb = window.supabase.createClient(CFG.url, CFG.chave, {
    auth: { flowType: 'implicit', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'agroeasy-auth' }
  });
  window.AGRO_SB = sb; // leitura (sessão do usuário + RLS); usado pela aba Inadimplência Rural
  window.AGRO_ACTIONS = {
    setPartnerStatus: (id, status, expected) => sb.rpc('alterar_status_parceiro', {
      p_id: id, p_status: status, p_status_esperado: expected
    })
  };

  // ---------- Entrar ----------
  $('#fEntrar').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.currentTarget;
    const email = f.email.value.trim().toLowerCase();
    const senha = f.senha.value;
    if (!emailValido(email) || !senha) return aviso('Informe e-mail e senha.', 'erro');
    ocupado(f, true);
    const { error } = await sb.auth.signInWithPassword({ email, password: senha });
    ocupado(f, false);
    if (error) { f.senha.value = ''; return aviso(traduzir(error), 'erro'); }
    f.reset();
    entrarNoMapa();
  });

  // ---------- Criar conta (somente e-mail da empresa) ----------
  $('#fCriar').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.currentTarget;
    const email = f.email.value.trim().toLowerCase();
    if (!emailValido(email) || !email.endsWith(DOMINIO)) return aviso(`Use seu e-mail ${DOMINIO}.`, 'erro');
    const problema = senhaInvalida(f.senha.value, f.confirmar.value);
    if (problema) return aviso(problema, 'erro');
    ocupado(f, true);
    const { data, error } = await sb.auth.signUp({ email, password: f.senha.value, options: { emailRedirectTo: location.origin + location.pathname } });
    ocupado(f, false);
    if (error) return aviso(traduzir(error), 'erro');
    f.reset();
    if (data && data.session) return entrarNoMapa('Conta criada. Bem-vindo!');
    // conta já existente: não revela, apenas orienta
    mostrar('entrar', 'Enviamos um e-mail de confirmação. Clique no link dele para ativar a conta e depois entre com sua senha. Se você já tem conta, entre direto.', 'info');
  });

  // ---------- Nova senha (recuperação ou primeiro acesso por convite) ----------
  $('#fNova').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.currentTarget;
    const senha = f.senha.value, conf = f.confirmar.value;
    const problema = senhaInvalida(senha, conf);
    if (problema) return aviso(problema, 'erro');
    ocupado(f, true);
    const { error } = await sb.auth.updateUser({ password: senha });
    ocupado(f, false);
    if (error) return aviso(traduzir(error), 'erro');
    f.reset();
    entrarNoMapa('Senha salva com sucesso.');
  });

  // ---------- Sair ----------
  async function sair() {
    try { await sb.auth.signOut(); } catch { /* sai mesmo sem rede */ }
    try { localStorage.removeItem('agroeasy-auth'); } catch { /* armazenamento indisponível */ }
    location.replace(location.pathname);
  }
  $('#sairBtn').addEventListener('click', sair);
  tela.addEventListener('click', (e) => { if (e.target.closest('[data-acao="sair"]')) sair(); });

  // ---------- Dados protegidos → formato usado pelo mapa ----------
  async function buscarDados() {
    const consultas = {
      bases: sb.from('bases').select('*'),
      indicadores: sb.from('indicadores').select('*').order('base_id').order('ordem'),
      estado_totais: sb.from('estado_totais').select('*').order('base_id').order('ordem'),
      municipio_registros: sb.from('municipio_registros').select('*').order('base_id').order('uf').order('ordem'),
      parceiros: sb.from('parceiros').select('*').order('uf').order('ordem'),
      municipio_coordenadas: sb.from('municipio_coordenadas').select('*'),
      permissao_parceiros: sb.rpc('pode_editar_parceiros')
    };
    const nomes = Object.keys(consultas);
    const res = await Promise.all(nomes.map((n) => consultas[n]));
    const erro = res.slice(0, -1).find((r) => r.error);
    if (erro) throw erro.error;
    const tabelas = Object.fromEntries(nomes.slice(0, -1).map((n, i) => [n, res[i].data || []]));
    tabelas.pode_editar_parceiros = !res[res.length - 1].error && res[res.length - 1].data === true;
    return tabelas;
  }
  function montar(t) {
    const data = { estados: ESTADOS };
    t.bases.forEach((b) => {
      data[b.id] = {
        titulo: b.titulo, singular: b.singular, plural: b.plural, fonte: b.fonte,
        notaPercentual: b.nota_percentual, totalComUF: b.total_com_uf, kpis: [], porEstado: {}
      };
    });
    t.indicadores.forEach((k) => { if (data[k.base_id]) data[k.base_id].kpis.push({ rotulo: k.rotulo, valor: k.valor, sub: k.sub, status: k.status || '' }); });
    t.estado_totais.forEach((e) => {
      if (!data[e.base_id]) return;
      const r = { total: e.total, pct: e.percentual, nota: e.nota };
      if (e.base_id === 'parceiros') r.pessoas = []; else r.municipios = [];
      data[e.base_id].porEstado[e.uf] = r;
    });
    t.municipio_registros.forEach((m) => {
      const r = data[m.base_id] && data[m.base_id].porEstado[m.uf];
      if (r && r.municipios) r.municipios.push([m.municipio, m.quantidade]);
    });
    // Parceiros removidos (excluido_em) não aparecem; o banco é a única fonte da lista.
    const parceirosVisiveis = t.parceiros.filter((p) => !p.excluido_em);
    parceirosVisiveis.forEach((p) => {
      const r = data.parceiros && data.parceiros.porEstado[p.uf];
      if (r && r.pessoas) r.pessoas.push([p.nome, p.municipio, p.status, p.id]);
    });
    // Parceiros são dados operacionais: total, distribuição e indicadores
    // acompanham a lista efetivamente visível, inclusive remoções e mudanças.
    if (data.parceiros) {
      const porUf = new Map();
      parceirosVisiveis.forEach((p) => porUf.set(p.uf, (porUf.get(p.uf) || 0) + 1));
      data.parceiros.totalComUF = parceirosVisiveis.length;
      Object.entries(data.parceiros.porEstado).forEach(([uf, estado]) => {
        estado.total = porUf.get(uf) || 0;
        estado.pct = parceirosVisiveis.length ? (estado.total * 100 / parceirosVisiveis.length).toFixed(1).replace('.', ',') + '%' : '0,0%';
      });
      data.parceiros.kpis.forEach((k) => {
        if (k.rotulo === 'Base total') k.valor = parceirosVisiveis.length;
        if (k.status === 'ativo') k.valor = parceirosVisiveis.filter((p) => p.status === 'Ativo').length;
        if (k.status === 'inativo') k.valor = parceirosVisiveis.filter((p) => p.status === 'Inativo').length;
      });
    }
    const coords = { k: 1, pontos: {}, interpretados: {}, semLocalizacao: [] };
    t.municipio_coordenadas.forEach((c) => {
      const chave = `${c.uf}|${c.municipio}`;
      coords.pontos[chave] = [c.x, c.y, c.lat, c.lon, c.cod_ibge];
      if (c.nome_oficial) coords.interpretados[chave] = c.nome_oficial;
    });
    // Coordenada temporária para que Campina Verde também apareça na prévia
    // local antes da migration inserir o ponto na tabela do Supabase.
    if (!coords.pontos['MG|Campina Verde']) {
      coords.pontos['MG|Campina Verde'] = [589.3, 605.9, -19.53, -49.48, '3111101'];
    }
    return { data, coords };
  }

  let mapaCarregado = false;
  async function entrarNoMapa(textoOk) {
    if (mapaCarregado) return;
    mostrar('carregando');
    let tabelas;
    try {
      tabelas = await buscarDados();
    } catch (err) {
      if (err && (err.status === 401 || /jwt|token/i.test(err.message || ''))) return mostrar('entrar', traduzir({ status: 401 }), 'erro');
      return mostrar('erro', traduzir(err), 'erro');
    }
    // Logado, mas o e-mail não está na lista de acessos: o banco não devolve nada
    if (!tabelas.bases.length) return mostrar('sem-acesso');
    const { data, coords } = montar(tabelas);
    window.AGRO_DATA = data;
    window.AGRO_COORDS = coords;
    window.AGRO_CAN_EDIT_PARTNERS = tabelas.pode_editar_parceiros;
    const s = document.createElement('script');
    s.src = 'js/app.js';
    s.onload = () => {
      // Aba Inadimplência Rural: módulo independente; se falhar, o mapa segue normal
      const ex = document.createElement('script');
      ex.src = 'js/inadimplencia.js';
      document.body.appendChild(ex);
      mapaCarregado = true;
      document.body.classList.remove('auth-open');
      tela.hidden = true;
      $('#sairBtn').hidden = false;
      if (textoOk) mostrarToastSimples(textoOk);
      try {
        const feedback = sessionStorage.getItem('agroeasy-partner-status-feedback');
        if (feedback) {
          sessionStorage.removeItem('agroeasy-partner-status-feedback');
          mostrarToastSimples(feedback);
        }
      } catch { /* armazenamento temporário indisponível */ }
    };
    s.onerror = () => mostrar('erro', 'Não foi possível abrir o mapa. Recarregue a página.', 'erro');
    document.body.appendChild(s);
  }
  function mostrarToastSimples(t) {
    const el = $('#toast');
    if (!el) return;
    el.textContent = t; el.hidden = false;
    setTimeout(() => { el.hidden = true; }, 2600);
  }

  // Sessão expirada/encerrada em outra aba: volta ao login
  sb.auth.onAuthStateChange((evento) => {
    if (evento === 'SIGNED_OUT' && mapaCarregado) location.replace(location.pathname);
    if (evento === 'PASSWORD_RECOVERY' && !mapaCarregado) mostrar('nova-senha', 'Defina sua nova senha.');
  });

  // ---------- Início ----------
  (async () => {
    mostrar('carregando');
    const { data } = await sb.auth.getSession();
    const sessao = data && data.session;
    limparHashDoLink();
    if (linkComErro && !sessao) return mostrar('entrar', 'Este link expirou ou já foi usado. Peça um novo em "Esqueci minha senha".', 'erro');
    if (sessao && tipoLink === 'invite') return mostrar('nova-senha', 'Bem-vindo! Crie sua senha para acessar o mapa.', 'ok');
    if (sessao && tipoLink === 'recovery') return mostrar('nova-senha', 'Defina sua nova senha.');
    if (sessao && tipoLink === 'signup') return entrarNoMapa('E-mail confirmado. Bem-vindo!');
    if (sessao) return entrarNoMapa();
    mostrar('entrar');
  })();
})();
