# Auditoria de Segurança — NodeMeLivre SDK

**Data:** 2026-08-08
**Versão analisada:** 1.0.x (pós-hardening Fases 1-4)
**Escopo:** 14 pacotes do monorepo (`packages/*`) + exemplos + CI
**Método:** revisão estática do código-fonte + verificação dinâmica dos achados (execução do `URL` parser e testes) + revisão por IA

---

## Resumo Executivo

Auditoria de segurança complementar ao [DOCUMENTO_CORRECOES.md](../DOCUMENTO_CORRECOES.md) (que cobriu os P0/P1/P2 de estado e autenticação — todos resolvidos). Esta auditoria focou em vetores **novos e clássicos** de bibliotecas HTTP/autenticação:

- **Injeção de path / confused deputy** (IDs de usuário interpolados em paths de API)
- **SSRF** (upload por URL, redirects HTTP)
- **Exposição de segredos** (logs, eventos)
- Higiene: permissões de arquivo, CSPRNG, CI, segredos no repo

Foram identificados **5 achados** (1 média-alta, 2 baixa-média, 2 baixos). **4 correções de segurança foram implementadas** (path traversal, SSRF no schema de URL, redirects não autorizados e `question_id` numérico) e 1 item foi documentado como recomendação. O estado atual é **verde**: 307 testes, lint, typecheck e build passando.

**Veredito:** o SDK estava **acima da média** em higiene (CSPRNG para state, token em arquivo com `0o600`, sem segredos em logs, rate-limit por recurso não-fragmentado). O único vetor com impacto real — path traversal via normalização de URL — foi corrigido e coberto por testes.

---

## ✅ Status de Resolução (2026-08-08)

| # | Achado | Severidade | Status | Onde |
|---|--------|------------|--------|------|
| 1 | Path traversal via `new URL()` (confused deputy) | 🔴 Média-Alta | ✅ Corrigido | `assertValidId` no core + 6 resources |
| 2 | `httpUrlSchema` aceita hosts de SSRF | 🟡 Baixa-Média | ✅ Corrigido | `httpUrlSchema` endurecido |
| 3 | Redirects seguidos cegamente (token em risco) | 🟡 Baixa-Média | ✅ Corrigido | `HttpClient` com `redirect: 'manual'` + validação |
| 4 | `Questions.reply` enviaria `question_id: null` | 🟢 Baixa | ✅ Corrigido | validação numérica em `reply` |
| 5 | Eventos expõem `headers`/`body` ao integrador | 🟢 Baixa | 📚 Documentado | nota de segurança no README |

---

## 🔴 ACHADO 1 — Path Traversal via Normalização de URL (confused deputy)

### Localização
```
packages/http/src/client.ts — buildUrl(): new URL(path, baseUrl)
packages/items/src/items.ts      Items.get(itemId)               →  `/items/${itemId}`
packages/orders/src/orders.ts    Orders.get / Orders.items       →  `/orders/${orderId}` e `/orders/${orderId}/items`
packages/questions/src/questions.ts  Questions.get               →  `/questions/${questionId}`
packages/users/src/users.ts      Users.get                      →  `/users/${userId}`
packages/shipments/src/shipments.ts  Shipments.get               →  `/shipments/${shipmentId}`
packages/messages/src/messages.ts    Messages.conversation        →  `/messages/packs/${packId}/sellers/${sellerId}`
```

### Descrição do Problema
Todos os resources interpolam IDs recebidos do chamador **sem validação** diretamente no path da API. O `HttpClient` resolve o path com `new URL(path, baseUrl)`, que **normaliza segmentos `..`**. Um ID malicioso pode fazer a requisição autenticada atingir um endpoint diferente do pretendido — executado com o `Authorization: Bearer` do vendedor.

### Evidência (execução real)
```
new URL('/items/../../users/me', base)        → https://api.mercadolibre.com/users/me
new URL('/items/../../../oauth/token', base)  → https://api.mercadolibre.com/oauth/token
new URL('/sites/../../users/me/search', base) → https://api.mercadolibre.com/users/me/search
```
(`%2F` codificado **não** é normalizado — mitigação parcial existia apenas por acaso.)

### Impacto
Se a aplicação do integrador repassar input de usuário para esses métodos (ex.: `itemId` vindo de query string da rota), um atacante pode:
- ler dados de outro endpoint (`../../orders/search` → vendas do vendedor);
- alcançar endpoints sensíveis com o token do vendedor.

O chamador chama `ml.items.get(...)` acreditando estar buscando um item; na prática o SDK executa uma requisição a outro recurso.

### Correção Implementada
`assertValidId(id, label)` em `@nodemelivre/core` (pattern `/^[A-Za-z0-9_-]+$/`, máx. 100 chars; números: inteiro não-negativo e seguro) aplicado em **todos** os métodos que interpolam IDs:
- `items`: `get`, `getDescription`, `update`, `updateDescription`, `updateStatus`, `search`, `list`, `searchBySeller`, `listBySeller`
- `orders`: `get`, `items`, `waitUntilPaid`
- `questions`: `get`, `reply`
- `users`: `get`
- `shipments`: `get`, `printLabel` (cada ID do array)
- `messages`: `list`, `conversation`, `get`

Payloads inválidos agora falham com `InputValidationError` **antes** de tocar a rede. O pattern rejeita unicode, percent-encoding (`%2F`), `..`, `\`, CRLF e espaços — sem bypass prático conhecido.

**Testes:** `schemas.test.ts` (DSL), `items/orders/questions/users.test.ts` (prova de que o transport não é chamado), `http/client.test.ts` (redirects).

---

## 🟡 ACHADO 2 — `httpUrlSchema` aceita destinos de SSRF

### Localização
```
packages/core/src/schemas.ts — httpUrlSchema / isHttpUrl
packages/images/src/images.ts:31 — uploadFromUrl(url)
```

### Descrição do Problema
O schema validava apenas o protocolo (`http:`/`https:`), permitindo `http://localhost:3000`, `http://127.0.0.1`, `http://169.254.169.254/latest/meta-data/`, `http://10.0.0.1`, `http://[::1]` e ranges privados.

### Contexto que Reduz o Risco
O SDK **não baixa** a URL — ela é repassada ao Mercado Livre (`POST /pictures { source }`), e o fetch acontece na infraestrutura do **ML**, não na do integrador. Ou seja: o SSRF seria contra o próprio ML, não contra a rede do usuário. Ainda assim, um integrador que deixe URL de usuário chegar a `uploadFromUrl` cria um vetor de abuso da plataforma (metadata endpoints, varredura interna).

### Correção Implementada
`httpUrlSchema` agora rejeita, além de não-http(s):
- `localhost` e `*.localhost`
- loopback IPv4 (`127.0.0.0/8`) e IPv6 (`::1`; `::` — unspecified — também bloqueado)
- ranges privados: `10/8`, `172.16/12`, `192.168/16`, `100.64/10` (CGNAT)
- link-local/metadata: `169.254.0.0/16`, `fe80::/10`, ULA (`fc00::/7`)
- hostnames de metadata: `metadata`, `metadata.google.internal`
- **IPv4-mapeado em IPv6** (`::ffff:127.0.0.1`, `::ffff:169.254.169.254`) — incluindo a forma **hex normalizada pelo WHATWG URL** (`::ffff:7f00:1`), decodificada e re-checada octeto a octeto

Nota: hosts que **resolvem por DNS** para IPs privados (ex.: `localtest.me`) não são bloqueados sintaticamente — limitação aceitável porque o fetch é executado pelo ML, e o bloqueio cobre os vetores literais clássicos.

**Testes:** `schemas.test.ts` cobre os 11 hosts bloqueados + 2 hosts públicos válidos.

---

## 🟡 ACHADO 3 — Redirects HTTP seguidos cegamente

### Localização
```
packages/http/src/client.ts — performFetch / buildFetchInit
```

### Descrição do Problema
O `fetch` nativo segue redirecionamentos automaticamente (`redirect: 'follow'`). Um `Location` malicioso (ex.: endpoint de metadata da nuvem, host não autorizado) faria o SDK seguir — e, em redirects do mesmo origin, reenviar o header `Authorization` para o destino.

### Correção Implementada
`HttpClient` agora usa `redirect: 'manual'` e resolve/valida **cada hop** manualmente:

| Regra | Comportamento |
|---|---|
| **Allowlist de host** | mesmo host do `baseUrl`, subdomínio do host, ou `api.mercadolibre.com` / `api.mercadolivre.com.br` (e subdomínios) |
| **Protocolo** | nunca rebaixar `https→http`; apenas http(s) |
| **Limite** | máximo de **5 hops** (anti-loop) → `NetworkError` |
| **Sem `Location`** | `NetworkError` explícito |
| **Spec do fetch** | 303 → GET; 301/302 em POST → GET (com limpeza de `content-type`/`content-length`); **HEAD preservado em 303**; 307/308 preservam método e corpo |

Um `Location` não autorizado nunca recebe o `Authorization` do SDK.

**Testes:** `http/client.test.ts` (segue mesmo host; bloqueia host externo; bloqueia downgrade; bloqueia loop com 5 hops) + `http/integration.test.ts` (redirect real 302→200 mesmo host; host externo bloqueado; loop bloqueado).

---

## 🟢 ACHADO 4 — `Questions.reply` enviaria `question_id: null`

### Localização
```
packages/questions/src/questions.ts — reply()
```

### Descrição do Problema
`reply` fazia `Number(questionId)` sem validação: `reply('abc', ...)` produzia `NaN`, e `JSON.stringify(NaN)` serializa como `null` — o payload enviado seria `{ question_id: null, text }`.

### Correção Implementada
`reply` valida com `assertValidId` **e** exige `Number.isSafeInteger(numericId) && numericId > 0`, lançando `InputValidationError` para `'abc'`, `'../../x'`, `NaN`, `0` e negativos.

---

## 🟢 ACHADO 5 — Eventos expõem `headers`/`body` (uso indevido)

### Localização
```
packages/http/src/client.ts — eventos request/response/retry/httpError/rateLimit
examples/events.ts
```

### Descrição do Problema
Os eventos emitem o `HttpClientRequest` (com `headers`) e o erro (com `body` da resposta). O SDK **não loga** segredos por padrão (verificado: `client.ts` loga apenas `url.toString()`; `refresh.ts` loga apenas `userId`; o `Authorization` é montado após o emit do evento `request`), mas um integrador que logue `req.headers` ou `err.body` completos pode capturar dados sensíveis.

### Ação
Documentado no README: ao usar eventos, evite logar o objeto `headers`/`body` completo sem redação.

---

## ✅ Verificações sem problema

| Área | Resultado |
|---|---|
| **CSPRNG** | `generateStateToken` usa `crypto.getRandomValues` (256 bits) ✅ |
| **Token em disco** | `FileTokenStore` escreve com `mode: 0o600` (principal, backup e temp) ✅; arquivos de lease/lock não contêm segredo (só `holderId`/timestamps) |
| **Segredos em logs** | nenhum `client_secret`/`refresh_token`/token logado pelos caminhos padrão ✅ |
| **Rate limiter** | `rateLimitKey` agrupa por `método:recurso` (primeiro segmento) — sem crescimento de memória por IDs parametrizados ✅ |
| **Webhooks** | sem assinatura HMAC é **limitação da plataforma ML** (documentada); `verifyForUser` valida `application_id` + `user_id` ✅ |
| **Segredos no repo** | `.gitignore` cobre `.env*` (com `!.env.example`); CI sem secrets; exemplos usam `process.env` sem valores hardcoded ✅ |
| **Permissões Windows** | modo `0o600` é POSIX — documentado no DOCUMENTO_CORRECOES como limitação |
| **Redirect cross-origin** | a spec do fetch remove `Authorization` em redirects cross-origin (undici); reforçado pelo bloqueio explícito do ACHADO 3 |

---

## 📊 Matriz de Severidade

| Severidade | Achados | Status |
|---|---|---|
| 🔴 Média-Alta | Path traversal (1) | ✅ Corrigido |
| 🟡 Baixa-Média | SSRF no schema (2), Redirects (3) | ✅ Corrigido |
| 🟢 Baixa | `reply` NaN (4), Eventos (5) | ✅ Corrigido / 📚 Documentado |

---

## 📚 Referências

- [DOCUMENTO_CORRECOES.md](../DOCUMENTO_CORRECOES.md) — correções P0/P1/P2 (estado, PKCE, atomicidade)
- [ANALISE_QUALIDADE_TECNICA.md](../ANALISE_QUALIDADE_TECNICA.md) — análise arquitetural e fases
- [ADR-0013](decisions/0013-schemas-validacao-zero-dep.md) — validação por schemas (fundação do `assertValidId`)
- [RFC 7636](https://www.rfc-editor.org/rfc/rfc7636) — PKCE (referência de estado)
- WHATWG URL Standard — normalização de `..` e IPv4-mapeado em IPv6
- Fetch Standard — `redirect: 'manual'`, mudança de método em redirects

---

*Auditoria baseada em leitura dos 14 pacotes (src + testes), execução do `URL` parser para confirmação dos vetores, e validação final com 307 testes, lint, typecheck e build verdes (commit `3ae58fb`).*
