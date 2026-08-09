import { describe, expect, it } from 'vitest'
import {
  ApiError,
  ForbiddenError,
  InputValidationError,
  NotFoundError,
  OAuthError,
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

  it('retry-after vazio ou só-espaço NÃO vira retry imediato sem backoff (F11, pente fino)', () => {
    // `Number('')`/`Number('  ')` = 0: um header vazio faria o 429 ser
    // retentado SEM backoff (rajada igual à do código pré-Rodada 6).
    expect(
      (toApiError(429, {}, headers({ 'retry-after': '' })) as RateLimitError).retryAfterSeconds,
    ).toBeUndefined()
    expect(
      (toApiError(429, {}, headers({ 'retry-after': '  ' })) as RateLimitError).retryAfterSeconds,
    ).toBeUndefined()
    expect(
      (toApiError(429, {}, headers({ 'retry-after': 'abc' })) as RateLimitError).retryAfterSeconds,
    ).toBeUndefined()
    // Número real continua sendo honrado.
    expect(
      (toApiError(429, {}, headers({ 'retry-after': '5' })) as RateLimitError).retryAfterSeconds,
    ).toBe(5)
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
    expect(err.message).toBe('Erro interno do Mercado Livre — tente novamente mais tarde')
  })

  it('sanitiza a message da API (anti log injection com CRLF)', () => {
    const err = toApiError(400, { message: 'campo inválido\r\nforjado: x' }, headers())
    expect(err.message).toContain('campo inválido')
    expect(err.message).not.toMatch(/\r|\n/)
    const unicode = toApiError(400, { message: 'a\u2028b\u0085c\x7fd' }, headers())
    expect(unicode.message).not.toMatch(/[\u2028\u0085\x7f]/)
  })

  it('cai no fallback do status quando a message é só control chars', () => {
    const err = toApiError(400, { message: '\n\r\u2028' }, headers())
    expect(err.message).toBe('Requisição inválida — verifique os parâmetros enviados')
  })
})

describe('InputValidationError', () => {
  it('deve ser um MercadoLivreError com nome correto', () => {
    const err = new InputValidationError('Entrada inválida')
    expect(err).toBeInstanceOf(InputValidationError)
    expect(err.name).toBe('InputValidationError')
    expect(err.message).toBe('Entrada inválida')
  })
})

describe('OAuthError', () => {
  it('sanitiza a error_description do /oauth/token (anti log injection)', () => {
    // Mesma classe do ApiError.message (Rodada 3): a description vem da
    // resposta do endpoint de token (pode ecoar dados enviados) e, ao ser
    // serializada (logs/APM), não pode forjar linhas de log.
    const err = new OAuthError(
      'invalid_request',
      'bad state\r\n[ERROR] falsificação de log\u0085fim',
    )
    expect(err.message.split('\n')).toHaveLength(1)
    expect(err.message.split('\r')).toHaveLength(1)
    expect(err.message).not.toMatch(/[\u0085\x7f]/)
    // Campos estruturados permanecem crus para matching de código.
    expect(err.oauthError).toBe('invalid_request')
    expect(err.errorDescription).toContain('[ERROR]')
  })

  it('sanitiza também o oauthError quando vira o message (sem description)', () => {
    const err = new OAuthError('invalid_grant\r\nfake', undefined)
    expect(err.message.split('\n')).toHaveLength(1)
    // O campo máquina permanece intacto.
    expect(err.oauthError).toBe('invalid_grant\r\nfake')
  })
})
