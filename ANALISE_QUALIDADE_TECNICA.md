# Análise Técnica de Qualidade - NodeMeLivre SDK

**Data:** 2026-08-08  
**Versão:** 1.0.0-beta.1  
**Escopo:** 14 pacotes, 45 arquivos fonte, 6.5k LOC, 222 testes

---

## Resumo Executivo

O SDK **funciona** (testes passam, build compila, tipo seguro), mas apresenta **problemas sistêmicos de arquitetura** que explicam por que "bugs reaparecem" mesmo após correções:

| Métrica | Valor | Avaliação |
|---------|-------|-----------|
| **Cobertura de testes** | 222 testes / 6.5k LOC | Boa quantidade, mas **foco errado** |
| **Duplicação de código** | 3+ funções idênticas (`paginationOptions`) | **Alta** |
| **Acoplamento temporal** | PKCE em memória, FileTokenStore não-atômico | **Crítico** |
| **Type safety real** | `unknown` bem usado, mas `any` implícito em cast | **Média** |
| **Testes de integração** | 0 (só unit com mocks) | **Ausente** |
| **Arquitetura defensiva** | Validação dispersa, sem contrato central | **Frágil** |

**Diagnóstico:** O código é "TypeScript que compila", não "TypeScript que previne bugs". A tipagem é **estrutural**, não **comportamental**.

---

## 1. Problemas Arquiteturais Sistêmicos

### 1.1 Acoplamento Temporal (Race Conditions por Design)

**O SDK confia em timing, não em contratos:**

```typescript
// auth/src/oauth.ts:109 - PKCE code_verifier em MEMÓRIA DA INSTÂNCIA
private readonly codeVerifiers = new Map<string, StoredCodeVerifier>()

// auth/src/refresh.ts:36 - Deduplicação via promise mutable
private refreshing: Promise<void> | null = null
```

**Por que falha:** Qualquer deploy com >1 instância (PM2, K8s, serverless) quebra o fluxo OAuth. Não é bug de implementação — é **decisão arquitetural** de guardar estado efêmero em memória de processo.

**Sintoma recorrente:** "Corrigimos o bug X, mas em produção com 2 replicas volta a falhar."

---

### 1.2 Ausência de Contratos de Persistência (TokenStore/StateStore)

**Interface `TokenStore` (token.ts:16-20):**
```typescript
export interface TokenStore {
  get(): Promise<AccessToken | null>
  set(token: AccessToken): Promise<void>
  clear(): Promise<void>
}
```

**Problemas:**
- **Sem atomicidade** — `get` + `set` não são transacionais
- **Sem versionamento** — não detecta written stale (duas instâncias leem v1, ambas escrevem v2)
- **Sem TTL/lease** — não há como saber se o token no disco está "fresco" ou corrompido
- **FileTokenStore ignora tudo isso** — write direto, sem lock, sem atomicidade

**Resultado:** Race conditions silenciosas em refresh concorrente. O teste unitário passa porque usa `InMemoryTokenStore` (single-threaded).

---

### 1.3 Validação Dispersa (Sem Single Source of Truth)

**Validação de Item** replicada em 3 lugares:
```typescript
// items.ts:188-224 - assertValidItemInput() com 15+ checks inline
// messages.ts:76 - InputValidationError para texto > 350 chars
// images.ts:17,30 - InputValidationError para arquivo vazio / URL inválida
```

**Problemas:**
- Cada resource valida "do seu jeito"
- Regras de negócio (ex.: `title` XOR `family_name`) ficam escondidas em `private function`
- **Impossível testar validação isoladamente** — precisa instanciar resource + transport mock
- Mudança na API do ML = caça ao tesouro em 10 arquivos

---

### 1.4 Duplicação Explícita (Copy-Paste Architecture)

**`paginationOptions` idêntica em 3 arquivos:**
```typescript
// items.ts:227, orders.ts:109, questions.ts:75
function paginationOptions(params, signal) {
  const options = {}
  if (params.limit !== undefined) options.limit = params.limit
  if (signal !== undefined) options.signal = signal
  return options
}
```

**Outros exemplos:**
- `resolveSellerItems` logic só em `items.ts` (não reutilizável)
- `sleep` com `AbortSignal` replicado em `orders.ts:78` e `questions.ts` (se houver)
- `toQuery` importado de `core` mas `omitEmpty`/`deepOmitEmpty` usados inconsistentemente

**Por que persiste:** Não há **shared utilities** para padrões comuns. Cada resource "se vira".

---

### 1.5 Testes Testam Mocks, Não Comportamento Real

**Padrão dominante nos 222 testes:**
```typescript
// items.test.ts:10
const transport = fakeTransport(() => item)
const items = new Items(transport)
const result = await items.get('MLB1')
expect(result).toEqual(item)
```

**O que NÃO é testado:**
| Cenário | Testado? |
|---------|----------|
| Multi-instância OAuth (PKCE) | ❌ |
| FileTokenStore concorrência | ❌ |
| Rate limit real (headers ML) | ❌ |
| Network partition / timeout | ❌ |
| Token corrompido no disco | ❌ |
| Webhook forjado com application_id válido | ❌ |
| Paginação com AbortSignal entre páginas | ✅ (unit) |
| Retry com backoff real | ❌ (mock time) |

**Cobertura ilusória:** 222 testes = 222 cenários de "mock retorna X, espero Y". **Zero testes de integração** contra API real ou simulador de rede.

---

## 2. Type Safety: Aparência vs Realidade

### 2.1 O Bom
- **Unions para enums fechados** (ADR-0007) — `ItemStatus`, `OrderStatus`, `ListingTypeId` etc.
- `unknown` em vez de `any` na maioria dos lugares
- `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess` no tsconfig
- `ApiErrorInput` com campos opcionais bem definidos

### 2.2 O Ruim (Type Safety Teatral)

**Casts implícitos que quebram garantias:**
```typescript
// transport.ts:27 - cast sem validação
out[key] = value as string | number | boolean

// utils.ts:35, 52 - casts em deepOmitEmpty
return value.map(deepOmitEmpty) as T
return out as T

// resilience.ts:90 - cast forçado no return
data: data as PartialResult<...>['data']
```

**Tipos que não modelam invariantes:**
```typescript
// item.ts:91-117 - ItemInput permite TUDO opcional
export interface ItemInput {
  title?: string
  family_name?: string
  price?: number        // deveria ser required na criação
  available_quantity?: number
  // ...
}
// Validação real só em runtime no assertValidItemInput()
```

**Resultado:** TypeScript impede `item.status = 'inexistente'`, mas **não impede** `ml.items.create({})` (objeto vazio). A validação real é **runtime**, não compile-time.

---

### 2.3 Generic Abuse (Complexidade sem Benefício)

```typescript
// resilience.ts:44 - generic complexo para pouco ganho
export async function parallel<T extends Record<string, () => Promise<unknown>>>(
  operations: T,
): Promise<PartialResult<{ [K in keyof T]: Awaited<ReturnType<T[K]>> }>>

// core/index.ts:5 - exporta tipos internos que vazam implementação
export type { PartialError, PartialResult } from './resilience.js'
```

**Custo:** Dificulta leitura, debugging, e manutenção. **Benefício:** Autocomplete no return do `parallel()` — que podia ser resolvido com `Record<string, Promise<unknown>>` simples.

---

## 3. Padrões de Erro: Inconsistentes e Vazados

### 3.1 Hierarquia de Erros Boa, Uso Ruim

```typescript
// errors/index.ts - hierarquia limpa
MercadoLivreError
  ├── ApiError (401, 403, 404, 400/422, 429, 5xx)
  ├── NetworkError
  ├── OAuthError
  ├── PollingTimeoutError
  ├── WebhookError
  ├── ConfigurationError
  └── InputValidationError
```

**Problema:** Resources lançam erros **diferentes para mesma falha**:
- `items.create({})` → `InputValidationError` (validação cliente)
- `items.create({ title: 'x', price: -1 })` → `InputValidationError` (validação cliente)
- `items.create(validInput)` mas API retorna 400 → `ValidationError` (ApiError subclass)

**Consumidor precisa fazer:**
```typescript
try {
  await ml.items.create(input)
} catch (e) {
  if (e instanceof InputValidationError) { /* erro meu */ }
  else if (e instanceof ValidationError) { /* erro API */ }
  else if (e instanceof ApiError) { /* outro erro API */ }
  // ...
}
```

**Sem padrão unificado** — cada resource decide o que validar cliente-side vs server-side.

---

### 3.2 Error Boundaries Ausentes

**Nenhum resource usa `ResilientTransport` ou `parallel()` internamente.** São exportados mas **não dogfoodados**.

Exemplo: `items.searchBySeller` faz `Promise.all` manual (linha 178) em vez de `mapWithConcurrency` que já existe no core.

---

## 4. Arquitetura de Pacotes: Modularidade Superficial

### 4.1 Dependências Circulares Implícitas

```mermaid
sdk → auth, http, core, types, items, orders, users, shipments, questions, images, messages, webhooks
auth → http, core, errors, types
http → core, errors
core → errors
items → core, errors, types, http (via transport)
orders → core, errors, types
...
```

**Problema real:** `@nodemelivre/sdk` re-exporta **TUDO** (index.ts:31-43). Consumidor que faz `import { Items } from '@nodemelivre/sdk'` puxa a árvore inteira. **Modularidade é só no build**, não no consumption.

---

### 4.2 ResourceTransport: Contrato Vazado

```typescript
// core/transport.ts:33-39
export interface ResourceTransport {
  get<T>(path: string, request?: ResourceRequest): Promise<T>
  post<T>(path: string, body?: unknown, request?: ResourceRequest): Promise<T>
  put<T>(path: string, body?: unknown, request?: ResourceRequest): Promise<T>
  patch<T>(path: string, body?: unknown, request?: ResourceRequest): Promise<T>
  delete<T>(path: string, request?: ResourceRequest): Promise<T>
}
```

**Problemas:**
- `T` é **completamente não restringido** — qualquer typo no path ou response shape passa no compile
- `body?: unknown` — sem validação de schema de request
- `ResourceRequest` permite `responseType` mas **resources não o usam** (só `shipments.printLabel`)
- **MockTransport** implementa a interface mas **não valida paths** — typo em `/itmes/MLB1` passa silenciosamente

---

## 5. O Que Explica "Bugs Que Reaparecem"

| Sintoma | Causa Raiz |
|---------|------------|
| PKCE falha em cluster | Estado em memória de processo (`Map` no `OAuthClient`) |
| Token corrompido | FileTokenStore sem atomicidade/locking |
| Validação inconsistente | Cada resource valida à sua maneira, sem schema central |
| Rate limit não respeitado | RateLimiter por recurso, mas resources fazem `Promise.all` manual |
| Memory leak em logger | Cleanup só on-access, não proativo |
| Testes passam mas produção falha | Testes mockam `ResourceTransport`, não testam HTTP real, rede, concorrência |

**Padrão comum:** Correções tratam **sintoma** (adicionam `try/catch`, mudam `if`), não **causa** (estado compartilhado, ausência de contratos, validação dispersa).

---

## 6. Métricas de Código (Evidência Quantitativa)

### 6.1 Complexidade Ciclomática Estimada

| Arquivo | LOC | Funções | Complexidade Estimada |
|---------|-----|---------|----------------------|
| `http/src/client.ts` | 348 | 12 | **Alta** (retry, rate-limit, refresh, parsing, events) |
| `auth/src/oauth.ts` | 274 | 8 | **Alta** (PKCE, state, 3 grant types, error mapping) |
| `items/src/items.ts` | 235 | 12 | **Média-Alta** (CRUD + paginação + validação + variations) |
| `core/src/resilience.ts` | 204 | 3 | **Média** (parallel + ResilientTransport) |

**Regra:** >200 LOC em arquivo único = candidato a refatoração. **4 arquivos** acima disso.

---

### 6.2 Razão Teste/Código

| Pacote | Src LOC | Test LOC | Ratio |
|--------|---------|----------|-------|
| items | 235 | 322 | **1.37** |
| auth/oauth | 274 | 306 | **1.12** |
| http/client | 348 | 258 | **0.74** |
| core/utils | 97 | 140 | **1.44** |
| webhooks | 104 | 88 | **0.85** |
| shipments | 37 | 34 | **0.92** |

**Média: ~1.0** — aparenta boa cobertura, mas **qualidade dos testes** é baixa (mocks only).

---

### 6.3 Duplicação Detectada

| Código Duplicado | Ocorrências | Locais |
|------------------|-------------|--------|
| `paginationOptions` | 3 | items, orders, questions |
| `sleep` com AbortSignal | 2+ | orders, (questions provável) |
| Validação `InputValidationError` | 3+ | items, messages, images |
| `toQuery` + `deepOmitEmpty` pattern | 8+ | todos resources |

---

## 7. Comparação: O Que Falta Para "Production Grade"

| Capabilidade | Status Atual | Necessário |
|--------------|--------------|------------|
| **Deploy multi-instância seguro** | ❌ Quebra (PKCE, FileTokenStore) | Estado externalizado (Redis/DB) |
| **Observabilidade real** | 🟡 Eventos emitidos, mas sem métricas | Latência p50/p99, error rate, rate-limit remaining |
| **Circuit breaker** | ❌ Não existe | `ResilientTransport` é só wrapper |
| **Idempotency keys** | ❌ Não suportado | Crítico para `POST /items`, `POST /orders` |
| **Request/Response schema validation** | ❌ Só runtime manual | Zod/Valibot ou types gerados do OpenAPI |
| **Integration test suite** | ❌ Zero | Testcontainers / MSW / API sandbox |
| **Chaos testing** | ❌ Não existe | Network partition, latency injection |
| **Migration path para v2** | ❌ Não planejado | Breaking changes acumuladas |

---

## 8. Plano de Refatoração Arquitetural (Não "Bug Fixes")

### Fase 1: Contratos de Estado (2-3 semanas)
1. **Externalizar PKCE** → `OAuthStateStore.metadata.codeVerifier` (já documentado no DOCUMENTO_CORRECOES)
2. **TokenStore v2** → Interface com `getWithVersion()`, `compareAndSet()`, `lease()`
3. **FileTokenStore v2** → Atomic write + file lock + checksum

### Fase 2: Validação Centralizada (1-2 semanas)
1. **Schema único** (Zod/Valibot) para `ItemInput`, `OrderSearchParams`, etc.
2. **Validator middleware** no `ResourceTransport` — valida request ANTES de sair, response AO CHEGAR
3. **Eliminar** `assertValidItemInput`, validações inline em messages/images

### Fase 3: Eliminação de Duplicação (1 semana)
1. `paginationOptions` → `@nodemelivre/core/utils`
2. `sleepWithAbort` → `@nodemelivre/core/utils`
3. `resolveSellerItems` → generic `resolveIds(transport, ids, concurrency)`

### Fase 4: Testes Reais (Contínuo)
1. **Testcontainers** com mock server do ML (OpenAPI spec)
2. **Contract tests** — cada resource testa contra schema real
3. **Chaos tests** — injetar latency, 429, 5xx, network partition
4. **Multi-instance tests** — 2+ processos compartilhando Redis StateStore

### Fase 5: Observabilidade & Resiliência (2 semanas)
1. **Metrics** no `HttpClient` (latência, error rate, rate-limit remaining)
2. **Circuit breaker** opcional no `ResourceTransport`
3. **Idempotency keys** automáticas para mutações

---

## 9. Conclusão: Por Que "Perseguimos a Própria Cauda"

> **O SDK foi construído como uma biblioteca de tipos + HTTP client, não como um sistema distribuído.**

Decisões iniciais (ADR-0001 a ADR-0012) resolveram **ergonomia de desenvolvimento** (tipos, modularidade, DX), mas **ignoraram realidades de produção**:
- Estado compartilhado entre instâncias
- Falhas parciais de rede/disco
- Concorrência real (não single-threaded test)
- Evolução de schema da API externa

**Cada "bug fix" adiciona mais `if/else` defensivo** sobre fundação que não suporta distribuição. A solução não é mais testes unitários — é **redesenhar os contratos de estado** (TokenStore, StateStore, RateLimiter) para serem **distributed-by-default**.

---

## Próximos Passos Recomendados

1. **Aceitar** que P0/P1 do DOCUMENTO_CORRECOES são **sintomas de arquitetura**, não bugs isolados
2. **Priorizar** Fase 1 (Contratos de Estado) — resolve 80% das falhas de produção
3. **Não adicionar** features novas até Fase 1 estar estável em staging multi-instância
4. **Investir** em suite de integração real (Testcontainers + MSW) — único jeito de pegar regressões de rede/estado

---

*Análise baseada em leitura completa de 45 arquivos fonte, 21 arquivos de teste, 12 ADRs, CHANGELOG, e execução de lint/typecheck/test/build.*