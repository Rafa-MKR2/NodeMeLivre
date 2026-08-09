import { generateStateToken } from '@nodemelivre/core'

export interface OAuthStateEntry {
  state: string
  redirectUri: string
  createdAt: number
  /** Dados extras associados ao estado (ex.: code verifier para PKCE). */
  metadata?: Record<string, unknown>
}

export interface OAuthStateStoreOptions {
  /** TTL em ms para cada estado (padrão: 10 min). */
  ttlMs?: number
  /** Limite máximo de estados armazenados (padrão: 1000). */
  maxEntries?: number
  /** Intervalo de limpeza automática em ms (padrão: 1 min). */
  cleanupIntervalMs?: number
  /** Clock injetável para testes. */
  clock?: () => number
}

/**
 * Contrato estrutural do store de estados OAuth (pluggável e ASSÍNCRONO).
 *
 * O `OAuthClient` depende APENAS desta interface — qualquer implementação
 * (in-memory, Redis, banco) pode ser injetada via `stateStore`. O contrato é
 * `Promise`-based porque stores compartilhados entre processos (Redis/banco)
 * fazem I/O de rede: a instância que recebe o callback precisa LER o `state`
 * e o `code_verifier` de um backing store remoto.
 *
 * Veja `examples/redis-state-store.ts` para um adaptador Redis completo e
 * `packages/auth/src/state.ts` (`OAuthStateStore`) para a implementação
 * in-memory (single-process).
 */
export interface OAuthStateStoreContract {
  /** Gera um novo state, armazena e retorna o state gerado. */
  create(redirectUri: string, metadata?: Record<string, unknown>): Promise<string>
  /** Armazena um state fornecido pelo chamador; false se já existir. */
  register(state: string, redirectUri: string, metadata?: Record<string, unknown>): Promise<boolean>
  /** Valida e consome um state (single-use). Retorna a entry ou null. */
  consume(state: string): Promise<OAuthStateEntry | null>
  /** Verifica se um state existe e é válido (sem consumir). */
  has(state: string): Promise<boolean>
  /** Obtém a entry sem remover (para inspeção). */
  get(state: string): Promise<OAuthStateEntry | null>
  /** Remove um state específico. */
  delete(state: string): Promise<boolean>
  /** Atualiza os metadados de um state existente. */
  updateMetadata(state: string, metadata: Record<string, unknown>): Promise<boolean>
  /** Estaciona um code_verifier PKCE após o consume (multi-instância). */
  parkCodeVerifier(state: string, verifier: string): Promise<void>
  /** Recupera um verifier estacionado (ou undefined). */
  getParkedCodeVerifier(state: string): Promise<string | undefined>
}

/**
 * Armazena estados OAuth temporários com TTL e limpeza automática.
 * Previne vazamento de memória quando usuários não completam a autenticação.
 *
 * Implementação in-memory (single-process). Para multi-instância, use um
 * store compartilhado (ex.: `examples/redis-state-store.ts`).
 */
/** TTL do verifier estacionado (mesma janela dos states). */
const PARKED_VERIFIER_TTL_MS = 10 * 60 * 1000
/** Limite de verifiers estacionados (anti memory leak — mesma disciplina do OAuthClient). */
const PARKED_VERIFIER_MAX_ENTRIES = 1000

export class OAuthStateStore implements OAuthStateStoreContract {
  private readonly store = new Map<string, OAuthStateEntry>()
  /**
   * Code verifiers "estacionados" após `consume` (ACHADO 31 + Rodada 9).
   *
   * O `consume` apaga a entry do state — junto com o `metadata.codeVerifier`
   * do PKCE. O fix do ACHADO 31 estacionava o verifier apenas no fallback
   * in-memory da instância que consumiu: em multi-instância (vários
   * `OAuthClient`/processos compartilhando o MESMO stateStore — cenário que
   * o SDK suporta), a instância B que troca o code não encontrava o
   * verifier e o `/oauth/token` ia sem `code_verifier` → `invalid_request`.
   * Este Map é COMPARTILHADO (vive no stateStore, não na instância): a
   * instância que consumiu estaciona aqui e qualquer outra instância que
   * use o mesmo store recupera na troca do code.
   */
  private readonly parkedVerifiers = new Map<string, { verifier: string; createdAt: number }>()
  private readonly ttlMs: number
  private readonly maxEntries: number
  private readonly cleanupIntervalMs: number
  private readonly clock: () => number
  private cleanupTimer: ReturnType<typeof setInterval> | null = null

  constructor(options: OAuthStateStoreOptions = {}) {
    this.ttlMs = options.ttlMs ?? 10 * 60 * 1000 // 10 min
    this.maxEntries = options.maxEntries ?? 1000
    this.cleanupIntervalMs = options.cleanupIntervalMs ?? 60 * 1000 // 1 min
    this.clock = options.clock ?? Date.now
    this.startCleanupTimer()
  }

  /**
   * Estaciona um `code_verifier` PKCE associado a um state já consumido.
   * Compartilhado entre instâncias que usam este store (multi-processo).
   * TTL e limite seguem a mesma política dos states (anti memory leak).
   */
  async parkCodeVerifier(state: string, verifier: string): Promise<void> {
    this.sweepExpiredParkedVerifiers()
    if (this.parkedVerifiers.size >= PARKED_VERIFIER_MAX_ENTRIES) {
      const oldest = this.parkedVerifiers.keys().next().value
      if (oldest !== undefined) this.parkedVerifiers.delete(oldest)
    }
    this.parkedVerifiers.set(state, { verifier, createdAt: this.clock() })
  }

  /** Recupera um verifier estacionado (ou `undefined` se ausente/expirado). */
  async getParkedCodeVerifier(state: string): Promise<string | undefined> {
    const parked = this.parkedVerifiers.get(state)
    if (parked === undefined) return undefined
    if (this.clock() - parked.createdAt > PARKED_VERIFIER_TTL_MS) {
      this.parkedVerifiers.delete(state)
      return undefined
    }
    return parked.verifier
  }

  private sweepExpiredParkedVerifiers(): void {
    const now = this.clock()
    for (const [state, parked] of this.parkedVerifiers.entries()) {
      if (now - parked.createdAt > PARKED_VERIFIER_TTL_MS) {
        this.parkedVerifiers.delete(state)
      }
    }
  }

  /**
   * Gera um novo state, armazena com o redirectUri e metadados opcionais.
   * Retorna o state gerado.
   */
  async create(redirectUri: string, metadata?: Record<string, unknown>): Promise<string> {
    this.enforceMaxEntries()
    const state = generateStateToken()
    const entry: OAuthStateEntry = {
      state,
      redirectUri,
      createdAt: this.clock(),
    }
    if (metadata !== undefined) {
      entry.metadata = metadata
    }
    this.store.set(state, entry)
    return state
  }

  /**
   * Armazena um state fornecido pelo chamador (em vez de gerar um novo).
   * Retorna `false` se o state já existir no store.
   */
  async register(
    state: string,
    redirectUri: string,
    metadata?: Record<string, unknown>,
  ): Promise<boolean> {
    if (this.store.has(state)) return false
    this.enforceMaxEntries()
    const entry: OAuthStateEntry = {
      state,
      redirectUri,
      createdAt: this.clock(),
    }
    if (metadata !== undefined) {
      entry.metadata = metadata
    }
    this.store.set(state, entry)
    return true
  }

  /**
   * Valida e consome um state (remove do store após uso).
   * Retorna a entry se válido, null caso contrário.
   */
  async consume(state: string): Promise<OAuthStateEntry | null> {
    const entry = this.store.get(state)
    if (!entry) return null
    if (this.isExpired(entry)) {
      this.store.delete(state)
      return null
    }
    this.store.delete(state)
    return entry
  }

  /** Verifica se um state existe e é válido (sem consumir). */
  async has(state: string): Promise<boolean> {
    const entry = this.store.get(state)
    if (!entry) return false
    if (this.isExpired(entry)) {
      this.store.delete(state)
      return false
    }
    return true
  }

  /** Obtém a entry sem remover (para inspeção). */
  async get(state: string): Promise<OAuthStateEntry | null> {
    const entry = this.store.get(state)
    if (!entry) return null
    if (this.isExpired(entry)) {
      this.store.delete(state)
      return null
    }
    return entry
  }

  /** Remove um state específico. */
  async delete(state: string): Promise<boolean> {
    return this.store.delete(state)
  }

  /**
   * Atualiza os metadados de um state existente (ex.: armazenar code_verifier PKCE).
   * Retorna false se o state não existir ou estiver expirado.
   */
  async updateMetadata(state: string, metadata: Record<string, unknown>): Promise<boolean> {
    const entry = this.store.get(state)
    if (!entry) return false
    if (this.isExpired(entry)) {
      this.store.delete(state)
      return false
    }
    entry.metadata = { ...entry.metadata, ...metadata }
    return true
  }

  /** Limpa todos os estados expirados. Retorna quantidade removida. */
  cleanup(): number {
    const now = this.clock()
    let removed = 0
    for (const [state, entry] of this.store.entries()) {
      if (now - entry.createdAt > this.ttlMs) {
        this.store.delete(state)
        removed++
      }
    }
    // Verifiers estacionados seguem a mesma política (TTL próprio).
    for (const [state, parked] of this.parkedVerifiers.entries()) {
      if (now - parked.createdAt > PARKED_VERIFIER_TTL_MS) {
        this.parkedVerifiers.delete(state)
        removed++
      }
    }
    return removed
  }

  /** Para o timer de limpeza automática. */
  stop(): void {
    if (this.cleanupTimer !== null) {
      clearInterval(this.cleanupTimer)
      this.cleanupTimer = null
    }
  }

  /** Número de estados armazenados atualmente. */
  get size(): number {
    return this.store.size
  }

  private isExpired(entry: OAuthStateEntry): boolean {
    return this.clock() - entry.createdAt > this.ttlMs
  }

  private enforceMaxEntries(): void {
    if (this.store.size >= this.maxEntries) {
      // Remove o mais antigo
      const oldest = this.store.keys().next().value
      if (oldest !== undefined) {
        this.store.delete(oldest)
      }
    }
  }

  private startCleanupTimer(): void {
    this.cleanupTimer = setInterval(() => {
      this.cleanup()
    }, this.cleanupIntervalMs)
    // Não impede o processo de sair
    if (this.cleanupTimer.unref) {
      this.cleanupTimer.unref()
    }
  }
}
