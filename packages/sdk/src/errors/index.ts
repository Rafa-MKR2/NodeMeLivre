/**
 * Erros tipados do SDK.
 *
 * Hierarquia:
 * - MercadoLivreError: base de todos os erros do SDK.
 *   - ApiError: erro devolvido pela API do Mercado Livre.
 *     - UnauthorizedError (401)
 *     - ForbiddenError (403)
 *     - NotFoundError (404)
 *     - ValidationError (400/422)
 *     - RateLimitError (429)
 *   - NetworkError: falha de transporte (fetch, timeout).
 *   - OAuthError: falha no fluxo OAuth2.
 */

export interface ApiErrorInput {
  message: string
  status: number
  apiCode?: string
  apiMessage?: string
  body?: unknown
  headers?: Headers
  requestId?: string
  retryAfterSeconds?: number
}

export class MercadoLivreError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'MercadoLivreError'
  }
}

/** Erro devolvido pela API do Mercado Livre (resposta não-2xx). */
export class ApiError extends MercadoLivreError {
  readonly status: number
  readonly apiCode: string | undefined
  readonly apiMessage: string | undefined
  readonly body: unknown
  readonly headers: Headers | undefined
  readonly requestId: string | undefined

  constructor(input: ApiErrorInput) {
    super(input.message)
    this.name = 'ApiError'
    this.status = input.status
    this.apiCode = input.apiCode
    this.apiMessage = input.apiMessage
    this.body = input.body
    this.headers = input.headers
    this.requestId = input.requestId
  }
}

export class UnauthorizedError extends ApiError {
  constructor(input: ApiErrorInput) {
    super(input)
    this.name = 'UnauthorizedError'
  }
}

export class ForbiddenError extends ApiError {
  constructor(input: ApiErrorInput) {
    super(input)
    this.name = 'ForbiddenError'
  }
}

export class NotFoundError extends ApiError {
  constructor(input: ApiErrorInput) {
    super(input)
    this.name = 'NotFoundError'
  }
}

export class ValidationError extends ApiError {
  constructor(input: ApiErrorInput) {
    super(input)
    this.name = 'ValidationError'
  }
}

export class RateLimitError extends ApiError {
  readonly retryAfterSeconds: number | undefined

  constructor(input: ApiErrorInput) {
    super(input)
    this.name = 'RateLimitError'
    this.retryAfterSeconds = input.retryAfterSeconds
  }
}

/** Falha de transporte: rede, DNS, timeout, etc. */
export class NetworkError extends MercadoLivreError {
  constructor(
    message: string,
    override readonly cause: unknown,
  ) {
    super(message, { cause })
    this.name = 'NetworkError'
  }
}

/** Falha no fluxo OAuth2 (grant inválido, escopo, etc). */
export class OAuthError extends MercadoLivreError {
  constructor(
    readonly oauthError: string,
    readonly errorDescription: string | undefined,
    options?: ErrorOptions,
  ) {
    super(errorDescription ?? oauthError, options)
    this.name = 'OAuthError'
  }
}

function parseRetryAfter(headers: Headers): number | undefined {
  const raw = headers.get('retry-after')
  if (!raw) return undefined
  const seconds = Number(raw)
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined
}

function parseRequestId(headers: Headers): string | undefined {
  const raw = headers.get('x-request-id')
  return raw ?? undefined
}

function errorMessageFor(status: number, apiMessage: unknown): string {
  if (typeof apiMessage === 'string' && apiMessage.length > 0) return apiMessage
  return `O Mercado Livre respondeu com status ${status}`
}

/** Mapeia uma resposta HTTP não-2xx para o erro tipado correspondente. */
export function toApiError(status: number, body: unknown, headers: Headers): ApiError {
  const record = isRecord(body) ? body : undefined
  const apiMessage = typeof record?.message === 'string' ? record.message : undefined
  const apiCode = typeof record?.error === 'string' ? record.error : undefined

  const base: ApiErrorInput = {
    message: errorMessageFor(status, apiMessage),
    status,
  }
  if (apiCode !== undefined) base.apiCode = apiCode
  if (apiMessage !== undefined) base.apiMessage = apiMessage
  if (body !== undefined) base.body = body
  base.headers = headers
  const requestId = parseRequestId(headers)
  if (requestId !== undefined) base.requestId = requestId

  switch (status) {
    case 401:
      return new UnauthorizedError(base)
    case 403:
      return new ForbiddenError(base)
    case 404:
      return new NotFoundError(base)
    case 400:
    case 422:
      return new ValidationError(base)
    case 429: {
      const retryAfterSeconds = parseRetryAfter(headers)
      return new RateLimitError(
        retryAfterSeconds === undefined ? base : { ...base, retryAfterSeconds },
      )
    }
    default:
      return new ApiError(base)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
