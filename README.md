# NodeMeLivre

> SDK TypeScript para a API do Mercado Livre — tipado, modular e sem esconder a API por baixo.

NodeMeLivre é um SDK moderno para a [API do Mercado Livre](https://developers.mercadolivre.com.br). Ele simplifica autenticação, gerenciamento de tokens, paginação, tratamento de erros e outras tarefas repetitivas, mantendo uma correspondência fiel com os recursos e comportamentos da API oficial. Todo recurso disponível na API permanece acessível através do SDK, sem abstrações que escondam funcionalidades ou limitem o controle do desenvolvedor.

## Instalação

```bash
npm install @nodemelivre/sdk
```

> Requer Node ≥ 18.17 (fetch nativo).

## Uso rápido

```ts
import { createMercadoLivre } from '@nodemelivre/sdk'

const ml = createMercadoLivre({
  clientId: process.env.ML_CLIENT_ID!,
  clientSecret: process.env.ML_CLIENT_SECRET!,
  siteId: 'MLB',
})

// URL para o vendedor autorizar
const url = ml.authorizationUrl('http://localhost:3000/callback', 'estado-anti-csrf')

// Após o callback, troca o code por token (persistido automaticamente)
const token = await ml.authenticate('http://localhost:3000/callback', code)

const me = await ml.users.me()
const search = await ml.items.search('MLB', { q: 'fone bluetooth' })
```

## Níveis de uso

| Nível | O que faz | Exemplo |
|---|---|---|
| 1. HTTP | Controle total, camada fina sobre o REST | `ml.http.get('/users/me')` |
| 2. Resources | Operações de domínio tipadas | `ml.items.get(id)`, `ml.orders.search(...)` |
| 3. Operações | Fluxos que economizam horas (futuro) | `ml.items.publish(...)`, `ml.orders.waitUntilPaid(...)` |

## Features atuais

- **Auth** — OAuth2 (`authorization_code`, `refresh_token`, `credentials`), refresh automático com leeway de 60s, dedupe de chamadas concorrentes, `TokenStore` pluggável (`InMemoryTokenStore`, `FileTokenStore`).
- **HTTP** — retry com backoff exponencial, timeout via `AbortSignal`, rate limit por recurso (`X-Rate-Limit-*`), injeção de `fetch`.
- **Resources** — `items`, `orders`, `users`, `shipments`, `questions`, todos tipados.
- **Erros** — `ApiError` tipado por status, `RateLimitError`, `NetworkError`, `OAuthError`.
- **Tipagem estrita** — `strict: true`, sem `any`.

## Estrutura do repositório

```text
packages/sdk/        Pacote publicável (@nodemelivre/sdk)
  src/auth/          OAuth2, TokenManager, TokenStore
  src/http/          Cliente, retry, rate limit
  src/resources/     items, orders, users, shipments, questions
  src/types/         Tipos de domínio (item, order, user, ...)
  src/errors/        Erros tipados
docs/                ADRs, roadmap, releases
examples/            Exemplos executáveis
```

## Documentação

- [docs/](docs/README.md) — ADRs, roadmap e processo de release.
- Este projeto segue o [Manual das Boas Práticas](https://github.com/rafaeldc/MANUAL-DAS-BOAS-PRATICAS): Conventional Commits, ADRs, branches, PRs e Definition of Done.

## Contribuindo

Veja [CONTRIBUTING.md](CONTRIBUTING.md).

## Licença

Distribuído sob a [Licença MIT](LICENSE).
