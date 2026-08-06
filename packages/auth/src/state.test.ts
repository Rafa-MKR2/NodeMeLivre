import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OAuthStateStore } from './state.js'

describe('OAuthStateStore', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('deve criar e consumir um state', () => {
    const store = new OAuthStateStore()
    const state = store.create('https://app.com/cb')
    expect(state).toMatch(/^[a-f0-9]{64}$/)
    expect(store.size).toBe(1)

    const entry = store.consume(state)
    expect(entry?.redirectUri).toBe('https://app.com/cb')
    expect(store.size).toBe(0)
  })

  it('deve consumir uma única vez', () => {
    const store = new OAuthStateStore()
    const state = store.create('https://app.com/cb')
    store.consume(state)
    expect(store.consume(state)).toBeNull()
  })

  it('deve expirar states após o TTL', () => {
    const store = new OAuthStateStore({ ttlMs: 1_000 })
    const state = store.create('https://app.com/cb')

    vi.advanceTimersByTime(1_001)
    expect(store.consume(state)).toBeNull()
    expect(store.size).toBe(0)
  })

  it('deve remover o mais antigo quando excede o limite', () => {
    const store = new OAuthStateStore({ maxEntries: 2 })
    const first = store.create('https://a.com/cb')
    store.create('https://b.com/cb')
    store.create('https://c.com/cb')

    expect(store.size).toBe(2)
    expect(store.consume(first)).toBeNull()
  })

  it('deve guardar metadados do estado', () => {
    const store = new OAuthStateStore()
    const state = store.create('https://app.com/cb', { redirectTo: '/admin' })
    const entry = store.get(state)
    expect(entry?.metadata).toEqual({ redirectTo: '/admin' })
  })

  it('deve limpar apenas os expirados no cleanup', () => {
    const store = new OAuthStateStore({ ttlMs: 1_000 })
    const stale = store.create('https://stale.com/cb')

    vi.advanceTimersByTime(1_500)
    const fresh = store.create('https://fresh.com/cb')
    const removed = store.cleanup()

    expect(removed).toBe(1)
    expect(store.size).toBe(1)
    expect(store.consume(fresh)).not.toBeNull()
    expect(store.consume(stale)).toBeNull()
  })

  it('deve parar o timer de limpeza no stop', () => {
    const store = new OAuthStateStore()
    store.create('https://app.com/cb')
    store.stop()
    expect(store.size).toBe(1)
  })

  it('deve rejeitar state inexistente no has', () => {
    const store = new OAuthStateStore()
    expect(store.has('inexistente')).toBe(false)
  })

  it('deve registrar um state fornecido pelo chamador', () => {
    const store = new OAuthStateStore()
    expect(store.register('meu-state', 'https://app.com/cb')).toBe(true)
    const entry = store.consume('meu-state')
    expect(entry?.redirectUri).toBe('https://app.com/cb')
  })

  it('deve recusar registrar state duplicado', () => {
    const store = new OAuthStateStore()
    expect(store.register('x', 'https://a.com')).toBe(true)
    expect(store.register('x', 'https://b.com')).toBe(false)
  })
})
