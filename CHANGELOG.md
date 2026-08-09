# Changelog

Todas as mudanças notáveis do monorepo serão documentadas neste arquivo.

O formato segue [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e o projeto adere ao [SemVer](https://semver.org/lang/pt-BR/). Veja o [processo de release](docs/releases/README.md).

## [Não lançado]

### Testes

- **Fuzzing determinístico do `deepOmitEmpty` (`utils.test.ts`)** — PRNG mulberry32 com seed fixa (reproduzível no CI, sem flakiness) gera 500 grafos aleatórios combinando **ciclos**, **DAGs**, **profundidade** e **chaves `__proto__`/`constructor`/`prototype`**; mais casos dirigidos: cadeias de 5k–15k de profundidade com ciclo no fundo (anti-stack/anti-OOM), DAGs densos (30 ramos compartilhando 1 objeto — não são confundidos com ciclo) e 200 grafos de chaves perigosas. Invariantes verificadas por grafo: não lança, resultado 100% serializável (nenhum ciclo sobrevive), **nenhum dado legítimo se perde** (todo valor folha do input continua no output), idempotência (`deepOmitEmpty² = deepOmitEmpty`) e sem poluição do `Object.prototype`. A eficácia foi comprovada por mutação: desligar a detecção de ciclo do `cleanDeep` faz o fuzzer travar (worker morto — o CI quebraria no regresso).
- **Fuzzing determinístico do `DeduplicatingLogger` (`logger.test.ts`)** — logar **nunca pode derrubar o processo**: PRNG mulberry32 com seed fixa gera ~900 contextos hostis combinando **ciclos** (self/mutual/arrays), **cadeias de `cause` circulares** (undici-like), **getters que lançam** (em qualquer profundidade), **símbolos**, **BigInt** (o `JSON.stringify` lança `TypeError`), **`toJSON` hostil** (lança/devolve BigInt/re-cria o ciclo → `RangeError` do V8), **proxies com traps que lançam**, **chaves perigosas** via `JSON.parse` e **profundidade 10k–20k** (`RangeError`). Invariantes por caso: os 4 níveis nunca lançam, a chave de deduplicação é estável (repetição hostil é suprimida), expiração/resumo/eviction nunca lançam e o `createConsoleLogger` aguenta tudo. Eficácia comprovada por mutação: remover o `try/catch` do `safeStringify` derruba 7 dos 9 testes de fuzzing.
- **Fuzzing determinístico do `buildUrl` (`http/src/url.test.ts`)** — o origin **nunca pode vazar**: PRNG mulberry32 com seed fixa gera 500 casos combinando **URLs malformadas**, **host com CRLF/controle** (payloads de header injection), **protocolos exóticos** (`javascript:`, `data:`, `file:`, `ftp:`, `ws:`, `gopher:`, `blob:`, `http+unix:`...), **whitespace/C0 leading** (vetor da Rodada 8), **userinfo** (`https://evil.com@localhost/x`), **backslash** (slash + backslash = protocol-relative) e **mutação aleatória** (CR/LF/NUL/`\`/`%` em posições arbitrárias). Invariantes por caso: se `buildUrl` retorna, o origin **é o do baseUrl** (nenhuma forma de escape desvia o `Authorization`); erros são sempre `InputValidationError` tipado (nunca erro nativo do parser); sem CR/LF crus no `href`; query round-trip. Casos dirigidos: CRLF/header injection, whitespace+C0+userinfo (Rodada 8), 85 combinações de schemes não-HTTP, paths relativos legítimos e path de 2MB (anti-DoS). Eficácia comprovada por mutação: desligar o origin guard faz 4 dos 6 testes falharem (origin escapou).
- **Modo de fuzzing com seeds rotativas (`FUZZ_SEEDS`)** — os 5 fuzzers (deepOmitEmpty, logger, buildUrl, paginate, RateLimiter) leem a env `FUZZ_SEEDS`: **no CI (sem a env) a seed fixa determinística é mantida** (100% reproduzível, saída idêntica); **fora do CI**, `FUZZ_SEEDS="0x1111,0x2222,0x3333"` **rotaciona** as seeds — cada teste roda uma vez por seed e cada seed gera um fluxo PRNG diferente, ampliando a cobertura (N seeds × grafos/casos) para rodadas mais longas. Valores hex (`0x…`) ou decimais separados por vírgula/espaço; inválidos/vazios caem no fallback da seed fixa — o modo nunca degrada o CI. Checagem estática 40 garante a presença do modo nos 5 fuzzers também no `--static-only`.
- **Fuzzing determinístico do `paginate` (`pagination.test.ts`)** — streams aleatórios de páginas: **páginas que não avançam** (API ignora `offset`, mesmo primeiro item — o cenário exato do ACHADO 17) **nunca entram em loop infinito de requisições**: o guard `previousFirstKey` para na 2ª chamada (nunca mais que 2 fetches, itens da 1ª página entregues uma vez); entrega exata em ordem quando a API avança (500 streams, offsets monotônicos, fetch além do `total` nunca ocorre); `total: null` termina na página vazia; e o tradeoff documentado de páginas diferentes com o mesmo primeiro item (parar é o comportamento seguro). Eficácia comprovada por mutação **hang-safe**: desligar o guard → loop infinito detectado (Promise.race + `setImmediate`).
- **Fuzzing determinístico do `RateLimiter` (`rate-limit.test.ts`)** — 1000 combinações aleatórias de headers `limit`/`remaining`/`reset` (epochs ms/s, relativos plausíveis e implausíveis, futuros distantes, negativos, lixo) com **delay injetado** que captura a espera: a espera **nunca passa de `MAX_WAIT_MS`** nem fica abaixo de 1ms — o sleep gigante do ACHADO 18 (reset corrompido/gateway no futuro distante) não volta; single-flight sob concorrência aleatória (1-4 chamadas → 1 delay); `rateLimitKey` com paths aleatórios nunca lança e agrupa pelo primeiro segmento. Eficácia comprovada por mutação: remover o cap → espera de ~998 trilhões de ms detectada; remover o guard O3 (relativo implausível) → espera de 500.000.000ms detectada.

### ⚠️ Breaking — contrato do `OAuthStateStore` agora é assíncrono

- **`OAuthStateStoreContract` (novo, plugável) e `OAuthStateStore` viraram `Promise`-based** — `authorizationUrl`, `consumeState` e `getCodeVerifierFromState` (OAuthClient) e `ml.authorizationUrl`/`ml.consumeState` (facade) agora retornam `Promise`. Motivo: o contrato passou a ser uma **interface pública assíncrona** que permite adaptadores com backing store remoto (Redis/banco) para deploy multi-processo real — a instância que recebe o callback precisa **ler** o `state` e o `code_verifier` de outro processo. Para quem usava a API pública, basta adicionar `await` (o comportamento é idêntico).
- **Novo `examples/redis-state-store.ts`** — adaptador `RedisOAuthStateStore` implementando o contrato (create/register/consume/has/get/delete/updateMetadata/parkCodeVerifier/getParkedCodeVerifier) com client duck-typed (ioredis/node-redis v4+), TTL por chave, keys com prefixo e demo executável zero-dep (FakeRedis in-memory). Multi-processo real: state + verifier no MESMO Redis entre réplicas.

### Segurança (auditoria Rodada 9 — rastro do pente fino, 2026-08-08)

- **`deepOmitEmpty` detecta ciclos (A1, anti-OOM)** — o fix do ACHADO 16 (iterativo, sem stack overflow) não tratava referências circulares: um objeto com `obj.self = obj` entrava em loop infinito na pilha explícita até **OOM do processo** (4GB consumidos em execução real). `cleanDeep` agora rastreia o caminho atual num `WeakSet` (`inPath`): ao reencontrar um objeto do caminho, o valor é **omitido** (mesma regra de `undefined` — não é serializável para a API); DAGs legítimos (mesmo objeto em dois ramos irmãos) são preservados porque o rastreio é por caminho, não por visita global. Ver `docs/auditoria-pente-fino.md`.
- **`parseBody` preserva JSON literal `null` (A2)** — `tryParseJson(text) ?? text` convertia o `null` de um corpo `200`/erro na **string `"null"`** (o `??` trata `null` como ausência). `tryParseJson` agora retorna sentinel (`{ failed }`): `null`, `false` e `0` chegam ao chamador com o tipo correto; texto não-JSON continua no fallback.
- **PKCE multi-instância completo (A3)** — o fix do ACHADO 31 estacionava o `code_verifier` no fallback in-memory da instância que consumiu o state: em multi-instância (vários `OAuthClient`/processos compartilhando o MESMO `OAuthStateStore`), a instância B que troca o code enviava `/oauth/token` **sem `code_verifier`** → `invalid_request`. Novos `OAuthStateStore.parkCodeVerifier`/`getParkedCodeVerifier` (TTL 10 min + limite 1000 + sweep no `cleanup`) compartilham o verifier no store; `getCodeVerifierFromState` consulta state ativo → estacionado → fallback.
- **Link-local IPv6 completo no `httpUrlSchema` (A4, bypass SSRF)** — o bloqueio usava `startsWith('fe80')`, mas `fe80::/10` cobre o primeiro hexteto `fe80`–`febf`: `fe90::`/`fea0::`/`feb0::`/`febf::` passavam. Agora é mascaramento de 10 bits (`firstHextet & 0xffc0 === 0xfe80`); ULA `fc00::/7` idem (`& 0xfe00 === 0xfc00`).
- **`generateStateToken` compatível com Node 18 (A5)** — usava o global `crypto` (`crypto.getRandomValues`), que no Node 18.x (mínimo do `engines`) é **experimental e exige `--experimental-global-webcrypto`** (só sai da flag no v19) → `ReferenceError` no fluxo OAuth. Agora `randomBytes(32).toString('hex')` de `node:crypto` (mesmo formato hex 64; `isValidStateToken` inalterado). `AbortSignal.any` (client) é seguro no 18.17 (backport confirmado).
- **`InMemoryTokenStore.set()` com versão monotônica (A6)** — `createVersioned(token)` com default `version = 1` RESETAVA o contador após um `compareAndSet` chegar a 2+ (o `FileTokenStore.set()` incrementa). Agora `(this.token?.version ?? 0) + 1` — mesmo contrato dos dois stores, CAS otimista confiável.
- **`Webhooks.verify` aceita `application_id` string (A7, falso negativo)** — comparação estrita (`'123' !== Number('123')`) rejeitava notificação legítima com `application_id` serializado como string. Comparação agora numérica nos dois lados (`Number(...) !== Number(...)`).
- **`Questions.answer` valida o payload (A8)** — o ACHADO 4 corrigiu `reply`, mas `answer` (método público que o `reply` chama) aceitava `question_id: 0`/negativo/`NaN`/string e `text: ''` direto no body. Novo `questionAnswerSchema` (`questionId` inteiro positivo + `text` não vazio) aplicado com `assertValid` antes do fetch.
- **`security:check` 36 → 45** — 9 checagens estáticas novas (A1–A8 + contrato async do stateStore) + 2 arquivos de teste no estágio dinâmico (`state.test.ts`, `integration.test.ts`). Relatório completo em `docs/auditoria-pente-fino.md`. **356 testes** verdes.
- **`security:check` 45 → 52 — estágios próprios de fuzzing + contrato de contagem** — o fuzzer do `deepOmitEmpty` (describe `deepOmitEmpty — fuzzing` em `utils.test.ts`) roda como **Estágio 3**, o do `DeduplicatingLogger` (describe `DeduplicatingLogger — fuzzing` em `logger.test.ts`) como **Estágio 4** e o do `buildUrl` (describe `buildUrl — fuzzing` em `http/src/url.test.ts`, também adicionado ao estágio dinâmico — 18 arquivos) como **Estágio 5** do `security:check`, além do vitest do Estágio 2: execução dedicada com `vitest -t "fuzzing"` que **falha se os testes não rodarem de verdade** (o vitest sai 0 com tudo skipped quando o filtro não casa — a checagem parseia `Tests N passed` e exige N ≥ 1). Novas checagens estáticas (itens 36-39) garantem que os fuzzers permaneçam nos arquivos também no `--static-only` e que os workflows carreguem o contrato. **Contrato de contagem (item 39):** `ci.yml` e `publish-beta.yml` passam `--expect-checks 52` — o script falha com exit 1 se o total de checagens mudar (ABAIXO = regressão de cobertura; ACIMA = contrato desatualizado). Remover uma checagem OU o contrato derruba o CI. Renomear/remover qualquer fuzzer também (confirmado por mutação).
- **`security:check` 52 → 53 — modo de fuzzing com seeds rotativas (`FUZZ_SEEDS`)** — nova checagem estática (item 40): os fuzzers precisam ler `process.env.FUZZ_SEEDS` — no CI (sem a env) a seed fixa determinística é mantida (saída idêntica); fora do CI a env rotaciona seeds para rodadas mais amplas. Contrato dos workflows atualizado para `--expect-checks 53` (validado por execução: 53 → exit 0; 52 → exit 1).
- **`security:check` 53 → 57 — fuzzers do `paginate` e do `RateLimiter` como estágios próprios** — o fuzzer do `paginate` (describe `paginate — fuzzing` em `pagination.test.ts`) roda como **Estágio 6** e o do `RateLimiter` (describe `RateLimiter — fuzzing` em `rate-limit.test.ts`) como **Estágio 7** do `security:check`, com o mesmo parse de `Tests N passed` (N ≥ 1 — falha se os testes não rodarem de verdade). Novas checagens estáticas (itens 41-42) garantem a presença dos fuzzers no `--static-only`; a checagem 40 (FUZZ_SEEDS) agora cobre os **5 fuzzers** e aceita a variante assíncrona (`forEachFuzzSeedAsync(0x…`) usada pelos fuzzers que iteram via `for await`. Contrato dos workflows atualizado para `--expect-checks 57` (validado: 57 → exit 0; 56/58 → exit 1).

### Adicionado

- **`security:check` — verificação de segurança automatizada no CI:** `scripts/security-check.mjs` (Node puro, zero dependências) cobre os vetores-chave das 5 rodadas da auditoria em 2 estágios: (1) **estático** — scan por segredos hardcoded em `packages/*/src`, APIs removidas que não podem ressurgir (`assertValidItemInput`, `getGlobalOAuthStateStore`, `securityHeaders`...), `Math.random` em auth (CSPRNG), chaves `__proto__`/`constructor` fora do `UNSAFE_KEYS`, presença dos fixes (trailing dot, sanitizeLog completo, `randomBytes`, limite do fallback, `deepOmitEmpty` iterativo, guard de página repetida no `paginate`, `MAX_WAIT_MS` no rate limit); (2) **dinâmico** — executa os 12 arquivos de teste de segurança (schemas, client/integration, utils, webhooks, errors, refresh/oauth, questions, items, pagination, rate-limit). `npm run security:check` roda tudo; `npm run security:static` só o estágio 1. Integrado ao CI entre Testes e Build.
- **Chaos testing (Fase 4 do ANALISE_QUALIDADE_TECNICA):** `MockMercadoLivreServer.chaos()` injeta falhas sobre as respostas — `failureRate`/`failStatus` (instabilidade intermitente), `latencyMs`/`jitterMs` (latência variável) e partição por endpoint (prefixo do path; o mais específico vence), com fonte aleatória injetável para determinismo. `packages/http/src/chaos.test.ts` (7 testes) valida a **degradação parcial** do SDK com `parallel`/`parallelBestEffort`/`ResilientTransport` contra um servidor com `/items` fora do ar e `/orders` lento — o que funciona segue, o que falha vira erro parcial (padrão do painel: stats `null` em vez de 500).
- **Integração dos fluxos nível 3 (Fase 4):** `packages/sdk/src/level3.integration.test.ts` (9 testes) exercita por HTTP real autenticado `items.createAndPublish` (cria + publica; input inválido falha antes de chamar a API), `orders.waitUntilPaid` (polling real: já pago, paga após N chamadas, `PollingTimeoutError` e `AbortSignal` → AbortError) e `questions.reply` (`POST /answers` com `question_id` numérico).
- **Suite de testes de integração real (Fase 4 do ANALISE_QUALIDADE_TECNICA):** `MockMercadoLivreServer` (mock server HTTP em `node:http`, zero dependências) em `@nodemelivre/core/test-utils`. `packages/http/src/integration.test.ts` cobre o contrato HTTP (método/path/query/headers/Authorization), retry 429/5xx com backoff real, rate limit por recurso (espera o reset), timeout, network partition (conexão recusada) e refresh 401 ponta a ponta. `packages/sdk/src/integration.test.ts` exercita o SDK completo por HTTP real: fluxo OAuth (PKCE) com persistência em `FileTokenStore`, refresh em 401 com o `TokenManager` e code_verifier compartilhado entre instâncias (multi-instância).
- **Validação centralizada por schemas (Fase 2 do ANALISE_QUALIDADE_TECNICA):** mini-DSL de validação zero-dependência em `@nodemelivre/core` (`string`, `number`, `enumOf`, `optional`, `arrayOf`, `object` + `refinements`, `assertValid`, `makeSchema`) e schemas de domínio (`itemInputCreateSchema`, `itemInputPartialSchema`, `orderSearchParamsSchema`, `httpUrlSchema`, `nonEmptyFileSchema`) como fonte única da verdade. `assertValidItemInput` e as validações inline de messages/images foram eliminados; as mensagens de erro históricas foram preservadas. `@nodemelivre/core` agora depende de `@nodemelivre/types` (sem ciclo) e o build do root foi reordenado (`types` antes de `core`). ADR-0013.
- `mapWithConcurrency()` em `@nodemelivre/core`: aplica um mapper respeitando limite de execuções paralelas, preservando a ordem — usado pela resolução de itens do vendedor.
- `Items.list`/`listBySeller` e `paginate()` aceitam `AbortSignal`: cancelamento antecipado da iteração e da requisição em voo (o `for await` rejeita com AbortError).
- `Images.uploadFromUrl(url)` em `@nodemelivre/images`: registra imagem a partir de uma URL pública (`POST /pictures`), validando protocolo http(s) — sem depender do Nível 1 do SDK.
- `Webhooks.verifyForUser(payload, applicationId, expectedUserId)` em `@nodemelivre/webhooks`: valida `application_id` e o `user_id` da notificação contra o vendedor esperado — controle real contra payloads forjados (o ML não usa HMAC).
- `Orders.list(params, signal)` em `@nodemelivre/orders` e `Questions.list(params, signal)` em `@nodemelivre/questions`: paginação assíncrona (`for await`) reutilizando `paginate()` do core, com `AbortSignal` opcional — o `for await` rejeita com AbortError sem buscar a página seguinte. `QuestionSearchParams` ganhou `offset`/`limit`; `Questions.list` normaliza a resposta (`questions` → `results`).

### Segurança (auditoria 2026-08-08)

- **`assertValidId` em `@nodemelivre/core`** — valida IDs de recursos antes de interpolá-los no path (`items`, `orders`, `questions`, `users`, `shipments`, `messages`): bloqueia **path traversal** (`../../users/me`), caracteres que alteram a URL (`/`, `?`, `#`, espaço, `..`) e IDs inválidos (NaN, negativos, vazios) com `InputValidationError` — um ID malicioso não consegue mais redirecionar a requisição autenticada para outro endpoint do ML.
- **`httpUrlSchema` endurecido contra SSRF** — além de http(s), agora rejeita `localhost`, loopback (`127.0.0.0/8`, `::1`), ranges privados (`10/8`, `172.16/12`, `192.168/16`), link-local/metadata de nuvem (`169.254.0.0/16`, `fe80::/10`, `metadata.google.internal`) e **IPv4-mapeado em IPv6** (`::ffff:127.0.0.1` / `::ffff:169.254.169.254` — o WHATWG URL normaliza para hex, decodificado e checado) — aplicado a `Images.uploadFromUrl`.
- **`HttpClient` não segue redirects cegamente** — `redirect: 'manual'` + resolução e validação de cada hop: apenas mesmo host/subdomínio do baseUrl ou hosts oficiais do ML (`api.mercadolibre.com`, `api.mercadolivre.com.br`), **sem downgrade https→http**, limite de 5 hops (anti-loop). Um `Location` malicioso não recebe o `Authorization` do SDK. 303/301/302 em POST viram GET (spec do fetch).
- `Questions.reply` valida `question_id` numérico positivo antes de converter — `reply('abc', ...)` lança `InputValidationError` em vez de enviar `question_id: null`.
- **Anti log injection nos `Webhooks`** — `topic`, `application_id` e `user_id` (atacante-controlados no payload do POST) são sanitizados antes de interpolar em `WebhookError`: CR/LF removidos (impede forjar linhas de log) e valores > 100 chars truncados.
- **Anti prototype pollution no core** — `deepOmitEmpty`, `omitEmpty`, `omitUndefined` e `toQuery` ignoram chaves `__proto__`/`constructor`/`prototype` de objetos vindos de `JSON.parse` (não confiáveis): a atribuição `out[key]` não pode mais acionar o setter de prototype nem herdar propriedades indesejadas.
- `Items.searchBySeller`/`listBySeller`: IDs vindos da resposta da API passam por `assertValidId` antes de serem interpolados no path (defesa em profundidade — fonte semi-confiável).
- **Bypass de SSRF por trailing dot corrigido (Rodada 3)** — `http://localhost./x`, `http://metadata./x` e `http://metadata.google.internal./x` escapavam do `httpUrlSchema` (o WHATWG URL mantém o ponto final; o host era comparado como `localhost.` ≠ `localhost`). O hostname agora é normalizado (`trailing dot` removido) antes das comparações — `localhost.` resolve para loopback na maioria dos resolvers (FQDN absoluto).
- **`ApiError.message` sanitizado (Rodada 3)** — a mensagem ecoada pela API (que pode refletir input do usuário) tem CR/LF, separadores Unicode (`\u2028`/`\u0085`) e control chars (`\x00-\x1f`, `\x7f`) removidos antes de virar `message` — sem log injection quando a exceção é serializada (logs/APM).
- **`sanitizeLog` ampliado (Rodada 3)** — além de CR/LF/`\u2028`/`\u2029`, agora remove NEL (`\u0085`), control chars (`\x00-\x1f`) e DEL (`\x7f`).
- **Re-autenticação persiste o token novo (Rodada 4)** — `TokenManager.saveAuthorizationCode` usava `compareAndSet(token, 0)`, que falhava silenciosamente quando já existia token (version ≥ 1): um re-login não substituía o token antigo e o SDK seguia com a sessão expirada. Agora lê a versão atual para compare-and-set atômico e força a sobrescrita em conflito — o token recém-trocado nunca é perdido.
- **`instanceId` padrão do `TokenManager` com CSPRNG (Rodada 4)** — antes `Math.random().toString(36)` (~31 bits previsível): colisão entre instâncias liberaria leases cruzados (refresh duplo). Agora `randomBytes(8).toString('hex')`.
- **Fallback in-memory de `code_verifier` limitado (Rodada 4)** — sem `stateStore`, cada `authorizationUrl()` com pkce adicionava uma entrada que só expirava na leitura (vazamento de memória com URLs nunca consumidas). Agora: limite de 1000 entradas (expulsa a mais antiga) + sweep de expiradas (mesma política do `OAuthStateStore`).
- **`deepOmitEmpty` iterativo (Rodada 5, DoS por stack overflow)** — a versão recursiva estourava a pilha do V8 (~10k de profundidade → `RangeError`) derrubando o processo do integrador com um payload de item controlado pelo usuário. Reescrito com pilha explícita (`cleanDeep`), semântica idêntica, sem recursão.
- **`paginate()` guard de página repetida (Rodada 5, DoS por loop infinito)** — se a API ignora `offset` e devolve sempre a mesma página (com `paging.total: null`), o loop avançava o offset indefinidamente fazendo requisições infinitas. Agora, se a primeira página de uma iteração começa com o mesmo item da anterior, a iteração encerra antes de entregar itens repetidos.
- **`RateLimiter` com teto de espera `MAX_WAIT_MS` (Rodada 5, DoS por sleep gigante)** — um `x-rate-limit-reset` corrompido/gateway no futuro distante fazia o SDK dormir dias (95 mil dias no experimento). A espera agora é limitada a 5 min por janela.
- **Origin guard no `HttpClient` (Rodada 6)** — `buildUrl` rejeita path absoluto (`https://evil.com/x`) e protocol-relative (`//evil.com/x`) com `InputValidationError`: o `new URL(path, baseUrl)` aceitava ambos, levando o `Authorization` do integrador para outro origin (confused deputy — achado de auditoria independente, confirmado por execução). As resources já validavam via `assertValidId`; esta é a defesa para `ml.http.*` (API pública) e qualquer path não validado.
- **Redirect cross-origin não reenvia `Authorization` (Rodada 6)** — um hop 302 de `api.mercadolibre.com` para `api.mercadolivre.com.br` (ambos autorizados) carregava o Bearer do integrador (confirmado por execução). Agora o header é removido quando o origin do destino difere do origin da requisição — comportamento do fetch nativo (que o `redirect: 'manual'` manual havia desviado). Redirect same-origin preserva o token.
- **`Retry-After` com teto no backoff (Rodada 6)** — `backoffDelay` capava `retryAfterSeconds * 1000` em `MAX_WAIT_MS` (mesmo teto do rate limit): um `Retry-After: 999999` fazia o SDK dormir ~11,5 dias. A mesma classe de DoS de espera fechada no rate limit (Rodada 5) ficava reaberta no caminho de retry.
- **`httpUrlSchema` bloqueia DNS wildcard (Rodada 6)** — `nip.io`, `sslip.io`, `xip.io`, `localtest.me`, `lvh.me`, `vcap.me` e `nip.rocks` (e subdomínios) são serviços que resolvem qualquer host para um IP escolhido pelo atacante (`127.0.0.1.nip.io` → loopback): passavam no schema por serem hosts públicos "bonitos" — vetor de SSRF/dns-rebinding.
- **`httpUrlSchema` bloqueia transição IPv6 (Rodada 6)** — NAT64 (`64:ff9b::/96`), 6to4 (`2002::/16`) e IPv4-compatível (`::/96`) embutem um IPv4 que roteia para loopback/privado em redes IPv6-only (`[64:ff9b::7f00:1]` → 127.0.0.1) e passavam no schema — agora o IPv4 embutido é extraído e re-validado contra os ranges locais.
- **`parallel()` sem pollution local por `__proto__` (Rodada 6)** — `data[resource] = value` com `resource = '__proto__'` (chave própria de objeto montado por `JSON.parse`/spread) acionava o setter de prototype, vazando o valor resolvido como propriedade herdada (`data.injected` visível sem estar em `Object.keys`). `data` agora é `Object.create(null)` — mesma disciplina do `UNSAFE_KEYS` no resto do core.
- **`FileTokenStore` com `0o600` no lease e lock (Rodada 6)** — o token já era `0o600`, mas `.lease` e `.lock` eram criados com umask padrão (0644). O lease não contém segredo, mas a disciplina de permissão do diretório de tokens ficava quebrada — agora `{ mode: 0o600 }` em todas as escritas e no `open()` do lock.
- **Hardening do CI e supply chain (Rodada 7)** — `ci.yml` e `publish-beta.yml` agora declaram `permissions` mínimas (`contents: read`; `packages: write` só no publish), têm `timeout-minutes` (15/20) e rodam `npm audit --omit=dev --audit-level=high`; o workflow de publish também roda `npm run security:check` antes de publicar. Dependências internas `@nodemelivre/*` deixaram de usar `"*"` (anti-padrão de publicação — não fixa compatibilidade) e agora usam `^1.0.0-beta.1`, com o lockfile atualizado.
- **Actions do CI pinadas por SHA (Rodada 7)** — `actions/checkout` e `actions/setup-node` nos 2 workflows deixam de referenciar tag móvel (`@v4`/`@v5`) e apontam para commit imutável (40 hex) com comentário da versão — elimina o risco de supply chain de uma tag sobrescrita trocar o código do CI sem mudança no workflow (achado 29). SHAs resolvidos via GitHub API (todos `type: commit`). Checagem estática no `security:check` (item 23) rejeita qualquer `uses: owner/repo@vN` futuro.
- **Dependabot configurado (Rodada 7)** — `.github/dependabot.yml`: ecossistema `github-actions` (semanal) atualiza o digest do SHA **preservando o comentário de versão** (`# v4`/`# v5`), mantendo o pinning imutável sem estagnação; ecossistema `npm` (workspaces) agrupa patch/minor num PR só e ignora os internos `@nodemelivre/*` (resolvidos localmente e publicados no GitHub Packages). `insecure-external-code-execution` permanece desabilitado por decisão de segurança — se um update exigir o postinstall do esbuild, o flag é avaliado caso a caso. Checagem estática no `security:check` (item 24) exige o arquivo — **33/33 checagens**.

### Corrigido

- `Items.searchBySeller`/`listBySeller`: resolução de IDs em itens completos agora respeita um limite de concorrência (10) em vez de `Promise.all` sem cap — evita rajada de requisições que estoura o rate limit em contas com milhares de anúncios.

- `HttpClient`: a retentativa pós-refresh (401) não consome o orçamento de retry — `retry: false` ainda renova o token. Quando o loop se esgota, o **erro real da API** é re-lançado em vez de um `ApiError` sintético com `status 0`.
- `DeduplicatingLogger`: o resumo de logs suprimidos agora é emitido quando a janela expira (antes o caminho era inalcançável e o resumo nunca aparecia).
- `DeduplicatingLogger`: a entry no cache é sempre substituída por uma referência nova (imutável) — nunca mutada no lugar — eliminando corridas de concorrência sobre o objeto compartilhado. O resumo emite a mensagem original (antes era reconstruída do key via `split(':')`, quebrando mensagens com dois-pontos).
- `RateLimiter`: espera single-flight — requisições concorrentes no mesmo recurso esgotado compartilham uma única espera até o reset (evita "thundering herd" no reset) e o estado esgotado é limpo ao fim da janela.
- `deepOmitEmpty`: preserva `null` intencional — enviar `null` em `PUT /items` continua limpando o campo (antes era removido do payload).
- `deepOmitEmpty`: **crash com `null` corrigido** (`Object.keys(null)` em qualquer `null` aninhado) — bug encontrado pelo dogfooding, coberto por testes novos.
- **Build publicável quebrado (crítico):** os `tsconfig.build.json` herdavam os `paths` dos packages irmãos e geravam `dist` aninhado — o entrypoint `dist/index.js`/`dist/index.d.ts` ficava congelado/ausente. `@nodemelivre/images`, `@nodemelivre/messages` e `@nodemelivre/webhooks` nem tinham entrypoint; os demais expunham código sem nível 3/hardening. Todos os 14 packages agora buildam com `rootDir: "src"` e `paths: {}`, validado por smoke test de import do `dist`.
- **Runtime quebrado no entry do `@nodemelivre/core`:** re-exportava os `test-utils` (que importam `vitest`), carregando o vitest em produção. Removido do entry; seguem no subpath `@nodemelivre/core/test-utils`.
- **Dependências não declaradas:** `@nodemelivre/core`, `@nodemelivre/images` e `@nodemelivre/messages` importavam `@nodemelivre/errors` sem declará-lo. Declaradas (consumidores de packages individuais quebravam em runtime).

### Alterado

- `DeduplicatingLogger`: limpeza periódica do cache de deduplicação — remove entradas expiradas emitindo o resumo dos logs suprimidos na expiração, e aplica um limite máximo de entradas (`maxEntries`, padrão 10.000) para que mensagens únicas (ex.: `requestId` diferentes) não cresçam a memória sem limite. Novo `stop()` para interromper o timer.
- `paginate()` e resources paginados: `paginationOptions` e `sleepWithAbort` centralizados em `@nodemelivre/core` e reutilizados por items/orders/questions — fim da duplicação (3 cópias de `paginationOptions`, 2 de `sleep`).
- **Validação mais estrita (fail fast no cliente):** `Orders.search/list` agora rejeitam `limit` não positivo/inteiro, `offset` negativo e `status` fora da union antes de chamar a API; `Messages.send` rejeita `text` não-string (antes, `undefined > 350` deixava passar); `Items` rejeita `attributes`/`pictures` fora do shape — payloads que iriam falhar na API agora falham com `InputValidationError` tipado.
- `RateLimiter`: tracking por recurso (`método:recurso`) em vez de path literal, e parsing robusto de `X-Rate-Limit-Reset` (epoch ms/segundos ou janela restante em segundos relativos).

### Removido (breaking)

- `HttpClientOptions.securityHeaders` e `SECURITY_HEADERS`: headers de resposta (CSP, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`) nunca devem ser enviados como headers de requisição — a opção que permitia isso foi removida por completo (o README documenta a recomendação de usar Helmet no seu servidor).
- `getGlobalOAuthStateStore`/`resetGlobalOAuthStateStore`: o singleton global de `OAuthStateStore` foi removido — instancie e injete seu próprio store (`new OAuthStateStore(...)` via `createMercadoLivre`/`OAuthClient`), habilitando multi-tenancy e opções por instância.

### Adicionado

- **PKCE (RFC 7636) no fluxo OAuth2** (`OAuthOptions.pkce` / `MercadoLivreOptions.pkce`): `authorizationUrl` inclui `code_challenge` + `code_challenge_method` (S256 padrão, `plain` opcional) e a troca do code envia `code_verifier` — exigência do Mercado Livre para apps com o fluxo PKCE habilitado (sem ele, o `/oauth/token` responde `invalid_request`). O `code_verifier` é gerado e armazenado por `state` (recuperado ao informar o mesmo `state` em `authenticate(redirectUri, code, state)`), com `codeVerifier` explícito como alternativa. `generateCodeVerifier`/`generateCodeChallenge` exportados.
- `OAuthClient`: `OAuthError` agora expõe o `message` do ML quando `error_description` não vem (ex.: `invalid_request` com detalhe "the following parameters are required...").
- `OAuthStateStore` integrado ao `OAuthClient`: com `stateStore` configurado, `authorizationUrl` gera/armazena o `state` automaticamente (CSRF) e `consumeState` valida o state recebido no callback. Exposto no facade via `ml.consumeState()` e opção `stateStore` em `MercadoLivreOptions`.
- `OAuthClient`: valida `clientId`/`clientSecret` no construtor — uso direto sem credenciais lança `ConfigurationError` com mensagem clara (antes gerava URL quebrada ou erro vindo da API).
- `InputValidationError` em `@nodemelivre/errors` (validação de entrada no cliente, antes de enviar à API).
- Validações: `Messages.send` rejeita texto acima de 350 caracteres; `Images.upload` rejeita arquivo vazio.
- `Orders.waitUntilPaid` aceita `AbortSignal` para cancelamento antecipado do polling.
- Testes para `resilience` (`parallel`/`ResilientTransport`), `OAuthStateStore` e `DeduplicatingLogger` — 147 testes no total.
- `utils.test.ts` no `@nodemelivre/core` (regressão do crash de `null`, comportamento documentado de preservar `null`, tokens OAuth) — 171 testes no total.
- **Validação de entrada em `@nodemelivre/items`** (`create`/`update`/`createAndPublish`): falha rápida com `InputValidationError` para `title` vazio, `price` não positivo e `available_quantity` não inteiro — mesmo padrão de `messages`/`images` (auditoria de consistência). `create`/`update` agora são `async` (validação rejeita como promise). — 175 testes no total.
- `BuyingMode` (`'buy_it_now' | 'classified'`) em `@nodemelivre/types`; `ItemInput.buying_mode` e `Item.buying_mode` tipados.
- `tsconfig.examples.json` + scripts `typecheck:examples`/`typecheck:all`: exemplos verificados no CI (antes ficavam fora e driftavam).

## [1.0.0] - 2026-08-05

### Adicionado

- **SDK consolidado** — `createMercadoLivre` facade expõe 8 resources (`items`, `orders`, `users`, `shipments`, `questions`, `images`, `messages`, `webhooks`) + `auth`/`tokens`/`http` e re-exports de `types`/`errors`/`core`.
- **Webhooks** (`@nodemelivre/webhooks`) — `parse(payload)` + `verify(payload, applicationId)` autentica via `application_id` (ML não usa HMAC).
- **Messages** (`@nodemelivre/messages`) — chat pós-venda: `list`, `get`, `send` com `tag=post_sale`.
- **Operações nível 3**:
  - `Items.createAndPublish(input)` — cria e garante publicado.
  - `Questions.reply(questionId, text)` — responde + marca respondida.
  - `Shipments.printLabel(ids, { format })` — etiqueta PDF/ZPL como `ArrayBuffer`.
  - `responseType: 'json' | 'text' | 'arraybuffer'` no transport/HttpClient.
- **Images** — `UploadSource = Blob | Buffer | Uint8Array | ArrayBuffer` extensível, nome padrão `image.bin`.
- **Paginação** — `paginate()` no core + `Items.list()` (`for await`).
- **ADRs 0001–0012**, 8 exemplos, roadmap, CHANGELOG.
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
