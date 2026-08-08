import { randomBytes } from 'node:crypto'
import { mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { HttpClient } from '@nodemelivre/http'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { OAuthClient } from './oauth.js'
import { TokenManager } from './refresh.js'
import { OAuthStateStore } from './state.js'
import { FileTokenStore, InMemoryTokenStore } from './token.js'

function createMockFetch() {
  const responses = new Map<string, any>()
  const createJsonResponse = (data: any, status = 200) => {
    const jsonStr = JSON.stringify(data)
    return {
      status,
      ok: status >= 200 && status < 300,
      text: async () => jsonStr,
      json: async () => data,
      headers: new Headers(),
    } as Response
  }
  return {
    fetchImpl: async (input: string | URL | Request, init?: RequestInit) => {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      const path = new URL(url).pathname
      const body = init?.body ? JSON.parse(init.body as string) : {}
      const key = `${path}:${JSON.stringify(body)}`
      if (responses.has(key)) return responses.get(key)
      if (path === '/oauth/token') {
        if (body.grant_type === 'authorization_code' && !body.code_verifier) {
          return createJsonResponse(
            {
              error: 'invalid_request',
              error_description: 'code_verifier is required',
            },
            400,
          )
        }
        if (
          body.grant_type === 'refresh_token' &&
          (!body.refresh_token || body.refresh_token === 'invalid')
        ) {
          return createJsonResponse(
            {
              error: 'invalid_grant',
              error_description: 'Invalid refresh token',
            },
            400,
          )
        }
        return createJsonResponse({
          access_token: `access-${randomBytes(8).toString('hex')}`,
          token_type: 'bearer',
          expires_in: 21600,
          scope: 'offline_access read write',
          user_id: 12345,
          refresh_token: `refresh-${randomBytes(8).toString('hex')}`,
        })
      }
      throw new Error(`No mock for ${path}`)
    },
    setResponse: (path: string, body: any, response: any) => {
      const key = `${path}:${JSON.stringify(body)}`
      responses.set(key, response)
    },
  }
}

describe('Integração Multi-Instância - Fase 1', () => {
  let tempDir: string
  let mock: ReturnType<typeof createMockFetch>

  beforeEach(async () => {
    tempDir = join(tmpdir(), `nodemelivre-test-${randomBytes(8).toString('hex')}`)
    await mkdir(tempDir, { recursive: true })
    const mockFetch = createMockFetch()
    mock = mockFetch
    mock.setResponse(
      '/oauth/token',
      {
        grant_type: 'authorization_code',
        client_id: 'APP_ID',
        client_secret: 'SECRET',
        code: 'code-1',
        redirect_uri: 'https://app.com/callback',
      },
      {
        status: 200,
        ok: true,
        text: async () =>
          JSON.stringify({
            access_token: 'access-initial',
            token_type: 'bearer',
            expires_in: 21600,
            scope: 'offline_access read write',
            user_id: 12345,
            refresh_token: 'refresh-initial',
          }),
        json: async () => ({
          access_token: 'access-initial',
          token_type: 'bearer',
          expires_in: 21600,
          scope: 'offline_access read write',
          user_id: 12345,
          refresh_token: 'refresh-initial',
        }),
        headers: new Headers(),
      } as Response,
    )
  })

  afterEach(async () => {
    try {
      await rm(tempDir, { recursive: true, force: true })
    } catch {
      // Ignora
    }
  })

  function createHttpClient() {
    return new HttpClient({ fetchImpl: mock.fetchImpl })
  }

  describe('PKCE code_verifier compartilhado via StateStore', () => {
    it('deve permitir que instância A gere code_verifier e instância B o recupere', async () => {
      const sharedStateStore = new OAuthStateStore()

      const mlA = new OAuthClient({
        clientId: 'APP_ID',
        clientSecret: 'SECRET',
        pkce: true,
        stateStore: sharedStateStore,
        httpClient: createHttpClient(),
      })

      const authUrl = mlA.authorizationUrl({
        redirectUri: 'https://app.com/callback',
        state: 'shared-state-123',
      })

      expect(authUrl).toContain('code_challenge=')
      expect(authUrl).toContain('code_challenge_method=S256')

      const mlB = new OAuthClient({
        clientId: 'APP_ID',
        clientSecret: 'SECRET',
        pkce: true,
        stateStore: sharedStateStore,
        httpClient: createHttpClient(),
      })

      const token = await mlB.exchangeCode('auth-code-123', {
        redirectUri: 'https://app.com/callback',
        state: 'shared-state-123',
      })

      expect(token.accessToken).toBeTruthy()
      expect(token.refreshToken).toBeTruthy()
    })

    it('deve falhar se code_verifier não estiver no StateStore', async () => {
      const stateStoreA = new OAuthStateStore()
      const stateStoreB = new OAuthStateStore()

      const mlA = new OAuthClient({
        clientId: 'APP_ID',
        clientSecret: 'SECRET',
        pkce: true,
        stateStore: stateStoreA,
        httpClient: createHttpClient(),
      })

      mlA.authorizationUrl({
        redirectUri: 'https://app.com/callback',
        state: 'state-123',
      })

      const mlB = new OAuthClient({
        clientId: 'APP_ID',
        clientSecret: 'SECRET',
        pkce: true,
        stateStore: stateStoreB,
        httpClient: createHttpClient(),
      })

      await expect(
        mlB.exchangeCode('auth-code-123', {
          redirectUri: 'https://app.com/callback',
          state: 'state-123',
        }),
      ).rejects.toThrow()
    })
  })

  describe('FileTokenStore - Escrita atômica e concorrência', () => {
    it('deve suportar escritas concorrentes sem corrupção', async () => {
      const filePath = join(tempDir, 'token.json')
      const store = new FileTokenStore({ filePath })

      const baseToken = {
        accessToken: 'access-base',
        tokenType: 'bearer' as const,
        scope: 'read write',
        userId: 123,
        expiresAt: Date.now() + 3600_000,
        refreshToken: 'refresh-base',
      }

      const promises = Array.from({ length: 10 }, (_, i) =>
        store.compareAndSet({ ...baseToken, accessToken: `access-${i}` }, null),
      )

      const results = await Promise.all(promises)
      const successCount = results.filter((v) => v !== null).length
      expect(successCount).toBe(10)

      const final = await store.getWithVersion()
      expect(final).not.toBeNull()
      expect(final?.version).toBe(10)
      expect(final?.token.accessToken).toMatch(/^access-\d+$/)
    })

    it('deve detectar conflito de versão com compareAndSet', async () => {
      const filePath = join(tempDir, 'token.json')
      const store = new FileTokenStore({ filePath })

      const token = {
        accessToken: 'access-1',
        tokenType: 'bearer' as const,
        scope: 'read',
        userId: 123,
        expiresAt: Date.now() + 3600_000,
      }

      await store.compareAndSet(token, 0)
      expect((await store.getWithVersion())?.version).toBe(1)

      const result = await store.compareAndSet({ ...token, accessToken: 'access-2' }, 999)
      expect(result).toBeNull()

      const result2 = await store.compareAndSet({ ...token, accessToken: 'access-3' }, 1)
      expect(result2).toBe(2)
    })

    it('deve recuperar de backup em caso de corrupção', async () => {
      const filePath = join(tempDir, 'token.json')
      const store = new FileTokenStore({ filePath })

      const token = {
        accessToken: 'access-valid',
        tokenType: 'bearer' as const,
        scope: 'read',
        userId: 123,
        expiresAt: Date.now() + 3600_000,
      }

      await store.compareAndSet(token, 0)

      const { writeFile } = await import('node:fs/promises')
      await writeFile(filePath, '{ invalid json }', 'utf8')

      const recovered = await store.get()
      expect(recovered).not.toBeNull()
      expect(recovered?.accessToken).toBe('access-valid')
    })
  })

  describe('TokenManager - Lease distribuído para refresh', () => {
    it('deve adquirir lease e renovar token', async () => {
      const store = new InMemoryTokenStore()

      const ml = new OAuthClient({
        clientId: 'APP_ID',
        clientSecret: 'SECRET',
        httpClient: createHttpClient(),
      })

      const manager = new TokenManager({
        oauth: ml,
        store,
        instanceId: 'instance-1',
      })

      const initialToken = await ml.exchangeCode('code-1', {
        redirectUri: 'https://app.com/callback',
      })
      await store.compareAndSet(initialToken, 0)

      await manager.refresh()

      const current = await store.get()
      expect(current?.accessToken).not.toBe(initialToken.accessToken)
    })

    it('deve bloquear segunda instância enquanto primeira tem lease', async () => {
      const store = new InMemoryTokenStore()

      const ml1 = new OAuthClient({
        clientId: 'APP_ID',
        clientSecret: 'SECRET',
        httpClient: createHttpClient(),
      })

      const ml2 = new OAuthClient({
        clientId: 'APP_ID',
        clientSecret: 'SECRET',
        httpClient: createHttpClient(),
      })

      const manager1 = new TokenManager({
        oauth: ml1,
        store,
        instanceId: 'instance-1',
      })

      const manager2 = new TokenManager({
        oauth: ml2,
        store,
        instanceId: 'instance-2',
      })

      const initialToken = await ml1.exchangeCode('code-1', {
        redirectUri: 'https://app.com/callback',
      })
      await store.compareAndSet(initialToken, 0)

      const refreshPromise1 = manager1.refresh()

      await new Promise((r) => setTimeout(r, 50))

      const refreshPromise2 = manager2.refresh()

      await Promise.all([refreshPromise1, refreshPromise2])

      const final = await store.get()
      expect(final).not.toBeNull()
    }, 10000)
  })
})
