# Roadmap

Visão de curto e médio prazo do SDK, com prioridades e status.

## Estratégia de releases

| Versão | Escopo | Objetivo | Status |
|---|---|---|---|
| **v0.1.0** | Base estável (monorepo, HTTP, OAuth2, TokenStore, 5 resources) | Publicar núcleo sólido; feedback inicial | ✔ Publicado 2026-08-04 |
| **v0.2.x** | Paginação assíncrona, eventos, operações nível 3 | Ergonomia: `for await`, `ml.on(...)`, `ml.items.publish()` |
| **v0.3.x** | Upload de imagens, webhooks `verify/parse`, PKCE | Recursos de plataforma |
| **v0.4.x** | Resources extras: payments, messages, billing | Cobertura de API |
| **v1.0.0** | API pública consolidada, estabilidade garantida | Marco de produção |

> Não esperamos 100% da API do ML para publicar. Entregamos valor incremental.

---

## Prioridade A — Fundação (aumenta capacidade do SDK)

| Feature | Dificuldade | Tempo | Status |
|---|---|---|---|
| **Eventos** (`ml.on('request' \| 'response' \| 'retry' \| 'tokenRefreshed' \| 'rateLimit' \| 'error')`) | Média | 2 dias | ✔ Concluído |
| **Paginação assíncrona** (`for await (const item of ml.items.list(params))`) | Média | 2 dias | ⏳ Planejado |
| **Upload de imagens** (`ml.images.upload(file)`) | Média | 2 dias | ⏳ Planejado |
| **Webhooks** (`ml.webhooks.verify(payload, signature)`, `ml.webhooks.parse(payload)`) | Média | 3 dias | ⏳ Planejado |
| **PKCE** no fluxo OAuth2 | Média | 2 dias | ⏳ Planejado |
| **MockTransport** para testes (testar sem chamar ML) | Baixa | 1 dia | ✔ Concluído |

> **Observabilidade** é o diferencial: quando alguém abrir issue "o refresh não funcionou", eventos valem ouro para depuração.

---

## Prioridade B — Ergonomia (desenvolvedor ama o SDK)

| Feature | Dificuldade | Tempo | Status |
|---|---|---|---|
| **Operações nível 3** — compostas que economizam horas | Média | 3 dias | ⏳ Planejado |
| `ml.items.publish(input)` → cria + ativa + publica | | | |
| `ml.items.pause(id)` → pausa anúncio | | | |
| `ml.orders.waitUntilPaid(orderId, timeout?)` → polling com backoff | | | |
| `ml.questions.reply(questionId, text)` → responde + marca lida | | | |
| `ml.shipments.printLabel(shipmentId)` → gera + baixa label | | | |

> Substitui sequências manuais por uma chamada única, tipada e testada.

---

## Prioridade C — Ecossistema (transforma SDK em plataforma)

| Feature | Dificuldade | Tempo | Status |
|---|---|---|---|
| **Middleware / plugins** (interceptadores de request/response) | Alta | 3 dias | ⏳ Planejado |
| **Cache** (ETag, `If-None-Match`, in-memory + pluggável) | Média | 2 dias | ⏳ Planejado |
| **Métricas** (latência, taxa de erro, rate-limit remaining) | Média | 2 dias | ⏳ Planejado |
| **Mocks avançados** (fixtures, scenarios, MSW integration) | Média | 2 dias | ⏳ Planejado |

---

## Concluído (v0.1)

| Feature | Status |
|---|---|
| Monorepo npm workspaces | ✔ |
| Cliente HTTP com retry/rate-limit/timeout | ✔ |
| OAuth2 (authorization_code, refresh, credentials) | ✔ |
| TokenManager + TokenStore pluggável | ✔ |
| Resources v1 (items, orders, users, shipments, questions) | ✔ |
| 74 testes (Vitest) | ✔ |
| ADRs 0001–0005, roadmap, releases, CHANGELOG | ✔ |
| CI (Biome + typecheck + test + build + conventional commits) | ✔ |
| Arquitetura modular 11 pacotes (errors, http, core, types, auth, 5 resources, sdk) | ✔ |
| Disciplina de tipos: unions para enums fechados | ✔ |

---

## Legenda de status

| Símbolo | Significado |
|---|---|
| ✔ | Concluído |
| 🚧 | Em andamento |
| ⏳ | Planejado |
| ❌ | Cancelado |
| 🔒 | Bloqueado |

---

## Regras de manutenção

- **Todo item tem status** — sem item sem status.
- Atualizar o roadmap **no dia em que** a tarefa mudar de status.
- Feature nova entra aqui antes de virar branch.
- Features canceladas ficam registradas como ❌ (não apagar).

---

## Definition of Done

Uma tarefa **só é considerada concluída** quando **todos** os itens abaixo são verdadeiros:

- [ ] Código implementado
- [ ] Testado
- [ ] Revisado (humanos ou IA)
- [ ] Documentado em `docs/`
- [ ] Mergeado na `main` (via release) ou `develop`
- [ ] Roadmap atualizado
- [ ] CHANGELOG atualizado (quando necessário)