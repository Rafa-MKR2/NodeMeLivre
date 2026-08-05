import { json, mockFetch, restoreFetch } from '@nodemelivre/core/test-utils'
import { ApiError, NetworkError, RateLimitError, UnauthorizedError } from '@nodemelivre/errors'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HttpClient, type HttpClientOptions, type TokenProvider } from './client.js'

const noDelay = async (): Promise<void> => {}

function client(overrides: HttpClientOptions = {}): HttpClient {
  return new HttpClient({
    delay: noDelay,
    retry: { maxRetries: 2, jitter: false, baseDelayMs: 1 },
    ...overrides,
  })
}

function provider(token: string | undefined, refresh?: () => Promise<void>): TokenProvider {
  return { getToken: vi.fn(async () => token), ...(refresh ? { refresh } : {}) }
}

afterEach(() => {
  restoreFetch()
})

describe('HttpClient.request', () => {
  it('deve montar a URL com query e devolver o JSON tipado', async () => {
    const spy = mockFetch((url) => {
      expect(url.href).toBe('https://api.mercadolibre.com/items/MLB1?offset=10')
      return json({ id: 'MLB1', title: 'Produto' })
    })

    const result = await client().get<{ id: string; title: string }>('/items/MLB1', {
      query: { offset: 10, extra: undefined },
    })

    expect(result.id).toBe('MLB1')
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('deve serializar o body como JSON com content-type', async () => {
    const spy = mockFetch((_url, init) => {
      expect(init.method).toBe('POST')
      expect(init.body).toBe(JSON.stringify({ title: 'Novo' }))
      const headers = new Headers(init.headers)
      expect(headers.get('content-type')).toBe('application/json')
      return json({ id: 'MLB2' })
    })

    const result = await client().post<{ id: string }>('/items', { title: 'Novo' })
    expect(result.id).toBe('MLB2')
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('deve passar FormData direto sem serializar como JSON', async () => {
    const spy = mockFetch((_url, init) => {
      expect(init.method).toBe('POST')
      expect(init.body).toBeInstanceOf(FormData)
      return json({ ok: true })
    })

    const form = new FormData()
    form.append('file', new Blob(['bytes']), 'foto.jpg')

    await client().post('/pictures/items/upload', form)
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('deve enviar o Authorization quando há token provider', async () => {
    mockFetch((_url, init) => {
      const headers = new Headers(init.headers)
      expect(headers.get('authorization')).toBe('Bearer token-123')
      return json({ ok: true })
    })

    await client({ auth: provider('token-123') }).get('/users/me')
  })

  it('deve mesclar headers padrão e por requisição', async () => {
    mockFetch((_url, init) => {
      const headers = new Headers(init.headers)
      expect(headers.get('x-tracker')).toBe('sdk-v1')
      expect(headers.get('x-custom')).toBe('yes')
      return json({ ok: true })
    })

    await client({ defaultHeaders: { 'x-tracker': 'sdk-v1' } }).get('/users/me', {
      headers: { 'x-custom': 'yes' },
    })
  })

  it('deve lançar UnauthorizedError em 401 sem refresh disponível', async () => {
    mockFetch(() => json({ message: 'Invalid token' }, 401))
    const err = await client()
      .get('/users/me')
      .catch((e) => e)
    expect(err).toBeInstanceOf(UnauthorizedError)
  })

  it('deve renovar o token em 401 e tentar de novo uma vez', async () => {
    let calls = 0
    const spy = mockFetch(() => {
      calls += 1
      if (calls === 1) return json({ message: 'expired' }, 401)
      return json({ id: 'MLB1' })
    })

    const refreshed = vi.fn(async () => {})
    const result = await client({ auth: provider('token-old', refreshed) }).get<{ id: string }>(
      '/items/MLB1',
      {
        headers: {},
      },
    )

    expect(result.id).toBe('MLB1')
    expect(refreshed).toHaveBeenCalledTimes(1)
    expect(spy).toHaveBeenCalledTimes(2)
  })

  it('deve aplicar retry em 429 e ter sucesso na próxima tentativa', async () => {
    let calls = 0
    const spy = mockFetch(() => {
      calls += 1
      if (calls < 3) return json({ message: 'rate limited' }, 429)
      return json({ id: 'MLB1' })
    })

    const result = await client().get<{ id: string }>('/items/MLB1')
    expect(result.id).toBe('MLB1')
    expect(spy).toHaveBeenCalledTimes(3)
  })

  it('deve lançar RateLimitError após esgotar as tentativas', async () => {
    mockFetch(() => json({ message: 'rate limited' }, 429))
    const err = await client()
      .get('/items/MLB1')
      .catch((e) => e)
    expect(err).toBeInstanceOf(RateLimitError)
  })

  it('deve lançar ApiError em 400 sem retry', async () => {
    const spy = mockFetch(() => json({ message: 'bad request' }, 400))
    const err = await client()
      .get('/items/MLB1')
      .catch((e) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('deve lançar NetworkError em falha de rede e não repetir POST', async () => {
    const spy = mockFetch(() => {
      throw new TypeError('fetch failed')
    })
    const err = await client()
      .post('/items', {})
      .catch((e) => e)
    expect(err).toBeInstanceOf(NetworkError)
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('deve repetir falha de rede em GET idempotente', async () => {
    const spy = mockFetch(() => {
      throw new TypeError('fetch failed')
    })
    const err = await client()
      .get('/items/MLB1')
      .catch((e) => e)
    expect(err).toBeInstanceOf(NetworkError)
    expect(spy).toHaveBeenCalledTimes(3)
  })

  it('deve desativar retry quando retry:false', async () => {
    const spy = mockFetch(() => json({ message: 'down' }, 503))
    await client({ retry: { maxRetries: 0 } })
      .get('/items/MLB1')
      .catch(() => {})
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('deve devolver undefined em 204', async () => {
    mockFetch(() => ({ status: 204, body: undefined }))
    const result = await client().delete<undefined>('/items/MLB1')
    expect(result).toBeUndefined()
  })
})
