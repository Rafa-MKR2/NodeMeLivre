import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OAuthStateStore } from './state.js'

describe('OAuthStateStore', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('deve criar e consumir um state', async () => {
    const store = new OAuthStateStore()
    const state = await store.create('https://app.com/cb')
    expect(state).toMatch(/^[a-f0-9]{64}$/)
    expect(store.size).toBe(1)

    const entry = await store.consume(state)
    expect(entry?.redirectUri).toBe('https://app.com/cb')
    expect(store.size).toBe(0)
  })

  it('deve consumir uma única vez', async () => {
    const store = new OAuthStateStore()
    const state = await store.create('https://app.com/cb')
    await store.consume(state)
    expect(await store.consume(state)).toBeNull()
  })

  it('deve expirar states após o TTL', async () => {
    const store = new OAuthStateStore({ ttlMs: 1_000 })
    const state = await store.create('https://app.com/cb')

    vi.advanceTimersByTime(1_001)
    expect(await store.consume(state)).toBeNull()
    expect(store.size).toBe(0)
  })

  it('deve remover o mais antigo quando excede o limite', async () => {
    const store = new OAuthStateStore({ maxEntries: 2 })
    const first = await store.create('https://a.com/cb')
    await store.create('https://b.com/cb')
    await store.create('https://c.com/cb')

    expect(store.size).toBe(2)
    expect(await store.consume(first)).toBeNull()
  })

  it('deve guardar metadados do estado', async () => {
    const store = new OAuthStateStore()
    const state = await store.create('https://app.com/cb', { redirectTo: '/admin' })
    const entry = await store.get(state)
    expect(entry?.metadata).toEqual({ redirectTo: '/admin' })
  })

  it('deve limpar apenas os expirados no cleanup', async () => {
    const store = new OAuthStateStore({ ttlMs: 1_000 })
    const stale = await store.create('https://stale.com/cb')

    vi.advanceTimersByTime(1_500)
    const fresh = await store.create('https://fresh.com/cb')
    const removed = store.cleanup()

    expect(removed).toBe(1)
    expect(store.size).toBe(1)
    expect(await store.consume(fresh)).not.toBeNull()
    expect(await store.consume(stale)).toBeNull()
  })

  it('deve parar o timer de limpeza no stop', async () => {
    const store = new OAuthStateStore()
    await store.create('https://app.com/cb')
    store.stop()
    expect(store.size).toBe(1)
  })

  it('deve rejeitar state inexistente no has', async () => {
    const store = new OAuthStateStore()
    expect(await store.has('inexistente')).toBe(false)
  })

  it('deve registrar um state fornecido pelo chamador', async () => {
    const store = new OAuthStateStore()
    expect(await store.register('meu-state', 'https://app.com/cb')).toBe(true)
    const entry = await store.consume('meu-state')
    expect(entry?.redirectUri).toBe('https://app.com/cb')
  })

  it('deve recusar registrar state duplicado', async () => {
    const store = new OAuthStateStore()
    expect(await store.register('x', 'https://a.com')).toBe(true)
    expect(await store.register('x', 'https://b.com')).toBe(false)
  })

  it('deve estacionar e recuperar code_verifier (Rodada 9)', async () => {
    const store = new OAuthStateStore()
    // O OAuthClient.consumeState estaciona o verifier no store compartilhado
    // após o consume — o store é o mecanismo (métodos dedicados abaixo).
    await store.parkCodeVerifier('state-x', 'verifier-secreto')
    expect(await store.getParkedCodeVerifier('state-x')).toBe('verifier-secreto')
    // Não contamina o fluxo normal de states (CSRF single-use intacto).
    expect(await store.has('state-x')).toBe(false)
  })

  it('deve expirar verifiers estacionados após o TTL (anti memory leak)', async () => {
    const store = new OAuthStateStore()
    await store.parkCodeVerifier('state-x', 'v1')

    vi.advanceTimersByTime(10 * 60 * 1000 + 1)
    expect(await store.getParkedCodeVerifier('state-x')).toBeUndefined()
  })

  it('deve expulsar o verifier mais antigo ao exceder o limite', async () => {
    const store = new OAuthStateStore()
    // O limite do parking é fixo (1000) — empilha 1001 e o primeiro sai.
    for (let i = 0; i < 1001; i++) await store.parkCodeVerifier(`state-${i}`, `v${i}`)
    expect(await store.getParkedCodeVerifier('state-0')).toBeUndefined()
    expect(await store.getParkedCodeVerifier('state-1000')).toBe('v1000')
  })

  it('cleanup também remove verifiers estacionados expirados', async () => {
    const store = new OAuthStateStore()
    await store.parkCodeVerifier('state-y', 'v1')
    vi.advanceTimersByTime(10 * 60 * 1000 + 1)
    const removed = store.cleanup()
    expect(removed).toBeGreaterThan(0)
    expect(await store.getParkedCodeVerifier('state-y')).toBeUndefined()
  })
})
