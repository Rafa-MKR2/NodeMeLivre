import { describe, expect, it } from 'vitest'
import {
  DEFAULT_RETRY,
  exponentialBackoff,
  IDEMPOTENT_METHODS,
  isRetryableMethod,
  isRetryableStatus,
} from './retry.js'

describe('isRetryableStatus', () => {
  it('deve retornar true para 429 e 5xx', () => {
    expect(isRetryableStatus(429)).toBe(true)
    expect(isRetryableStatus(500)).toBe(true)
    expect(isRetryableStatus(502)).toBe(true)
    expect(isRetryableStatus(503)).toBe(true)
  })

  it('deve retornar false para 4xx e 2xx', () => {
    expect(isRetryableStatus(400)).toBe(false)
    expect(isRetryableStatus(404)).toBe(false)
    expect(isRetryableStatus(200)).toBe(false)
  })
})

describe('isRetryableMethod', () => {
  it('deve considerar GET, PUT e DELETE idempotentes por padrão', () => {
    expect(isRetryableMethod('GET')).toBe(true)
    expect(isRetryableMethod('PUT')).toBe(true)
    expect(isRetryableMethod('DELETE')).toBe(true)
  })

  it('deve NÃO considerar POST idempotente por padrão', () => {
    expect(isRetryableMethod('POST')).toBe(false)
  })

  it('deve respeitar lista customizada de métodos', () => {
    expect(isRetryableMethod('POST', { idempotentMethods: ['POST'] })).toBe(true)
  })

  it('deve expor os métodos padrão como IDEMPOTENT_METHODS', () => {
    expect(IDEMPOTENT_METHODS).toContain('GET')
  })
})

describe('exponentialBackoff', () => {
  it('deve dobrar o atraso a cada tentativa sem jitter', () => {
    const options = { baseDelayMs: 250, maxDelayMs: 8000, jitter: false }
    expect(exponentialBackoff(0, options)).toBe(250)
    expect(exponentialBackoff(1, options)).toBe(500)
    expect(exponentialBackoff(2, options)).toBe(1000)
  })

  it('deve respeitar o teto maxDelayMs', () => {
    const options = { baseDelayMs: 250, maxDelayMs: 1000, jitter: false }
    expect(exponentialBackoff(5, options)).toBe(1000)
  })

  it('deve manter o valor dentro dos limites com jitter', () => {
    for (let attempt = 0; attempt < 5; attempt++) {
      const delay = exponentialBackoff(attempt, { jitter: true })
      expect(delay).toBeGreaterThan(0)
      expect(delay).toBeLessThanOrEqual(DEFAULT_RETRY.maxDelayMs)
    }
  })
})
