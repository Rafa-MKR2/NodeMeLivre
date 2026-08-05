import { json, mockFetch, restoreFetch } from '@nodemelivre/core/test-utils'
import { OAuthError } from '@nodemelivre/errors'
import type { HttpClient } from '@nodemelivre/http'
import { afterEach, describe, expect, it } from 'vitest'
import { OAuthClient } from './oauth.js'

function client(httpClient?: HttpClient): OAuthClient {
  return new OAuthClient({
    clientId: 'APP_ID',
    clientSecret: 'SECRET',
    siteId: 'MLB',
    ...(httpClient ? { httpClient } : {}),
  })
}

afterEach(() => {
  restoreFetch()
})

describe('OAuthClient.authorizationUrl', () => {
  it('deve montar a URL de autorização para MLB', () => {
    const url = client().authorizationUrl({ redirectUri: 'https://app.com/callback' })
    expect(url).toContain('https://auth.mercadolivre.com.br/authorization')
    expect(url).toContain('response_type=code')
    expect(url).toContain('client_id=APP_ID')
    expect(url).toContain('redirect_uri=https%3A%2F%2Fapp.com%2Fcallback')
  })

  it('deve incluir state quando informado', () => {
    const url = client().authorizationUrl({
      redirectUri: 'https://app.com/callback',
      state: 'csrf-token',
    })
    expect(url).toContain('state=csrf-token')
  })

  it('deve usar domínio correto por site', () => {
    const arg = new OAuthClient({ clientId: 'a', clientSecret: 'b', siteId: 'MLA' })
    expect(arg.authorizationUrl({ redirectUri: 'https://x.com' })).toContain(
      'https://auth.mercadolibre.com.ar/authorization',
    )
  })
})

describe('OAuthClient.exchangeCode', () => {
  it('deve trocar o code por AccessToken com expiração resolvida', async () => {
    const spy = mockFetch((_url, init) => {
      const body = JSON.parse(String(init.body))
      expect(body.grant_type).toBe('authorization_code')
      expect(body.client_secret).toBe('SECRET')
      return json({
        access_token: 'access-1',
        token_type: 'bearer',
        expires_in: 21600,
        scope: 'offline_access read write',
        user_id: 987,
        refresh_token: 'refresh-1',
      })
    })

    const now = Date.now()
    const token = await client().exchangeCode('code-1', { redirectUri: 'https://app.com/callback' })

    expect(token.accessToken).toBe('access-1')
    expect(token.refreshToken).toBe('refresh-1')
    expect(token.userId).toBe(987)
    expect(token.expiresAt).toBeGreaterThanOrEqual(now + 21600 * 1000)
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('deve lançar OAuthError quando a API rejeita o grant', async () => {
    mockFetch(() =>
      json(
        {
          error: 'invalid_grant',
          error_description: 'The code has expired',
        },
        400,
      ),
    )

    const err = await client()
      .exchangeCode('code-1', { redirectUri: 'https://app.com/callback' })
      .catch((e) => e)
    expect(err).toBeInstanceOf(OAuthError)
    expect(err.oauthError).toBe('invalid_grant')
  })
})

describe('OAuthClient.getAppToken', () => {
  it('deve pedir token de aplicação com client_credentials', async () => {
    mockFetch((_url, init) => {
      const body = JSON.parse(String(init.body))
      expect(body.grant_type).toBe('client_credentials')
      return json({
        access_token: 'app-token',
        token_type: 'bearer',
        expires_in: 3600,
        scope: 'read',
      })
    })

    const token = await client().getAppToken()
    expect(token.accessToken).toBe('app-token')
    expect(token.refreshToken).toBeUndefined()
  })
})
