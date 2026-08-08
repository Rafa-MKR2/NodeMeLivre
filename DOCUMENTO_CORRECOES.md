# Documento de Correções Críticas - NodeMeLivre SDK

**Data:** 2026-08-08  
**Versão Analisada:** 1.0.0-beta.1  
**Autor da Análise:** Análise de código estático + execução de testes

---

## Resumo Executivo

Foram identificadas **7 falhas** no SDK NodeMeLivre, sendo **2 CRÍTICAS (P0)** que quebram funcionalidades essenciais em produção clusterizada, **2 ALTAS (P1)** que afetam arquitetura e segurança, **2 MÉDIAS (P2)** com risco de vazamento de memória e race conditions, e **1 BAIXA (P4)**.

Todos os testes atuais passam (222/222), mas **não cobrem cenários multi-instância, concorrência de arquivos, nem vazamento de memória em long-running**.

---

## 🔴 P0 - CRÍTICA 1: PKCE Code Verifier Perdido em Deploy Multi-Instância

### Localização
```
packages/auth/src/oauth.ts:109
```

### Código Problemático
```typescript
private readonly codeVerifiers = new Map<string, StoredCodeVerifier>()
```

### Descrição do Problema
O `code_verifier` (PKCE RFC 7636) é gerado no `authorizationUrl()` e armazenado **apenas na memória da instância do `OAuthClient`** (`this.codeVerifiers`). O `OAuthStateStore` (que pode ser compartilhado via Redis, banco, etc.) **não recebe** o `code_verifier`.

### Cenário de Falha
1. **Instância A** recebe request de autorização → gera `code_verifier` → salva em `this.codeVerifiers` → redireciona usuário
2. Usuário autoriza no ML → callback cai no **Load Balancer** → roteado para **Instância B**
3. **Instância B** recebe `code` + `state` → chama `exchangeCode()` → tenta recuperar `code_verifier` via `getCodeVerifier(state)`
4. **Falha:** `this.codeVerifiers` da Instância B está vazio → `undefined` → request ao `/oauth/token` sem `code_verifier`
5. **Resultado:** Mercado Livre retorna `invalid_request` (exigência obrigatória desde 2025 para apps com PKCE habilitado)

### Impacto
- **Quebra completa do fluxo OAuth em produção** com PM2 cluster mode, Kubernetes, ECS, Cloud Run, ou qualquer arquitetura com múltiplas instâncias
- Funciona apenas em desenvolvimento single-process

### Solução Proposta
Armazenar o `code_verifier` no `metadata` do `OAuthStateStore` (que é pluggável e compartilhável):

```typescript
// Em authorizationUrl() - após gerar o verifier:
const entry = this.stateStore.get(state) || this.stateStore.create(options.redirectUri, options.metadata)
entry.metadata = { ...entry.metadata, codeVerifier: verifier }

// Em exchangeCode() - recuperar do state consumido:
const entry = this.stateStore.consume(state)
const verifier = entry?.metadata?.codeVerifier
```

### Arquivos a Modificar
- `packages/auth/src/oauth.ts` (métodos `authorizationUrl`, `getCodeVerifier`, `exchangeCode`)
- `packages/auth/src/state.ts` (garantir que `metadata` persista no `consume`)

### Testes Necessários
- Teste de integração simulando 2 instâncias com `OAuthStateStore` compartilhado (InMemory compartilhado ou mock)
- Verificar que `code_verifier` gerado na instância A é recuperado na instância B

---

## 🔴 P0 - CRÍTICA 2: FileTokenStore Não-Atômico e Sem File Locking

### Localização
```
packages/auth/src/token.ts:65-71
```

### Código Problemático
```typescript
async set(token: AccessToken): Promise<void> {
  await mkdir(dirname(this.filePath), { recursive: true })
  await writeFile(this.filePath, JSON.stringify(token, null, 2), {
    mode: 0o600,
    encoding: 'utf8',
  })
}
```

### Problemas Identificados

| Problema | Descrição | Risco |
|----------|-----------|-------|
| **Escrita não-atômica** | `writeFile` pode ser interrompido (crash, kill, OOM) deixando arquivo truncado/corrompido | Token corrompido = usuário precisa reautenticar |
| **Sem file locking** | Múltiplos processos (workers PM2, containers) escrevem simultaneamente → corrupção de dados | Race condition silenciosa |
| **`mode: 0o600` ignorado no Windows** | Permissões POSIX não aplicadas no Windows → arquivo legível por outros usuários | Vazamento de token em ambientes Windows |

### Cenários de Falha Real
1. **PM2 cluster mode:** 4 workers recebem 401 simultâneo → todos tentam refresh → 4 writes concorrentes no mesmo arquivo
2. **Container restart:** Processo morto durante `writeFile` → arquivo JSON inválido → próximo start falha ao parsear
3. **Servidor Windows:** Token salvo com permissões default → outros usuários do servidor leem `access_token` + `refresh_token`

### Solução Proposta

#### Opção A: Escrita Atômica + Lock Simples (Recomendada - Zero Dependências)
```typescript
import { open, constants } from 'node:fs/promises'
import { rename } from 'node:fs/promises'

async set(token: AccessToken): Promise<void> {
  await mkdir(dirname(this.filePath), { recursive: true })
  
  // Lock file (simples, funciona cross-platform)
  const lockPath = this.filePath + '.lock'
  let lockFd: number | undefined
  try {
    lockFd = await open(lockPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY)
  } catch {
    // Aguarda lock ser liberado (com timeout)
    await this.waitForLock(lockPath)
    return this.set(token) // retry
  }
  
  try {
    // Write temp + atomic rename
    const tempPath = this.filePath + '.tmp'
    await writeFile(tempPath, JSON.stringify(token, null, 2), { encoding: 'utf8' })
    await rename(tempPath, this.filePath) // atômico no POSIX e Windows
  } finally {
    await lockFd.close()
    await rm(lockPath, { force: true })
  }
}
```

#### Opção B: Dependência `proper-lockfile` (Mais Robusto)
```bash
npm install proper-lockfile
```
```typescript
import lockfile from 'proper-lockfile'

async set(token: AccessToken): Promise<void> {
  await mkdir(dirname(this.filePath), { recursive: true })
  const release = await lockfile.lock(this.filePath)
  try {
    const tempPath = this.filePath + '.tmp'
    await writeFile(tempPath, JSON.stringify(token, null, 2), { encoding: 'utf8' })
    await rename(tempPath, this.filePath)
  } finally {
    await release()
  }
}
```

### Arquivos a Modificar
- `packages/auth/src/token.ts` (classe `FileTokenStore`)

### Testes Necessários
- Teste de concorrência: 10 processos escrevendo simultaneamente → verificar integridade
- Teste de crash: matar processo durante write → próximo read deve recuperar token válido ou null
- Teste cross-platform: validar no Windows (GitHub Actions matrix)

---

## 🟡 P1 - ALTA 3: OAuthStateStore Global Singleton Problemático

### Localização
```
packages/auth/src/state.ts:173-190
```

### Código Problemático
```typescript
let globalStore: OAuthStateStore | null = null

export function getGlobalOAuthStateStore(options?: OAuthStateStoreOptions): OAuthStateStore {
  if (globalStore === null) {
    globalStore = new OAuthStateStore(options)
  }
  return globalStore
}
```

### Problemas

| Problema | Impacto |
|----------|---------|
| **Estado global mutável** | Dificulta testes unitários (estado vaza entre testes) |
| **Multi-tenancy impossível** | Uma instância do SDK = um store global; não dá para atender múltiplos clients/lojas no mesmo processo |
| **Timer de cleanup não gerenciado** | `setInterval` roda indefinidamente; `unref()` evita bloquear exit, mas timer continua consumindo CPU/memória |
| **Opções ignoradas após primeira chamada** | `getGlobalOAuthStateStore({ ttlMs: 5000 })` → segunda chamada com `{ ttlMs: 60000 }` é ignorada silenciosamente |

### Solução Proposta
**Remover o singleton global.** O consumidor deve instanciar e injetar seu próprio `OAuthStateStore`:

```typescript
// Remover:
// - let globalStore
// - getGlobalOAuthStateStore()
// - resetGlobalOAuthStateStore()

// Consumidor faz:
import { OAuthStateStore } from '@nodemelivre/auth'
const stateStore = new OAuthStateStore({ ttlMs: 10 * 60 * 1000 })
const ml = createMercadoLivre({ clientId, clientSecret, stateStore })
```

### Arquivos a Modificar
- `packages/auth/src/state.ts` (remover linhas 173-190)
- `packages/auth/src/oauth.ts` (remover import/uso do global store se houver)
- `packages/sdk/src/index.ts` (não passar store global por default)

### Migração
- **Breaking change** (menor): consumidores que usavam `getGlobalOAuthStateStore()` precisam instanciar manualmente
- Documentar no CHANGELOG e README

---

## 🟡 P1 - ALTA 4: Headers de Segurança Enviados Incorretamente nas Requisições

### Localização
```
packages/http/src/client.ts:78-82, 100-102
```

### Código Problemático
```typescript
const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'DENY',
}

// ...
this.securityHeaders = options.securityHeaders ?? false
const security = this.securityHeaders ? SECURITY_HEADERS : {}
this.defaultHeaders = { ...security, ...options.defaultHeaders }
```

### Problema
**`X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy` são headers de RESPOSTA HTTP** (definem como o browser deve renderizar a resposta). O SDK os envia como headers de **REQUISIÇÃO** para a API do Mercado Livre.

### Consequências
1. **Inútil:** API do ML ignora completamente esses headers
2. **Potencialmente problemático:** Proxies, WAFs, ou API gateways podem rejeitar requests com headers "estranhos"
3. **Violação de responsabilidade:** O SDK não deve definir headers de resposta do servidor do integrador (como alerta o próprio README: "Use Helmet no seu app")

### Solução Proposta
**Remover completamente `SECURITY_HEADERS` e a opção `securityHeaders`.**

```typescript
// Remover:
// - const SECURITY_HEADERS
// - securityHeaders option
// - this.securityHeaders
// - merge no defaultHeaders

// Manter apenas:
this.defaultHeaders = { ...options.defaultHeaders }
```

### Arquivos a Modificar
- `packages/http/src/client.ts` (remover linhas 78-82, 94, 100-102)
- `packages/http/src/client.ts` (atualizar interface `HttpClientOptions` removendo `securityHeaders`)
- `packages/sdk/src/index.ts` (remover `securityHeaders` do `MercadoLivreOptions` se exposto)

### Nota
O README já documenta corretamente: *"o SDK não injeta headers de resposta (CSP, X-Frame-Options, etc.) nas requisições — esses headers pertencem ao seu servidor. Use Helmet (ou equivalente) no seu app."*

---

## 🟡 P2 - MÉDIA 5: DeduplicatingLogger Vaza Memória (Memory Leak)

### Localização
```
packages/core/src/logger.ts:25-28
```

### Código Problemático
```typescript
private readonly seen = new Map<
  string,
  { count: number; firstSeen: number; lastLogged: number; message: string }
>()
```

### Problema
O `Map` `seen` cresce indefinidamente. A limpeza **só ocorre quando a mesma chave é acessada novamente após o TTL** (linha 51-58). Mensagens únicas (ex.: logs de requests com `requestId` diferentes, user IDs diferentes, etc.) **nunca são removidas**.

### Cenário de Vazamento
```typescript
// Em produção com 1000 req/s, cada request loga:
logger.info({ requestId: 'uuid-unico', userId: 123 }, 'Request received')
// Chave: "info:Request received:{"requestId":"uuid-unico","userId":123}"
// → Nova entrada no Map a cada request
// → Após 1 hora: 3.6M entradas no Map
// → Memória explode (OOM)
```

### Solução Proposta
Adicionar limpeza periódica proativa:

```typescript
export class DeduplicatingLogger implements Logger {
  // ...existing code...
  private cleanupTimer: ReturnType<typeof setInterval> | null = null

  constructor(logger: Logger, options: { windowMs?: number; maxRepeats?: number; maxEntries?: number } = {}) {
    // ...existing code...
    this.startCleanupTimer()
  }

  private startCleanupTimer(): void {
    this.cleanupTimer = setInterval(() => {
      const now = Date.now()
      for (const [key, entry] of this.seen.entries()) {
        if (now - entry.firstSeen > this.windowMs) {
          this.seen.delete(key)
        }
      }
      // Safety cap: se ainda muito grande, remove os mais antigos
      if (this.seen.size > (this.maxEntries ?? 10000)) {
        const entriesToRemove = this.seen.size - (this.maxEntries ?? 10000)
        const keys = this.seen.keys()
        for (let i = 0; i < entriesToRemove; i++) {
          const key = keys.next().value
          if (key !== undefined) this.seen.delete(key)
        }
      }
    }, this.windowMs) // roda a cada windowMs
    
    if (this.cleanupTimer.unref) this.cleanupTimer.unref()
  }

  // Adicionar método stop() para testes
  stop(): void {
    if (this.cleanupTimer !== null) {
      clearInterval(this.cleanupTimer)
      this.cleanupTimer = null
    }
  }
}
```

### Arquivos a Modificar
- `packages/core/src/logger.ts` (classe `DeduplicatingLogger`)

### Testes Necessários
- Teste de estresse: logar 100k mensagens únicas → verificar que Map não cresce indefinidamente
- Teste de cleanup: avançar clock fake → verificar remoção de entradas expiradas

---

## 🟡 P2 - MÉDIA 6: Race Condition Teórica no TokenManager.getToken()

### Localização
```
packages/auth/src/refresh.ts:48-56
```

### Código Problemático
```typescript
async getToken(): Promise<string | undefined> {
  const token = await this.store.get()
  if (token === null) return undefined
  if (this.isExpiring(token)) {
    await this.refresh()  // deduplica, OK
    return (await this.store.get())?.accessToken
  }
  return token.accessToken
}
```

### Cenário de Race Condition
Embora o `refresh()` tenha deduplicação (`this.refreshing`), há uma janela entre:
1. `store.get()` retorna token válido mas expirando
2. `isExpiring()` retorna `true`
3. **Outra chamada concorrente** faz `store.clear()` ou `store.set()` com token diferente
4. `refresh()` completa com token antigo/incorreto

É um **edge case raro** (requer clear/set concorrente durante o refresh), mas o padrão "check-then-act" sem atomicidade é frágil.

### Solução Proposta
Mover a verificação de expiração para dentro do lock de refresh, ou tornar `getToken()` atômico:

```typescript
async getToken(): Promise<string | undefined> {
  // Tentativa rápida sem lock
  let token = await this.store.get()
  if (token !== null && !this.isExpiring(token)) {
    return token.accessToken
  }
  
  // Precisa refresh: usa o lock existente
  await this.refresh()
  return (await this.store.get())?.accessToken
}
```

**Ou melhor:** `TokenStore` expõe `getWithExpiry()` que retorna `{ token, isExpiring }` atomicamente (requer mudança na interface `TokenStore` - breaking).

### Arquivos a Modificar
- `packages/auth/src/refresh.ts` (simplificar `getToken`)
- Opcional: `packages/auth/src/token.ts` (interface `TokenStore`)

---

## 🟢 P4 - BAIXA 7: RateLimiter - Cleanup de Promises Órfãs

### Localização
```
packages/http/src/rate-limit.ts:108-124
```

### Código
```typescript
const existing = this.waits.get(key)
if (existing !== undefined) return existing

const wait = this.delay(delayMs).then(() => {
  const current = this.states.get(key)
  if (current !== undefined && current.resetAt === resetAt && current.remaining === 0) {
    this.states.delete(key)
  }
})
this.waits.set(key, wait)
```

### Problema
Se o processo crashar durante o `delay()`, a promise fica no Map `waits`. Como é in-memory, restart limpa. Em long-running sem restart (meses), se houver bug no cleanup, pode acumular.

### Solução
Adicionar `try/finally` garantido (já tem) + limpeza periódica opcional. **Baixa prioridade** - mitigação natural pelo restart de containers/PM2.

---

## Plano de Ação Sugerido

### Sprint 1 (P0 - Críticas de Produção)
1. **PKCE Code Verifier no StateStore** - 2-3 dias
2. **FileTokenStore Atômico + Lock** - 1-2 dias

### Sprint 2 (P1 - Arquitetura/Segurança)
3. **Remover OAuthStateStore Global** - 0.5 dia
4. **Remover Security Headers** - 0.5 dia

### Sprint 3 (P2 - Estabilidade Long-Running)
5. **DeduplicatingLogger Cleanup Periódico** - 1 dia
6. **TokenManager getToken Atômico** - 1 dia

### Sprint 4 (Opcional)
7. **RateLimiter Cleanup** - 0.5 dia

---

## Checklist de Validação Pós-Fix

- [ ] Todos os 222 testes existentes passam
- [ ] Novos testes de integração multi-instância para PKCE
- [ ] Testes de concorrência para FileTokenStore (10 writers paralelos)
- [ ] Teste de memory leak para DeduplicatingLogger (100k logs únicos)
- [ ] Teste de race condition para TokenManager (simular clear concorrente)
- [ ] Build + typecheck + lint verdes
- [ ] Exemplos atualizados se breaking changes
- [ ] CHANGELOG atualizado
- [ ] ADR nova para decisões arquiteturais (PKCE storage, FileTokenStore atomicity)

---

## Referências

- **RFC 7636** - PKCE (Proof Key for Code Exchange)
- **Mercado Livre OAuth Docs** - Exigência de `code_verifier` para apps novos
- **Node.js `fs.promises`** - `open` com `O_EXCL` para locking cross-platform
- **ADR-0003** - TokenStore Pluggável (contexto original)
- **ADR-0009** - PKCE implementação (contexto original)