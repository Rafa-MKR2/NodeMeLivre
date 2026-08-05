import { EventEmitter } from 'node:events'
import { type Logger, silentLogger } from '@nodemelivre/core'
import { ApiError, NetworkError, RateLimitError, toApiError } from '@nodemelivre/errors'
import type { RateLimiter } from './rate-limit.js'
import {
  DEFAULT_RETRY,
  defaultShouldRetry,
  exponentialBackoff,
  type RetryOptions,
} from './retry.js'
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
    this.defaultHeaders = options.defaultHeaders ?? {}
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
    const maxAttempts = request.retry === false ? 1 : this.retry.maxRetries + 1

    let token: string | undefined
    if (request.auth !== false && this.auth !== undefined) {
      token = await this.auth.getToken()
    }
    let headers = this.buildHeaders(request.headers, token)
    let refreshed = false

    // Emit request event
    this.emit('request', request)

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (this.rateLimiter !== undefined) {
        const state = this.rateLimiter.stateOf(request.path)
        if (
          state?.remaining !== undefined &&
          state.remaining === 0 &&
          state.resetAt !== undefined
        ) {
          this.emit('rateLimit', state.resetAt, request)
        }
        await this.rateLimiter.waitIfNeeded(request.path)
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
        this.rateLimiter.update(request.path, response.headers)
      }

      // Emit response event for all responses
      this.emit('response', response, request)

      if (response.ok) {
        return (await parseBody(response, request.responseType)) as T
      }

      const body = await tryReadBody(response)
      const apiError = toApiError(response.status, body, response.headers)
      this.logger.debug({ err: apiError, url: url.toString() }, 'erro da api')
      this.emit('httpError', apiError, request)

      // 401 com refresh disponível: renova o token e tenta de novo uma única vez.
      if (apiError.status === 401 && !refreshed && this.auth?.refresh !== undefined) {
        await this.auth.refresh()
        const fresh = await this.auth.getToken()
        if (fresh !== undefined) {
          headers = this.buildHeaders(request.headers, fresh)
          refreshed = true
          continue
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

    throw new ApiError({
      message: 'Número máximo de tentativas excedido',
      status: 0,
    })
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
    const init: RequestInit = { method, headers }

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

    return this.fetchImpl(url, init)
  }

  private backoffDelay(attempt: number, error: ApiError): number {
    if (error instanceof RateLimitError && error.retryAfterSeconds !== undefined) {
      return error.retryAfterSeconds * 1000
    }
    return exponentialBackoff(attempt, this.retry)
  }

  async getBearerToken(): Promise<string | undefined> {
    return this.auth?.getToken()
  }
}

function buildUrl(baseUrl: string, path: string, query: HttpClientRequest['query']): URL {
  const url = new URL(path, baseUrl)
  for (const [name, value] of Object.entries(query ?? {})) {
    if (value !== undefined) {
      url.searchParams.set(name, String(value))
    }
  }
  return url
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
  return tryParseJson(text) ?? text
}

async function tryReadBody(response: Response): Promise<unknown> {
  const text = await response.text()
  if (text === '') return undefined
  return tryParseJson(text) ?? text
}

function tryParseJson(text: string): unknown | undefined {
  try {
    return JSON.parse(text) as unknown
  } catch {
    return undefined
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
