# Roadmap

Visão de curto e médio prazo do SDK, com prioridades e status.

## Estratégia de releases

| Versão | Escopo | Objetivo | Status |
|---|---|---|---|
| **v0.1.0** | Base estável (monorepo, HTTP, OAuth2, TokenStore, 5 resources) | Publicar núcleo sólido; feedback inicial | ✔ Publicado 2026-08-04 |
| **v0.2.x** | Upload de imagens + variações em itens | Destravar a criação real de anúncios (foto + SKU) | ✔ Concluído |
| **v0.3.x** | Paginação assíncrona + operações nível 3 | Ergonomia: `for await`, `publish`, `pause`, `waitUntilPaid` | ✔ Concluído |
| **v0.4.x** | Webhooks (`parse`/`verify`) + `messages` | Notificação em tempo real e chat de comprador | ✔ Concluído |
| **v1.0.0** | API pública consolidada, docs completas, estabilidade | Marco de produção | ⏳ Planejado |

> **Critério de "versão sólida" (v1.0):** o integrador consegue, de ponta a ponta, autenticar, criar anúncio com foto e variação, paginar buscas, acompanhar vendas/perguntas/envios em tempo real e operar por chat — sem workaround manual.

> Itens adiados para pós-v1.0 (não bloqueiam produção): PKCE (foco SPA/mobile), middleware/plugins, cache, métricas, `payments`/`billing`.

---

## Prioridade A — Destrava o vendedor (v0.2 → v0.3)

| Feature | Dificuldade | Tempo | Status |
|---|---|---|---|
| **Upload de imagens** (`ml.images.upload(file)`) | Média | 2 dias | ✔ Concluído |
| **Variações em itens** (`ItemInput.variations`, SKU/tamanho/cor) | Média | 2 dias | ✔ Concluído |
| **Paginação assíncrona** (`for await (const item of ml.items.list(params))`) | Média | 2 dias | ✔ Concluído |
| **Eventos** (`ml.on('request' \| 'response' \| 'retry' \| 'tokenRefreshed' \| 'rateLimit' \| 'error')`) | Média | 2 dias | ✔ Concluído |
| **MockTransport** para testes (testar sem chamar ML) | Baixa | 1 dia | ✔ Concluído |

> **Sem upload de imagem e variação, o SDK só cria anúncio "quebrado".** Esses dois destravam a operação real.

---

## Prioridade B — Produção (v0.4)

| Feature | Dificuldade | Tempo | Status |
|---|---|---|---|
| **Operações nível 3** — compostas que economizam horas | Média | 3 dias | 🚧 Parcial |
| `ml.items.publish(input)` → cria + ativa + publica | | | ⏳ Pendente |
| `ml.items.pause(id)` → pausa anúncio | | | ✔ Concluído |
| `ml.orders.waitUntilPaid(orderId, timeout?)` → polling com backoff | | | ✔ Concluído |
| `ml.questions.reply(questionId, text)` → responde + marca lida | | | ⏳ Pendente |
| `ml.shipments.printLabel(shipmentId)` → gera + baixa label | | | ⏳ Pendente |
| **Webhooks** (`ml.webhooks.parse(payload)`, `ml.webhooks.verify(payload, applicationId)`) | Média | 3 dias | ✔ Concluído |
| **Messages** (`ml.messages.list/get/send` — chat de comprador) | Média | 3 dias | ✔ Concluído |

> **Webhooks** habilitam notificação em tempo real (nova venda, pergunta, mensagem) — essencial para rodar em produção.

---

## Prioridade C — Pós-v1.0 (ecossistema)

| Feature | Dificuldade | Tempo | Status |
|---|---|---|---|
| **Middleware / plugins** (interceptadores de request/response) | Alta | 3 dias | ⏳ Planejado |
| **Cache** (ETag, `If-None-Match`, in-memory + pluggável) | Média | 2 dias | ⏳ Planejado |
| **Métricas** (latência, taxa de erro, rate-limit remaining) | Média | 2 dias | ⏳ Planejado |
| **Mocks avançados** (fixtures, scenarios, MSW integration) | Média | 2 dias | ⏳ Planejado |
| **PKCE** no fluxo OAuth2 (foco SPA/mobile) | Média | 2 dias | ⏳ Planejado |
| **Resources extras** (payments, billing) | Baixa | 5 dias | ⏳ Planejado |

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

## Concluído (v0.2)

| Feature | Status |
|---|---|
| `@nodemelivre/images` — resource `Images.upload()` (multipart) | ✔ |
| Suporte a `FormData`/multipart no `HttpClient` | ✔ |
| Variações em itens (`ItemVariation`, `ItemVariationInput`) | ✔ |
| ADR-0009 (images + variações) | ✔ |

## Concluído (v0.3)

| Feature | Status |
|---|---|
| `paginate()` no core + `Items.list()` (`for await`) | ✔ |
| `Items.publish` / `Items.pause` (aliases de status) | ✔ |
| `Orders.waitUntilPaid()` + `PollingTimeoutError` | ✔ |
| ADR-0010 (paginação + nível 3) | ✔ |

## Concluído (v0.4)

| Feature | Status |
|---|---|
| `@nodemelivre/webhooks` — `Webhooks.parse()` / `Webhooks.verify(payload, applicationId)` (sem HMAC — o ML não assina) | ✔ |
| `@nodemelivre/messages` — `Messages.list/get/send` (chat pós-venda, `tag=post_sale`) | ✔ |
| `WebhookError` em `@nodemelivre/errors` | ✔ |
| ADR-0011 (webhooks + messages) | ✔ |

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