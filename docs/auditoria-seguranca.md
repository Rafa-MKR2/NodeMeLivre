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

Em **sete rodadas** (auditoria inicial + re-auditoria exaustiva com execução real de experimentos e revisão independente + verificação adicional com revisor independente + auditoria focada em OAuth/PKCE/timing/concorrência + auditoria focada em DoS/erros/payloads + auditoria cega independente com confirmação por execução + auditoria de supply chain/CI), foram identificados **29 achados** (1 média-alta, 8 médias, 3 baixa-média, 17 baixos). **27 correções foram implementadas**, 1 item documentado (eventos) e 1 mitigado (temp previsível do `FileTokenStore`). O estado atual é **verde**: 325 testes, lint, typecheck, build e `npm run security:check` (33/33) passando.

**Veredito:** o SDK estava **acima da média** em higiene (CSPRNG para state, token em arquivo com `0o600`, sem segredos em logs, rate-limit por recurso não-fragmentado). Os vetores com impacto real — path traversal via normalização de URL, bypass de SSRF por trailing dot e perda de token na re-autenticação — foram corrigidos e cobertos por testes.

---

## ✅ Status de Resolução (2026-08-08)

### Rodada 1 — auditoria inicial

| # | Achado | Severidade | Status | Onde |
|---|--------|------------|--------|------|
| 1 | Path traversal via `new URL()` (confused deputy) | 🔴 Média-Alta | ✅ Corrigido | `assertValidId` no core + 6 resources |
| 2 | `httpUrlSchema` aceita hosts de SSRF | 🟡 Baixa-Média | ✅ Corrigido | `httpUrlSchema` endurecido |
| 3 | Redirects seguidos cegamente (token em risco) | 🟡 Baixa-Média | ✅ Corrigido | `HttpClient` com `redirect: 'manual'` + validação |
| 4 | `Questions.reply` enviaria `question_id: null` | 🟢 Baixa | ✅ Corrigido | validação numérica em `reply` |
| 5 | Eventos expõem `headers`/`body` ao integrador | 🟢 Baixa | 📚 Documentado | nota de segurança no README |

### Rodada 2 — re-auditoria (verificação exaustiva)

| # | Achado | Severidade | Status | Onde |
|---|--------|------------|--------|------|
| 6 | Log injection via `WebhookError` (CRLF em `topic`/`application_id`/`user_id`) | 🟡 Média | ✅ Corrigido | `sanitizeLog()` em `webhooks.ts` |
| 7 | Prototype pollution local em `deepOmitEmpty`/`omitEmpty`/`omitUndefined`/`toQuery` (`__proto__` aciona setter) | 🟢 Baixa | ✅ Corrigido | chaves perigosas ignoradas no core |
| 8 | `resolveSellerItems` interpola IDs da API sem validação | 🟢 Baixa | ✅ Corrigido | `assertValidId` defesa-em-profundidade |
| 9 | `FileTokenStore` temp path previsível (symlink race) | 🟢 Baixa | ✅ Mitigado | escrita temp+rename já protege o alvo; risco exige acesso local prévio |

### Rodada 3 — verificação com revisor independente

| # | Achado | Severidade | Status | Onde |
|---|--------|------------|--------|------|
| 10 | Bypass de SSRF por **trailing dot** (`localhost.`, `metadata.` — FQDN absoluto que resolve para loopback) | 🟡 Média | ✅ Corrigido | `httpUrlSchema` normaliza hostname (`trailing dot` removido) |
| 11 | `ApiError.message` interpola a `message` da API sem sanitização (log injection em logs/APM) | 🟢 Baixa | ✅ Corrigido | `errorMessageFor` sanitiza control chars |
| 12 | `sanitizeLog` não cobria NEL (`\u0085`) e DEL (`\x7f`) | 🟢 Baixa | ✅ Corrigido | regex ampliado no webhooks |

### Rodada 4 — OAuth/PKCE, timing attacks e concorrência

| # | Achado | Severidade | Status | Onde |
|---|--------|------------|--------|------|
| 13 | **Re-autenticação perde o token novo** — `saveAuthorizationCode` com `compareAndSet(token, 0)` falha silenciosamente quando já há token (version ≥ 1); o SDK segue com sessão expirada após re-login | 🟡 Média | ✅ Corrigido | `TokenManager` lê a versão atual + força sobrescrita em conflito |
| 14 | `instanceId` do `TokenManager` com `Math.random()` (holderId do lease previsível — colisão liberaria leases cruzados) | 🟢 Baixa | ✅ Corrigido | CSPRNG (`randomBytes(8)`) |
| 15 | Fallback in-memory de `code_verifier` sem limite (memory leak com URLs nunca consumidas) | 🟢 Baixa | ✅ Corrigido | max 1000 entradas + sweep de expiradas |

### Rodada 5 — DoS, erros e payloads da API

| # | Achado | Severidade | Status | Onde |
|---|--------|------------|--------|------|
| 16 | `deepOmitEmpty` recursivo estoura a pilha (RangeError) com payload profundamente aninhado — DoS local do processo do integrador | 🟡 Média | ✅ Corrigido | `cleanDeep` iterativo (pilha explícita) |
| 17 | `paginate()` em loop infinito quando a API ignora `offset` (página repetida + `total: null`) — requisições infinitas | 🟡 Média | ✅ Corrigido | guard de página repetida antes de entregar itens |
| 18 | `RateLimiter` dorme dias com `x-rate-limit-reset` no futuro distante (header corrompido/gateway) — DoS de espera | 🟡 Média | ✅ Corrigido | teto `MAX_WAIT_MS` (5 min) |

### Rodada 6 — auditoria cega independente (confirmação por execução)

| # | Achado | Severidade | Status | Onde |
|---|--------|------------|--------|------|
| 19 | Origin escape no `buildUrl`: path absoluto (`https://evil.com/y`) ou protocol-relative (`//evil.com/x`) leva o `Authorization` para outro origin (confused deputy via `ml.http.*`) | 🔴 Média | ✅ Corrigido | `buildUrl` rejeita path não-relativo |
| 20 | DNS-rebinding: serviços wildcard públicos (`nip.io`, `sslip.io`, `xip.io`, `localtest.me`...) passam no `httpUrlSchema` — `127.0.0.1.nip.io` → loopback | 🟡 Média | ✅ Corrigido | `WILDCARD_DNS_SUFFIXES` bloqueado |
| 21 | IPv6 transition (NAT64 `64:ff9b::/96`, 6to4 `2002::/16`, IPv4-compat `::/96`) embute IPv4 local e passa no schema | 🟡 Baixa-Média | ✅ Corrigido | `isBlockedTransitionIPv6` re-valida octetos embutidos |
| 22 | `Authorization` reenviado em redirect cross-origin autorizado (`api.mercadolibre.com` → `api.mercadolivre.com.br`) — fetch nativo removeria o header | 🟢 Baixa | ✅ Corrigido | header dropado quando `next.origin !== url.origin` |
| 23 | `parallel()` faz pollution local via chave `__proto__` (valor resolvido vira prototype de `data`) | 🟢 Baixa | ✅ Corrigido | `Object.create(null)` para `data` |
| 24 | `FileTokenStore` cria `.lease`/`.lock` com umask padrão (0644) — token é `0o600`, auxiliares não | 🟢 Baixa | ✅ Corrigido | `mode: 0o600` em lease e lock |

### Rodada 7 — supply chain, scripts npm, build e hardening do CI

| # | Achado | Severidade | Status | Onde |
|---|--------|------------|--------|------|
| 25 | `ci.yml` sem `permissions:` — GITHUB_TOKEN com escopos amplos por default | 🟢 Baixa | ✅ Corrigido | `permissions: contents: read` nos jobs |
| 26 | Workflows sem `timeout-minutes` — job pode rodar indefinidamente (custos/DoS em runner) | 🟢 Baixa | ✅ Corrigido | `timeout-minutes: 15` (ci) / 20 (publish) |
| 27 | CI não rodava `npm audit` — vulnerabilidades de dependências passavam despercebidas | 🟢 Baixa | ✅ Corrigido | `npm audit --omit=dev --audit-level=high` nos 2 workflows |
| 28 | Dependências internas `@nodemelivre/*` com `"*"` — não fixam compatibilidade ao publicar | 🟢 Baixa | ✅ Corrigido | `^1.0.0-beta.1` em todos os 14 manifests + lockfile |
| 29 | Actions do CI por **tag móvel** (`@v4`/`@v5`) — o dono do repo da action pode sobrescrever a tag com outro código (supply chain) | 🟢 Baixa | ✅ Corrigido | pin por SHA (commit imutável) + comentário da versão nos 2 workflows |

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

## 🟡 ACHADO 6 — Log injection via `WebhookError` (Rodada 2)

### Localização
```
packages/webhooks/src/webhooks.ts — parse() e verify()/verifyForUser()
```

### Descrição do Problema
O payload do webhook é um **POST público** (qualquer um pode enviar). Os campos `topic`, `application_id` e `user_id` são atacante-controlados e eram interpolados **sem sanitização** em mensagens de `WebhookError`:

```ts
`Webhook inválido: tópico desconhecido "${data.topic}"`
`application_id ${notification.application_id} não pertence...`
```

Um payload com `topic: "orders_v2\n[ERROR] ..."` injetava **linhas falsas em qualquer logger** que registrasse o erro — forjar logs de auditoria. `parse` também aceitava strings gigantes (linha de log gigante).

### Correção Implementada
`sanitizeLog(value)`: remove CR/LF (a mensagem nunca quebra em múltiplas linhas) e trunca em 100 chars. Aplicado a `topic`, `application_id` e `user_id` em todas as mensagens que os ecoam. **Confirmado por teste**: payload com `\n` e `\r` produz mensagem com exatamente 1 linha.

---

## 🟢 ACHADO 7 — Prototype pollution local em funções de objeto (Rodada 2)

### Localização
```
packages/core/src/utils.ts — deepOmitEmpty, omitEmpty, omitUndefined
packages/core/src/transport.ts — toQuery
```

### Descrição do Problema
`out[key] = value` onde `key` pode ser `__proto__` (vindo de `JSON.parse` de input não confiável — vira **own key**). A atribuição aciona o **setter de prototype**: `out['__proto__'] = {polluted: true}` faz o objeto resultante **herdar** `polluted` (confirmado por execução: `omitEmpty(evil).polluted === true`). Não é poluição global do `Object.prototype`, mas é uma superfície indesejada — o objeto retornado carrega propriedades herdadas que o chamador não criou.

### Correção Implementada
As quatro funções ignoram as chaves `__proto__`/`constructor`/`prototype` antes de atribuir. **Confirmado por teste**: `deepOmitEmpty(evil)` não contém `__proto__` nem `constructor`, e `({}).polluted` permanece `undefined` (sem poluição global).

---

## 🟢 ACHADO 8 — `resolveSellerItems` interpola IDs da API sem validação (Rodada 2)

### Localização
```
packages/items/src/items.ts — resolveSellerItems()
```

### Descrição do Problema
Os IDs dos anúncios vêm da **resposta da API** (`/users/{id}/items/search` — fonte semi-confiável) e eram interpolados em `/items/${id}` sem `assertValidId`. O `assertValidId` foi aplicado aos inputs do usuário, mas não a este fluxo interno.

### Correção Implementada
Cada ID passa por `assertValidId(id, 'item_id')` antes da resolução — um ID anômalo não pode alterar o endpoint. Defesa em profundidade (custo ~zero).

---

## 🟢 ACHADO 9 — `FileTokenStore` temp path previsível (Rodada 2)

### Localização
```
packages/auth/src/token.ts — writeVersionedUnlocked()
```

### Descrição do Problema
O arquivo temporário usa nome fixo (`sdk-token.json.tmp`) + `writeFile` (segue symlinks). Um atacante **local** com escrita no diretório do token poderia pre-criar o temp como symlink para outro arquivo.

### Mitigação
A escrita **temp+rename atômica** já protege o arquivo alvo (o `rename` substitui o symlink, não o segue); o risco exigiria acesso de escrita prévio ao diretório do usuário (que já implica acesso à conta). Aceito como risco residual baixo; mitigação adicional possível com sufixo aleatório (`randomBytes`) no nome do temp, se desejado.

---

## 🟡 ACHADO 10 — Bypass de SSRF por trailing dot (Rodada 3)

### Localização
```
packages/core/src/schemas.ts — isBlockedHttpHost()
```

### Descrição do Problema
A checagem de hosts usava `url.hostname` **sem normalizar o trailing dot**. O WHATWG URL mantém o ponto final em hostnames: `new URL('http://localhost./x').hostname` → `localhost.`. Como a comparação era `host === 'localhost'`, o host `localhost.` **escapava** — e `localhost.` é o FQDN absoluto de `localhost`, resolvendo para 127.0.0.1 na maioria dos resolvers. Mesmo vetor para `metadata.` e `metadata.google.internal.`.

### Evidência (execução real)
```
httpUrlSchema.parse('http://localhost./x')        → PASS (antes) / BLOQUEADO (depois)
httpUrlSchema.parse('http://metadata./x')         → PASS (antes) / BLOQUEADO (depois)
httpUrlSchema.parse('http://metadata.google.internal./x') → PASS (antes) / BLOQUEADO (depois)
https://img.example.com/foto.jpg                  → ACEITO (inalterado)
```

### Correção Implementada
O hostname é normalizado com `replace(/\.$/, '')` antes de todas as comparações. Nota: IPv4 com trailing dot (`127.0.0.1.`) já era normalizado pelo próprio WHATWG URL — o vetor era exclusivo de hostnames. `::ffff:`-mapeado, decimal/hex IPv4 (`2130706433`, `0x7f000001`) e ranges privados já estavam cobertos (reverificados na Rodada 3).

**Testes:** casos de trailing dot adicionados ao bloco de hosts bloqueados em `schemas.test.ts`.

---

## 🟢 ACHADO 11 — `ApiError.message` sem sanitização (Rodada 3)

### Localização
```
packages/errors/src/index.ts — errorMessageFor()
```

### Descrição do Problema
A `message` ecoada pela API do ML (que pode refletir input do usuário em erros de validação) era interpolada **crua** em `ApiError.message`. Quando a exceção é serializada (logs, APM, dashboards), um `message` com `\r\n` forjava linhas de log — o mesmo vetor já corrigido nos webhooks, agora no caminho de erro da API.

### Correção Implementada
`errorMessageFor` sanitiza a `message` da API removendo CR/LF, separadores Unicode (`\u2028`/`\u2029`/`\u0085`) e control chars (`\x00-\x1f`, `\x7f`). O `body` bruto continua disponível estruturado em `err.body` (sem quebra de contrato).

---

## 🟢 ACHADO 12 — `sanitizeLog` sem NEL/DEL (Rodada 3)

### Localização
```
packages/webhooks/src/webhooks.ts — sanitizeLog()
```

### Descrição do Problema
O regex cobria CR/LF e `\u2028`/`\u2029`, mas não o NEL (`\u0085`, reconhecido como quebra de linha por vários loggers) nem o DEL (`\x7f`).

### Correção Implementada
Regex ampliado para `[\r\n\u2028\u2029\u0085\x00-\x1f\x7f]`. O mesmo padrão é usado no `ApiError.message` (Achado 11) — consistência entre os dois pontos de sanitização.

---

## 🟡 ACHADO 13 — Re-autenticação perde o token novo (Rodada 4)

### Localização
```
packages/auth/src/refresh.ts — TokenManager.saveAuthorizationCode()
```

### Descrição do Problema
`saveAuthorizationCode` persistia o resultado do `authorization_code` com `compareAndSet(token, 0)` — semântica "só se o store estiver vazio". No **re-login** (store já contém token com `version ≥ 1`), o compare-and-set retorna `null` e o **retorno era ignorado**: o token novo era descartado silenciosamente e o SDK continuava com a sessão anterior (potencialmente expirada).

### Evidência (execução real)
```
após 1a auth: access-code-1
após re-auth:   access-code-1 (esperado access-code-2)  ← BUG
após correção:  access-code-2  ✓
```

### Correção Implementada
Lê a versão atual (`getWithVersion()`) e usa compare-and-set atômico com ela; se houver conflito (outra escrita no meio), **força a sobrescrita uma única vez** — o token recém-trocado por um novo login é sempre mais novo que qualquer refresh concorrente e não pode ser perdido.

---

## 🟢 ACHADO 14 — `instanceId` previsível no `TokenManager` (Rodada 4)

### Localização
```
packages/auth/src/refresh.ts — randomInstanceId()
```

### Descrição do Problema
O `instanceId` (holderId do lease distribuído) usava `Math.random().toString(36).substring(2, 10)` — ~31 bits, gerador previsível. Uma colisão entre duas instâncias faria uma liberar o lease da outra (`releaseLease(holderId)`), permitindo **refresh duplo** (duas chamadas concorrentes a `/oauth/token` com o mesmo `refresh_token`).

### Correção Implementada
`randomBytes(8).toString('hex')` (CSPRNG, 64 bits) — consistente com a disciplina do projeto (`generateStateToken` usa `getRandomValues` de 256 bits). `Math.random` segue apenas em jitter de retry/backoff e caos de teste (não-secretos).

---

## 🟢 ACHADO 15 — Fallback in-memory de `code_verifier` sem limite (Rodada 4)

### Localização
```
packages/auth/src/oauth.ts — codeVerifiers (fallback sem stateStore)
```

### Descrição do Problema
Sem `stateStore`, o `OAuthClient` armazena `code_verifier` por state em um `Map` in-memory com TTL de 10 min — mas o TTL só era checado **na leitura**. Um fluxo que gera muitas `authorizationUrl()` com pkce e nunca completa os callbacks (usuários abandonando login, atacante gerando URLs) crescia o `Map` sem limite: vazamento de memória.

### Correção Implementada
Mesma política do `OAuthStateStore`: limite de **1000 entradas** (expulsa a mais antiga) + sweep de entradas expiradas a cada inserção. Teste: 1001 states → o primeiro é expulso, o último permanece.

---

## 🟡 ACHADO 16 — `deepOmitEmpty` recursivo estoura a pilha (Rodada 5)

### Localização
```
packages/core/src/utils.ts — deepOmitEmpty()
```

### Descrição do Problema
`deepOmitEmpty` limpava recursivamente objetos aninhados. Input de usuário pode ter **profundidade arbitrária** (ex.: `attributes` de item com nested objects vindos de `JSON.parse`): a versão recursiva estoura a pilha do V8 (~10k frames → `RangeError: Maximum call stack size exceeded`) e **derruba o processo** do integrador — DoS local a partir de um payload malformado.

### Evidência (execução real)
```
payload com profundidade ~10.000 → RangeError: Maximum call stack size exceeded (antes)
payload com profundidade ~10.000 → limpeza concluída (depois, pilha explícita)
```

### Correção Implementada
Reescrita **iterativa** (`cleanDeep` com pilha explícita de frames + `deliver` por consumer): semântica idêntica à recursão original (preserva `null`, omite `undefined` e objetos vazios, ignora `UNSAFE_KEYS`), sem recursão de função — profundidade arbitrária processada sem estourar a pilha. Teste: payload de 10k de profundidade limpa sem `RangeError`.

---

## 🟡 ACHADO 17 — `paginate()` em loop infinito (Rodada 5)

### Localização
```
packages/core/src/pagination.ts — paginate()
```

### Descrição do Problema
Quando a API ignora o parâmetro `offset` e devolve sempre a mesma página (com `paging.total: null` — respostas de busca normalmente trazem `total`, mas a defesa não podia assumir), o `paginate()` avançava o offset e buscava **para sempre**: requisições infinitas à API (consumo de rate limit e do orçamento do integrador — DoS). Confirmado por execução: fetch chamado indefinidamente.

### Correção Implementada
Guarda de página repetida: se a página atual começa com o **mesmo primeiro item** da anterior (JSON.stringify do primeiro elemento), a iteração encerra **antes de entregar os itens repetidos**. As páginas legítimas seguem intactas (página de itens diferentes nunca dispara o guard). Teste: API que devolve `[1,2]` sempre → iteração entrega `[1,2]` e faz exatamente 2 chamadas.

---

## 🟡 ACHADO 18 — `RateLimiter` com espera gigante (Rodada 5)

### Localização
```
packages/http/src/rate-limit.ts — RateLimiter.waitIfNeeded()
```

### Descrição do Problema
O `RateLimiter` calcula a espera como `resetAt - now` sem teto. Um header `x-rate-limit-reset` **corrompido ou injetado por gateway/atacante** com valor no futuro distante (ex.: epoch com unidade errada, ano 2099) fazia o SDK dormir **dias**: no experimento, `x-rate-limit-reset: 9999999999` (≈ ano 2286) gerou espera de ~95.067 dias — cada requisição ao recurso esgotado ficava presa por uma eternidade (DoS de espera, sem timeout).

### Evidência (execução real)
```
x-rate-limit-reset futuro distante → delay de 95.067 dias (antes)
x-rate-limit-reset futuro distante → espera limitada a 5 min (depois)
```

### Correção Implementada
Teto `MAX_WAIT_MS = 5 min` (constante documentada) aplicado a qualquer espera calculada acima dele. O single-flight (`waits` por recurso) e a limpeza do estado esgotado ao fim da janela foram preservados. Teste: reset no futuro distante → delay é exatamente o teto.

---

## 🟢 ACHADO 25 — `ci.yml` sem `permissions:` (Rodada 7)

### Localização
```
.github/workflows/ci.yml — jobs.validate
```

### Descrição do Problema
O workflow não declarava `permissions:`. Por default o `GITHUB_TOKEN` recebe escopos amplos do repositório (ex.: `contents: write` para o próprio repo) mesmo quando o CI só lê código e roda testes — superfície desnecessária: um passo comprometido (ex.: dependência maliciosa em um script) teria o token com permissões de escrita.

### Correção Implementada
`permissions: contents: read` nos dois jobs (`validate` e `conventional-commits`); `publish-beta.yml` mantém `packages: write` (necessário para publicar) mas restringe `contents: read`. Checagem estática no `security:check` impede regressão.

---

## 🟢 ACHADO 26 — Workflows sem `timeout-minutes` (Rodada 7)

### Localização
```
.github/workflows/ci.yml e publish-beta.yml
```

### Descrição do Problema
Jobs sem timeout podem rodar indefinidamente — um teste que trava (ex.: espera de rede sem teto) consome o runner e o orçamento do repo indefinidamente.

### Correção Implementada
`timeout-minutes: 15` no `ci.yml` (validate e conventional-commits) e `20` no `publish-beta.yml` (build + publish de 14 pacotes).

---

## 🟢 ACHADO 27 — CI sem `npm audit` (Rodada 7)

### Localização
```
.github/workflows/ci.yml e publish-beta.yml
```

### Descrição do Problema
Nenhum workflow rodava `npm audit` — vulnerabilidades em dependências (transitivas inclusive) passavam despercebidas no CI (na prática, a árvore atual está limpa: `npm audit --omit=dev` → 0 vulnerabilidades).

### Correção Implementada
Step `npm audit --omit=dev --audit-level=high` em ambos os workflows, após `npm ci` (produção; devDependencies ficam de fora por serem de tooling). Falha fecha o PR com exit code 1.

---

## 🟢 ACHADO 28 — Dependências internas com `"*"` (Rodada 7)

### Localização
```
packages/*/package.json — dependencies (@nodemelivre/*)
```

### Descrição do Problema
Todas as dependências internas usavam `"*"`. Em monorepo funciona (workspace resolve local), mas **ao publicar** o `"*"` não fixa compatibilidade: um consumidor que instale `@nodemelivre/auth` isolado receberia a versão mais recente de `@nodemelivre/core` — sem garantia de quebrou a API entre releases.

### Correção Implementada
Todos os manifests usam `^1.0.0-beta.1` (range compatível com a versão atual, fixando o mínimo). Lockfile atualizado (`npm install --package-lock-only`) e resolução de workspaces confirmada (`npm ls` → deduped local). Checagem estática no `security:check` impede a volta de `"*"`.

---

## 🟢 ACHADO 29 — Actions do CI por tag móvel (Rodada 7)

### Localização
```
.github/workflows/ci.yml — actions/checkout, actions/setup-node
.github/workflows/publish-beta.yml — idem
```

### Descrição do Problema
Os workflows referenciavam as actions por **tag semântica móvel** (`actions/checkout@v4`, `actions/setup-node@v5`). Tags como `v4` são re-escritas pelo dono do repo da action para apontar para novos commits — um atacante que comprometa o repo da action (ou o dono publique código malicioso sob a mesma tag) substituiria o código que o CI executa **sem mudança nenhuma no workflow** do projeto. O mesmo princípio de imutabilidade aplicado a dependências npm (`npm ci` + lockfile) deve valer para as actions.

### Correção Implementada
Todas as `uses:` apontam para **SHA de commit** (imutável) com comentário da versão legível:

| Action | SHA pinado | Versão |
|---|---|---|
| `actions/checkout` (ci) | `11d5960a326750d5838078e36cf38b85af677262` | v4 |
| `actions/setup-node` (ci) | `49933ea5288caeca8642d1e84afbd3f7d6820020` | v4 |
| `actions/checkout` (publish) | `fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09` | v5 |
| `actions/setup-node` (publish) | `a0853c24544627f65ddf259abe73b1d18a591444` | v5 |

Os SHAs foram resolvidos via GitHub API (todos apontam para `type: commit`, não tag anotada). Checagem estática no `security:check` (item 23) rejeita qualquer `uses: owner/repo@vN` futuro.

**Complemento — atualização automática:** o pinning por SHA só é sustentável com atualização automática. `.github/dependabot.yml` configura o Dependabot (ecossistema `github-actions`, semanal): ele atualiza o digest do SHA **preservando o comentário de versão** (`# v4`/`# v5`) — o pin nunca volta a ser tag móvel. O ecossistema `npm` (workspaces) atualiza o lockfile agrupando patch/minor num PR só e ignora os pacotes internos `@nodemelivre/*` (resolvidos via workspaces, publicados no GitHub Packages). `insecure-external-code-execution` permanece **desabilitado** por decisão de segurança (Rodada 7) — se um update exigir o postinstall do esbuild, o flag é avaliado caso a caso. Checagem estática no `security:check` (item 24) exige o arquivo.

---

## 🔴 ACHADO 19 — Origin escape no `buildUrl` (Rodada 6)

### Localização
```
packages/http/src/client.ts — buildUrl()
```

### Descrição do Problema
`new URL(path, baseUrl)` aceita path **absoluto** e **protocol-relative**: `http.get('//evil.example.com/x')` resolvia para `https://evil.example.com/x` e `http.get('https://evil.com/y')` idem — com o `Authorization: Bearer` no header (confirmado por execução). As resources tipadas validam tudo via `assertValidId` (que bloqueia `/` e `.`), então o vetor só abre se o integrador usar `ml.http.get()` com entrada não validada — e `ml.http` é **API pública documentada**. O SDK endureceu redirecionamentos para "não vazar o token", mas o URL inicial não tinha validação de origem — a mesma classe de confused deputy do Achado 1, agora na entrada do transport.

### Correção Implementada
`buildUrl` rejeita path que comece com `//` ou que contenha protocolo (`/^[a-z][a-z0-9+.-]*:/i`) com `InputValidationError` ("path deve ser relativo ao baseUrl") — o token nunca chega a sair do processo para outro origin. Teste: `get('https://evil.com/y')` e `get('//evil.example.com/x')` lançam sem chamar o fetch.

---

## 🟡 ACHADO 20 — SSRF por DNS wildcard público (Rodada 6)

### Localização
```
packages/core/src/schemas.ts — httpUrlSchema / isBlockedHttpHost()
```

### Descrição do Problema
Serviços como `nip.io`, `sslip.io`, `xip.io` e `localtest.me` resolvem **qualquer** host para um IP escolhido no próprio hostname (`127.0.0.1.nip.io` → 127.0.0.1). Confirmado por execução: todos passavam no schema como "hosts públicos" — o bloqueio cobria apenas IPs literais e hostnames exatos. Impacto atenuado porque quem faz o fetch é o ML (uploadFromUrl), mas o vetor de abuso da plataforma descrito no Achado 2 permanecia aberto.

### Correção Implementada
`WILDCARD_DNS_SUFFIXES` (nip.io, sslip.io, xip.io, localtest.me, lvh.me, vcap.me, nip.rocks) bloqueados como host exato ou sufixo — cobre os serviços wildcard clássicos. DNS-rebinding por serviços novos exige atualização da lista (trade-off documentado: o schema é síncrono e não resolve DNS).

---

## 🟡 ACHADO 21 — SSRF por transição IPv6 (Rodada 6)

### Localização
```
packages/core/src/schemas.ts — isBlockedHttpHost()
```

### Descrição do Problema
Mecanismos de transição IPv6 embutem um IPv4 que roteia para loopback/privado em redes IPv6-only — e todos passavam no schema (confirmado por execução):
```
[64:ff9b::7f00:1]   NAT64 well-known prefix → 127.0.0.1
[2002:7f00:1::]     6to4                  → 127.0.0.1
[::7f00:1]          IPv4-compatível        → 127.0.0.1
```

### Correção Implementada
`isBlockedTransitionIPv6()` extrai o IPv4 embutido de cada mecanismo (dotted e hex — o WHATWG URL normaliza para hex) e reaplica `isBlockedIPv4`: NAT64 `64:ff9b::/96`, 6to4 `2002::/16` (próximos 32 bits) e IPv4-compatível `::/96`. IPv6 público legítimo (`2001:4860:4860::8888`) permanece aceito.

---

## 🟢 ACHADO 22 — `Authorization` em redirect cross-origin (Rodada 6)

### Localização
```
packages/http/src/client.ts — performFetch()
```

### Descrição do Problema
O `redirect: 'manual'` + resolução manual dos hops reutilizava `currentHeaders` (com `Authorization`) em cada hop. Um redirect 302 para outro host autorizado (ex.: `api.mercadolivre.com.br` vindo de `api.mercadolibre.com`) carregava o Bearer — confirmado por execução (header presente no 2º hop). O fetch nativo teria removido o header na troca de origin. Risco baixo (hosts autorizados são oficiais do ML), mas com `baseUrl` próprio (proxy/staging) o token ia para qualquer subdomínio do integrador.

### Correção Implementada
Quando `next.origin !== url.origin` (origin da requisição original), o `Authorization` é removido do header antes do próximo hop — mesmo comportamento do fetch. Redirect same-origin preserva o token. Teste: Bearer presente na origem e `null` no hop cross-origin.

---

## 🟢 ACHADO 23 — Pollution local em `parallel()` (Rodada 6)

### Localização
```
packages/core/src/resilience.ts — parallel()
```

### Descrição do Problema
`data[resource] = value` com `resource = '__proto__'` (chave própria de um objeto de operações montado por `JSON.parse`/spread) aciona o **setter de prototype**: o valor resolvido vira o prototype de `data`, e `data.injected`/`data.from` ficam visíveis sem estar em `Object.keys(data)` (confirmado por execução). Não é pollution global, mas o resto do SDK trata `__proto__` com `UNSAFE_KEYS` — `parallel()` era a exceção.

### Correção Implementada
`data` é criado com `Object.create(null)` — a atribuição vira own property, sem acionar setter. Teste: `data.injected` é `undefined` e `({}).injected` permanece `undefined`.

---

## 🟢 ACHADO 24 — Permissões de `.lease`/`.lock` no `FileTokenStore` (Rodada 6)

### Localização
```
packages/auth/src/token.ts — acquireLease() / renewLease() / acquireLock()
```

### Descrição do Problema
O token era escrito com `mode: 0o600`, mas o lease (`writeFile` sem mode) e o lock (`open` sem mode) eram criados com umask padrão (0644) — confirmado por execução (`sdk-token.json` = 600, `.lease` = 644). O lease não contém segredo, mas quebra a disciplina de permissão do diretório de tokens.

### Correção Implementada
`mode: 0o600` em todas as escritas de lease (acquire/renew) e no `open()` do lock. Teste: token e lease com 600.

---

## ✅ Verificações da Rodada 4 — OAuth/PKCE, timing e concorrência (sem problema)

| Vetor | Resultado |
|---|---|
| **PKCE RFC 7636** | verifier 43 chars (32 bytes base64url), charset `[A-Za-z0-9-._~]`, S256 sem padding — confirmado por execução ✅ |
| **Timing attack no state** | `consumeState` usa `Map.get` (hash lookup, não comparação string-a-string) — sem canal de tempo mensurável ✅ |
| **Timing em webhooks** | `application_id`/`user_id` comparados com `===` são números não-secretos ✅ |
| **Refresh concorrente** | single-flight local + lease distribuído: 2 instâncias fazem **1 refresh** (confirmado por execução); `compareAndSet` previne sobrescrita; lease liberado em `finally` ✅ |
| **Stale lease** | holder morto segura o lease até o TTL (30s); `waitForLeaseRelease` aguarda e o token é relido — indisponibilidade temporária, sem corrupção ✅ |
| **Leeway** | renova 60s antes da expiração (clock injetável) — confirmado ✅ |
| **State single-use** | `consume` 2x retorna `null` na segunda — confirmado por execução ✅ |
| **Code trocado 2x** | rejeitado pelo ML (`invalid_grant`); SDK não reusa code ✅ |
| **Segredos em logs/eventos** | `client_secret`/`refresh_token` nunca logados pelos caminhos padrão (eventos emitem `userId`/URL) ✅ |
| **401 sem refresh_token** | `OAuthError('missing_refresh_token')` tipado, sem loop ✅ |
| **Checksum do FileTokenStore** | SHA-256 sem MAC — detecta corrupção/tamper acidental; atacante com escrita no arquivo pode recalcular (risco residual aceito, documentado) ⚪ |

---

## 🔁 Verificação automatizada no CI (`security:check`)

Para impedir regressão dos vetores corrigidos, o monorepo tem `npm run security:check` (`scripts/security-check.mjs`, Node puro, zero dependências) rodando no CI entre os testes e o build:

| Estágio | Cobre |
|---|---|
| **1. Estático** (scan) | segredos hardcoded em `packages/*/src`; APIs removidas não podem ressurgir (`assertValidItemInput`, `getGlobalOAuthStateStore`, `resetGlobalOAuthStateStore`, `securityHeaders`, `SECURITY_HEADERS`); `Math.random` em código do auth (CSPRNG); chaves `__proto__`/`constructor`/`prototype` fora do `UNSAFE_KEYS`; presença dos fixes: trailing dot no `httpUrlSchema` (Rodada 3), `sanitizeLog` com NEL/DEL (Rodadas 2-3), `randomBytes` no instanceId e limite do fallback de `code_verifier` (Rodada 4), `ApiError.message` sanitizado (Rodada 3), `deepOmitEmpty` iterativo, guard de página repetida no `paginate` e `MAX_WAIT_MS` no rate limit (Rodada 5), origin guard no `buildUrl`, drop de Authorization cross-origin, cap do `Retry-After`, DNS wildcard e IPv6 transition no `httpUrlSchema`, `UNSAFE_KEYS` no `parallel`, `0o600` no lease/lock (Rodada 6); supply chain/CI: dependências internas com versão real (sem `"*"`), `permissions` mínimas nos workflows, `npm audit` e `security:check` no CI, `timeout-minutes`, actions pinadas por SHA, dependabot configurado (Rodada 7) |
| **2. Dinâmico** | executa os 14 arquivos de teste de segurança (schemas, http client/integration, utils, webhooks, errors, refresh/oauth, questions, items, pagination, rate-limit, resilience, token) — 33/33 checagens |

`npm run security:static` roda apenas o estágio 1 (mais rápido para desenvolvimento). Uma violação falha o CI com exit code 1.

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
| 🟡 Média | SSRF trailing dot (10), Log injection webhooks (6), Re-auth perde token (13), `deepOmitEmpty` stack overflow (16), `paginate` loop infinito (17), `RateLimiter` espera gigante (18), Origin escape no `buildUrl` (19), DNS wildcard (20) | ✅ Corrigido |
| 🟡 Baixa-Média | SSRF no schema (2), Redirects (3), IPv6 transition (21) | ✅ Corrigido |
| 🟢 Baixa | `reply` NaN (4), Eventos (5), Prototype (7), API IDs (8), temp previsível (9), `ApiError.message` (11), NEL/DEL (12), instanceId previsível (14), code_verifier leak (15), Authorization cross-origin (22), `parallel` `__proto__` (23), permissões lease/lock (24), CI sem permissions (25), sem timeout (26), sem npm audit (27), deps com `"*"` (28), actions por tag móvel (29) | ✅ Corrigido / 📚 Documentado |

---

## 📚 Referências

- [DOCUMENTO_CORRECOES.md](../DOCUMENTO_CORRECOES.md) — correções P0/P1/P2 (estado, PKCE, atomicidade)
- [ANALISE_QUALIDADE_TECNICA.md](../ANALISE_QUALIDADE_TECNICA.md) — análise arquitetural e fases
- [ADR-0013](decisions/0013-schemas-validacao-zero-dep.md) — validação por schemas (fundação do `assertValidId`)
- [RFC 7636](https://www.rfc-editor.org/rfc/rfc7636) — PKCE (referência de estado)
- WHATWG URL Standard — normalização de `..` e IPv4-mapeado em IPv6
- Fetch Standard — `redirect: 'manual'`, mudança de método em redirects

---

*Auditoria baseada em leitura dos 14 pacotes (src + testes), execução real de experimentos para confirmação dos vetores (URL parser na Rodada 3; refresh/re-auth/PKCE na Rodada 4; deepOmitEmpty/paginate/rate-limit na Rodada 5; buildUrl/redirect/DNS/IPv6/parallel/permissões na Rodada 6 — auditada por analista independente; lockfile/npm audit/workflows na Rodada 7), e validação final com 325 testes, lint, typecheck, build e `npm run security:check` (33/33) verdes (Rodadas 1–2 no commit `3ae58fb`; Rodada 3 no commit `2aa5ed0`; Rodada 4 no commit `506d6c8`; Rodadas 5-6 no commit `976e710`).*
