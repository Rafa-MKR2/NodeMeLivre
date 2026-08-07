import { ApiError, ConfigurationError, OAuthError } from '@nodemelivre/errors'
import { HttpClient, type HttpClientOptions } from '@nodemelivre/http'
import { generateCodeChallenge, generateCodeVerifier, type PkceMethod } from './pkce.js'
import type { OAuthStateEntry, OAuthStateStore } from './state.js'
import type { AccessToken } from './token.js'

const TOKEN_PATH = '/oauth/token'
const DEFAULT_SITE_ID = 'MLB'
const PKCE_TTL_MS = 10 * 60 * 1000 // mesma janela dos states

/** Domínios de autorização por site. Brasil usa mercadolivre, os demais mercadolibre. */
const AUTH_DOMAINS: Record<string, string> = {
  MLB: 'auth.mercadolivre.com.br',
  MLA: 'auth.mercadolibre.com.ar',
  MLM: 'auth.mercadolibre.com.mx',
  MLC: 'auth.mercadolibre.cl',
  MCO: 'auth.mercadolibre.com.co',
  MLU: 'auth.mercadolibre.com.uy',
  MLV: 'auth.mercadolibre.com.ve',
  MPE: 'auth.mercadolibre.com.pe',
  MEC: 'auth.mercadolibre.com.ec',
  MCR: 'auth.mercadolibre.co.cr',
  MPA: 'auth.mercadolibre.com.pa',
  MGT: 'auth.mercadolibre.com.gt',
  MDO: 'auth.mercadolibre.com.do',
  MBO: 'auth.mercadolibre.com.bo',
  MPY: 'auth.mercadolibre.com.py',
  MHN: 'auth.mercadolibre.com.hn',
  MSV: 'auth.mercadolibre.com.sv',
  MNI: 'auth.mercadolibre.com.ni',
}

export interface OAuthOptions {
  clientId: string
  clientSecret: string
  /** Site do vendedor (ex.: MLB, MLA). Determina o domínio de autorização. */
  siteId?: string
  baseUrl?: string
  /** Fetch injetável usado nas chamadas de token. */
  fetchImpl?: typeof fetch
  /** Client HTTP usado apenas nas chamadas de token (sem Authorization). */
  httpClient?: HttpClient
  /**
   * Store de estados OAuth para proteção CSRF. Quando configurado,
   * `authorizationUrl` gera/armazena o `state` automaticamente e
   * `consumeState` valida o state recebido no callback.
   */
  stateStore?: OAuthStateStore
  /**
   * Habilita PKCE (RFC 7636) no fluxo `authorization_code`.
   *
   * A partir de 2025/2026 o Mercado Livre exige `code_verifier` para
   * aplicações com o fluxo PKCE habilitado — sem ele a troca do code falha
   * com `invalid_request`. Padrão: desabilitado (compatível com apps antigos).
   */
  pkce?: boolean | { method?: PkceMethod }
}

export interface AuthorizationUrlOptions {
  redirectUri: string
  /** Valor anti-CSRF que volta intacto no redirect. Padrão: gerado e armazenado no `stateStore`. */
  state?: string
  /** Dados extras associados ao state (ex.: página para redirecionar após o login). */
  metadata?: Record<string, unknown>
}

export interface TokenGrantOptions {
  redirectUri?: string
  /**
   * State usado na autorização — necessário para o SDK recuperar o
   * `code_verifier` gerado (PKCE). Pode ser omitido quando `codeVerifier`
   * é passado explicitamente ou quando o fluxo PKCE está desabilitado.
   */
  state?: string
  /** Code verifier explícito (quando o chamador gerencia o próprio PKCE). */
  codeVerifier?: string
}

/** Resposta crua do endpoint /oauth/token. */
interface OAuthTokenResponse {
  access_token: string
  token_type: string
  expires_in: number
  scope: string
  user_id?: number
  refresh_token?: string
}

interface StoredCodeVerifier {
  verifier: string
  createdAt: number
}

/**
 * Cliente OAuth2 do Mercado Livre.
 *
 * Fluxos suportados:
 * - authorization_code (vendedor autoriza no navegador)
 * - refresh_token (renova sem nova autorização)
 * - client_credentials (token da aplicação, sem usuário)
 */
export class OAuthClient {
  private readonly clientId: string
  private readonly clientSecret: string
  private readonly siteId: string
  private readonly httpClient: HttpClient
  private readonly pkceEnabled: boolean
  private readonly pkceMethod: PkceMethod
  private readonly codeVerifiers = new Map<string, StoredCodeVerifier>()
  readonly stateStore: OAuthStateStore | undefined

  constructor(options: OAuthOptions) {
    if (!options.clientId || !options.clientSecret) {
      throw new ConfigurationError(
        'OAuth não configurado. Defina clientId e clientSecret (ML_CLIENT_ID e ML_CLIENT_SECRET).',
      )
    }
    this.clientId = options.clientId
    this.clientSecret = options.clientSecret
    this.siteId = options.siteId ?? DEFAULT_SITE_ID
    this.httpClient = options.httpClient ?? buildTokenClient(options)
    this.stateStore = options.stateStore
    const pkce = options.pkce ?? false
    this.pkceEnabled = pkce === true || (typeof pkce === 'object' && pkce !== null)
    this.pkceMethod =
      typeof pkce === 'object' && pkce !== null && pkce.method !== undefined ? pkce.method : 'S256'
  }

  /** URL para redirecionar o vendedor ao navegador de autorização do Mercado Livre. */
  authorizationUrl(options: AuthorizationUrlOptions): string {
    const url = new URL(`https://${authDomain(this.siteId)}/authorization`)
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('client_id', this.clientId)
    url.searchParams.set('redirect_uri', options.redirectUri)

    const state = this.resolveState(options)
    if (state !== undefined) {
      url.searchParams.set('state', state)
    }

    if (this.pkceEnabled) {
      const verifier = generateCodeVerifier()
      url.searchParams.set('code_challenge', generateCodeChallenge(verifier, this.pkceMethod))
      url.searchParams.set('code_challenge_method', this.pkceMethod)
      if (state !== undefined) {
        this.codeVerifiers.set(state, { verifier, createdAt: Date.now() })
      }
    }
    return url.toString()
  }

  /**
   * Valida e consome um `state` recebido no callback OAuth (proteção CSRF).
   * Retorna os dados armazenados (redirectUri/metadata) se válido, ou `null`
   * se não houver `stateStore` configurado, o state for inexistente/expirado
   * ou já tiver sido consumido.
   */
  consumeState(state: string): OAuthStateEntry | null {
    return this.stateStore?.consume(state) ?? null
  }

  /** Code verifier ativo para um state (PKCE), se ainda não expirado. */
  getCodeVerifier(state: string): string | undefined {
    const stored = this.codeVerifiers.get(state)
    if (stored === undefined) return undefined
    if (Date.now() - stored.createdAt > PKCE_TTL_MS) {
      this.codeVerifiers.delete(state)
      return undefined
    }
    return stored.verifier
  }

  private resolveState(options: AuthorizationUrlOptions): string | undefined {
    if (this.stateStore === undefined) return options.state
    if (options.state !== undefined) {
      this.stateStore.register(options.state, options.redirectUri, options.metadata)
      return options.state
    }
    return this.stateStore.create(options.redirectUri, options.metadata)
  }

  /** Troca o código de autorização por um AccessToken. */
  async exchangeCode(code: string, options: TokenGrantOptions): Promise<AccessToken> {
    const body: Record<string, string | undefined> = {
      grant_type: 'authorization_code',
      client_id: this.clientId,
      client_secret: this.clientSecret,
      code,
      redirect_uri: options.redirectUri,
    }
    if (this.pkceEnabled) {
      const verifier =
        options.codeVerifier ??
        (options.state !== undefined ? this.getCodeVerifier(options.state) : undefined)
      if (verifier !== undefined) body.code_verifier = verifier
    }
    return this.tokenRequest(body)
  }

  /** Renova o token usando o refresh_token. */
  async refresh(refreshToken: string): Promise<AccessToken> {
    const body = {
      grant_type: 'refresh_token',
      client_id: this.clientId,
      client_secret: this.clientSecret,
      refresh_token: refreshToken,
    }
    return this.tokenRequest(body)
  }

  /** Token da aplicação (client_credentials) — sem vínculo com vendedor. */
  async getAppToken(scope?: string): Promise<AccessToken> {
    const body: Record<string, string> = {
      grant_type: 'client_credentials',
      client_id: this.clientId,
      client_secret: this.clientSecret,
    }
    if (scope !== undefined) body.scope = scope
    return this.tokenRequest(body)
  }

  private async tokenRequest(body: Record<string, string | undefined>): Promise<AccessToken> {
    const payload: Record<string, string> = {}
    for (const [key, value] of Object.entries(body)) {
      if (value !== undefined) payload[key] = value
    }
    try {
      const response = await this.httpClient.post<OAuthTokenResponse>(TOKEN_PATH, payload, {
        auth: false,
        retry: false,
      })
      return toAccessToken(response)
    } catch (error) {
      if (error instanceof ApiError && isOAuthErrorBody(error.body)) {
        throw new OAuthError(error.body.error, error.body.error_description ?? error.body.message)
      }
      throw error
    }
  }
}

function authDomain(siteId: string): string {
  return AUTH_DOMAINS[siteId] ?? 'auth.mercadolibre.com'
}

function buildTokenClient(options: OAuthOptions): HttpClient {
  const httpOptions: HttpClientOptions = {}
  if (options.baseUrl !== undefined) httpOptions.baseUrl = options.baseUrl
  if (options.fetchImpl !== undefined) httpOptions.fetchImpl = options.fetchImpl
  return new HttpClient(httpOptions)
}

function toAccessToken(response: OAuthTokenResponse): AccessToken {
  const expiresAt = Date.now() + response.expires_in * 1000
  const token: AccessToken = {
    accessToken: response.access_token,
    tokenType: 'bearer',
    scope: response.scope,
    userId: response.user_id ?? 0,
    expiresAt,
  }
  if (response.refresh_token !== undefined) {
    token.refreshToken = response.refresh_token
  }
  return token
}

function isOAuthErrorBody(
  body: unknown,
): body is { error: string; error_description?: string; message?: string } {
  if (typeof body !== 'object' || body === null) return false
  const record = body as Record<string, unknown>
  return typeof record.error === 'string'
}
