import {
  createMercadoLivre,
  FileTokenStore,
  generateStateToken,
  type OAuthStateEntry,
  type OAuthStateStoreContract,
} from '../packages/sdk/src/index.js'

/**
 * OAuthStateStore plugável com Redis — deploy MULTI-PROCESSO real.
 *
 * O `OAuthClient` depende apenas do contrato `OAuthStateStoreContract`
 * (assíncrono, 9 métodos). Esta classe implementa esse contrato com Redis
 * como backing store: o `state` anti-CSRF e o `code_verifier` do PKCE ficam
 * acessíveis a TODAS as instâncias do seu deploy (cada processo aponta para
 * o MESMO Redis) — resolve o cenário em que o balanceador manda o callback
 * para uma instância diferente da que gerou a URL de autorização.
 *
 * ── Por que o contrato é assíncrono ──────────────────────────────────────
 *   O `OAuthClient.authorizationUrl`/`consumeState` agora são `async`: o
 *   state + code_verifier precisam ser GRAVADOS no backing store remoto
 *   antes da URL retornar, e LIDOS no callback por qualquer instância. O
 *   `OAuthStateStore` in-memory também é assíncrono (mesmo contrato) — a
 *   mudança é transparente para quem usava a API pública (só ganha `await`).
 *
 * ── Como usar em produção ────────────────────────────────────────────────
 *   npm install ioredis            # ou node-redis v4+ (qualquer client que
 *                                  # exponha get/set/expire/del/keys)
 *
 *   import { Redis } from 'ioredis'
 *   const redis = new Redis(process.env.REDIS_URL!)
 *   const stateStore = new RedisOAuthStateStore({ client: redis })
 *
 *   // Instancie o SDK em TODAS as réplicas com este stateStore:
 *   const ml = createMercadoLivre({
 *     clientId, clientSecret, siteId: 'MLB',
 *     pkce: true, stateStore, tokenStore: new FileTokenStore({...}),
 *   })
 *
 *   // 1. GET /login (qualquer réplica):
 *   //    const url = await ml.authorizationUrl('https://seusite.com/callback')
 *   // 2. Callback (QUALQUER réplica):
 *   //    const entry = await ml.consumeState(state)   // valida + estaciona verifier
 *   //    const token = await ml.authenticate(uri, code, state)  // troca o code
 *
 * ── Chaves no Redis ──────────────────────────────────────────────────────
 *   <prefix>:state:<state>     → JSON de OAuthStateEntry (TTL = ttlMs)
 *   <prefix>:pkce:<state>      → JSON { verifier, createdAt } (TTL = ttlMs)
 *
 * ── Semântica ────────────────────────────────────────────────────────────
 *   Espelha o `OAuthStateStore` in-memory: consume é single-use; o verifier
 *   sobrevive ao consume (parked); TTL segue a mesma política (10 min). Para
 *   single-use com estrita atomicidade em produção, use o comando `GETDEL`
 *   do Redis 6.2+ (ou um script Lua) — o adapter usa get+del (janela de
 *   corrida mínima, suficiente para CSRF com state de 256 bits aleatório).
 */

/** Interface mínima de client Redis (duck-typed — ioredis e node-redis v4+ satisfazem). */
export interface RedisClientLike {
  get(key: string): Promise<string | null>
  set(key: string, value: string): Promise<unknown>
  /** TTL em segundos. */
  expire(key: string, seconds: number): Promise<unknown>
  del(...keys: string[]): Promise<unknown>
  keys(pattern: string): Promise<string[]>
}

export interface RedisOAuthStateStoreOptions {
  client: RedisClientLike
  /** TTL em ms para states e verifiers estacionados (padrão: 10 min). */
  ttlMs?: number
  /** Prefixo das chaves no Redis (padrão: `nodemelivre:oauth`). */
  keyPrefix?: string
  /** Clock injetável para testes (padrão: Date.now). */
  clock?: () => number
}

interface ParkedVerifier {
  verifier: string
  createdAt: number
}

const DEFAULT_TTL_MS = 10 * 60 * 1000 // 10 min — mesma janela do OAuthStateStore

export class RedisOAuthStateStore implements OAuthStateStoreContract {
  private readonly client: RedisClientLike
  private readonly ttlMs: number
  private readonly keyPrefix: string
  private readonly clock: () => number

  constructor(options: RedisOAuthStateStoreOptions) {
    this.client = options.client
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS
    this.keyPrefix = options.keyPrefix ?? 'nodemelivre:oauth'
    this.clock = options.clock ?? Date.now
  }

  /** Gera um novo state, armazena e retorna o state gerado. */
  async create(redirectUri: string, metadata?: Record<string, unknown>): Promise<string> {
    const state = generateStateToken()
    await this.writeEntry(state, {
      state,
      redirectUri,
      createdAt: this.clock(),
      ...(metadata !== undefined ? { metadata } : {}),
    })
    return state
  }

  /** Armazena um state fornecido pelo chamador; false se já existir. */
  async register(
    state: string,
    redirectUri: string,
    metadata?: Record<string, unknown>,
  ): Promise<boolean> {
    if (await this.get(state)) return false
    await this.writeEntry(state, {
      state,
      redirectUri,
      createdAt: this.clock(),
      ...(metadata !== undefined ? { metadata } : {}),
    })
    return true
  }

  /** Valida e consome um state (single-use). Retorna a entry ou null. */
  async consume(state: string): Promise<OAuthStateEntry | null> {
    const entry = await this.get(state)
    if (entry === null) return null
    // Single-use: remove mesmo que o `get` acima tenha decidido validar —
    // o Redis é o único dono da verdade entre as instâncias.
    await this.delete(state)
    return entry
  }

  /** Verifica se um state existe e é válido (sem consumir). */
  async has(state: string): Promise<boolean> {
    return (await this.get(state)) !== null
  }

  /** Obtém a entry sem remover (para inspeção). */
  async get(state: string): Promise<OAuthStateEntry | null> {
    const raw = await this.client.get(this.stateKey(state))
    if (raw === null) return null
    let entry: OAuthStateEntry
    try {
      entry = JSON.parse(raw) as OAuthStateEntry
    } catch {
      // Chave corrompida — remove e trata como inexistente.
      await this.delete(state)
      return null
    }
    if (this.isExpired(entry.createdAt)) {
      await this.delete(state)
      return null
    }
    return entry
  }

  /** Remove um state específico (o verifier estacionado expira por TTL). */
  async delete(state: string): Promise<boolean> {
    // Remove SÓ a chave do state — mesma semântica do OAuthStateStore
    // in-memory: verifiers estacionados são namespaced à parte (`pkce:`) e
    // expiram via TTL do Redis. (No fluxo do OAuthClient, consume→park é
    // sequencial, então o verifier é estacionado DEPOIS do delete.)
    await this.client.del(this.stateKey(state))
    return true
  }

  /** Atualiza os metadados de um state existente. */
  async updateMetadata(state: string, metadata: Record<string, unknown>): Promise<boolean> {
    const entry = await this.get(state)
    if (entry === null) return false
    entry.metadata = { ...entry.metadata, ...metadata }
    await this.writeEntry(state, entry)
    return true
  }

  /** Estaciona um code_verifier PKCE após o consume (multi-instância). */
  async parkCodeVerifier(state: string, verifier: string): Promise<void> {
    const parked: ParkedVerifier = { verifier, createdAt: this.clock() }
    await this.client.set(this.parkedKey(state), JSON.stringify(parked))
    await this.client.expire(this.parkedKey(state), this.ttlSeconds())
  }

  /** Recupera um verifier estacionado (ou undefined). */
  async getParkedCodeVerifier(state: string): Promise<string | undefined> {
    const raw = await this.client.get(this.parkedKey(state))
    if (raw === null) return undefined
    let parked: ParkedVerifier
    try {
      parked = JSON.parse(raw) as ParkedVerifier
    } catch {
      return undefined
    }
    if (this.isExpired(parked.createdAt)) {
      await this.client.del(this.parkedKey(state))
      return undefined
    }
    return parked.verifier
  }

  /** No-op: o Redis expira as chaves via TTL (sem timer local). */
  stop(): void {
    // nada a fazer
  }

  private async writeEntry(state: string, entry: OAuthStateEntry): Promise<void> {
    const key = this.stateKey(state)
    await this.client.set(key, JSON.stringify(entry))
    await this.client.expire(key, this.ttlSeconds())
  }

  private isExpired(createdAt: number): boolean {
    return this.clock() - createdAt > this.ttlMs
  }

  private ttlSeconds(): number {
    return Math.max(1, Math.floor(this.ttlMs / 1000))
  }

  private stateKey(state: string): string {
    return `${this.keyPrefix}:state:${state}`
  }

  private parkedKey(state: string): string {
    return `${this.keyPrefix}:pkce:${state}`
  }
}

// ─────────────────────────────────────────────────────────────────────────
// DEMO executável (zero dependências) — substitua o FakeRedis por um client
// ioredis/node-redis real em produção (ver comentário do topo).
// ─────────────────────────────────────────────────────────────────────────

/** Mini client Redis in-memory para o demo (o monorepo é zero-dep no runtime). */
class FakeRedis implements RedisClientLike {
  private readonly data = new Map<string, { value: string; expiresAt: number }>()

  async get(key: string): Promise<string | null> {
    const item = this.data.get(key)
    if (item === undefined) return null
    if (item.expiresAt <= Date.now()) {
      this.data.delete(key)
      return null
    }
    return item.value
  }

  async set(key: string, value: string): Promise<unknown> {
    this.data.set(key, { value, expiresAt: Date.now() + DEFAULT_TTL_MS })
    return undefined
  }

  async expire(key: string, seconds: number): Promise<unknown> {
    const item = this.data.get(key)
    if (item === undefined) return undefined
    item.expiresAt = Date.now() + seconds * 1000
    return undefined
  }

  async del(...keys: string[]): Promise<unknown> {
    for (const key of keys) this.data.delete(key)
    return undefined
  }

  async keys(pattern: string): Promise<string[]> {
    const regex = new RegExp(`^${pattern.replace(/\*/g, '.*')}$`)
    return [...this.data.keys()].filter((key) => regex.test(key))
  }
}

async function main(): Promise<void> {
  const clientId = process.env.ML_CLIENT_ID
  const clientSecret = process.env.ML_CLIENT_SECRET
  if (clientId === undefined || clientSecret === undefined) {
    throw new Error('Defina ML_CLIENT_ID e ML_CLIENT_SECRET')
  }

  // Em produção: const redis = new Redis(process.env.REDIS_URL!)  // ioredis
  const redis = new FakeRedis()
  const stateStore = new RedisOAuthStateStore({ client: redis })

  // O MESMO stateStore em todas as réplicas do deploy (aqui: duas instâncias
  // compartilhando o mesmo Redis, como se fossem dois processos).
  const makeMl = () =>
    createMercadoLivre({
      clientId,
      clientSecret,
      siteId: 'MLB',
      pkce: true, // apps novos do ML exigem code_verifier
      stateStore,
      tokenStore: new FileTokenStore({ filePath: './.nodemelivre/token.json' }),
    })
  const mlA = makeMl()
  const mlB = makeMl()

  // 1. Réplica A gera a URL de autorização (state + verifier gravados no Redis).
  const url = await mlA.authorizationUrl('https://seusite.com/callback')
  console.log(`1. Réplica A gerou: ${url}`)

  // 2. O callback cai na réplica B (balanceador não é sticky): valida o state
  //    (anti-CSRF, single-use) e estaciona o code_verifier no Redis.
  const state = new URL(url).searchParams.get('state') ?? ''
  const entry = await mlB.consumeState(state)
  if (entry === null) {
    throw new Error('state inválido/expirado — possível ataque CSRF')
  }
  console.log('2. Réplica B validou o state no callback (consumeState OK)')

  // 3. Prova do multi-processo: o code_verifier gerado na réplica A e
  //    estacionado no passo 2 está disponível na réplica B (via Redis). Sem
  //    isso, o /oauth/token responderia invalid_request para apps PKCE.
  const verifier = await mlB.auth.getCodeVerifierFromState(state)
  if (verifier === undefined) {
    throw new Error('code_verifier não encontrado no Redis — fluxo multi-instância quebrou')
  }
  console.log('3. Réplica B recuperou o code_verifier do Redis (PKCE ok)')

  // 4. A troca real do code (await mlB.authenticate(uri, code, state)) exige
  //    credenciais e code reais — rode com suas credenciais e um code válido
  //    do callback para ver o fluxo completo contra o Mercado Livre.
  console.log('4. Troca do code: rode com ML_CLIENT_ID/ML_CLIENT_SECRET reais e um code válido')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
