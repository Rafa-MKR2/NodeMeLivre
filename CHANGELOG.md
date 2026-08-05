# Changelog

Todas as mudanças notáveis do monorepo serão documentadas neste arquivo.

O formato segue [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e o projeto adere ao [SemVer](https://semver.org/lang/pt-BR/). Veja o [processo de release](docs/releases/README.md).

## Não publicado

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

### Alterado

- Pacote renomeado de `@mlibre/sdk` para `@nodemelivre/sdk`; monorepo renomeado para `nodemelivre-monorepo`.
- Caminho padrão de persistência de token alterado de `~/.mlibre/` para `~/.nodemelivre/`.
- README, LICENSE (MIT), CONTRIBUTING e templates `.github/` adicionados seguindo o padrão da casa.
- CI com lint, typecheck, testes, build e validação de Conventional Commits.

### Adicionado (arquitetura modular — ADR-0005 + ADR-0006)

- Monorepo quebrado em **11 pacotes por domínio**, cada um publicável de forma independente:
  - `@nodemelivre/errors` — hierarquia de erros tipados (`ApiError`, `NetworkError`, `OAuthError`, `RateLimitError`...).
  - `@nodemelivre/core` — transport, logger, test-utils (infra transversal não-HTTP).
  - `@nodemelivre/http` — `HttpClient`, retry, rate limit, timeout (camada HTTP independente).
  - `@nodemelivre/types` — tipos de domínio (item, order, user, shipment, question) com **unions para enums fechados** (`ListingTypeId`, `ShippingMode`, `OrderStatus`, `PaymentStatus`, `ShipmentType`, `QuestionStatus`, `AnswerStatus`, `ShipmentStatus`, `UserType`, `SiteStatus`, `ReputationLevelId`) — ADR-0007.
  - `@nodemelivre/auth` — OAuth2, `TokenManager`, `TokenStore`.
  - `@nodemelivre/items`, `@nodemelivre/orders`, `@nodemelivre/users`, `@nodemelivre/shipments`, `@nodemelivre/questions`.
  - `@nodemelivre/sdk` — facade que re-exporta todos os pacotes, mantendo a API `createMercadoLivre`/`MercadoLivre`.
- Testes unificados na raiz via Vitest com aliases para o `src` dos pacotes; build com ordem topológica explícita (errors → core → http → types → auth → resources → sdk).

### Adicionado (disciplina de tipos — ADR-0007)

- Unions para enums fechados em todos os tipos de domínio:
  - Item: `ListingTypeId`, `ShippingMode`
  - Order: `OrderStatus`, `PaymentStatus`, `ShipmentType`
  - Question: `QuestionStatus`, `AnswerStatus`
  - Shipment: `ShipmentStatus`, `ShippingType`
  - User: `UserType`, `SiteStatus`, `ReputationLevelId`

### Adicionado (testes — ADR-0008)

- `MockTransport` em `@nodemelivre/core/test-utils.ts`: API fluente para testar resources sem rede
  (`.onGet()`, `.onPost()`, `.withDelay()`, `.withError()`, `.reset()`, `.calledWith()`, `.lastCall()`).
- `fakeTransport()` legado mantido para compatibilidade.