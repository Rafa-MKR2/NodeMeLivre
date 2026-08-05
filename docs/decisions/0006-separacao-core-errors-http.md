# ADR-0006: Separação de core em errors, http e core (11 pacotes)

- **Status:** Aceita
- **Data:** 2026-08-04
- **Autor:** Rafael

## Contexto

ADR-0005 definiu 9 pacotes com `@nodemelivre/core` concentrando HTTP (retry, rate-limit, timeout), erros tipados, logger, transport e test-utils. Durante a implementação, ficou claro que HTTP e erros evoluem independentemente dos resources e da infra transversal.

## Problema

Manter HTTP, erros e infra (logger/transport/test-utils) no mesmo pacote cria acoplamento desnecessário:
- Mudança no cliente HTTP força bump de versão no `core` e em tudo que depende dele
- Erros tipados são estáveis; HTTP muda mais (retry policies, timeouts, headers)
- Consumidor que só quer `TokenProvider` + `Logger` carrega todo o cliente HTTP

## Solução

Dividir `@nodemelivre/core` em **três pacotes independentes**:

| Pacote | Responsabilidade | Depende de |
|---|---|---|
| `@nodemelivre/errors` | Hierarquia de erros (`ApiError`, `NetworkError`, `OAuthError`, `RateLimitError`...) | — |
| `@nodemelivre/http` | `HttpClient`, `RateLimiter`, retry, timeout, `TokenProvider` | `errors`, `core` (Logger) |
| `@nodemelivre/core` | `Logger`, `silentLogger`, `ResourceTransport`, `toQuery`, test-utils | — |

**Total: 11 pacotes** (errors, http, core, types, auth, 5 resources, sdk).

## Alternativas

- **A:** Manter 9 pacotes — mais simples hoje, mas acopla HTTP/erros/infra.
- **B:** Separar só errors — HTTP continua acoplado a core.
- **Escolhida:** 3 pacotes — isolamento completo, versionamento independente.

## Consequências

- (+) Consomidor instala só `@nodemelivre/http` + `@nodemelivre/items` sem carregar erros/core
- (+) Erros podem versionar em `v1` enquanto HTTP está em `v0.x`
- (+) Build order explícita: errors → core → http → types → auth → resources → sdk
- (-) Mais pacotes para manter (11); mitigado por convenção compartilhada