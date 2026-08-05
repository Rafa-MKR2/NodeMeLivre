# Roadmap

Visão de curto e médio prazo do SDK, com prioridades e status.

## Versões planejadas

| Versão | Escopo |
|---|---|
| v0.1 | Fundação: monorepo, HTTP, OAuth2, TokenStore, resources (items, orders, users, shipments, questions) |
| v0.2 | `docs/` completa, exemplos, cobertura de testes, README do pacote |
| v1.0 | Publicação pública do `@nodemelivre/sdk` |

## Backlog por prioridade

| Feature | Prioridade | Dificuldade | Tempo | Status |
|---|---|---|---|---|
| Monorepo npm workspaces | Alta | Média | 1 dia | ✔ Concluído |
| Cliente HTTP com retry/rate-limit/timeout | Alta | Alta | 2 dias | ✔ Concluído |
| OAuth2 (authorization_code, refresh, credentials) | Alta | Alta | 2 dias | ✔ Concluído |
| TokenManager + TokenStore pluggável | Alta | Média | 1 dia | ✔ Concluído |
| Resources v1 (5 domínios) | Alta | Média | 2 dias | ✔ Concluído |
| Testes unitários/integração (74) | Alta | Média | 2 dias | ✔ Concluído |
| Docs: ADRs 0001–0004, roadmap, releases | Alta | Baixa | 1 dia | ✔ Concluído |
| Exemplos de uso | Média | Baixa | 1 dia | ✔ Concluído |
| CHANGELOG e processo de release | Média | Baixa | 1 dia | ✔ Concluído |
| CI (lint + typecheck + test) | Média | Média | 2 dias | ✔ Concluído |
| Renomear para NodeMeLivre + repo público no GitHub | Média | Baixa | 1 dia | ✔ Concluído |
| Arquitetura modular (ADR-0005) em 9 pacotes | Alta | Alta | 5 dias | ✔ Concluído |
| Paginação com `for await` (`ml.items.list()`) | Alta | Média | 2 dias | ⏳ Planejado |
| Operações nível 3 (`publish`, `pause`, `waitUntilPaid`, `reply`) | Alta | Média | 3 dias | ⏳ Planejado |
| Eventos (`tokenRefreshed`, `rateLimit`, `request`, `response`, `httpError`) | Média | Média | 2 dias | ✔ Concluído |
| Upload de imagens (`ml.images.upload(file)`) | Média | Média | 2 dias | ⏳ Planejado |
| Webhooks (`verify`, `parse`) | Média | Média | 3 dias | ⏳ Planejado |
| PKCE no fluxo OAuth2 | Média | Média | 2 dias | ⏳ Planejado |
| Resources extras (payments, messages, billing) | Baixa | Alta | 5 dias | ⏳ Planejado |

### Legenda de status

| Símbolo | Significado |
|---|---|
| ✔ | Concluído |
| 🚧 | Em andamento |
| ⏳ | Planejado |
| ❌ | Cancelado |
| 🔒 | Bloqueado |

## Regras de manutenção

- **Todo item tem status** — sem item sem status.
- Atualizar o roadmap **no dia em que** a tarefa mudar de status.
- Feature nova entra aqui antes de virar branch.
- Features canceladas ficam registradas como ❌ (não apagar).

## Definition of Done

Uma tarefa **só é considerada concluída** quando **todos** os itens abaixo são verdadeiros:

- [ ] Código implementado
- [ ] Testado
- [ ] Revisado (humanos ou IA)
- [ ] Documentado em `docs/`
- [ ] Mergeado na `main` (via release) ou `develop`
- [ ] Roadmap atualizado
- [ ] CHANGELOG atualizado (quando necessário)
