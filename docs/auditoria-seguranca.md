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

Em **quatro rodadas** (auditoria inicial + re-auditoria exaustiva com execução real de experimentos e revisão independente + verificação adicional com revisor independente + auditoria focada em OAuth/PKCE/timing/concorrência), foram identificados **15 achados** (1 média-alta, 3 médias, 2 baixa-média, 9 baixos). **13 correções foram implementadas**, 1 item documentado (eventos) e 1 mitigado (temp previsível do `FileTokenStore`). O estado atual é **verde**: 316 testes, lint, typecheck e build passando.

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
| 🟡 Média | SSRF trailing dot (10), Log injection webhooks (6), Re-auth perde token (13) | ✅ Corrigido |
| 🟡 Baixa-Média | SSRF no schema (2), Redirects (3) | ✅ Corrigido |
| 🟢 Baixa | `reply` NaN (4), Eventos (5), Prototype (7), API IDs (8), temp previsível (9), `ApiError.message` (11), NEL/DEL (12), instanceId previsível (14), code_verifier leak (15) | ✅ Corrigido / 📚 Documentado |

---

## 📚 Referências

- [DOCUMENTO_CORRECOES.md](../DOCUMENTO_CORRECOES.md) — correções P0/P1/P2 (estado, PKCE, atomicidade)
- [ANALISE_QUALIDADE_TECNICA.md](../ANALISE_QUALIDADE_TECNICA.md) — análise arquitetural e fases
- [ADR-0013](decisions/0013-schemas-validacao-zero-dep.md) — validação por schemas (fundação do `assertValidId`)
- [RFC 7636](https://www.rfc-editor.org/rfc/rfc7636) — PKCE (referência de estado)
- WHATWG URL Standard — normalização de `..` e IPv4-mapeado em IPv6
- Fetch Standard — `redirect: 'manual'`, mudança de método em redirects

---

*Auditoria baseada em leitura dos 14 pacotes (src + testes), execução real de experimentos para confirmação dos vetores (URL parser na Rodada 3; refresh/re-auth/PKCE na Rodada 4), e validação final com 316 testes, lint, typecheck e build verdes (Rodadas 1–2 no commit `3ae58fb`; Rodada 3 no commit `2aa5ed0`; Rodada 4 pendente de commit).*
