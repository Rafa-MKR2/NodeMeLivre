import { randomBytes } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { type Logger, silentLogger } from '@nodemelivre/core'
import { OAuthError } from '@nodemelivre/errors'
import type { TokenProvider } from '@nodemelivre/http'
import type { OAuthClient } from './oauth.js'
import type { AccessToken, TokenStore, VersionedToken } from './token.js'

export interface TokenManagerEvents {
  /** Emitido quando o token é renovado com sucesso. */
  tokenRefreshed: [token: AccessToken]
}

export interface TokenManagerOptions {
  oauth: OAuthClient
  store: TokenStore
  /** Janela de segurança em ms antes da expiração para renovar (padrão: 60s). */
  leewayMs?: number
  /** Clock injetável para testes. */
  clock?: () => number
  logger?: Logger
  /** ID único desta instância para lease distribuído (padrão: aleatório). */
  instanceId?: string
}

const DEFAULT_LEEWAY_MS = 60_000
const LEASE_TTL_MS = 30_000 // 30s para lease de refresh

/**
 * Gerencia o ciclo de vida do token: resolve o token atual, renova
 * automaticamente antes de expirar e após um 401. É o `TokenProvider`
 * que o HttpClient usa para montar o header Authorization.
 *
 * v2: Usa compareAndSet para atomicidade e lease distribuído para
 * prevenir refreshes concorrentes em multi-instância.
 */
export class TokenManager extends EventEmitter<TokenManagerEvents> implements TokenProvider {
  private readonly oauth: OAuthClient
  private readonly store: TokenStore
  private readonly leewayMs: number
  private readonly clock: () => number
  private readonly logger: Logger
  private readonly instanceId: string
  private refreshing: Promise<void> | null = null

  constructor(options: TokenManagerOptions) {
    super()
    this.oauth = options.oauth
    this.store = options.store
    this.leewayMs = options.leewayMs ?? DEFAULT_LEEWAY_MS
    this.clock = options.clock ?? Date.now
    this.logger = options.logger ?? silentLogger
    this.instanceId = options.instanceId ?? `tm-${randomInstanceId()}`
  }

  /** Token atual, renovando antes de expirar se necessário. */
  async getToken(): Promise<string | undefined> {
    const token = await this.store.get()
    if (token === null) return undefined
    if (this.isExpiring(token)) {
      // Sem refresh_token (ex.: client_credentials, sessão sem offline_access)
      // não há como renovar — mas o token AINDA É VÁLIDO por até `leewayMs`:
      // devolvê-lo aproveita as últimas requisições em vez de derrubá-las com
      // `missing_refresh_token` (M2, pente fino). Já expirado de verdade, o
      // refresh é tentado e o erro claro (`OAuthError`) é quem se propaga.
      if (token.refreshToken === undefined && this.clock() < token.expiresAt) {
        return token.accessToken
      }
      await this.refresh()
      return (await this.store.get())?.accessToken
    }
    return token.accessToken
  }

  /** Persiste o resultado da troca do authorization_code. */
  async saveAuthorizationCode(
    code: string,
    redirectUri: string,
    state?: string,
    codeVerifier?: string,
  ): Promise<AccessToken> {
    const grant: { redirectUri: string; state?: string; codeVerifier?: string } = { redirectUri }
    if (state !== undefined) grant.state = state
    if (codeVerifier !== undefined) grant.codeVerifier = codeVerifier
    const token = await this.oauth.exchangeCode(code, grant)
    // Re-autenticação substitui o token anterior (novo login é sempre mais
    // novo que qualquer refresh concorrente). Lê a versão atual e faz
    // compare-and-set atômico; em conflito (outra escrita no meio), força a
    // sobrescrita uma única vez — o token recém-trocado não pode ser perdido.
    const current = await this.store.getWithVersion()
    const expected = current?.version ?? 0
    const newVersion = await this.store.compareAndSet(token, expected)
    if (newVersion === null) {
      await this.store.compareAndSet(token, null)
    }
    return token
  }

  /** Renova o token usando o refresh_token persistido. Deduplica chamadas concorrentes + lease distribuído. */
  async refresh(): Promise<void> {
    // Deduplicação local (mesmo processo)
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

  /** Token completo com metadados de versão (para debug/inspeção). */
  async currentWithVersion(): Promise<VersionedToken | null> {
    return this.store.getWithVersion()
  }

  /** Descarta o token armazenado. */
  async clear(): Promise<void> {
    await this.store.clear()
  }

  private async doRefresh(): Promise<void> {
    // Tenta adquirir lease distribuído
    const leaseResult = await this.store.acquireLease({
      holderId: this.instanceId,
      ttlMs: LEASE_TTL_MS,
    })

    if (!leaseResult.acquired) {
      // Outra instância tem o lease - aguarda ela terminar
      this.logger.debug(
        { holderId: this.instanceId, leaseExpiresAt: leaseResult.leaseExpiresAt },
        'lease de refresh ocupado por outra instância, aguardando...',
      )
      await this.waitForLeaseRelease(leaseResult.leaseExpiresAt ?? 0)
      // Após espera, o token deve ter sido atualizado pela outra instância
      return
    }

    try {
      // Lê token atual com versão para compareAndSet
      const versioned = await this.store.getWithVersion()
      if (!versioned?.token?.refreshToken) {
        throw new OAuthError(
          'missing_refresh_token',
          'Não há refresh_token armazenado para renovar a sessão',
        )
      }

      this.logger.debug({ userId: versioned.token.userId }, 'renovando token de acesso')
      const fresh = await this.oauth.refresh(versioned.token.refreshToken)

      // Atualiza atomicamente com compareAndSet
      const newVersion = await this.store.compareAndSet(fresh, versioned.version)
      if (newVersion === null) {
        // Conflito de versão - outra instância atualizou entre getWithVersion e compareAndSet
        // Recupera o token atualizado
        const updated = await this.store.getWithVersion()
        if (updated) {
          this.emit('tokenRefreshed', updated.token)
        }
        return
      }

      this.emit('tokenRefreshed', fresh)
    } finally {
      // Sempre libera o lease ao finalizar (sucesso ou erro)
      await this.store.releaseLease(this.instanceId)
    }
  }

  private async waitForLeaseRelease(leaseExpiresAt: number): Promise<void> {
    // O7 (Rodada 8): usa o clock injetado do TokenManager (e não Date.now) —
    // em testes com clock fake, o loop reagiria ao relógio avançado e não
    // divergiria do `expiresAt` calculado pelo store (que também usa clock).
    const maxWaitMs = 60_000 // máximo 60s
    const startWait = this.clock()
    while (this.clock() < leaseExpiresAt && this.clock() - startWait < maxWaitMs) {
      await new Promise((r) => setTimeout(r, 500))
      // Verifica se lease ainda existe
      const versioned = await this.store.getWithVersion()
      if (versioned && versioned.updatedAt > startWait) {
        // Token foi atualizado recentemente
        return
      }
    }
    // Timeout - continua mesmo assim (pode ser que a outra instância falhou)
  }

  private isExpiring(token: AccessToken): boolean {
    return this.clock() + this.leewayMs >= token.expiresAt
  }
}

function randomInstanceId(): string {
  // CSPRNG — o holderId do lease não pode ser previsível: com Math.random,
  // uma colisão entre instâncias liberaria leases cruzados (refresh duplo).
  return randomBytes(8).toString('hex')
}
