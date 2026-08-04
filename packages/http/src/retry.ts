/** Política de retry para requisições HTTP. */

/** Métodos considerados idempotentes por padrão. */
export const IDEMPOTENT_METHODS = ['GET', 'PUT', 'DELETE', 'HEAD', 'OPTIONS'] as const

export const DEFAULT_RETRY: Required<RetryOptions> = {
  maxRetries: 3,
  baseDelayMs: 250,
  maxDelayMs: 8_000,
  jitter: true,
  idempotentMethods: IDEMPOTENT_METHODS,
}

export interface RetryOptions {
  /** Quantas tentativas adicionais após a primeira (padrão: 3). */
  maxRetries?: number
  /** Atraso base do backoff exponencial em ms (padrão: 250). */
  baseDelayMs?: number
  /** Atraso máximo do backoff em ms (padrão: 8000). */
  maxDelayMs?: number
  /** Aplica jitter para evitar thundering herd (padrão: true). */
  jitter?: boolean
  /** Métodos HTTP que podem ser repetidos com segurança em erro de servidor (padrão: GET, PUT, DELETE, HEAD, OPTIONS). */
  idempotentMethods?: readonly string[]
}

/** Status que sempre merecem retry, independente do método: 429 e 5xx. */
export function isRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status < 600)
}

/** Define se um método HTTP pode ser repetido quando o servidor dá erro. */
export function isRetryableMethod(method: string, options: RetryOptions = {}): boolean {
  const allow = options.idempotentMethods ?? IDEMPOTENT_METHODS
  return allow.includes(method)
}

/** Backoff exponencial com jitter. Ex.: base 250 -> ~250, ~500, ~1000, ... */
export function exponentialBackoff(attempt: number, options: RetryOptions = {}): number {
  const { baseDelayMs, maxDelayMs, jitter } = {
    ...DEFAULT_RETRY,
    ...options,
  }
  const exponential = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt)
  if (!jitter) return exponential
  return exponential * (0.5 + Math.random() * 0.5)
}

export interface RetryContext {
  attempt: number
  method: string
  status: number | undefined
  error: unknown
}

export type ShouldRetry = (context: RetryContext) => boolean

/** Política padrão de retry: 429/5xx sempre; erro de rede só em método idempotente. */
export const defaultShouldRetry: ShouldRetry = (context) => {
  const { method, status, error } = context
  if (status !== undefined) return isRetryableStatus(status)
  return error instanceof Error && isRetryableMethod(method)
}
