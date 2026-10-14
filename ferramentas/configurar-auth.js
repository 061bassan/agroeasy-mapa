// Configura o Auth do projeto Supabase pela Management API.
// Uso (o token NÃO fica salvo em arquivo):
//   SUPABASE_ACCESS_TOKEN=sbp_... SUPABASE_PROJECT_REF=abcd SITE_URL=https://seu-site.netlify.app node ferramentas/configurar-auth.js [--aplicar]
// Sem --aplicar, apenas mostra o que seria alterado.
const token = process.env.SUPABASE_ACCESS_TOKEN;
const ref = process.env.SUPABASE_PROJECT_REF;
const site = (process.env.SITE_URL || '').replace(/\/+$/, '');
if (!token || !ref || !/^https:\/\//.test(site)) {
  console.error('Defina SUPABASE_ACCESS_TOKEN, SUPABASE_PROJECT_REF e SITE_URL (https://...).');
  process.exit(1);
}

const botao = (texto) => `<p style="margin:24px 0"><a href="{{ .ConfirmationURL }}" style="background:#CBA16C;color:#2A2B2B;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600">${texto}</a></p>`;
const rodape = '<p style="color:#777;font-size:12px">Se você não esperava este e-mail, pode ignorá-lo com segurança.</p>';

const desejado = {
  // Cadastro aberto só para @agroeasy.com.br (regra no banco), com confirmação por e-mail
  disable_signup: false,
  mailer_autoconfirm: false,
  site_url: site,
  uri_allow_list: [`${site}/**`, 'http://localhost:5173/**'].join(','),
  // Senhas: mínimo 10 caracteres, com letras e números
  password_min_length: 10,
  password_required_characters: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ:0123456789',
  // Links de e-mail valem 1 hora
  mailer_otp_exp: 3600,
  // E-mails em português
  mailer_subjects_recovery: 'AgroEasy | Criar nova senha',
  mailer_templates_recovery_content:
    '<h2>Criar nova senha</h2><p>Recebemos um pedido para redefinir a senha do Mapa AgroEasy.</p>' +
    botao('Criar nova senha') + '<p>O link vale por 1 hora.</p>' + rodape,
  mailer_subjects_confirmation: 'AgroEasy | Confirme seu e-mail',
  mailer_templates_confirmation_content:
    '<h2>Confirme seu e-mail</h2><p>Recebemos seu cadastro no Mapa AgroEasy. Clique no botão para confirmar que este e-mail é seu.</p>' +
    botao('Confirmar meu e-mail') + '<p>O link vale por 1 hora.</p>' + rodape,
  mailer_subjects_invite: 'AgroEasy | Seu acesso ao Mapa da Base',
  mailer_templates_invite_content:
    '<h2>Você foi convidado</h2><p>Você recebeu acesso ao Mapa AgroEasy. Clique no botão para criar sua senha.</p>' +
    botao('Criar minha senha') + '<p>O link vale por 1 hora.</p>' + rodape
};

const api = (metodo, corpo) => fetch(`https://api.supabase.com/v1/projects/${ref}/config/auth`, {
  method: metodo,
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: corpo ? JSON.stringify(corpo) : undefined
}).then(async (r) => { const t = await r.text(); if (!r.ok) throw new Error(`${r.status} ${t}`); return t ? JSON.parse(t) : {}; });

(async () => {
  const atual = await api('GET');
  // Modelos de e-mail só podem ser alterados com SMTP próprio configurado (EMAILS_PROPRIOS=1)
  const comEmails = process.env.EMAILS_PROPRIOS === '1';
  const mudancas = Object.entries(desejado)
    .filter(([k]) => comEmails || !/^mailer_(subjects|templates)_/.test(k))
    .filter(([k, v]) => atual[k] !== v);
  if (!comEmails) console.log('(modelos de e-mail em português ficam para quando houver SMTP próprio: rode com EMAILS_PROPRIOS=1)\n');
  if (!mudancas.length) return console.log('Configuração do Auth já está correta.');
  console.log('Alterações:');
  mudancas.forEach(([k, v]) => console.log(` - ${k}: ${JSON.stringify(atual[k]).slice(0, 60)} -> ${JSON.stringify(v).slice(0, 60)}`));
  if (!process.argv.includes('--aplicar')) return console.log('\n(nada aplicado; rode com --aplicar)');
  await api('PATCH', Object.fromEntries(mudancas));
  console.log('\nConfiguração aplicada.');
})().catch((e) => { console.error('Falhou:', e.message); process.exit(1); });
