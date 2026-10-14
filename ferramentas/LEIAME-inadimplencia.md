# Pipeline de dados — aba Inadimplência Rural

Tudo é reproduzível e idempotente (upsert). O token do Supabase fica só no ambiente do comando (`SUPABASE_ACCESS_TOKEN`).

| Etapa | Script | Fonte | Observação |
|---|---|---|---|
| 1. Inadimplência (saldo, SOR12/SOR02) | `importar-sicor.js` | Sicor/BCB `SICOR_SALDOS_<ano>` + `SICOR_COMPLEMENTO_OPERACAO_BASICA` | ~8 GB lidos em fluxo; parciais por ano retomáveis |
| 2. Carga no banco | `carregar-inadimplencia.js <agg.json> <ref> [UFs]` | — | cria `inad_municipios`, `inad_municipio_mensal`, `inad_cobertura_periodo` |
| 3. Crédito contratado | `importar-credito-sicor.js` | Sicor/BCB `SICOR_OPERACAO_BASICA_ESTADO_<ano>` + domínio `Empreendimento` | fluxo anual por finalidade; parciais por ano |
| 4. Perfil agropecuário | `importar-ibge.js` | IBGE SIDRA 5457 (PAM), 3939 e 74 (PPM) | consultas em lotes de 40 municípios (limite SIDRA: 50 mil valores) |
| 5. Carga do enriquecimento | `carregar-enriquecimento.js <ref> --ibge f --credito f` | — | `inad_agro_*`, `inad_credito_*` |

Regras: crédito contratado (fluxo) nunca divide nem substitui o saldo inadimplente (estoque); valores ausentes (`..`, `X`) não viram zero; município identificado por código IBGE.
Limites: o Sicor só informa município em parte das operações (≈75% das operações / ≈43% do saldo em 08/2026); o serviço Olinda da MDCR estava instável na carga, por isso o crédito foi derivado dos microdados.

## Auditoria (etapa 3)
- **Duplicidades (Sicor, 2024–2026):** nenhuma repetição de REF_BACEN+NU_ORDEM no ano nem entre anos; nenhum valor ≤ 0; nenhuma operação sem finalidade.
- **Totais:** ano civil 2024 R$ 380,0 bi · 2025 R$ 361,2 bi · 2026 (jan–set) R$ 237,4 bi · safra 2024/25 (jul–jun) R$ 383,3 bi.
- **Comparação com o Mapa** (nota "Aplicação do crédito rural da safra 2024/25 somou R$ 330,9 bilhões", extração de 04/06/2025, provisória; jul/24–mai/25): a agregação aqui dá R$ 346,3 bi (+4,7%). A composição **não concilia**: custeio R$ 187,4 bi (Mapa 155,1), investimento R$ 93,3 bi (Mapa 57,0), comercialização + industrialização R$ 65,6 bi (Mapa 70,9). O próprio detalhamento publicado soma R$ 282,9 bi, não 330,9. Causas possíveis (não confirmadas): escopo diferente (perfis/programas), classificação da finalidade (domínio Empreendimento × critério do Mapa) e registros tardios. O total é coerente em ordem de grandeza; a divisão por finalidade **não está validada**.
- **Valor contratado × liberado:** `VL_PARC_CREDITO` é o valor da parcela de crédito contratada; não é o valor efetivamente liberado.
- **Cobertura de município (valor, 2024–2026):** investimento 79%, custeio 34%, comercialização 14%, industrialização ≈0%; por UF de 19% (DF) a 89% (AP). A divisão por finalidade e a comparação entre UFs não representam o mercado.
- **Municípios:** 5.570 no app × 5.571 na API do IBGE; falta 5101837 (Boa Esperança do Norte/MT; carteira R$ 98,5 mi, inadimplência 0 em 08/2026), sem geometria. 16 nomes padronizados para a grafia oficial (`nomes-oficiais-ibge.json`). 61 municípios sem operações ativas no Sicor (ausência de registro, nunca zero).
- **Ranking:** 4.511 elegíveis (4.499 com 3 critérios, 12 com 2). Empates agora usam posição média. Correção por cobertura entre UFs fica como proposta (ver relatório).

## Consolidação das pendências (etapa 4)
- **Ranking:** a pontuação existe em dois escopos com os mesmos critérios e pesos: *nacional* (percentis entre todos os municípios elegíveis do país) e *estadual* (percentis só entre os elegíveis da UF selecionada). A tela identifica o escopo e não apresenta a pontuação como probabilidade.
- **Parceiros:** a lista exibida vem somente do banco (`parceiros`, sem linhas com `excluido_em`); nenhum nome fica embutido no código do site. A aba 4 usa o mesmo conjunto exibido.
- **Presença no ranking:** parceiros ativos são resolvidos para código IBGE por município/UF; siglas no lugar do município (ex.: "Rio G Sul/RS") não casam e não afetam o ranking.
- **Boa Esperança do Norte/MT (5101837):** contorno oficial da Malha Municipal Digital 2025 do IBGE, projetado no plano do app (erro de ajuste ≤ 0,07 unid.; municípios não afetados batem em ≤ 0,28 unid.), em `public/assets/inad/municipios-extra.js`, usado só pela aba 4. Município incluído em `inad_municipios` (5.571).
- **Crédito:** finalidades listadas em ordem fixa e rotuladas como "ainda não conciliada"; não entram no ranking.

## Simplificação e dados de 2026 (etapa 5)
- **Disponibilidade (verificada em 14/10/2026):** o Sicor regenera os arquivos diariamente. Saldos (inadimplência): último mês **ago/2026** (set/2026 ainda não publicado). Operações (crédito): emissões até **30/09/2026**; a atualização do dia trouxe +8.984 registros tardios em 2026 (R$ 237,4 → 238,0 bi) e foi carregada. PAM/PPM: **2025** é o último ano consolidado (PAM publicada em 01/10/2026). IBGE/LSPA (SIDRA 6588): estimativa da safra 2026 por UF, referência **ago/2026**, carregada em `inad_lspa_uf` (`importar-lspa.js`; é estimativa estadual, não equivale à PAM). Conab: planilhas por UF sem API estável; não integrada.
- **Interface:** três níveis (visão geral → estado/município → blocos expansíveis carregados sob demanda). Dois modos (Inadimplência | Oportunidades), seletores de período (jan/2025–ago/2026) e de presença AgroEasy, um único ranking por vez, pontuação nacional ou estadual só no modo Oportunidades.

## Ajuste do ranking (etapa 6)
- **Pontuação nacional:** o percentil do **saldo inadimplente** é calculado dentro de cada UF (reduz a diferença de cobertura de município entre estados); produção e crédito continuam em percentis nacionais. UFs com menos de 10 municípios elegíveis (hoje só o DF) usam o percentil do país para o saldo.
- **Pontuação estadual:** os três indicadores são comparados só entre os elegíveis da UF (inalterada).
- Elegibilidade, pesos (média simples), filtros e o ranking de inadimplência observada não mudaram.
- **Reprodução:** `SUPABASE_ACCESS_TOKEN=... node ferramentas/comparar-ranking.js <ref> --base 153ef45` extrai a função `pontuar` de cada versão do app e compara o top 100 com os dados reais (ago/2026, 4.507 elegíveis). Resultado: 74/100 em comum; MT 26→12, MS 14→5, SP 0→3, MG 7→16, RS 16→18, PR 11→15, SC 0→3.
