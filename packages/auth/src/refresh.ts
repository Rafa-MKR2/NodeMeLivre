import { type Logger, silentLogger } from '@nodemelivre/core'
import { OAuthError } from '@nodemelivre/errors'
import type { TokenProvider } from '@nodemelivre/http'
import type { OAuthClient } from './oauth.js'
import type { AccessToken, TokenStore } from './token.js'

export interface TokenManagerOptions {
  oauth: OAuthClient
  store: TokenStore
  /** Janela de segurança em ms antes da expiração para renovar (padrão: 60s). */
  leewayMs?: number
  /** Clock injetável para testes. */
  clock?: () => number
  logger?: Logger
}

const DEFAULT_LEEWAY_MS = 60_000

/**
 * Gerencia o ciclo de vida do token: resolve o token atual, renova
 * automaticamente antes de expirar e após um 401. É o `TokenProvider`
 * que o HttpClient usa para montar o header Authorization.
 */
export class TokenManager implements TokenProvider {
  private readonly oauth: OAuthClient
  private readonly store: TokenStore
  private readonly leewayMs: number
  private readonly clock: () => number
  private readonly logger: Logger
  private refreshing: Promise<void> | null = null

  constructor(options: TokenManagerOptions) {
    this.oauth = options.oauth
    this.store = options.store
    this.leewayMs = options.leewayMs ?? DEFAULT_LEEWAY_MS
    this.clock = options.clock ?? Date.now
    this.logger = options.logger ?? silentLogger
  }

  /** Token atual, renovando antes de expirar se necessário. */
  async getToken(): Promise<string | undefined> {
    const token = await this.store.get()
    if (token === null) return undefined
    if (this.isExpiring(token)) {
      await this.refresh()
      return (await this.store.get())?.accessToken
    }
    return token.accessToken
  }

  /** Persiste o resultado da troca do authorization_code. */
  async saveAuthorizationCode(code: string, redirectUri: string): Promise<AccessToken> {
    const token = await this.oauth.exchangeCode(code, { redirectUri })
    await this.store.set(token)
    return token
  }

  /** Renova o token usando o refresh_token persistido. Deduplica chamadas concorrentes. */
  async refresh(): Promise<void> {
    if (this.refreshing !== null) return this.refreshing

    this.refreshing = this.doRefresh()
    try {
      await this.refreshing
    } finally {
      this.refreshing = null
    }
  }

  /** Token completo armazenado (para inspeção, ex.: userId). */
  async current(): Promise<AccessToken | null> {
    return this.store.get()
  }

  /** Descarta o token armazenado. */
  async clear(): Promise<void> {
    await this.store.clear()
  }

  private async doRefresh(): Promise<void> {
    const token = await this.store.get()
    if (token?.refreshToken === undefined) {
      throw new OAuthError(
        'missing_refresh_token',
        'Não há refresh_token armazenado para renovar a sessão',
      )
    }

    this.logger.debug({ userId: token.userId }, 'renovando token de acesso')
    const fresh = await this.oauth.refresh(token.refreshToken)
    await this.store.set(fresh)
  }

  private isExpiring(token: AccessToken): boolean {
    return this.clock() + this.leewayMs >= token.expiresAt
  }
}
