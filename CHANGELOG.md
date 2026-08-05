# Changelog

Todas as mudanças notáveis do monorepo serão documentadas neste arquivo.

O formato segue [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e o projeto adere ao [SemVer](https://semver.org/lang/pt-BR/). Veja o [processo de release](docs/releases/README.md).

## [1.0.0] - 2026-08-05

### Adicionado

- **SDK consolidado** — `createMercadoLivre` facade expõe 12 resources: `items`, `orders`, `users`, `shipments`, `questions`, `images`, `messages`, `webhooks`, `auth`, `http`, `core`, `types`, `errors`.
- **Webhooks** (`@nodemelivre/webhooks`) — `parse(payload)` + `verify(payload, applicationId)` autentica via `application_id` (ML não usa HMAC).
- **Messages** (`@nodemelivre/messages`) — chat pós-venda: `list`, `get`, `send` com `tag=post_sale`.
- **Operações nível 3**:
  - `Items.createAndPublish(input)` — cria e garante publicado.
  - `Questions.reply(questionId, text)` — responde + marca respondida.
  - `Shipments.printLabel(ids, { format })` — etiqueta PDF/ZPL como `ArrayBuffer`.
  - `responseType: 'json' | 'text' | 'arraybuffer'` no transport/HttpClient.
- **Images** — `UploadSource = Blob | Buffer | Uint8Array | ArrayBuffer` extensível, nome padrão `image.bin`.
- **Paginação** — `paginate()` no core + `Items.list()` (`for await`).
- **ADRs 0001–0012**, 12 exemplos, roadmap, CHANGELOG.
- 110 testes (Vitest), CI verde.

## [0.4.2] - 2026-08-05

### Alterado

- `Images.upload` agora aceita `UploadSource = Blob | Buffer | Uint8Array | ArrayBuffer` — alias em `@nodemelivre/types` para permitir novos formatos (ex.: `File`, `ReadableStream`) sem quebrar a API pública.
- Nome padrão do arquivo no multipart alterado de `imagem` para `image.bin` (com extensão, para melhor interoperabilidade com servidores de upload).
- ADR-0009 atualizado com a evolução do tipo de entrada.

## [0.4.1] - 2026-08-05

### Adicionado

- `Items.createAndPublish(input)` — cria um anúncio e, se ele não nascer `active`, publica via `updateStatus('active')`. Mantém `publish(itemId)` como alias simples (sem overload ambíguo).
- `Questions.reply(questionId, text)` — alias ergonômico de `answer`; responder via `POST /answers` já marca a pergunta como `ANSWERED`.
- `Shipments.printLabel(ids | ids[], { format?: 'pdf' | 'zpl2' })` — baixa a etiqueta de envio (`GET /shipment_labels`) e retorna `Promise<ArrayBuffer>` (binário íntegro). Formato padrão `pdf`.
- `responseType: 'json' | 'text' | 'arraybuffer'` em `ResourceRequest` (`@nodemelivre/core`) e `HttpClientRequest` (`@nodemelivre/http`) — suporte a respostas binárias/plano no transport.
- ADR-0012 (operações nível 3) e exemplo `examples/nivel-3-completo.ts`.
- Prioridade B do roadmap concluída (operações nível 3 completas) — v1.0 desbloqueada.
- 107 testes (Vitest) — 7 novos (createAndPublish, reply, printLabel, arraybuffer/text no client).

## [0.4.0] - 2026-08-05

### Adicionado

- **`@nodemelivre/webhooks`** — notificações do Mercado Livre:
  - `Webhooks.parse(payload)` — converte o corpo do callback em `WebhookNotification` tipado, validando `resource`/`user_id`/`topic` e o tópico conhecido.
  - `Webhooks.verify(payload, applicationId)` — autentica a notificação conferindo o `application_id` da sua aplicação (o ML **não** usa assinatura HMAC, ao contrário do Mercado Pago). Lança `WebhookError`.
  - `WebhookError` em `@nodemelivre/errors`.
- **`@nodemelivre/messages`** — chat pós-venda (`tag=post_sale`):
  - `Messages.list(packId, sellerId, { markAsRead? })` → `GET /messages/packs/{packId}/sellers/{sellerId}`.
  - `Messages.get(messageId)` → `GET /messages/{messageId}` (o `resource` do webhook de mensagem é um hash usado aqui).
  - `Messages.send({ from, to, text })` → `POST /messages` (máx. 350 caracteres).
- Tipos de domínio: `WebhookNotification`/`WebhookTopic`/`WebhookMessageAction` e `Message`/`MessageSendInput`/`MessageUser`/`MessageRecipient`/`MessageAttachment`.
- ADR-0011 (webhooks e messages).
- Exemplo `examples/webhooks-e-messages.ts`.
- 100 testes (Vitest) — 14 novos (webhooks parse/verify, messages list/get/send).

## [0.3.0] - 2026-08-05

### Adicionado

- **Paginação assíncrona** — helper `paginate()` em `@nodemelivre/core`: async generator genérico que itera item a item sobre uma busca paginada, avançando o `offset` automaticamente e suportando `break` para parada antecipada.
- `Items.list(siteId, params)` — percorre todos os resultados de uma busca:
  ```ts
  for await (const item of ml.items.list('MLB', { q: 'fone' })) {
    console.log(item.title)
  }
  ```
- Operações nível 3:
  - `Items.publish(itemId)` / `Items.pause(itemId)` — aliases tipados de `updateStatus`.
  - `Orders.waitUntilPaid(orderId, { timeoutMs?, intervalMs? })` — polling até o pedido ficar `paid`, com `PollingTimeoutError` em `@nodemelivre/errors` no estouro de timeout.
- ADR-0010 (paginação assíncrona e operações nível 3).
- 86 testes (Vitest) — 9 novos (paginate no core, `list`, `publish`, `pause`, `waitUntilPaid`).

## [0.2.0] - 2026-08-05

### Adicionado

- `@nodemelivre/images` — novo resource `Images.upload(file)` que envia imagem via multipart para `POST /pictures/items/upload` e retorna `ImageUploadResponse` (id + variações de tamanho no CDN). O `id` pode ser usado em `picture_ids` ao criar itens com variações.
- Suporte a `FormData`/`Blob`/`BodyInit` no `HttpClient`: body nativo multipart é passado direto ao fetch (sem `JSON.stringify`), preservando o boundary gerado pelo `FormData`.
- Tipos de variação em `@nodemelivre/types` — `VariationAttribute`, `ItemVariation`, `ItemVariationInput`; `Item.variations` e `ItemInput.variations`.
- ADR-0009 (resource images e variações de item).
- 77 testes (Vitest) — 3 novos (upload multipart no resource, FormData direto no client).

## [0.1.0] - 2026-08-04

### Adicionado

- Monorepo com npm workspaces (`packages/*`) e configs compartilhadas (Biome, `tsconfig.base.json` strict).
- `@nodemelivre/sdk` v0.1.0:
  - `http/` — cliente sobre fetch nativo com retry, rate-limit (`X-Rate-Limit-*`), timeout via `AbortSignal.any` e refresh automático em 401.
  - `auth/` — `OAuthClient` (authorization_code, refresh_token, credentials), `TokenManager` com leeway 60s e dedupe de refresh, `InMemoryTokenStore` e `FileTokenStore`.
  - `resources/` — items, orders, users, shipments, questions sobre um `ResourceTransport` comum.
  - `types/` — tipos de domínio (item, order, user, shipment, question, common).
  - `errors/` — `ApiError` tipado por status, `NetworkError` e `OAuthError`.
  - `index.ts` — `MercadoLivre`, `createMercadoLivre` e re-exports.
- 74 testes (Vitest) cobrindo errors, retry, rate-limit, cliente HTTP, OAuth, token managers e os 5 resources.
- `docs/` — ADRs 0001–0004, roadmap e processo de release.
- Arquitetura modular em **11 pacotes por domínio** (ADR-0005 + ADR-0006), cada um publicável de forma independente:
  - `@nodemelivre/errors` — hierarquia de erros tipados (`ApiError`, `NetworkError`, `OAuthError`, `RateLimitError`...).
  - `@nodemelivre/core` — transport, logger, test-utils (infra transversal não-HTTP).
  - `@nodemelivre/http` — `HttpClient`, retry, rate limit, timeout (camada HTTP independente).
  - `@nodemelivre/types` — tipos de domínio com **unions para enums fechados** (`ListingTypeId`, `ShippingMode`, `OrderStatus`, `PaymentStatus`, `ShipmentType`, `QuestionStatus`, `AnswerStatus`, `ShipmentStatus`, `UserType`, `SiteStatus`, `ReputationLevelId`) — ADR-0007.
  - `@nodemelivre/auth` — OAuth2, `TokenManager`, `TokenStore`.
  - `@nodemelivre/items`, `@nodemelivre/orders`, `@nodemelivre/users`, `@nodemelivre/shipments`, `@nodemelivre/questions`.
  - `@nodemelivre/sdk` — facade que re-exporta todos os pacotes, mantendo a API `createMercadoLivre`/`MercadoLivre`.
- Testes unificados na raiz via Vitest com aliases para o `src` dos pacotes; build com ordem topológica explícita (errors → core → http → types → auth → resources → sdk).
- `MockTransport` em `@nodemelivre/core/test-utils.ts` (ADR-0008): API fluente para testar resources sem rede
  (`.onGet()`, `.onPost()`, `.withDelay()`, `.withError()`, `.reset()`, `.calledWith()`, `.lastCall()`).
- `fakeTransport()` legado mantido para compatibilidade.
- Eventos tipados no `HttpClient` (`request`, `response`, `retry`, `httpError`, `rateLimit`) e no `TokenManager` (`tokenRefreshed`), com exemplos em `examples/events.ts`.
- ADRs 0006–0008 (separação core/errors/http, disciplina de tipos, MockTransport).

### Corrigido

- `OrderStatus` agora inclui `'paid'`.
- Removida a opção `baseUrl` preterida dos `tsconfig.json` de `packages/*` (TypeScript 6/7).

### Alterado

- Pacote renomeado de `@mlibre/sdk` para `@nodemelivre/sdk`; monorepo renomeado para `nodemelivre-monorepo`.
- Caminho padrão de persistência de token alterado de `~/.mlibre/` para `~/.nodemelivre/`.
- README, LICENSE (MIT), CONTRIBUTING e templates `.github/` adicionados seguindo o padrão da casa.
- CI com lint, typecheck, testes, build e validação de Conventional Commits.
