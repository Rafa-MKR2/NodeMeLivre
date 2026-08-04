import { OAuthClient, type OAuthOptions } from './auth/oauth.js'
import { TokenManager, type TokenManagerOptions } from './auth/refresh.js'
import { type AccessToken, InMemoryTokenStore, type TokenStore } from './auth/token.js'
import { HttpClient, type HttpClientOptions } from './http/client.js'
import { RateLimiter } from './http/rate-limit.js'
import type { RetryOptions } from './http/retry.js'
import type { Logger } from './logger.js'
import { Items } from './resources/items.js'
import { Orders } from './resources/orders.js'
import { Questions } from './resources/questions.js'
import { Shipments } from './resources/shipments.js'
import { Users } from './resources/users.js'

export interface MercadoLivreOptions {
  /** App ID da aplicação no Mercado Livre. */
  clientId: string
  /** Secret Key da aplicação no Mercado Livre. */
  clientSecret: string
  /** Site do vendedor (ex.: MLB, MLA). Determina o domínio de autorização. */
  siteId?: string
  /** Base URL da API. Padrão: `https://api.mercadolibre.com`. */
  baseUrl?: string
  /** Onde persistir o token. Padrão: em memória. */
  tokenStore?: TokenStore
  /** Controle de rate limit por recurso. Padrão: instância nova. */
  rateLimiter?: RateLimiter
  /** Fetch injetável (útil em testes). */
  fetchImpl?: typeof fetch
  /** Passar `false` desativa retry. */
  retry?: RetryOptions | false
  defaultTimeoutMs?: number
  logger?: Logger
}

/**
 * Ponto de entrada do SDK. Orquestra OAuth2, transporte HTTP (retry +
 * rate limit) e os resources tipados.
 *
 * ```ts
 * const ml = createMercadoLivre({ clientId, clientSecret, siteId: 'MLB' })
 * const item = await ml.items.get('MLB123')
 * ```
 */
export class MercadoLivre {
  readonly auth: OAuthClient
  readonly tokens: TokenManager
  readonly http: HttpClient

  readonly items: Items
  readonly orders: Orders
  readonly users: Users
  readonly shipments: Shipments
  readonly questions: Questions

  constructor(options: MercadoLivreOptions) {
    const oauthOptions: OAuthOptions = {
      clientId: options.clientId,
      clientSecret: options.clientSecret,
    }
    if (options.siteId !== undefined) oauthOptions.siteId = options.siteId
    if (options.baseUrl !== undefined) oauthOptions.baseUrl = options.baseUrl
    if (options.fetchImpl !== undefined) oauthOptions.fetchImpl = options.fetchImpl

    const tokenStore = options.tokenStore ?? new InMemoryTokenStore()
    this.auth = new OAuthClient(oauthOptions)

    const tokenManagerOptions: TokenManagerOptions = {
      oauth: this.auth,
      store: tokenStore,
    }
    if (options.logger !== undefined) {
      tokenManagerOptions.logger = options.logger
    }
    this.tokens = new TokenManager(tokenManagerOptions)

    const httpOptions: HttpClientOptions = {
      auth: this.tokens,
      rateLimiter: options.rateLimiter ?? new RateLimiter(),
    }
    if (options.baseUrl !== undefined) httpOptions.baseUrl = options.baseUrl
    if (options.defaultTimeoutMs !== undefined)
      httpOptions.defaultTimeoutMs = options.defaultTimeoutMs
    if (options.fetchImpl !== undefined) httpOptions.fetchImpl = options.fetchImpl
    if (options.logger !== undefined) httpOptions.logger = options.logger
    if (options.retry !== undefined) {
      httpOptions.retry = options.retry === false ? { maxRetries: 0 } : options.retry
    }

    this.http = new HttpClient(httpOptions)

    this.items = new Items(this.http)
    this.orders = new Orders(this.http)
    this.users = new Users(this.http)
    this.shipments = new Shipments(this.http)
    this.questions = new Questions(this.http)
  }

  /** URL para redirecionar o vendedor ao navegador de autorização. */
  authorizationUrl(redirectUri: string, state?: string): string {
    return this.auth.authorizationUrl(
      state === undefined ? { redirectUri } : { redirectUri, state },
    )
  }

  /** Troca o `code` recebido no redirect por um token e persiste na store. */
  async authenticate(redirectUri: string, code: string): Promise<AccessToken> {
    return this.tokens.saveAuthorizationCode(code, redirectUri)
  }
}

/** Factory que evita o `new` e facilita composição. */
export function createMercadoLivre(options: MercadoLivreOptions): MercadoLivre {
  return new MercadoLivre(options)
}

export type { AuthorizationUrlOptions, OAuthOptions, TokenGrantOptions } from './auth/oauth.js'
export type { TokenManagerOptions } from './auth/refresh.js'
// Re-export da API pública.
export type { AccessToken, TokenStore } from './auth/token.js'
export { FileTokenStore, InMemoryTokenStore } from './auth/token.js'
export * from './errors/index.js'
export type {
  HttpClientOptions,
  HttpClientRequest,
  HttpMethod,
  TokenProvider,
} from './http/client.js'
export { HttpClient, MERCADO_LIVRE_BASE_URL } from './http/client.js'
export type { RateLimitState } from './http/rate-limit.js'
export { RateLimiter } from './http/rate-limit.js'
export * from './http/retry.js'
export type { Logger } from './logger.js'
export type { ResourceRequest, ResourceTransport } from './resources/transport.js'
export * from './types/index.js'
export { MercadoLivre as default }
