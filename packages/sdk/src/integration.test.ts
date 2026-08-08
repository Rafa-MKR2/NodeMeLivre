import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MockMercadoLivreServer } from '@nodemelivre/core/test-utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createMercadoLivre, FileTokenStore, InMemoryTokenStore, OAuthStateStore } from './index.js'

const TOKEN_BODY = {
  access_token: 'token-auth',
  token_type: 'bearer',
  expires_in: 21600,
  scope: 'offline_access read write',
  user_id: 12345,
  refresh_token: 'refresh-auth',
}

/**
 * Integração real ponta a ponta: `createMercadoLivre` contra um mock server
 * HTTP do Mercado Livre (fetch nativo, zero dependências). Cobre o fluxo que
 * os testes unitários não exercitam: OAuth por HTTP real, persistência em
 * arquivo, refresh em 401 com o TokenManager e o code_verifier PKCE
 * compartilhado entre instâncias.
 */
describe('Integração SDK real — mock server do Mercado Livre', () => {
  let server: MockMercadoLivreServer
  let baseUrl: string
  let tempDir: string

  beforeEach(async () => {
    server = new MockMercadoLivreServer()
    baseUrl = await server.start()
    tempDir = await mkdtemp(join(tmpdir(), 'nodemelivre-sdk-'))

    server.route('POST', '/oauth/token', (req) => {
      const body = req.body as Record<string, unknown>
      if (body.grant_type === 'authorization_code') {
        // O ML exige code_verifier (PKCE) — sem ele responde invalid_request.
        if (body.code_verifier === undefined) {
          return {
            status: 400,
            json: { error: 'invalid_request', error_description: 'code_verifier is required' },
          }
        }
        return { json: TOKEN_BODY }
      }
      if (body.grant_type === 'refresh_token') {
        return {
          json: {
            ...TOKEN_BODY,
            access_token: 'token-refreshado',
            refresh_token: 'refresh-novo',
          },
        }
      }
      return { status: 400, json: { error: 'unsupported_grant_type' } }
    })
  })

  afterEach(async () => {
    await server.stop()
    await rm(tempDir, { recursive: true, force: true })
  })

  it('fluxo completo: autorização → troca do code → persistência → chamada autenticada', async () => {
    server.respond('GET', '/items/MLB1', 200, {
      id: 'MLB1',
      title: 'Produto',
      status: 'active',
    })
    const filePath = join(tempDir, 'token.json')
    const stateStore = new OAuthStateStore()

    const ml = createMercadoLivre({
      clientId: 'APP_ID',
      clientSecret: 'SECRET',
      baseUrl,
      pkce: true,
      stateStore,
      tokenStore: new FileTokenStore({ filePath }),
    })

    const authUrl = ml.authorizationUrl('https://app.com/cb')
    expect(authUrl).toContain('code_challenge=')

    // O state é gerado e armazenado no stateStore automaticamente.
    const state = new URL(authUrl).searchParams.get('state') as string
    await ml.authenticate('https://app.com/cb', 'code-123', state)

    // O token foi persistido em disco pelo FileTokenStore.
    const raw = await readFile(filePath, 'utf8')
    expect(raw).toContain('token-auth')

    // A chamada de recurso sai autenticada com o token persistido.
    const item = await ml.items.get('MLB1')
    expect(item.id).toBe('MLB1')
    const req = server.requests.find((r) => r.path === '/items/MLB1')
    expect(req?.headers.authorization).toBe('Bearer token-auth')
  })

  it('refresca o token em 401 e conclui a chamada com o token novo', async () => {
    server.route('GET', '/orders/123', (req) =>
      req.headers.authorization === 'Bearer token-refreshado'
        ? { json: { id: 123, status: 'paid' } }
        : { status: 401, json: { message: 'expirado' } },
    )
    const store = new FileTokenStore({ filePath: join(tempDir, 'token.json') })
    // Token válido do ponto de vista do cliente, mas rejeitado pelo servidor
    // — força o caminho de 401 → refresh → retry com o token novo.
    await store.compareAndSet(
      {
        accessToken: 'token-antigo',
        tokenType: 'bearer',
        scope: 'read',
        userId: 123,
        expiresAt: Date.now() + 3_600_000,
        refreshToken: 'refresh-auth',
      },
      0,
    )

    const ml = createMercadoLivre({
      clientId: 'APP_ID',
      clientSecret: 'SECRET',
      baseUrl,
      tokenStore: store,
    })

    const order = await ml.orders.get(123)

    expect(order.status).toBe('paid')
    // O refresh aconteceu via /oauth/token com grant_type=refresh_token.
    const refreshReq = server.requests.find(
      (r) =>
        r.path === '/oauth/token' &&
        (r.body as Record<string, unknown>).grant_type === 'refresh_token',
    )
    expect(refreshReq).toBeDefined()
    expect((await ml.tokens.current())?.accessToken).toBe('token-refreshado')
  })

  it('multi-instância: code_verifier gerado na instância A é usado na instância B', async () => {
    const stateStore = new OAuthStateStore()
    const tokenStore = new InMemoryTokenStore()
    const makeMl = (): ReturnType<typeof createMercadoLivre> =>
      createMercadoLivre({
        clientId: 'APP_ID',
        clientSecret: 'SECRET',
        baseUrl,
        pkce: true,
        stateStore,
        tokenStore,
      })

    const mlA = makeMl()
    const authUrl = mlA.authorizationUrl('https://app.com/cb')
    const state = new URL(authUrl).searchParams.get('state') as string

    // Instância B (outro OAuthClient) completa o fluxo com o MESMO state.
    const mlB = makeMl()
    const token = await mlB.authenticate('https://app.com/cb', 'code-456', state)

    expect(token.accessToken).toBe('token-auth')
    // O /oauth/token recebeu o code_verifier (sem ele o mock responde 400).
    const oauthReq = server.requests.find((r) => r.path === '/oauth/token')
    const oauthBody = oauthReq?.body as Record<string, unknown> | undefined
    expect(oauthBody?.code_verifier).toBeTruthy()
  })
})
