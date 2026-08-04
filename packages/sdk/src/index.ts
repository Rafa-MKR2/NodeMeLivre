import {
  type AccessToken,
  InMemoryTokenStore,
  OAuthClient,
  type OAuthOptions,
  TokenManager,
  type TokenManagerOptions,
  type TokenStore,
} from '@nodemelivre/auth'
import {
  HttpClient,
  type HttpClientOptions,
  type Logger,
  RateLimiter,
  type RetryOptions,
} from '@nodemelivre/core'
import { Items } from '@nodemelivre/items'
import { Orders } from '@nodemelivre/orders'
import { Questions } from '@nodemelivre/questions'
import { Shipments } from '@nodemelivre/shipments'
import { Users } from '@nodemelivre/users'

export * from '@nodemelivre/auth'
export * from '@nodemelivre/core'
export * from '@nodemelivre/items'
export * from '@nodemelivre/orders'
export * from '@nodemelivre/questions'
export * from '@nodemelivre/shipments'
export * from '@nodemelivre/types'
export * from '@nodemelivre/users'

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
    this.auth = new OAuthClient(oauthOptions)

    const tokenStore = options.tokenStore ?? new InMemoryTokenStore()
    const tokenManagerOptions: TokenManagerOptions = {
      oauth: this.auth,
      store: tokenStore,
    }
    if (options.logger !== undefined) tokenManagerOptions.logger = options.logger
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

export { MercadoLivre as default }
