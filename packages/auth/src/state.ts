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
 * Armazena estados OAuth temporários com TTL e limpeza automática.
 * Previne vazamento de memória quando usuários não completam a autenticação.
 */
export class OAuthStateStore {
  private readonly store = new Map<string, OAuthStateEntry>()
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
   * Gera um novo state, armazena com o redirectUri e metadados opcionais.
   * Retorna o state gerado.
   */
  create(redirectUri: string, metadata?: Record<string, unknown>): string {
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
  register(state: string, redirectUri: string, metadata?: Record<string, unknown>): boolean {
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
  consume(state: string): OAuthStateEntry | null {
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
  has(state: string): boolean {
    const entry = this.store.get(state)
    if (!entry) return false
    if (this.isExpired(entry)) {
      this.store.delete(state)
      return false
    }
    return true
  }

  /** Obtém a entry sem remover (para inspeção). */
  get(state: string): OAuthStateEntry | null {
    const entry = this.store.get(state)
    if (!entry) return null
    if (this.isExpired(entry)) {
      this.store.delete(state)
      return null
    }
    return entry
  }

  /** Remove um state específico. */
  delete(state: string): boolean {
    return this.store.delete(state)
  }

  /**
   * Atualiza os metadados de um state existente (ex.: armazenar code_verifier PKCE).
   * Retorna false se o state não existir ou estiver expirado.
   */
  updateMetadata(state: string, metadata: Record<string, unknown>): boolean {
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

/** Store em memória global (para uso simples). */
let globalStore: OAuthStateStore | null = null

/** Obtém ou cria o store global. */
export function getGlobalOAuthStateStore(options?: OAuthStateStoreOptions): OAuthStateStore {
  if (globalStore === null) {
    globalStore = new OAuthStateStore(options)
  }
  return globalStore
}

/** Reseta o store global (útil para testes). */
export function resetGlobalOAuthStateStore(): void {
  if (globalStore !== null) {
    globalStore.stop()
    globalStore = null
  }
}
