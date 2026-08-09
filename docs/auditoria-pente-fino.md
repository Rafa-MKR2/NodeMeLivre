# Auditoria Rodada 9 — Rastro do Pente Fino (análise profunda pós-auditoria)

**Data:** 2026-08-08
**Versão analisada:** 1.0.x (pós-Rodada 8)
**Escopo:** validação da premissa de que a [auditoria-seguranca.md](auditoria-seguranca.md) cobriu *todo* o SDK — análise profunda do código-fonte dos 14 pacotes + execução real de experimentos para confirmar cada suspeita
**Método:** leitura integral dos `src` + experimentos executados (vitest/Node) para confirmar os vetores antes de corrigir; cada achado tem evidência de execução

---

## Contexto

A auditoria das Rodadas 1–8 declarou o SDK "verde": 339 testes, lint, typecheck, build e `security:check` (36/36). Uma segunda passada — **rastro do pente fino** — testou os pontos que a auditoria declarou cobertos mas que, por classe de bug ou cenário, não foram exercitados:

1. **Reescritas que trocaram uma classe de bug por outra** (o fix do ACHADO 16 virou iterativo, mas sem detecção de ciclo);
2. **Semântica de operadores** (`??` tratando `null` como "ausência de parse");
3. **Cenários multi-processo do próprio produto** (o fix do ACHADO 31 era single-process);
4. **Ranges parciais em expressões de bloqueio** (`fe80` em vez de `fe80::/10`);
5. **O runtime mínimo declarado** (`engines: node >=18.17.0` vs `crypto` global do Node 19+).

Foram identificados **8 achados novos** (1 média-alta, 4 médias, 1 baixa-média, 2 baixos). **Todos corrigidos e cobertos por testes** (378 testes — 22 novos dos fuzzers determinísticos). O `security:check` passou de 36 para **57/57** (9 checagens estáticas novas — A1–A8 + contrato async do stateStore — + 3 arquivos de teste novos no estágio dinâmico + **estágios próprios de fuzzing** do `deepOmitEmpty`, do `DeduplicatingLogger`, do `buildUrl`, do `paginate` e do `RateLimiter` com checagem de presença + **contrato de contagem** no CI + **modo `FUZZ_SEEDS`** de seeds rotativas fora do CI).

Um **pente fino de continuidade** reexaminou, após a Rodada 9, os pontos em que um fix da Rodada 9 tinha a mesma classe de bug de outro caminho ou o mesmo vetor coberto por um único campo: foram identificados **3 achados novos** (B1–B3: 2 baixos, 1 baixa-média), **todos corrigidos e cobertos por testes** — `OAuthError.message` **sem sanitização** (o `error_description` do `/oauth/token` ecoava CRLF cru → log injection; mesma classe do ACHADO 11, por um caminho não coberto); `Webhooks.parse` **falso negativo** com `user_id` string numérica (o A7 cobriu só o `application_id`); e `paginate` em **loop infinito** quando o primeiro item da página é `undefined` (`JSON.stringify(undefined)` não é string → guard do ACHADO 17 nunca disparava). O `security:check` passou de 57 para **60/60** e a suíte para **383 testes**.

Uma **caçada ampla pós-Rodada 9** (agentes de auditoria independentes + experimentos) reexaminou os pacotes por inteiro e encontrou **10 achados novos** (C1–C10: 1 média-alta, 6 médias, 3 baixos), **todos confirmados por execução e corrigidos com testes** — o `security:check` subiu para **70/70** (10 checagens estáticas novas) e a suíte para **399 testes**. **Destaques:** `retry: false` e `maxRetries: N` eram **violados** para toda requisição autenticada (o slot do refresh inflava o orçamento de retry → POST não-idempotente reenviado em 5xx/429); o **cancelamento do usuário** (AbortSignal) era tratado como falha de rede (NetworkError) e ainda **retentado**; `getToken()` **derrubava as últimas requisições** de um token ainda válido sem `refresh_token`; um gateway que **omitisse** o `x-rate-limit-remaining` fazia o SDK **dormir até o reset** (DoS auto-infligido); `paging.total` como **string** encurtava a paginação (perda de dados); o **token legacy v1** era descartado na migração; `listBySeller` **duplicava itens** quando a resolução descartava entradas inválidas. Relatório completo nas seções C1–C10 abaixo.

---

## 📋 Status de Resolução (Rodada 9)

| # | Achado | Severidade | Status | Onde |
|---|--------|------------|--------|------|
| A1 | `deepOmitEmpty` com objeto circular: loop infinito na pilha explícita até **OOM do processo** (4GB consumidos em execução real) — o fix do ACHADO 16 cobriu profundidade, não ciclos | 🔴 Média-Alta | ✅ Corrigido | `core/src/utils.ts` — `cleanDeep` com `WeakSet` in-path; valor circular omitido; DAGs preservados |
| A2 | `parseBody`/`tryReadBody` devolvem a **string `"null"`** para corpo JSON literal `null` (`JSON.parse('null')` → `null`; `null ?? text` → `text`) — contrato `T` quebrado | 🟡 Média | ✅ Corrigido | `http/src/client.ts` — `tryParseJson` com sentinel (`{ failed }`); `null`/`false`/`0` preservados |
| A3 | **PKCE multi-instância incompleto**: o fix do ACHADO 31 estacionava o `code_verifier` no fallback in-memory da instância que consumiu — instância B (compartilhando o stateStore) enviava `/oauth/token` sem `code_verifier` → `invalid_request` | 🟡 Média | ✅ Corrigido | `auth/src/state.ts` (`parkCodeVerifier`/`getParkedCodeVerifier` no store compartilhado) + `auth/src/oauth.ts` |
| A4 | **Bypass SSRF**: link-local IPv6 é `fe80::/10` (`fe80`–`febf`), mas o schema só checava `startsWith('fe80')` — `fe90::`/`fea0::`/`feb0::`/`febf::` passavam | 🟡 Média | ✅ Corrigido | `core/src/schemas.ts` — mascaramento de 10 bits (`firstHextet & 0xffc0 === 0xfe80`); ULA `fc00::/7` idem |
| A5 | `generateStateToken` usava o **global `crypto`** — no Node 18.17 (mínimo do `engines`) ele exige `--experimental-global-webcrypto` (só sai da flag no v19) → `ReferenceError` no fluxo OAuth | 🟡 Média | ✅ Corrigido | `core/src/utils.ts` — `randomBytes(32)` de `node:crypto` (mesmo formato hex 64) |
| A6 | `InMemoryTokenStore.set()` **resetava a versão para 1** (`createVersioned` default) — `FileTokenStore.set()` incrementa; dois stores com contratos divergentes quebravam CAS monotônico | 🟢 Baixa-Média | ✅ Corrigido | `auth/src/token.ts` — `(this.token?.version ?? 0) + 1` |
| A7 | `Webhooks.verify` com `application_id` **string** no payload era falso negativo (`'123' !== Number('123')`) | 🟢 Baixa | ✅ Corrigido | `webhooks/src/webhooks.ts` — comparação numérica nos dois lados |
| A8 | `Questions.answer()` sem validação — `question_id: 0`/negativo/string/`text: ''` iam à API (o ACHADO 4 só corrigiu `reply`) | 🟢 Baixa | ✅ Corrigido | `questions/src/questions.ts` — `questionAnswerSchema` |

---

## 🔴 ACHADO A1 — `deepOmitEmpty` com objeto circular: OOM do processo

### Localização
`packages/core/src/utils.ts` — `cleanDeep()` (reescrita iterativa do ACHADO 16)

### Descrição do Problema
O ACHADO 16 (Rodada 5) reescreveu `deepOmitEmpty` de recursivo para iterativo (pilha explícita) para evitar `RangeError` com profundidade extrema. A reescrita resolveu a profundidade, mas **não tratou ciclos**: um objeto com referência circular (`obj.self = obj` — possível em objetos montados em JS pelo integrador) fazia o loop `while (stack.length > 0)` empilhar frames **para sempre**, consumindo memória até o processo morrer.

### Evidência (execução real)
```
deepOmitEmpty({ self: <referência circular> })
  → sem limite: 4GB de heap consumidos → FATAL ERROR: JavaScript heap out of memory
  → com --max-old-space-size=256: OOM em segundos (confirmado isolado)
```

### Contexto que Reduz o Risco
`JSON.parse` nunca produz ciclos (JSON não tem referências); o vetor exige objeto montado em JS pelo integrador. Mas `items.create`/`items.update` chamam `deepOmitEmpty(input)` com dados do integrador — e o resultado era **derrubar o processo** (mesma classe de impacto do ACHADO 16, que foi classificado Média).

### Correção Implementada
`cleanDeep` agora rastreia o **caminho atual** em um `WeakSet` (`inPath`):
- ao empilhar um container, verifica se ele já está no caminho → se sim, é **ciclo**: o valor é **omitido** (mesma regra de `undefined` — um valor circular não é serializável para a API de qualquer forma);
- ao desempilhar, remove do `WeakSet` → **DAGs legítimos** (o mesmo objeto referenciado em dois ramos irmãos) continuam intactos.

**Testes:** `utils.test.ts` — objeto circular não lança e produz resultado serializável; DAG de dois ramos preservado; item circular dentro de array omitido (`[1, <self>]` → `[1]`).

---

## 🟡 ACHADO A2 — `parseBody` devolve a string `"null"` para JSON literal `null`

### Localização
`packages/http/src/client.ts` — `parseBody()` e `tryReadBody()`

### Descrição do Problema
O parse era `tryParseJson(text) ?? text`. Para um corpo `null` (JSON válido), `JSON.parse('null')` retorna `null` — e `null ?? text` cai no **nullish coalescing**, devolvendo a **string `"null"`**. Um endpoint que responda `200` com `null` literal entregava ao chamador a string `"null"` em vez de `null` — quebrando o contrato tipado `T`. Vale também para o caminho de erro (`ApiError.body` de um 5xx com `null`).

### Evidência (execução real)
```
get() com body "null"  → typeof result === 'string' (antes) → null (depois)
get() com body "false" → false (inalterado — `??` não pega false)
get() com body "0"     → 0 (inalterado)
```

### Correção Implementada
`tryParseJson` retorna um **sentinel** `{ failed: true }` (parse falhou) ou `{ failed: false, value }` — o corpo só cai no fallback de texto quando o parse realmente falhou. `null`, `false` e `0` chegam ao chamador com o tipo correto.

**Testes:** `client.test.ts` — `null` (não string), `false` e `0` preservados.

---

## 🟡 ACHADO A3 — PKCE multi-instância: fix do ACHADO 31 era single-process

### Localização
`packages/auth/src/oauth.ts` — `consumeState()`/`getCodeVerifierFromState()`; `packages/auth/src/state.ts`

### Descrição do Problema
O ACHADO 31 (Rodada 8) corrigiu o `consumeState` apagando o `metadata.codeVerifier` do store, estacionando o verifier no **fallback in-memory da instância que consumiu**. Em **multi-instância/multi-processo** — cenário que o próprio SDK suporta (o `integration.test.ts` valida "instância A gera code_verifier e instância B o recupere") — a instância B que troca o code não enxerga o fallback in-memory da instância A: o `/oauth/token` ia sem `code_verifier` e o ML respondia `invalid_request` para apps PKCE.

### Evidência (execução real)
```
instância A: authorizationUrl(state) + consumeState(state) → entry ok
instância B: exchangeCode(code, { state })
  body do /oauth/token: { grant_type, client_id, client_secret, code, redirect_uri }  ← SEM code_verifier
```

### Correção Implementada
O verifier é estacionado em **dois lugares**:
1. **No `OAuthStateStore` compartilhado** — novos métodos `parkCodeVerifier(state, verifier)` / `getParkedCodeVerifier(state)` (TTL de 10 min + limite de 1000 entradas + sweep no `cleanup()`, mesma disciplina do store): qualquer instância que use o mesmo store recupera o verifier;
2. No fallback in-memory (compatibilidade sem `stateStore`).

`getCodeVerifierFromState` consulta: (1) state ativo no store → (2) verifier **estacionado** no store → (3) fallback in-memory.

**Testes:** `state.test.ts` (park/recupera/TTL/limite/cleanup) + `auth/integration.test.ts` (fluxo completo: `consumeState` em A, `exchangeCode` em B — o teste exato que falhava).

---

## 🟡 ACHADO A4 — Link-local IPv6 `fe80::/10` incompleto (bypass SSRF)

### Localização
`packages/core/src/schemas.ts` — `isBlockedHttpHost()`

### Descrição do Problema
O bloqueio de link-local IPv6 usava `host.startsWith('fe80')`. Mas o prefixo link-local é **`fe80::/10`**, que cobre o primeiro hexteto de `fe80` a `febf`. Endereços como `fe90::`, `fea0::`, `feb0::` e `febf::` são link-local válidos e **passavam** no schema (confirmado por execução).

### Evidência (execução real)
```
http://[fe80::1]   → BLOQUEADO (antes e depois)
http://[fe90::1]   → ACEITO (antes) / BLOQUEADO (depois)
http://[fea0::1]   → ACEITO (antes) / BLOQUEADO (depois)
http://[feb0::1]   → ACEITO (antes) / BLOQUEADO (depois)
http://[febf::1]   → ACEITO (antes) / BLOQUEADO (depois)
```

### Correção Implementada
Mascaramento de 10 bits no primeiro hexteto (`firstHextet & 0xffc0 === 0xfe80`). O mesmo padrão é aplicado à ULA **`fc00::/7`** (`firstHextet & 0xfe00 === 0xfc00`, cobre `fc00`–`fdff`), substituindo os `startsWith` frágeis anteriores.

**Testes:** `schemas.test.ts` — `fe80`/`fe90`/`fea0`/`feb0`/`febf` + `fc00`/`fd00`/`fdff` no bloco de bloqueados.

---

## 🟡 ACHADO A5 — `generateStateToken` quebra no Node 18 (mínimo do `engines`)

### Localização
`packages/core/src/utils.ts` — `generateStateToken()`; `package.json` (`engines: node >=18.17.0`)

### Descrição do Problema
O SDK declara suporte a `node >=18.17.0`, mas `generateStateToken()` usava o **global `crypto`** (`crypto.getRandomValues`). Segundo a documentação oficial do Node.js v18, o `globalThis.crypto` é **experimental e exige a flag `--experimental-global-webcrypto`** — só foi liberado por padrão no **Node 19.0.0**. Em um Node 18.17 limpo, `crypto` é `undefined` → `ReferenceError` no fluxo OAuth (geração de state/CSRF/PKCE). (Nota: `AbortSignal.any` — usado no client — é seguro: foi backportado para 18.17.0.)

### Evidência (documentação oficial)
```
Node.js v18 globals: "Crypto — Stability: 1 Experimental. Enable this API with the
--experimental-global-webcrypto CLI flag."
Node.js v19+: "No longer behind --experimental-global-webcrypto CLI flag."
AbortSignal.any: "Added in: v20.3.0, v18.17.0"  ← OK no 18.17
```

### Correção Implementada
`generateStateToken` usa `randomBytes(32).toString('hex')` de **`node:crypto`** — mesma saída (64 hex chars, `isValidStateToken` inalterado), CSPRNG, e disponível em qualquer Node suportado.

**Testes:** existentes em `utils.test.ts` (formato hex 64 e unicidade) seguem verdes.

---

## 🟢 ACHADO A6 — `InMemoryTokenStore.set()` resetava a versão

### Localização
`packages/auth/src/token.ts` — `InMemoryTokenStore.set()`

### Descrição do Problema
`FileTokenStore.set()` incrementa a versão a partir da atual; `InMemoryTokenStore.set()` chamava `createVersioned(token)` com o **default `version = 1`** — após um `compareAndSet` chegar a 2+, um `set()` **regredia o contador para 1**. Os dois stores tinham contratos divergentes: um CAS que esperava a versão antiga podia aceitar (ou rejeitar) escritas com base em uma versão regredida.

### Evidência (execução real)
```
compareAndSet ×2 (v1, v2) → set() → version = 1 (esperado 3, como no FileTokenStore)
```

### Correção Implementada
`set()` usa `createVersioned(token, (this.token?.version ?? 0) + 1)` — **monotônico**, mesmo contrato do `FileTokenStore`.

**Testes:** `token.test.ts` — `compareAndSet`×2 → `set` → versão 3.

---

## 🟢 ACHADO A7 — `Webhooks.verify` falso negativo com `application_id` string

### Localização
`packages/webhooks/src/webhooks.ts` — `verify()`

### Descrição do Problema
A comparação era estrita: `notification.application_id !== Number(applicationId)`. Um payload com `application_id: "123"` (string — possível em JSON de alguns gateways/mocks) era **rejeitado** mesmo sendo o app correto: `'123' !== 123` → `WebhookError`.

### Evidência (execução real)
```
verify({ application_id: "123", ... }, 123) → WebhookError "não pertence à aplicação"
  (antes) → aceito (depois — comparação numérica nos dois lados)
```

### Correção Implementada
`Number(notification.application_id) !== Number(applicationId)` — comparação numérica nos dois lados. `application_id` não-numérico continua rejeitado (`NaN !== NaN`).

**Testes:** `webhooks.test.ts` — payload com `application_id` string aceito; casos numéricos existentes inalterados.

---

## 🟢 ACHADO A8 — `Questions.answer()` sem validação (vetor do ACHADO 4 por outro caminho)

### Localização
`packages/questions/src/questions.ts` — `answer()`

### Descrição do Problema
O ACHADO 4 (Rodada 1) corrigiu `reply()` (question_id numérico), mas `answer()` — o **método público** que o `reply` chama — aceitava `questionId: 0`, negativo, `NaN`, string e `text: ''` direto no body do `POST /answers`. O mesmo vetor do ACHADO 4 (`question_id: null` por `Number('abc')` → `NaN` → `JSON.stringify(NaN)` → `null`) permanecia aberto por este caminho.

### Evidência (execução real)
```
answer({ questionId: 'abc', text: '' }) → transport recebe { question_id: 'abc', text: '' } (antes)
answer({ questionId: 0, text: 'oi' })   → InputValidationError (depois)
```

### Correção Implementada
Novo `questionAnswerSchema` (`questionId: number({ integer, positive })`, `text: string({ minLength: 1 })`) aplicado com `assertValid` antes do fetch — falha rápida com `InputValidationError`, mesma disciplina do O6.

**Testes:** `questions.test.ts` — 6 payloads inválidos rejeitados sem chamar o transport.

---

## 🟢 ACHADO B1 — `OAuthError.message` sem sanitização (log injection no `/oauth/token`)

### Localização
`packages/errors/src/index.ts` — construtor do `OAuthError`.

### Descrição do Problema
O `error_description` retornado pelo endpoint `/oauth/token` ia **cru** para o `message` do erro. Como o `OAuthError` é **serializado em logs** (o `DeduplicatingLogger` loga erros com seus `message`), um `error_description` contendo `\r\n` (o cliente pode ecoar dados arbitrários — ex.: um `redirect_uri` malformado, que a API devolve em `error_description` para alguns erros) abria **log injection**: campos falsos injetados no log de erro. A classe é a **mesma do ACHADO 11** (sanitização do `ApiError.message`, Rodada 3), mas o caminho do OAuth não era coberto.

### Evidência (execução real)
Constrói-se `new OAuthError({ error: 'invalid_grant', error_description: 'x\r\n<implantado>ERRO fake</implantado>' })` e serializa-se o `message` em um JSON de log: antes, o `\r\n` passava cru e um parser de log interpretava a linha `ERRO fake` como um evento real de erro — provado por experimento.

### Correção Implementada
Helper `sanitizeMessage` (constante `CONTROL_CHARS`: CR/LF/NEL/LS/PS/C0/C1 + DEL) aplicado em **todos** os construtores de erro que ecoam payload externo no `message` (`OAuthError` e `errorMessageFor`). Os campos crus (`oauthError`, `errorDescription`) são **preservados** para inspeção programática — só a serialização é segura.

**Testes:** `errors/src/index.test.ts` — `message` com `\r\n`/NEL saneado; campos crus preservados.

---

## 🟢 ACHADO B2 — `Webhooks.parse` falso negativo com `user_id` string numérica

### Localização
`packages/webhooks/src/webhooks.ts` — método `parse`.

### Descrição do Problema
O fix do A7 (`application_id`) cobriu **um** campo, mas o `parse` continuava exigindo `number` estrito para `user_id`. A API do Mercado Livre pode entregar `user_id` como **string numérica** em notificações; o parse **rejeitava** o payload (`InputValidationError` falso negativo) — vetor do A7 incompletamente coberto.

### Evidência (execução real)
`parse({ topic, resource, user_id: '123456', application_id: 123 })` → falhava (antes do fix) apesar de o payload ser legítimo.

### Correção Implementada
Coerção no `parse`: `user_id` string numérica (`Number.isSafeInteger(Number(value))`) é aceita e **normalizada** para `number` (mesma disciplina do A7). O `verifyForUser` compara `Number()` nos **dois** lados — `number` e string numérica são equivalentes.

**Testes:** `webhooks/src/webhooks.test.ts` — `user_id` string numérica aceita no `parse`; notificação com `user_id` string numérica passa no `verifyForUser`; string **não** numérica continua rejeitada.

---

## 🟢 ACHADO B3 — `paginate` em loop infinito com primeiro item `undefined`

### Localização
`packages/core/src/pagination.ts` — guard do `previousFirstKey` (ACHADO 17).

### Descrição do Problema
O guard anti-DoS do ACHADO 17 comparava `JSON.stringify(results[0])` com a chave anterior — mas **`undefined` não é serializável** no `JSON.stringify` (vira `undefined`, não string). Um fetcher customizado que devolva uma página cujo primeiro item é `undefined` produzia chave `undefined` (≠ chave anterior) e o guard **nunca disparava** → **loop infinito de requisições** (mesma classe do ACHADO 17, por outro caminho).

### Evidência (execução real)
Fetcher que sempre devolve `[{}, undefined]` (o JSON.stringify da página muda, mas o primeiro item é `undefined`): antes do fix, o `paginate` rodava indefinidamente (loop infinito).

### Correção Implementada
O guard usa `JSON.stringify(results[0] ?? null)` — o primeiro item **sempre** produz chave string (null inclusive), então uma página repetida é **sempre** detectada na 2ª chamada (no máximo 2 fetches).

**Testes:** `pagination.test.ts` — stream que repete `[{}, undefined]` termina com 2 chamadas de fetch (sem loop).

---

## 🟠 ACHADO C1 — `retry: false`/`maxRetries` violados pelo slot de refresh (orçamento de retry)

### Localização
`packages/http/src/client.ts` — inicialização de `maxAttempts` e guard de retry.

### Descrição do Problema
O slot de refresh (`refreshSlots = 1`) era somado ao `maxAttempts` de TODA requisição autenticada, e o mesmo `maxAttempts` dirigia o guard de retry de status. Resultado: `retry: false` e `maxRetries: N` eram **silenciosamente `N+1`** — um POST não-idempotente ganhava um reenvio extra em 5xx/429 mesmo com o retry desativado.

### Evidência (execução real)
`maxRetries: 0` + auth + 503 persistente → 2 tentativas (1 retry), quando deveria ser 1; `retry: false` + auth → idem. Sem auth → 1 tentativa (correto).

### Correção Implementada
`maxAttempts` começa em `retry === false ? 1 : maxRetries + 1`; a tentativa pós-refresh é **gratuita** e ganha `maxAttempts += 1` **apenas quando o refresh realmente ocorre**. Validado por teste: `retry: false`/`maxRetries: 0` + 503 → 1 tentativa.

---

## 🟠 ACHADO C2 — Abort do usuário tratado como falha de rede (e retentado)

### Localização
`packages/http/src/client.ts` — catch do `performFetch`.

### Descrição do Problema
Um cancelamento (AbortSignal) rejeitava a promise do fetch e o SDK (a) embrulhava em `NetworkError` (o padrão `e.name === 'AbortError'` do chamador quebrava) e (b) **retentava** o GET abortado quando o fetch rejeitava com `Error` simples (shims/Node antigo) — desrespeitando a intenção de cancelamento e contradizendo o contrato do próprio `paginate` ("o `for await` rejeita com AbortError").

### Evidência (execução real)
Com shim que rejeita com `Error` simples no abort: GET abortado retentado 4x com backoff. Com fetch real (undici): o AbortError virava NetworkError.

### Correção Implementada
No catch, se `request.signal?.aborted === true` → propaga um erro com `name === 'AbortError'` (helper `toAbortError`, preservando o `signal.reason`) **sem retry**. Testes: abort pré-disparado → AbortError com 1 chamada; shim que rejeita no abort → AbortError, 1 chamada.

---

## 🟡 ACHADO C3 — `auth: false` ainda disparava refresh e retry de 401

### Localização
`packages/http/src/client.ts` — branch do 401 com refresh.

### Descrição do Problema
A requisição com `auth: false` não anexava token, mas um 401 nela ainda chamava `this.auth.refresh()` e reenviava — o chamador que desativou a autenticação explicitamente ganhava refresh/retry sem pedir (e o orçamento inflado do C1).

### Evidência (execução real)
`client.get('/public', { auth: false })` retornando 401 → `refresh()` invocado e segunda requisição enviada.

### Correção Implementada
O branch do 401-refresh exige `request.auth !== false`. Teste: `auth: false` + 401 + refresh disponível → `refresh` **não** chamado, 1 tentativa.

---

## 🟡 ACHADO C4 — Falha do refresh propagava erro cru, perdendo o 401 tipado

### Localização
`packages/http/src/client.ts` — chamada de `this.auth.refresh()` no 401.

### Descrição do Problema
O `refresh()` (fora do try/catch do loop) que rejeitasse (ex.: `invalid_grant` por refresh_token rotacionado) propagava o erro cru do refresh para o chamador — que perdia o `UnauthorizedError` original (status/body/`requestId`) e a normalização da hierarquia de erros (contrato da Rodada 3).

### Evidência (execução real)
`refresh` lançando → `get()` rejeita com o erro cru (`status: undefined`), não o 401.

### Correção Implementada
O refresh é embrulhado em try/catch; na falha, o erro tipado do 401 original (`lastError ?? apiError`) é relançado. Teste: refresh falhando → `UnauthorizedError` com `status: 401` e `requestId` preservados.

---

## 🟠 ACHADO C5 — RateLimiter bloqueava com `remaining` vazio/ausente (DoS auto-infligido)

### Localização
`packages/http/src/rate-limit.ts` — `parsePositive` e `waitIfNeeded`.

### Descrição do Problema
`Number('')`/`Number('  ')` = 0 e `Number('0x10')` = 16: um gateway que enviasse o `x-rate-limit-remaining` vazio/só-espaço era tratado como "esgotado" e o SDK **dormia até o reset** mesmo com o recurso disponível; um header **ausente** com `reset` presente bloqueava igual.

### Evidência (execução real)
`remaining: ''` + `reset: '30'` → espera de ~30s; `remaining: ' '` + `reset: '10'` → 10s; sem header `remaining` + `reset` → 15s; `remaining: '0x10'` → parseado como 16.

### Correção Implementada
`parsePositive` exige inteiro decimal real (`/^\d+$/`); `waitIfNeeded` **não bloqueia** quando `remaining` é `undefined` (só `remaining === 0` explícito indica recurso esgotado). Testes: vazio/espaço/hex/ausente → sem espera; `0` real → espera (inalterado).

---

## 🟡 ACHADO C6 — `paging.total` como string encurtava a paginação (perda de dados)

### Localização
`packages/core/src/pagination.ts` — cheque de término por `paging.total`.

### Descrição do Problema
`paging.total` tipado `number | null` mas um gateway pode entregá-lo como **string**: `"0"` (string) num `>=` coercia a 0 e o `paginate` devolvia só a 1ª página (perda silenciosa de dados); `"abc"` coercio a NaN nunca encerrava (loop até página vazia).

### Evidência (execução real)
`total = "0"`, 2 páginas de 2 → retorna `[1,2]` com 1 fetch (dados perdidos); `total = "abc"` → comparação NaN → loop.

### Correção Implementada
Coerção explícita: `Number(rawTotal)`; `Number.isFinite(total)` decide o término — string parseável vira número; `null`/NaN = "total desconhecido" (termina por página vazia/guard). Testes: `"4"` entrega as 4 páginas; `"abc"` encerra na 2ª chamada via guard.

---

## 🟡 ACHADO C7 — Token legacy v1 descartado na migração (perda silenciosa)

### Localização
`packages/auth/src/token.ts` — `parseVersionedToken`.

### Descrição do Problema
O fallback legacy (formato v1, `AccessToken` direto) só rodava quando o `JSON.parse` **lançava**. Um arquivo legacy válido (JSON ok, shape ≠ `VersionedToken`) caía em `return null` — token **silenciosamente perdido** e usuário forçado a re-autenticar.

### Evidência (execução real)
Token v1 válido escrito no arquivo → `store.get()` devolve `null`.

### Correção Implementada
`parseVersionedToken` separa o parse do shape: `isVersionedToken(parsed)` → retorna; senão, tenta o formato legacy (`parseToken`) e cria versionado com `version: 1`. Teste: arquivo legacy → `getWithVersion()` devolve versão 1 com o mesmo `accessToken`.

---

## 🟡 ACHADO C8 — `getToken()` derrubava as últimas requisições de token ainda válido sem refresh_token

### Localização
`packages/auth/src/refresh.ts` — `TokenManager.getToken()`.

### Descrição do Problema
`isExpiring` (janela de leeway de 60s) disparava `refresh()`, que lançava `missing_refresh_token` quando o token não tinha `refresh_token` (client_credentials, sessão sem `offline_access`) — um token **ainda válido por 30s** era recusado e TODA requisição falhava até o `OAuthError`, apesar de o token funcionar.

### Evidência (execução real)
Token com `expiresAt = now + 30s`, sem `refreshToken` → `getToken()` lança `OAuthError`.

### Correção Implementada
Sem `refresh_token` e **ainda não expirado** (`clock() < expiresAt`), o token é devolvido (aproveita as últimas requisições). Já expirado de verdade, o `refresh()` é tentado e o `OAuthError` claro se propaga. Testes: ainda válido → devolvido; expirado → `OAuthError`.

---

## 🟢 ACHADO C9 — `retry-after` vazio virava retry imediato sem backoff

### Localização
`packages/errors/src/index.ts` — `parseRetryAfter`.

### Descrição do Problema
`Number('')`/`Number('  ')` = 0: um `retry-after` vazio/só-espaço fazia o 429 ser retentado **sem backoff** (mesma rajada do código pré-Rodada 6).

### Correção Implementada
`parseRetryAfter` exige dígitos reais (`/^\d+(\.\d+)?$/`); vazio/espaço/lixo → `undefined` (backoff exponencial normal). Teste: `''`/`'  '`/`'abc'` → `retryAfterSeconds` undefined; `'5'` → 5.

---

## 🟢 ACHADO C10 — `listBySeller` duplicava itens quando a resolução descartava entradas

### Localização
`packages/items/src/items.ts` — `listBySeller`/`resolveSellerItems` + `paginate`.

### Descrição do Problema
O fetcher resolvia/filtrava os IDs **antes** do `paginate`: o length resolvido (menor que os slots reais da API) dirigia `offset += results.length` e a página seguinte **sobrepunha** a anterior — itens **duplicados** no stream.

### Evidência (execução real)
`total: 8`, `limit: 4`, páginas com entradas nulas → stream `["MLB1","MLB2","MLB3","MLB3","MLB4","MLB5","MLB5","MLB6"]` (MLB3/MLB5 duplicados).

### Correção Implementada
`listBySeller` pagina os **resultados crus** (IDs) — o offset avança pelos slots reais — e uma transformação (`resolveSellerItemsStream`, lotes com a mesma concorrência de 10) resolve/filtra os itens antes de entregar. Teste: páginas com entradas inválidas → offset seguinte em `3` (slots reais) e nenhuma duplicata.

---

## 🔁 Verificação automatizada (`security:check`)

O `security:check` passou de **36 → 57 checagens** na Rodada 9, para **60** no pente fino de continuidade (B1–B3) e para **70/70** na caçada ampla (C1–C10):

- **Estáticas novas (8):** A1 (`WeakSet` in-path no `cleanDeep`), A2 (sentinel do `tryParseJson`), A3 (`parkCodeVerifier`/`getParkedCodeVerifier` no store + uso no oauth), A4 (máscara `0xffc0`/`0xfe80`), A5 (`randomBytes` no `generateStateToken`), A6 (`(this.token?.version ?? 0) + 1` no `set`), A7 (`Number()` nos dois lados do `verify`), A8 (`questionAnswerSchema` no `answer`).
- **Dinâmicas (2 arquivos novos):** `state.test.ts` (parking/TTL/limite) e `integration.test.ts` (PKCE multi-instância com `consumeState`).
- **Estáticas novas (pente fino, 3):** B1 (`sanitizeMessage` no construtor do `OAuthError`), B2 (`Number.isSafeInteger(Number(data.user_id))` + coerção no `parse` do webhook), B3 (`JSON.stringify(results[0] ?? null)` no guard do `paginate`).
- **Estáticas novas (caçada ampla, 10):** C1 (`let maxAttempts` sem slot de refresh + `maxAttempts += 1` no refresh), C2 (`request.signal?.aborted` + `toAbortError`), C3 (`request.auth !== false` no branch do 401), C4 (`throw lastError ?? apiError` na falha do refresh), C5 (`^\d+$` estrito + `remaining === undefined` não bloqueia), C6 (`Number(rawTotal)` + `Number.isFinite` no `paginate`), C7 (`isVersionedToken` + fallback legacy), C8 (`token.refreshToken === undefined && clock() < expiresAt`), C9 (`^\d+(\.\d+)?$` no retry-after), C10 (`resolveSellerItemsStream` no `listBySeller`).

`npm run security:check` → **70/70** (contrato `--expect-checks 70` no `ci.yml`/`publish-beta.yml` — exit 1 se a contagem mudar).

**Reforço pós-Rodada 9 (fuzzing do `deepOmitEmpty`):** para garantir que os fixes A1 (ciclos/OOM) e ACHADO 16 (profundidade/stack) nunca regridam, `utils.test.ts` ganhou um **fuzzer determinístico** (PRNG mulberry32 com seed fixa — reproduzível no CI): 500 grafos aleatórios com ciclos + DAGs + chaves perigosas + vazios, cadeias de 5k–15k de profundidade com ciclo no fundo, DAGs densos e 200 grafos de `__proto__`/`constructor`/`prototype`. Invariantes: não lança, serializável (sem ciclo sobrevivente), nenhum dado legítimo se perde, idempotente e sem poluição global. **Eficácia comprovada por mutação:** desativar a detecção de ciclo (`inPath.has(node)`) faz o fuzzer travar o worker — a suíte (371 testes) quebraria no regresso.

**Reforço pós-Rodada 9 (fuzzing do `DeduplicatingLogger`):** logar **nunca pode derrubar o processo** — `logger.test.ts` ganhou um fuzzer determinístico (~900 contextos hostis): ciclos (self/mutual/arrays), cadeias de `cause` circulares (undici-like), getters que lançam em qualquer profundidade, símbolos, **BigInt** (`JSON.stringify` lança `TypeError`), `toJSON` hostil (lança/devolve BigInt/re-cria o ciclo → `RangeError` do V8), proxies com traps que lançam, chaves perigosas via `JSON.parse` e profundidade 10k–20k (`RangeError`). Invariantes: os 4 níveis nunca lançam, chave de dedup estável (repetição hostil suprimida), expiração/resumo/eviction nunca lançam. **Eficácia comprovada por mutação:** remover o `try/catch` do `safeStringify` derruba 7 dos 9 testes de fuzzing.

**Reforço pós-Rodada 9 (fuzzing do `buildUrl`):** o origin **nunca pode vazar** — `http/src/url.test.ts` ganhou um fuzzer determinístico (500 casos): URLs malformadas, host com CRLF/controle (payloads de header injection), protocolos exóticos (`javascript:`/`data:`/`file:`/`ftp:`/`ws:`/`gopher:`/`blob:`/`http+unix:`...), whitespace/C0 leading (vetor da Rodada 8), userinfo (`https://evil.com@localhost/x`), backslash (`/\evil.com/x` = protocol-relative) e mutação aleatória de CR/LF/NUL/`\`/`%`. Invariantes: se `buildUrl` retorna, o origin **é o do baseUrl** (guard por resultado das Rodadas 6+8); erros são só `InputValidationError` (nunca erro nativo do parser); sem CR/LF crus no `href`; query round-trip. **Eficácia comprovada por mutação:** desligar o origin guard faz 4 dos 6 testes falharem (origin escapou).

**Reforço pós-Rodada 9 (fuzzing do `paginate`):** o anti-DoS do ACHADO 17 (página que não avança → loop infinito de requisições) não pode regredir — `pagination.test.ts` ganhou um fuzzer determinístico: streams aleatórios de páginas que **não avançam** (mesmo primeiro item, `total` null/99.999) **nunca entram em loop infinito** (o guard `previousFirstKey` para na 2ª chamada — nunca mais que 2 fetches, itens da 1ª página entregues uma vez); entrega exata em ordem quando a API avança (500 streams, offsets monotônicos, zero fetch além do `total`); `total: null` termina na página vazia; tradeoff documentado de páginas diferentes com o mesmo primeiro item. **Eficácia comprovada por mutação hang-safe** (Promise.race + `setImmediate`): desligar o guard → **loop infinito detectado**.

**Reforço pós-Rodada 9 (fuzzing do `RateLimiter`):** o sleep gigante do ACHADO 18 (reset corrompido/gateway no futuro distante) não pode voltar — `rate-limit.test.ts` ganhou um fuzzer determinístico: 1000 combinações aleatórias de headers `limit`/`remaining`/`reset` (epochs ms/s, relativos plausíveis e implausíveis, futuros distantes, negativos, lixo) com **delay injetado** que captura a espera — a espera **nunca passa de `MAX_WAIT_MS`** nem fica abaixo de 1ms; single-flight sob concorrência aleatória (1-4 → 1 delay); `rateLimitKey` com paths aleatórios. **Eficácia comprovada por mutação:** remover o cap → espera de ~998 trilhões de ms detectada; remover o guard O3 → espera de 500.000.000ms detectada.

**Estágios próprios no `security:check`:** para que os fuzzers **sempre** rodem no CI de segurança, eles também são estágios próprios do `security:check` (45 → **60/60 checagens**): o fuzzer do `deepOmitEmpty` é o **Estágio 3**, o do `DeduplicatingLogger` o **Estágio 4**, o do `buildUrl` o **Estágio 5**, o do `paginate` o **Estágio 6** e o do `RateLimiter` o **Estágio 7** — execução dedicada com `vitest -t "fuzzing"` que **falha se os testes não rodarem de verdade** (o vitest sai 0 com tudo *skipped* quando o filtro não casa — a checagem parseia `Tests N passed` e exige N ≥ 1) — mais checagens estáticas de presença (itens 36-38 e 41-42) que pegam a remoção/renomeação também no `--static-only`. Todos confirmados por mutação: renomear um describe derruba a checagem estática e o estágio correspondente.

**Contrato de contagem no CI:** para que uma regressão de cobertura **nunca** passe silenciosamente, `ci.yml` e `publish-beta.yml` rodam `npm run security:check -- --expect-checks 70` — o script falha com **exit 1** se o total de checagens não for exatamente 70 (ABAIXO = alguma checagem foi removida/desativada; ACIMA = contrato desatualizado a atualizar nos workflows e docs). A checagem estática 39 impede que o contrato seja removido dos workflows. Validado por execução: `--expect-checks 70` → exit 0; `--expect-checks 69`/`71` → exit 1.

**Seeds rotativas fora do CI (`FUZZ_SEEDS`):** para rodadas mais amplas sem mudar o CI, os 3 fuzzers leem a env `FUZZ_SEEDS` — sem ela (CI), a **seed fixa** determinística é mantida (saída idêntica, 100% reproduzível); com ela (`FUZZ_SEEDS="0x1111,0x2222,0x3333"` — hex `0x…` ou decimal, separados por vírgula/espaço), cada teste roda **uma vez por seed** e cada seed gera um fluxo PRNG diferente — cobertura multiplicada por N seeds (ex.: o fuzzer do `buildUrl` passa de 500 para 1500 casos com 3 seeds). Valor inválido/vazio → fallback para a seed fixa (o modo nunca degrada o CI). A checagem estática 40 (item novo, 52 → 53) exige `process.env.FUZZ_SEEDS` nos 3 fuzzers — remover o modo derruba o `--static-only`.

---

## ✅ Verificações sem problema (reconfirmadas na Rodada 9 + Rodada 10)

| Vetor | Resultado |
|---|---|
| Origin guard do `buildUrl` (ACHADO 30) — 7 vetores (whitespace/C0/backslash) | ✅ bloqueados |
| SSRF: trailing dot, DNS wildcard, IPv4 decimal/hex/octal, NAT64, 6to4, IPv4-mapped | ✅ todos bloqueados |
| `RateLimiter` (reset passado/futuro, ms/s) | ✅ comportamento correto |
| `paginate` (página repetida, `total` presente/nulo) | ✅ correto |
| 401 + refresh sem loop infinito (retry desativado inclusive) | ✅ correto |
| `AbortSignal.any` no Node 18.17 (mínimo) | ✅ disponível (v18.17.0) |
| `mapWithConcurrency` com limit inválido; `sleepWithAbort`; `generateCodeChallenge` | ✅ corretos |

---

## 📊 Matriz de Severidade (Rodadas 9 + 10)

| Severidade | Achados | Status |
|---|---|---|
| 🔴 Média-Alta | A1 — OOM por ciclo no `deepOmitEmpty` | ✅ Corrigido |
| 🟡 Média | A2 — `"null"` string, A3 — PKCE multi-instância, A4 — link-local IPv6 parcial, A5 — `crypto` no Node 18 | ✅ Corrigido |
| 🟢 Baixa-Média | A6 — versão resetada no InMemoryTokenStore, B3 — `paginate` com primeiro item `undefined` | ✅ Corrigido |
| 🟢 Baixa | A7 — webhook `application_id` string, A8 — `answer` sem validação, B1 — `OAuthError.message` não saneado, B2 — webhook `user_id` string | ✅ Corrigido |

**Caçada ampla pós-Rodada 9 (C1–C10):**

| Severidade | Achados | Status |
|---|---|---|
| 🟡 Média-Alta | C1 — `retry: false`/`maxRetries` violados pelo slot de refresh | ✅ Corrigido |
| 🟡 Média | C2 — abort do usuário tratado como falha de rede e retentado, C3 — `auth: false` ainda disparava refresh, C4 — falha do refresh perdia o 401 tipado, C5 — `remaining` vazio/ausente bloqueava (DoS auto-infligido), C6 — `paging.total` string encurtava a paginação, C7 — token legacy v1 descartado na migração, C8 — `getToken()` derrubava token ainda válido sem `refresh_token` | ✅ Corrigido |
| 🟢 Baixa | C9 — `retry-after` vazio virava retry sem backoff, C10 — `listBySeller` duplicava itens com entradas descartadas | ✅ Corrigido |

---

*Rodada 9 baseada em leitura integral dos 14 pacotes + execução real dos vetores (OOM do `deepOmitEmpty` circular; `null` no `parseBody`; PKCE A→B com `consumeState`; `fe90–febf::` no schema; versão do InMemoryStore; webhook string; `answer` sem schema) e validação final com **399 testes**, lint, typecheck, build e `npm run security:check` (**70/70**, contrato de contagem no CI + modo `FUZZ_SEEDS` de seeds rotativas fora do CI + fuzzers de `paginate`/`RateLimiter` como estágios próprios) verdes. Pente fino de continuidade (B1–B3) com correções em `errors/src/index.ts`, `webhooks/src/webhooks.ts` e `core/src/pagination.ts` + 5 testes novos.*

*Rodada 10 (caçada ampla pós-Rodada 9, C1–C10) baseada em agentes de auditoria independentes + experimentos (provas por execução: POST 503 com `maxRetries: 0` reenviado; abort retentado; `remaining: ''`/`' '`/`0x10` dormindo; `total: "0"` encurtando; legacy v1 perdido; token válido recusado; `listBySeller` com MLB3/MLB5 duplicados) e validação final com **399 testes** (16 novos nesta rodada), lint, typecheck, build e `npm run security:check` (**70/70**, 10 checagens estáticas novas) verdes. Correções em `http/src/client.ts`, `http/src/rate-limit.ts`, `core/src/pagination.ts`, `auth/src/token.ts`, `auth/src/refresh.ts` e `items/src/items.ts`.*
