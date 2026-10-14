# UX Contract

## Product context

- Audience: equipe AgroEasy autenticada.
- Primary jobs: explorar a distribuição da base e manter parceiros.
- Target market(s): Brasil.
- Active locales: pt-BR.
- Language/content register: português brasileiro, direto e operacional.
- Timezone/calendar policy: datas de auditoria permanecem em timestamp UTC do banco; não são exibidas neste fluxo.
- Accessibility target: foco visível, nomes acessíveis, controles nativos e adaptação a movimento reduzido.

## Business-context sources

| Domain / scope | Authoritative source | Source type | Reviewed date |
|---|---|---|---|
| Permission model | `supabase/migrations/20261006120000_mapa_agroeasy.sql` e regra do usuário para editores | Migration + product instruction | 2026-10-06 |
| Partner status lifecycle | `privado/data.js` (local, fora do repositório) e tabela `public.parceiros` | Seed/source data | 2026-10-06 |

## Visual contract

- Project `DESIGN.md`: `DESIGN.md`.
- Token ownership: runtime CSS permanece canônico.
- Runtime design source: `public/css/styles.css`.
- Supported themes: tema escuro atual.

## Canonical UI Map

| Capability | Canonical owner | Source of truth | Allowed variants | Verification |
|---|---|---|---|---|
| Form | inline partner row action | this contract | single status action | keyboard + server result |
| Toast | `#toast` in `public/index.html` | `public/js/app.js` | success / error | live region + reload recovery |
| CRUD | partner status RPC and row action | Supabase migration + this contract | status transition only | permission, success, failure, conflict |

## Dataset navigation

- Exploratory lists: partner rows inside the selected state's panel.
- Selecting **Todos** opens the city map with location-pin markers for leads, clients, active partners, and inactive partners visible together; the marker color identifies the category. The user can still switch to States or Opportunities. The whole-Brazil overview uses a warm presence scale that does not represent one specific category.
- Category colors: leads blue (`#36A9FF`), clients vivid turquoise (`#00E5C4`), active partners green (`#35D07F`), inactive partners orange (`#FF764A`).
- URL state: existing hash retains mode, state, and map view; partner filter is transient.
- Loading/error: action button is disabled while saving; errors remain visible in the app toast.
- Post-action: reload canonical server data while preserving the hash-selected view.

## Flow ledger

| Operation | Trigger | Pending | Success destination | Success feedback | Failure recovery | Focus outcome | Source ref |
|---|---|---|---|---|---|---|---|
| Edit partner status | row action by an authorized editor | disable the target row action | same map hash and state | localized status toast | keep database state; show error; permit retry | current state view restored | Supabase status RPC |

## Async and resilience

- Mutation default: pessimistic; the database is authoritative.
- Duplicate-submit: disable the target row action while its RPC is in flight.
- Offline/write failure: preserve the current status and show an actionable error.
- Multi-user conflict: server compares expected status and rejects stale transitions; reload shows current state.
- Session expiry: follow the existing authentication flow.
- Cache invalidation: reload the authorized data after a successful change so map markers, totals, filters, opportunity lists, and tooltips all derive from one server snapshot.

## Permission and clipboard

- Only the two provisioned editor accounts see status actions.
- The database rechecks editor membership for every mutation; hiding the control is not the authorization boundary.
- Other authenticated users retain read-only access.

## Verification

- Required checks: JavaScript syntax, migration review, generator/seed consistency, permission and state-transition review, browser flow when a project session is available.
- Canonical sibling flow: existing partner status filter in the selected-state panel.
