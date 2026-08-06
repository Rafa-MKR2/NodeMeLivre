import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RateLimiter, rateLimitKey } from './rate-limit.js'

function headers(extra?: Record<string, string>): Headers {
  const h = new Headers()
  for (const [k, v] of Object.entries(extra ?? {})) h.set(k, v)
  return h
}

describe('RateLimiter', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(1_750_000_000_000)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('deve ler limit, remaining e reset dos headers', () => {
    const limiter = new RateLimiter()
    limiter.update(
      '/items/MLB1',
      headers({
        'x-rate-limit-limit': '1000',
        'x-rate-limit-remaining': '42',
        'x-rate-limit-reset': '1700000000',
      }),
    )
    const state = limiter.stateOf('/items/MLB1')
    expect(state?.limit).toBe(1000)
    expect(state?.remaining).toBe(42)
    expect(state?.resetAt).toBe(1_700_000_000_000)
  })

  it('deve interpretar reset em milissegundos (epoch)', () => {
    const limiter = new RateLimiter()
    limiter.update(
      '/items/MLB1',
      headers({ 'x-rate-limit-reset': '1750000000000', 'x-rate-limit-remaining': '0' }),
    )
    expect(limiter.stateOf('/items/MLB1')?.resetAt).toBe(1_750_000_000_000)
  })

  it('deve interpretar reset relativo em segundos', () => {
    const limiter = new RateLimiter()
    limiter.update(
      '/items/MLB1',
      headers({ 'x-rate-limit-reset': '30', 'x-rate-limit-remaining': '0' }),
    )
    expect(limiter.stateOf('/items/MLB1')?.resetAt).toBe(1_750_000_030_000)
  })

  it('deve ignorar respostas sem headers de rate limit', () => {
    const limiter = new RateLimiter()
    limiter.update('/users/me', headers())
    expect(limiter.stateOf('/users/me')).toBeUndefined()
  })

  it('não deve esperar quando ainda há requisições restantes', async () => {
    const limiter = new RateLimiter()
    limiter.update(
      '/orders/search',
      headers({
        'x-rate-limit-remaining': '5',
        'x-rate-limit-reset': '1700000001',
      }),
    )
    await limiter.waitIfNeeded('/orders/search')
    expect(limiter.stateOf('/orders/search')?.remaining).toBe(5)
  })

  it('deve esperar até o reset quando o recurso está esgotado', async () => {
    const limiter = new RateLimiter()
    const resetAt = 1_750_000_005_000 // daqui a 5s
    limiter.update(
      '/items/MLB1',
      headers({
        'x-rate-limit-remaining': '0',
        'x-rate-limit-reset': String(resetAt / 1000),
      }),
    )

    let resolved = false
    const waiting = limiter.waitIfNeeded('/items/MLB1').then(() => {
      resolved = true
    })

    await vi.advanceTimersByTimeAsync(4_000)
    expect(resolved).toBe(false)
    await vi.advanceTimersByTimeAsync(1_000)
    await waiting
    expect(resolved).toBe(true)
  })

  it('deve limpar o estado quando a janela já expirou', async () => {
    const limiter = new RateLimiter()
    limiter.update(
      '/items/MLB1',
      headers({
        'x-rate-limit-remaining': '0',
        'x-rate-limit-reset': '1700000000',
      }),
    )
    await limiter.waitIfNeeded('/items/MLB1')
    expect(limiter.stateOf('/items/MLB1')).toBeUndefined()
  })
})

describe('rateLimitKey', () => {
  it('deve agrupar por método e primeiro segmento do path', () => {
    expect(rateLimitKey('GET', '/items/MLB1')).toBe('GET:items')
    expect(rateLimitKey('GET', '/items/MLB2')).toBe('GET:items')
    expect(rateLimitKey('POST', '/items')).toBe('POST:items')
    expect(rateLimitKey('GET', '/sites/MLB/search')).toBe('GET:sites')
  })

  it('deve usar o path como recurso quando não há segmento', () => {
    expect(rateLimitKey('GET', '/')).toBe('GET:/')
    expect(rateLimitKey('GET', 'sem-slash')).toBe('GET:sem-slash')
  })
})
