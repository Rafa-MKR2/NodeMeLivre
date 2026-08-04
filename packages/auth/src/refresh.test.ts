import { OAuthError } from '@nodemelivre/core'
import { describe, expect, it, vi } from 'vitest'
import type { OAuthClient } from './oauth.js'
import { TokenManager } from './refresh.js'
import { type AccessToken, InMemoryTokenStore } from './token.js'

const NOW = 1_000_000_000_000

function storedToken(overrides: Partial<AccessToken> = {}): AccessToken {
  return {
    accessToken: 'access-1',
    tokenType: 'bearer',
    scope: 'read write',
    userId: 7,
    expiresAt: NOW + 3600_000,
    refreshToken: 'refresh-1',
    ...overrides,
  }
}

function fakeOAuth(): OAuthClient {
  return {
    refresh: vi.fn(async (refreshToken: string) =>
      storedToken({ accessToken: 'access-2', refreshToken: `new-${refreshToken}` }),
    ),
    exchangeCode: vi.fn(async (code: string) => storedToken({ accessToken: `access-${code}` })),
  } as unknown as OAuthClient
}

function createManager(options: Partial<ConstructorParameters<typeof TokenManager>[0]> = {}): {
  manager: TokenManager
  oauth: OAuthClient
  store: InMemoryTokenStore
} {
  const oauth = options.oauth ?? fakeOAuth()
  const store = (options.store as InMemoryTokenStore | undefined) ?? new InMemoryTokenStore()
  const manager = new TokenManager({
    oauth,
    store,
    clock: () => NOW,
    ...options,
  })
  return { manager, oauth, store }
}

describe('TokenManager', () => {
  it('deve devolver o token atual quando ainda válido', async () => {
    const { manager, store } = createManager()
    await store.set(storedToken())
    await expect(manager.getToken()).resolves.toBe('access-1')
  })

  it('deve devolver undefined quando não há token', async () => {
    const { manager } = createManager()
    await expect(manager.getToken()).resolves.toBeUndefined()
  })

  it('deve renovar o token dentro da janela de leeway (60s)', async () => {
    const { manager, oauth, store } = createManager()
    await store.set(storedToken({ expiresAt: NOW + 30_000 }))
    const token = await manager.getToken()
    expect(token).toBe('access-2')
    expect(oauth.refresh).toHaveBeenCalledWith('refresh-1')
    expect((await manager.current())?.accessToken).toBe('access-2')
  })

  it('deve renovar quando o token já expirou', async () => {
    const { manager, oauth, store } = createManager()
    await store.set(storedToken({ expiresAt: NOW - 1000 }))
    const token = await manager.getToken()
    expect(token).toBe('access-2')
    expect(oauth.refresh).toHaveBeenCalledTimes(1)
  })

  it('deve lançar OAuthError ao renovar sem refresh_token', async () => {
    const { manager, store } = createManager()
    const token = storedToken({ expiresAt: NOW - 1000 })
    delete token.refreshToken
    await store.set(token)
    const err = await manager.getToken().catch((e) => e)
    expect(err).toBeInstanceOf(OAuthError)
  })

  it('deve deduplicar chamadas concorrentes de refresh', async () => {
    const { manager, oauth, store } = createManager()
    await store.set(storedToken({ expiresAt: NOW - 1000 }))
    await Promise.all([manager.refresh(), manager.refresh()])
    expect(oauth.refresh).toHaveBeenCalledTimes(1)
  })

  it('deve persistir o resultado do authorization_code', async () => {
    const { manager, store } = createManager()
    const token = await manager.saveAuthorizationCode('abc', 'https://app.com/callback')
    expect(token.accessToken).toBe('access-abc')
    expect((await store.get())?.accessToken).toBe('access-abc')
  })

  it('deve limpar o token', async () => {
    const { manager, store } = createManager()
    await store.set(storedToken())
    await manager.clear()
    expect(await store.get()).toBeNull()
  })
})
