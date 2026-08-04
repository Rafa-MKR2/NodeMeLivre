import { describe, expect, it } from 'vitest'
import {
  ApiError,
  ForbiddenError,
  NotFoundError,
  RateLimitError,
  toApiError,
  UnauthorizedError,
  ValidationError,
} from './index.js'

function headers(extra?: Record<string, string>): Headers {
  const h = new Headers()
  for (const [k, v] of Object.entries(extra ?? {})) h.set(k, v)
  return h
}

describe('toApiError', () => {
  it('deve mapear 401 para UnauthorizedError com código da API', () => {
    const err = toApiError(401, { error: 'unauthorized', message: 'Token inválido' }, headers())
    expect(err).toBeInstanceOf(UnauthorizedError)
    expect(err).toBeInstanceOf(ApiError)
    expect(err.apiCode).toBe('unauthorized')
    expect(err.message).toBe('Token inválido')
    expect(err.status).toBe(401)
  })

  it('deve mapear 403 para ForbiddenError', () => {
    expect(toApiError(403, {}, headers())).toBeInstanceOf(ForbiddenError)
  })

  it('deve mapear 404 para NotFoundError', () => {
    expect(toApiError(404, {}, headers())).toBeInstanceOf(NotFoundError)
  })

  it('deve mapear 400 e 422 para ValidationError', () => {
    expect(toApiError(400, {}, headers())).toBeInstanceOf(ValidationError)
    expect(toApiError(422, {}, headers())).toBeInstanceOf(ValidationError)
  })

  it('deve mapear 429 para RateLimitError com retryAfterSeconds', () => {
    const err = toApiError(429, { message: 'Too many requests' }, headers({ 'retry-after': '12' }))
    expect(err).toBeInstanceOf(RateLimitError)
    expect((err as RateLimitError).retryAfterSeconds).toBe(12)
  })

  it('deve capturar x-request-id dos headers', () => {
    const err = toApiError(500, {}, headers({ 'x-request-id': 'abc-123' }))
    expect(err.requestId).toBe('abc-123')
  })

  it('deve cair no ApiError genérico para status desconhecido', () => {
    const err = toApiError(503, {}, headers())
    expect(err).toBeInstanceOf(ApiError)
    expect(err).not.toBeInstanceOf(RateLimitError)
  })

  it('deve usar mensagem padrão quando a API não devolve message', () => {
    const err = toApiError(500, {}, headers())
    expect(err.message).toBe('O Mercado Livre respondeu com status 500')
  })
})
