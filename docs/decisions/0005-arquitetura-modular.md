# ADR-0005: Arquitetura modular em pacotes por domínio

- **Status:** Aceita
- **Data:** 2026-08-04
- **Autor:** Rafael

## Contexto

O SDK (antes `@nodemelivre/sdk` único) cresceu para um só pacote que concentra core, auth, resources e tipos. A visão de longo prazo é o NodeMeLivre se aproximar do que o Octokit é para o GitHub e o SDK da Stripe para pagamentos: um ecossistema modular, bem tipado e agradável de usar, que escala de dezenas para centenas de funcionalidades sem quebrar quem já usa.

## Problema

Como organizar o monorepo para que o consumidor instale apenas o que precisa, sem duplicar configuração, e o time adicione recursos novos sem tocar em código existente.

## Solução

Quebrar o pacote único em **pacotes por domínio**, cada um com `package.json`, `tsconfig` e ciclo de build próprios:

- `@nodemelivre/core` — transport, logger, test-utils (infra transversal não-HTTP).
- `@nodemelivre/http` — `HttpClient`, retry, rate limit, timeout (camada HTTP independente).
- `@nodemelivre/errors` — hierarquia de erros tipados (`MercadoLivreError`, `ApiError`, `NetworkError`, `OAuthError`, `RateLimitError`...).
- `@nodemelivre/types` — tipos de domínio (item, order, user, shipment, question).
- `@nodemelivre/auth` — OAuth2, `TokenManager`, `TokenStore`.
- `@nodemelivre/items`, `@nodemelivre/orders`, `@nodemelivre/users`, `@nodemelivre/shipments`, `@nodemelivre/questions` — um resource por pacote.
- `@nodemelivre/sdk` — facade que re-exporta tudo e mantém a API `createMercadoLivre(...)` / `new MercadoLivre(...)`.

- **Alternativa A:** continuar com um pacote único — mais simples hoje, mas o consumidor que só usa `items` baixa o mundo inteiro; toda feature nova toca o mesmo ciclo de release.
- **Alternativa B:** pastas separadas dentro de um só pacote — isola no código, mas não isola publicação e versão.
- **Alternativa C:** geração automática de módulos a partir de schema — poderoso, mas adiciona infra de geração que ainda não se justifica.
- **Escolhida:** pacotes por domínio sobre o monorepo npm workspaces (ADR-0001), porque permite instalação seletiva (`@nodemelivre/http` + `@nodemelivre/items`), versionamento independente e testes por pacote com aliases do Vitest apontando para o `src`.

## Consequências

- (+) Consumidor instala só o que usa, ou o `@nodemelivre/sdk` que agrega tudo.
- (+) Feature nova vira um pacote novo sem tocar nos existentes — compatibilidade preservada.
- (+) Cada pacote declara suas dependências irmãs com `"@nodemelivre/*": "*"`; npm workspaces linka via symlink.
- (+) Typecheck dev usa `paths` apontando para o `src` dos irmãos (sem precisar buildar); o build usa os `dist` em ordem topológica fixa.
- (+) Testes rodam na raiz via `vitest` com aliases para o `src` — um comando para todos os pacotes.
- (-) Onze pacotes para manter; mitigado por convenção (`kebab-case`, mesmo `tsconfig.base.json`, mesmo Biome).
- (-) `npm run build` precisa de ordem explícita (errors → core → http → types → auth → resources → sdk), pois o npm não ordena por topologia com `--workspaces`.
- (-) `@nodemelivre/types` não tem exports em runtime (só tipos) — natural para um pacote de tipos, como `@types/*`.

### Quando revisitar

Se o número de pacotes passar de ~15, avaliar ferramenta de monorepo (Turborepo/pnpm) e geração a partir do schema OpenAPI. Registrar nova ADR.