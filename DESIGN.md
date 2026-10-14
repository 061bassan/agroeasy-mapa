---
version: alpha
name: AgroEasy Mapa da Base
description: Mapa operacional para entender a distribuição de leads, clientes e parceiros AgroEasy.
colors:
  gold: "#D6C588"
  copper: "#CBA16C"
  leads: "#36A9FF"
  clientes: "#00E5C4"
  parceiros: "#35D07F"
  parceiros-inativos: "#FF764A"
  background: "#2A2B2B"
  surface: "#373838"
  text: "#F2EEE3"
  success: "#35D07F"
  warning: "#FF764A"
typography:
  sans:
    fontFamily: "Jost, Segoe UI, system-ui, sans-serif"
  mono:
    fontFamily: "ui-monospace, SFMono-Regular, monospace"
rounded:
  sm: "8px"
  md: "12px"
  lg: "14px"
spacing:
  compact-control: "8px"
  panel-inset: "20px"
components:
  button: { }
  card: { }
  status: { }
---

# AgroEasy Mapa da Base — Design System

## Overview

### Creative North Star

Uma mesa de análise geográfica para uma consultoria financeira do agronegócio: o território e os números guiam a leitura, enquanto tons de carvão, dourado e cobre mantêm o mapa legível e reconhecível.

### Product context and register

- **Audience and primary job:** equipe AgroEasy; explorar a distribuição de leads, clientes e parceiros e manter o status operacional dos parceiros.
- **Target market(s) and evidence:** Brasil; interface, dados e nomes de estados brasileiros presentes em `public/index.html` e `privado/data.js` (local, fora do repositório).
- **Locale(s) and language policy:** português brasileiro; números formatados com `pt-BR`.
- **Usage scene:** mapa de leitura densa em desktop e celular, com navegação e ações por toque ou teclado.
- **Register:** produto interno autenticado.
- **Memorable signature:** mapa escuro do Brasil com destaques geográficos e bandeiras estaduais.
- **Restraint:** controles de manutenção devem permanecer compactos e próximos ao parceiro correspondente.
- **Anti-references:** painel administrativo genérico e cores semânticas usadas apenas como decoração.
- **Token ownership/runtime mapping:** `public/css/styles.css` permanece fonte canônica; este arquivo documenta seus valores aceitos. O tema usa variáveis CSS em `:root`.

## Colors

Dourado `#D6C588` e cobre `#CBA16C` identificam a marca e ações principais; não representam clientes. Leads usam azul `#36A9FF`, clientes turquesa intenso `#00E5C4`, parceiros ativos verde `#35D07F` e inativos laranja `#FF764A`. Essas cores semânticas saturadas diferenciam marcadores e categorias sobre o mapa escuro. A visão geral usa uma escala quente de dourado para mostrar presença agregada sem confundir com uma base específica. Fundo `#2A2B2B`, superfície `#373838` e texto `#F2EEE3` formam as camadas de leitura. Estados e status também usam rótulos textuais.

## Typography

Jost é a família principal, com fallbacks de sistema para português e diacríticos. Títulos usam pesos moderados; tabelas, percentuais e contagens priorizam leitura e alinhamento numérico.

## Layout

O mapa e o painel de detalhes dividem a tela ampla; em até 960px, o painel passa abaixo do mapa. Usar os espaçamentos existentes e manter ações de cada parceiro dentro da linha correspondente, com quebra segura em telas estreitas.

## Elevation & Depth

Hierarquia vem de superfícies tonais, bordas discretas e camadas do mapa. Sombras ficam reservadas a popovers e avisos flutuantes.

## Shapes

Cards usam cantos de 12–14px; botões e filtros usam formas arredondadas já existentes. Foco visível usa contorno dourado.

## Components

### Foundational visual states

Controles devem manter estados hover, focus-visible, pressed, disabled e busy. A redução de movimento do sistema é respeitada.

### Buttons and actions

Ações usam rótulos diretos em português, nomes acessíveis e cores semânticas acompanhadas de texto.

### Iconography

Ícones SVG de traço simples; controles relevantes mantêm rótulo textual.

### Motion

Transições existentes são curtas e funcionais; operações de rotina não recebem animação decorativa.

### Content and data visualization

Voz concisa em português brasileiro. Status de parceiros aparecem por texto e cor; totais e listas refletem a fonte persistida no Supabase. A visualização Todos abre Cidades para exibir, em conjunto, marcadores em forma de localização para leads, clientes, parceiros ativos e inativos. A cor identifica a categoria; o tamanho é constante e a quantidade aparece ao passar o cursor.

## Do's and Don'ts

- **Do:** manter o mapa e a densidade atuais como eixo visual do produto.
- **Do:** mostrar confirmação e erro perto do fluxo em que ocorreram.
- **Don't:** indicar status apenas por cor.
- **Don't:** permitir edição sem que a autorização seja verificada pelo banco.
