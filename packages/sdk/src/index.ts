import {
  type AccessToken,
  type AuthorizationUrlOptions,
  InMemoryTokenStore,
  OAuthClient,
  type OAuthOptions,
  type OAuthStateEntry,
  type OAuthStateStore,
  type PkceMethod,
  TokenManager,
  type TokenManagerOptions,
  type TokenStore,
} from '@nodemelivre/auth'
import type { Logger } from '@nodemelivre/core'
import { ConfigurationError } from '@nodemelivre/errors'
import {
  HttpClient,
  type HttpClientOptions,
  RateLimiter,
  type RetryOptions,
} from '@nodemelivre/http'
import { Images } from '@nodemelivre/images'
import { Items } from '@nodemelivre/items'
import { Messages } from '@nodemelivre/messages'
import { Orders } from '@nodemelivre/orders'
import { Questions } from '@nodemelivre/questions'
import { Shipments } from '@nodemelivre/shipments'
import { Users } from '@nodemelivre/users'
import { Webhooks } from '@nodemelivre/webhooks'

export * from '@nodemelivre/auth'
export * from '@nodemelivre/core'
export * from '@nodemelivre/errors'
export * from '@nodemelivre/http'
export * from '@nodemelivre/images'
export * from '@nodemelivre/items'
export * from '@nodemelivre/messages'
export * from '@nodemelivre/orders'
export * from '@nodemelivre/questions'
export * from '@nodemelivre/shipments'
export * from '@nodemelivre/types'
export * from '@nodemelivre/users'
export * from '@nodemelivre/webhooks'

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
  /** Store de estados OAuth para proteção CSRF no fluxo de autorização. */
  stateStore?: OAuthStateStore
  /**
   * Habilita PKCE (RFC 7636) no fluxo OAuth2 — obrigatório para apps com o
   * fluxo PKCE habilitado no painel do Mercado Livre. Padrão: desabilitado.
   */
  pkce?: boolean | { method?: PkceMethod }
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
  readonly messages: Messages
  readonly orders: Orders
  readonly users: Users
  readonly shipments: Shipments
  readonly questions: Questions
  readonly images: Images
  readonly webhooks: Webhooks

  constructor(options: MercadoLivreOptions) {
    if (!options.clientId || !options.clientSecret) {
      throw new ConfigurationError('SDK não configurado. Defina ML_CLIENT_ID e ML_CLIENT_SECRET.')
    }

    const oauthOptions: OAuthOptions = {
      clientId: options.clientId,
      clientSecret: options.clientSecret,
    }
    if (options.siteId !== undefined) oauthOptions.siteId = options.siteId
    if (options.baseUrl !== undefined) oauthOptions.baseUrl = options.baseUrl
    if (options.fetchImpl !== undefined) oauthOptions.fetchImpl = options.fetchImpl
    if (options.stateStore !== undefined) oauthOptions.stateStore = options.stateStore
    if (options.pkce !== undefined) oauthOptions.pkce = options.pkce
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
    this.messages = new Messages(this.http)
    this.orders = new Orders(this.http)
    this.users = new Users(this.http)
    this.shipments = new Shipments(this.http)
    this.questions = new Questions(this.http)
    this.images = new Images(this.http)
    this.webhooks = new Webhooks()
  }

  /**
   * URL para redirecionar o vendedor ao navegador de autorização.
   * Com `stateStore` configurado, o `state` é gerado e armazenado
   * automaticamente (proteção CSRF).
   */
  authorizationUrl(
    redirectUri: string,
    state?: string,
    metadata?: Record<string, unknown>,
  ): string {
    const options: AuthorizationUrlOptions = { redirectUri }
    if (state !== undefined) options.state = state
    if (metadata !== undefined) options.metadata = metadata
    return this.auth.authorizationUrl(options)
  }

  /**
   * Valida e consome o `state` recebido no callback OAuth.
   * Retorna os dados armazenados ou `null` se inválido/consumido.
   */
  consumeState(state: string): OAuthStateEntry | null {
    return this.auth.consumeState(state)
  }

  /**
   * Troca o `code` recebido no redirect por um token e persiste na store.
   *
   * Com PKCE habilitado, informe o mesmo `state` usado em `authorizationUrl`
   * para o SDK recuperar o `code_verifier` correspondente (ou passe o
   * `codeVerifier` explicitamente).
   */
  async authenticate(
    redirectUri: string,
    code: string,
    state?: string,
    codeVerifier?: string,
  ): Promise<AccessToken> {
    return this.tokens.saveAuthorizationCode(code, redirectUri, state, codeVerifier)
  }
}

/** Factory que evita o `new` e facilita composição. */
export function createMercadoLivre(options: MercadoLivreOptions): MercadoLivre {
  return new MercadoLivre(options)
}

export { MercadoLivre as default }
