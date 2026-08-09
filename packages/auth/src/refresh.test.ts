import { OAuthError } from '@nodemelivre/errors'
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

  it('sem refresh_token, devolve o token AINDA VÁLIDO em vez de quebrar as últimas requisições (M2, pente fino)', async () => {
    const { manager, store } = createManager()
    // Dentro da janela de leeway (60s) mas ainda NÃO expirado: não há
    // refresh_token (ex.: client_credentials) e renovar lançaria — o token
    // ainda funciona por ~30s e deve ser usado, não descartado.
    const token = storedToken({ expiresAt: NOW + 30_000 })
    delete token.refreshToken
    await store.set(token)
    await expect(manager.getToken()).resolves.toBe('access-1')
  })

  it('sem refresh_token e JÁ expirado, o erro claro (OAuthError) se propaga (M2, pente fino)', async () => {
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

  it('re-autenticação substitui o token anterior (re-login)', async () => {
    const { manager, store } = createManager()
    await manager.saveAuthorizationCode('code-1', 'https://app.com/callback')
    await manager.saveAuthorizationCode('code-2', 'https://app.com/callback')
    expect((await store.get())?.accessToken).toBe('access-code-2')
  })

  it('instanceId padrão usa CSPRNG (não Math.random)', async () => {
    const { manager } = createManager()
    const id = (manager as unknown as { instanceId: string }).instanceId
    expect(id).toMatch(/^tm-[0-9a-f]{16}$/)
  })

  it('deve limpar o token', async () => {
    const { manager, store } = createManager()
    await store.set(storedToken())
    await manager.clear()
    expect(await store.get()).toBeNull()
  })

  it('waitForLeaseRelease usa o clock injetado e sai quando o token é atualizado (O7)', async () => {
    vi.useFakeTimers()
    try {
      // Relógio controlável compartilhado entre store e manager.
      let now = NOW
      const store = new InMemoryTokenStore({ clock: () => now })
      const oauth = fakeOAuth()
      const manager = new TokenManager({ oauth, store, clock: () => now })
      await store.set(storedToken({ expiresAt: now - 1000 }))

      // Outra instância segura o lease e atualiza o token durante a espera.
      await store.acquireLease({ holderId: 'outra-instancia' })

      const refreshPromise = manager.refresh()
      // Espera o loop do waitForLeaseRelease entrar (startWait = now).
      await vi.advanceTimersByTimeAsync(0)

      // A outra instância conclui o refresh: avança o relógio e grava o token.
      now += 2000
      await store.set(storedToken({ accessToken: 'access-2', refreshToken: 'refresh-2' }))

      // O ciclo de 500ms do loop percebe updatedAt > startWait e retorna.
      await vi.advanceTimersByTimeAsync(600)
      await refreshPromise

      // Esta instância NÃO renovou — o token veio da outra instância.
      expect(oauth.refresh).not.toHaveBeenCalled()
      expect((await manager.current())?.accessToken).toBe('access-2')
    } finally {
      vi.useRealTimers()
    }
  })
})
