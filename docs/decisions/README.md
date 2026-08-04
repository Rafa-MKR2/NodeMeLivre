# ADRs — Architecture Decision Records

ADRs registram **por que** tomamos cada decisão de arquitetura do SDK.

## Regras

- Uma ADR por decisão significativa (estrutura do repo, cliente HTTP, persistência de token, exposição de resources).
- Numeração sequencial: `NNNN-descricao-curta.md`.
- Para revisar ou reverter uma decisão, crie uma **nova ADR** — nunca edite uma ADR aceita (apenas adicione status "superseded").
- Estados possíveis: `Proposta` → `Aceita` → `Superseded` / `Rejeitada`.
- O template segue o [MANUAL-DAS-BOAS-PRATICAS](../../../MANUAL-DAS-BOAS-PRATICAS/docs/decisions/0000-template.md).

## ADRs deste projeto

| Nº | Decisão | Status | Data |
|---|---|---|---|
| [0001](0001-monorepo-npm-workspaces.md) | Monorepo com npm workspaces | Aceita | 2026-08-04 |
| [0002](0002-http-fetch-nativo.md) | HTTP via fetch nativo (undici) | Aceita | 2026-08-04 |
| [0003](0003-tokenstore-pluggable.md) | TokenStore pluggável | Aceita | 2026-08-04 |
| [0004](0004-resources-v1.md) | Resources v1: items, orders, users, shipments, questions | Aceita | 2026-08-04 |
| [0005](0005-arquitetura-modular.md) | Arquitetura modular em pacotes por domínio | Aceita | 2026-08-04 |
