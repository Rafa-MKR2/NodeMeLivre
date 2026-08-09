import { EventEmitter } from 'node:events'
import { type Logger, silentLogger } from '@nodemelivre/core'
import { ApiError, NetworkError, RateLimitError, toApiError } from '@nodemelivre/errors'
import { MAX_WAIT_MS, type RateLimiter, rateLimitKey } from './rate-limit.js'
import {
  DEFAULT_RETRY,
  defaultShouldRetry,
  exponentialBackoff,
  type RetryOptions,
} from './retry.js'
import { buildUrl, MAX_REDIRECTS, resolveRedirectTarget } from './url.js'
export const MERCADO_LIVRE_BASE_URL = 'https://api.mercadolibre.com'

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD'

/** Eventos emitidos pelo HttpClient. */
export interface HttpClientEvents {
  /** Emitido antes de enviar a requisição. */
  request: [request: HttpClientRequest]
  /** Emitido ao receber resposta (sucesso ou erro). */
  response: [response: Response, request: HttpClientRequest]
  /** Emitido quando uma tentativa de retry vai ocorrer. */
  retry: [attempt: number, error: unknown, request: HttpClientRequest]
  /** Emitido quando ocorre um erro (rede ou API). */
  httpError: [error: Error, request: HttpClientRequest]
  /** Emitido quando rate limit é atingido e aguarda. */
  rateLimit: [resetAt: number, request: HttpClientRequest]
}

/** Fonte de token para autenticação das requisições. */
export interface TokenProvider {
  getToken(): Promise<string | undefined>
  /** Renova o token em uso (chamado pelo client ao receber 401). */
  refresh?(): Promise<void>
}

export interface HttpClientRequest {
  method?: HttpMethod
  /** Caminho relativo ao baseUrl, ex.: `/items/MLB123` */
  path: string
  /** Query params; valores `undefined` são ignorados. */
  query?: Record<string, string | number | boolean | undefined>
  /** Body serializado como JSON. */
  body?: unknown
  headers?: Record<string, string>
  timeoutMs?: number
  signal?: AbortSignal
  /** Envia o token de autenticação (padrão: true). */
  auth?: boolean
  /** Aplica retry (padrão: true). */
  retry?: boolean
  /** Formato esperado do corpo da resposta. Padrão: `json`. */
  responseType?: 'json' | 'text' | 'arraybuffer'
}

export interface HttpClientOptions {
  baseUrl?: string
  defaultTimeoutMs?: number
  /** Fetch injetável — útil para testes. Padrão: fetch global. */
  fetchImpl?: typeof fetch
  retry?: RetryOptions
  /** Provedor de token para o header Authorization. */
  auth?: TokenProvider
  rateLimiter?: RateLimiter
  logger?: Logger
  defaultHeaders?: Record<string, string>
  /** Sleep injetável para backoff — útil para testes. */
  delay?: (ms: number) => Promise<void>
}

const JSON_CONTENT_TYPE = 'application/json'

export class HttpClient extends EventEmitter<HttpClientEvents> {
  private readonly baseUrl: string
  private readonly defaultTimeoutMs: number
  private readonly defaultHeaders: Record<string, string>
  private readonly fetchImpl: typeof fetch
  private readonly logger: Logger
  private readonly delay: (ms: number) => Promise<void>
  private readonly retry: Required<RetryOptions>
  private readonly auth: TokenProvider | undefined
  private readonly rateLimiter: RateLimiter | undefined

  constructor(options: HttpClientOptions = {}) {
    super()
    this.baseUrl = options.baseUrl ?? MERCADO_LIVRE_BASE_URL
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? 30_000
    this.defaultHeaders = { ...options.defaultHeaders }
    this.fetchImpl = options.fetchImpl ?? fetch
    this.logger = options.logger ?? silentLogger
    this.delay = options.delay ?? ((ms) => new Promise((r) => setTimeout(r, ms)))
    this.retry = { ...DEFAULT_RETRY, ...options.retry }
    this.auth = options.auth
    this.rateLimiter = options.rateLimiter
  }

  async get<T>(path: string, request: Omit<HttpClientRequest, 'path' | 'method'> = {}): Promise<T> {
    return this.request<T>({ ...request, path, method: 'GET' })
  }

  async post<T>(
    path: string,
    body?: unknown,
    request: Omit<HttpClientRequest, 'path' | 'method' | 'body'> = {},
  ): Promise<T> {
    return this.request<T>({ ...request, path, method: 'POST', body })
  }

  async put<T>(
    path: string,
    body?: unknown,
    request: Omit<HttpClientRequest, 'path' | 'method' | 'body'> = {},
  ): Promise<T> {
    return this.request<T>({ ...request, path, method: 'PUT', body })
  }

  async patch<T>(
    path: string,
    body?: unknown,
    request: Omit<HttpClientRequest, 'path' | 'method' | 'body'> = {},
  ): Promise<T> {
    return this.request<T>({ ...request, path, method: 'PATCH', body })
  }

  async delete<T>(
    path: string,
    request: Omit<HttpClientRequest, 'path' | 'method'> = {},
  ): Promise<T> {
    return this.request<T>({ ...request, path, method: 'DELETE' })
  }

  async request<T>(request: HttpClientRequest): Promise<T> {
    const method = request.method ?? 'GET'
    const url = buildUrl(this.baseUrl, request.path, request.query)
    // O orçamento de retry é EXATAMENTE `maxRetries` (ou 1, se desativado).
    // A retentativa pós-refresh (401) é gratuita: o `maxAttempts += 1` só
    // acontece quando o refresh realmente ocorre. Antes, um `refreshSlots`
    // fixo somava 1 ao orçamento de TODA requisição autenticada — o que
    // violava `retry: false` e `maxRetries: N` (um POST não-idempotente
    // ganhava um reenvio extra em 5xx/429) (F1, pente fino).
    let maxAttempts = request.retry === false ? 1 : this.retry.maxRetries + 1

    let token: string | undefined
    if (request.auth !== false && this.auth !== undefined) {
      token = await this.auth.getToken()
    }
    let headers = this.buildHeaders(request.headers, token)
    let refreshed = false
    let lastError: ApiError | undefined

    // Emit request event
    this.emit('request', request)

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (this.rateLimiter !== undefined) {
        const key = rateLimitKey(method, request.path)
        const state = this.rateLimiter.stateOf(key)
        if (
          state?.remaining !== undefined &&
          state.remaining === 0 &&
          state.resetAt !== undefined
        ) {
          this.emit('rateLimit', state.resetAt, request)
        }
        await this.rateLimiter.waitIfNeeded(key)
      }

      let response: Response
      try {
        response = await this.performFetch(
          url,
          method,
          headers,
          request.body,
          request.timeoutMs,
          request.signal,
        )
      } catch (error) {
        this.logger.debug({ err: error, url: url.toString() }, 'falha de rede')
        // Cancelamento do usuário (AbortSignal) NÃO é falha de rede: não
        // retenta e propaga um AbortError (mesmo contrato do `paginate`) —
        // antes, abort virava NetworkError e ainda era retentado quando o
        // fetch rejeitava com Error simples (F2, pente fino).
        if (request.signal?.aborted === true) {
          throw toAbortError(request.signal, error)
        }
        const networkError = new NetworkError('Falha ao comunicar com o Mercado Livre', error)
        this.emit('httpError', networkError, request)
        if (
          attempt < maxAttempts - 1 &&
          defaultShouldRetry({ attempt, method, status: undefined, error })
        ) {
          this.emit('retry', attempt, networkError, request)
          await this.delay(exponentialBackoff(attempt, this.retry))
          continue
        }
        throw networkError
      }

      if (this.rateLimiter !== undefined) {
        this.rateLimiter.update(rateLimitKey(method, request.path), response.headers)
      }

      // Emit response event for all responses. O4 (Rodada 8): emite um CLONE —
      // um listener que leia o body da `Response` recebida não pode quebrar o
      // parse do SDK (a original continua íntegra para `parseBody`).
      this.emit('response', response.clone(), request)

      if (response.ok) {
        return (await parseBody(response, request.responseType)) as T
      }

      const body = await tryReadBody(response)
      const apiError = toApiError(response.status, body, response.headers)
      lastError = apiError
      this.logger.debug({ err: apiError, url: url.toString() }, 'erro da api')
      this.emit('httpError', apiError, request)

      // 401 com refresh disponível (e auth habilitado para esta requisição):
      // renova o token e tenta de novo uma única vez. O `maxAttempts += 1`
      // dá a essa tentativa um slot GRATUITO (não consome o orçamento de
      // retry de status/5xx/429). Com `auth: false`, nenhum token foi anexado
      // — um 401 não deve disparar refresh nem retentativa (F8, pente fino).
      if (
        apiError.status === 401 &&
        !refreshed &&
        request.auth !== false &&
        this.auth?.refresh !== undefined
      ) {
        try {
          await this.auth.refresh()
          const fresh = await this.auth.getToken()
          if (fresh !== undefined) {
            headers = this.buildHeaders(request.headers, fresh)
            refreshed = true
            maxAttempts += 1
            continue
          }
        } catch (error) {
          // O refresh falhou (ex.: refresh_token rotacionado/invalidado): o
          // erro do refresh NÃO substitui o erro tipado do 401 original — o
          // chamador mantém status/body/requestId (contrato de erro da Rodada
          // 3) em vez de receber um erro cru fora da hierarquia (M4, pente fino).
          this.logger.warn({ err: error, url: url.toString() }, 'refresh do token falhou')
          throw lastError ?? apiError
        }
      }

      if (
        attempt < maxAttempts - 1 &&
        defaultShouldRetry({ attempt, method, status: apiError.status, error: apiError })
      ) {
        this.emit('retry', attempt, apiError, request)
        await this.delay(this.backoffDelay(attempt, apiError))
        continue
      }

      throw apiError
    }

    // Nunca deve chegar aqui sem um erro real: quando o loop se esgota via
    // `continue` (ex.: refresh de token no último attempt), re-lançamos o
    // último erro da API em vez de um erro sintético.
    throw lastError ?? new ApiError({ message: 'Número máximo de tentativas excedido', status: 0 })
  }

  private buildHeaders(headers: Record<string, string> | undefined, token?: string): Headers {
    const merged = new Headers(this.defaultHeaders)
    for (const [name, value] of Object.entries(headers ?? {})) {
      merged.set(name, value)
    }
    if (token !== undefined) {
      merged.set('Authorization', `Bearer ${token}`)
    }
    return merged
  }

  private async performFetch(
    url: URL,
    method: HttpMethod,
    headers: Headers,
    body: unknown,
    timeoutMs: number | undefined,
    signal: AbortSignal | undefined,
  ): Promise<Response> {
    // Redirecionamentos NÃO são seguidos cegamente pelo fetch: cada hop é
    // resolvido e validado manualmente (mesmo host/família autorizada e
    // sem downgrade https→http) — um `Location` malicioso não consegue
    // levar o token para outro destino.
    let currentUrl = url
    let currentMethod = method
    let currentHeaders = headers
    let currentBody = body

    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const init = this.buildFetchInit(
        currentMethod,
        currentHeaders,
        currentBody,
        timeoutMs,
        signal,
      )
      const response = await this.fetchImpl(currentUrl, init)

      if (!isRedirectStatus(response.status)) return response

      const location = response.headers.get('location')
      if (location === null) {
        throw new NetworkError('Redirecionamento sem header Location', undefined)
      }
      const next = resolveRedirectTarget(currentUrl, location)
      if (next === null) {
        throw new NetworkError(
          `Redirecionamento bloqueado: destino não autorizado (${location})`,
          undefined,
        )
      }

      // Redirect cross-origin não carrega o Authorization (spec do fetch): o
      // token só vale para o origin original da requisição — um `Location`
      // para outro host autorizado (ex.: api.mercadolivre.com.br vindo de
      // api.mercadolibre.com, ou subdomínio de um baseUrl próprio) não deve
      // receber o Bearer do integrador.
      if (next.origin !== url.origin && currentHeaders.has('authorization')) {
        const fresh = new Headers(currentHeaders)
        fresh.delete('authorization')
        currentHeaders = fresh
      }

      // 303 sempre vira GET; 301/302 em POST vira GET (spec do fetch).
      // HEAD é preservado em 303; 307/308 preservam método e corpo.
      if (
        currentMethod !== 'GET' &&
        currentMethod !== 'HEAD' &&
        (response.status === 303 || response.status === 301 || response.status === 302)
      ) {
        currentMethod = 'GET'
        currentBody = undefined
        const fresh = new Headers(currentHeaders)
        fresh.delete('content-type')
        fresh.delete('content-length')
        currentHeaders = fresh
      }
      currentUrl = next
    }

    throw new NetworkError(
      `Número máximo de redirecionamentos excedido (${MAX_REDIRECTS})`,
      undefined,
    )
  }

  private buildFetchInit(
    method: HttpMethod,
    headers: Headers,
    body: unknown,
    timeoutMs: number | undefined,
    signal: AbortSignal | undefined,
  ): RequestInit {
    const init: RequestInit = { method, headers, redirect: 'manual' }

    if (body !== undefined) {
      if (isBodyInit(body)) {
        init.body = body as NonNullable<RequestInit['body']>
      } else {
        init.body = JSON.stringify(body)
        if (!headers.has('content-type')) {
          headers.set('content-type', JSON_CONTENT_TYPE)
        }
      }
    }

    const timeout = timeoutMs ?? this.defaultTimeoutMs
    const signals: AbortSignal[] = []
    if (signal !== undefined) signals.push(signal)
    if (timeout > 0) signals.push(AbortSignal.timeout(timeout))
    const single = signals[0]
    if (signals.length === 1 && single !== undefined) {
      init.signal = single
    } else if (signals.length > 1) {
      init.signal = AbortSignal.any(signals)
    }

    return init
  }

  private backoffDelay(attempt: number, error: ApiError): number {
    if (error instanceof RateLimitError && error.retryAfterSeconds !== undefined) {
      // Teto na espera por Retry-After: um header corrompido/gateway com valor
      // no futuro distante faria o SDK dormir dias (mesmo DoS de espera que o
      // `MAX_WAIT_MS` do RateLimiter fecha — Rodada 5; aqui no caminho de retry).
      return Math.min(error.retryAfterSeconds * 1000, MAX_WAIT_MS)
    }
    return exponentialBackoff(attempt, this.retry)
  }
}

function isRedirectStatus(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308
}

/**
 * Erro tipado para cancelamento do usuário (F2, pente fino).
 *
 * Preserva o `AbortSignal.reason` quando já for um AbortError (DOMException
 * padrão) e, nos shims de fetch que rejeitam com Error simples, devolve um
 * `Error` com `name === 'AbortError'` — o padrão `e.name === 'AbortError'`
 * do chamador continua funcionando (mesmo contrato do `paginate`).
 */
function toAbortError(signal: AbortSignal, error: unknown): Error {
  const reason = signal.reason
  if (reason instanceof Error && reason.name === 'AbortError') return reason
  if (error instanceof Error && error.name === 'AbortError') return error
  const abortError = new Error('Requisição abortada pelo usuário')
  abortError.name = 'AbortError'
  return abortError
}

async function parseBody(
  response: Response,
  responseType: HttpClientRequest['responseType'] = 'json',
): Promise<unknown> {
  if (response.status === 204) return undefined
  if (responseType === 'arraybuffer') return response.arrayBuffer()
  if (responseType === 'text') return response.text()
  const text = await response.text()
  if (text === '') return undefined
  const parsed = tryParseJson(text)
  // Sentinel: `null` (JSON literal) é um corpo válido e deve chegar como
  // `null` ao chamador — `parsed ?? text` converteria `null` em "null"
  // (string) quebrando o contrato `T` (Rodada 9 da auditoria).
  return parsed.failed ? text : parsed.value
}

async function tryReadBody(response: Response): Promise<unknown> {
  const text = await response.text()
  if (text === '') return undefined
  const parsed = tryParseJson(text)
  return parsed.failed ? text : parsed.value
}

/** Resultado do parse JSON: `{ failed: true }` ou `{ failed: false, value }`. */
function tryParseJson(text: string): { failed: boolean; value?: unknown } {
  try {
    return { failed: false, value: JSON.parse(text) as unknown }
  } catch {
    return { failed: true }
  }
}

function isBodyInit(body: unknown): boolean {
  return (
    typeof body === 'string' ||
    body instanceof Blob ||
    body instanceof FormData ||
    body instanceof URLSearchParams ||
    body instanceof ArrayBuffer ||
    ArrayBuffer.isView(body)
  )
}
