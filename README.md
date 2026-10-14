# Mapa AgroEasy

Mapa interativo que mostra onde estão os leads, clientes e parceiros de uma operação de agronegócio, e cruza esse retrato com dados públicos de crédito rural para apontar onde vale concentrar esforço comercial.

O projeto nasceu de uma pergunta simples: "onde está a nossa base?". As informações viviam em planilhas e infográficos, sem uma visão única. O mapa reúne tudo em uma tela e, na aba Inadimplência Rural, responde também "onde estão as oportunidades?".

> Este repositório contém apenas código, esquema do banco e pipeline de dados. Nenhum dado de clientes, leads ou parceiros é versionado aqui. O aplicativo é de uso interno, com login restrito.

## O que ele faz

**Mapa da base**
- Mapa do Brasil por estado, com detalhe por município e zoom animado.
- Quatro visões: todos, leads, clientes e parceiros.
- Busca por estado, município ou parceiro.
- Gestão do status dos parceiros (ativo ou inativo) por usuários com permissão de edição, com histórico de auditoria.

**Aba Inadimplência Rural**
- Saldo inadimplente por estado e município, mês a mês, a partir dos microdados do Sicor (Banco Central).
- Crédito contratado por ano e finalidade, produção agrícola e pecuária (IBGE PAM e PPM) e estimativa de safra por estado (IBGE LSPA).
- Dois modos: Inadimplência observada e Oportunidades.
- Ranking de oportunidades com pontuação nacional ou estadual, combinando três critérios por percentil (saldo inadimplente, produção e crédito).
- Cruzamento com a presença da empresa (leads, clientes e parceiros ativos) em cada município.

## Princípios de dados

- Valor ausente nunca vira zero. Ausência de registro é mostrada como ausência.
- Crédito contratado (fluxo) nunca substitui nem divide o saldo inadimplente (estoque).
- O Sicor informa município só em parte das operações. A cobertura aparece na tela.
- A pontuação do ranking não é probabilidade de sucesso comercial, e a interface diz isso.
- Municípios são identificados pelo código IBGE.

## Arquitetura

| Camada | Tecnologia |
|---|---|
| Front-end | HTML, CSS e JavaScript puro, sem framework e sem etapa de build |
| Mapa | SVG gerado no cliente, com zoom por transform CSS (GPU) |
| Banco e login | Supabase (Postgres, Auth e RLS) |
| Hospedagem | Site estático (Netlify) |
| Pipeline de dados | Scripts Node.js idempotentes |

```
public/                 site publicado (único diretório que vai ao ar)
  index.html
  js/                   app.js (mapa), auth.js (login e dados), inadimplencia.js (aba 4)
  css/
  assets/               contornos municipais, bandeiras, fontes
supabase/migrations/    esquema, RLS, funções e views
ferramentas/            importação e carga dos dados públicos
dados/coords.js         coordenadas oficiais dos municípios
```

## Segurança

- **RLS em todas as tabelas.** O acesso passa por `private.tem_acesso()`. O papel anônimo não tem nenhum privilégio no schema público.
- **Cadastro restrito ao domínio da empresa**, validado no banco (não só na tela), com confirmação por e-mail e senha de no mínimo 10 caracteres com letras e números.
- **Edição de parceiros** só por uma lista de editores, via função `security definer` com `search_path` fixo, controle de concorrência e trilha de auditoria.
- **Views com `security_invoker`**, para respeitar o RLS de quem consulta.
- **CSP restritiva**: sem script ou estilo inline, sem recursos de terceiros, `connect-src` limitado ao projeto do Supabase, `frame-ancestors 'none'`.
- Cabeçalhos adicionais: HSTS, `X-Content-Type-Options`, `Referrer-Policy: no-referrer`, `Permissions-Policy`, COOP e CORP.
- **Escape por padrão** em todo HTML montado no cliente e `noindex` nas páginas.
- **A chave do Supabase em `public/js/config.js` é a chave pública (publishable).** Ela é pública por natureza e inofensiva sem login, por causa do RLS. Nunca use a chave `service_role` ou tokens de acesso no front-end.
- Tokens de gestão do Supabase são lidos só de variáveis de ambiente pelos scripts e nunca são gravados em arquivo.

## Como rodar localmente

O site é estático. Qualquer servidor de arquivos serve:

```
npx serve public
```

Para funcionar de verdade, é preciso um projeto Supabase próprio:

1. Aplique as migrations de `supabase/migrations` em ordem.
2. Edite `public/js/config.js` com a URL e a chave publishable do seu projeto.
3. Em `20261006190000_edicao_status_parceiros.sql`, troque os e-mails de exemplo pelos dos seus editores.
4. Carregue seus próprios dados de leads, clientes e parceiros (o gerador `ferramentas/gerar-seed.js` lê um arquivo local `privado/data.js`, que fica fora do git).

## Pipeline de dados da aba Inadimplência

Documentado em `ferramentas/LEIAME-inadimplencia.md`. Resumo:

1. `importar-sicor.js` lê em fluxo os saldos e complementos do Sicor (vários GB).
2. `carregar-inadimplencia.js` grava municípios, série mensal e cobertura.
3. `importar-credito-sicor.js` agrega o crédito contratado por finalidade.
4. `importar-ibge.js` e `importar-lspa.js` trazem produção e estimativa de safra do IBGE (SIDRA).
5. `carregar-enriquecimento.js` grava o enriquecimento.

Todas as cargas são reproduzíveis (upsert). O token do Supabase é passado pela variável `SUPABASE_ACCESS_TOKEN` no comando.

## Fontes de dados públicas

- Banco Central do Brasil, Sicor (operações e saldos de crédito rural)
- IBGE, Malha Municipal Digital e SIDRA (PAM, PPM e LSPA)

## Licença

Projeto de uso interno. Todos os direitos reservados, salvo definição em contrário do autor.
