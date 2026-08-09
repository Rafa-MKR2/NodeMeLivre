import { json, mockFetch, restoreFetch } from '@nodemelivre/core/test-utils'
import {
  ApiError,
  InputValidationError,
  NetworkError,
  RateLimitError,
  UnauthorizedError,
} from '@nodemelivre/errors'
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

  it('deve renovar o token em 401 mesmo com retry desativado', async () => {
    let calls = 0
    const spy = mockFetch(() => {
      calls += 1
      if (calls === 1) return json({ message: 'expired' }, 401)
      return json({ id: 'MLB1' })
    })

    const refreshed = vi.fn(async () => {})
    const result = await client({
      auth: provider('token-old', refreshed),
      retry: { maxRetries: 0 },
    }).get<{ id: string }>('/items/MLB1')

    expect(result.id).toBe('MLB1')
    expect(refreshed).toHaveBeenCalledTimes(1)
    expect(spy).toHaveBeenCalledTimes(2)
  })

  it('deve lançar o erro real do 401 quando o refresh esgota as tentativas', async () => {
    mockFetch(() => json({ message: 'expired' }, 401))
    const refreshed = vi.fn(async () => {})
    const err = await client({
      auth: provider('token-old', refreshed),
      retry: { maxRetries: 0 },
    })
      .get('/users/me')
      .catch((e) => e)

    expect(err).toBeInstanceOf(UnauthorizedError)
    expect((err as UnauthorizedError).status).toBe(401)
    expect(refreshed).toHaveBeenCalledTimes(1)
  })

  it('retry:false não ganha retry extra por ter auth+refresh (F1, pente fino)', async () => {
    // O slot de refresh era somado ao maxAttempts — `retry:false` com auth
    // presente ganhava 1 reenvio em 503/429 mesmo tendo sido desativado.
    const spy = mockFetch(() => json({ message: 'down' }, 503))
    const err = await client({
      auth: provider(
        'token-x',
        vi.fn(async () => {}),
      ),
    })
      .get('/items/MLB1', { retry: false })
      .catch((e) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('maxRetries:0 não ganha retry extra por ter auth+refresh (F1, pente fino)', async () => {
    const spy = mockFetch(() => json({ message: 'down' }, 503))
    const err = await client({
      auth: provider(
        'token-x',
        vi.fn(async () => {}),
      ),
      retry: { maxRetries: 0 },
    })
      .get('/items/MLB1')
      .catch((e) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('auth:false não dispara refresh em 401 (F8, pente fino)', async () => {
    const spy = mockFetch(() => json({ message: 'public only' }, 401))
    const refreshed = vi.fn(async () => {})
    const err = await client({ auth: provider('token-x', refreshed) })
      .get('/public', { auth: false })
      .catch((e) => e)
    expect(err).toBeInstanceOf(UnauthorizedError)
    expect(refreshed).not.toHaveBeenCalled()
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('abort do usuário vira AbortError e não é retentado (F2, pente fino)', async () => {
    const controller = new AbortController()
    controller.abort()
    const spy = mockFetch(() => {
      throw new Error('fetch interrompido')
    })

    const err = await client()
      .get('/items/MLB1', { signal: controller.signal })
      .catch((e) => e)

    // Sem abort: GET idempotente retentaria 3x; abortado, o AbortError sai
    // imediatamente (contrato `e.name === AbortError`, mesmo do paginate).
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).name).toBe('AbortError')
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('abort do usuário com fetch real rejeitando por abort também não retenta (F2, pente fino)', async () => {
    const controller = new AbortController()
    const spy = vi.fn(async (_url: unknown, init: RequestInit | undefined) => {
      // Simula o fetch real: o abort rejeita a promise quando o signal dispara.
      await new Promise<void>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const e = new Error('This operation was aborted')
          e.name = 'AbortError'
          reject(e)
        })
      })
    })
    const http = new HttpClient({
      fetchImpl: spy as unknown as typeof fetch,
      retry: { maxRetries: 3, jitter: false },
    })

    const pending = http.get('/items/MLB1', { signal: controller.signal }).catch((e) => e)
    controller.abort()
    const err = await pending
    expect((err as Error).name).toBe('AbortError')
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('refresh que falha propaga o erro tipado do 401 original (M4, pente fino)', async () => {
    mockFetch(() => ({
      body: { message: 'expired' },
      status: 401,
      headers: { 'x-request-id': 'req-123' },
    }))
    const refreshed = vi.fn(async () => {
      throw new Error('invalid_grant — refresh_token rotacionado')
    })
    const err = await client({ auth: provider('token-old', refreshed), retry: { maxRetries: 0 } })
      .get('/users/me')
      .catch((e) => e)
    // O contrato de erro (Rodada 3) é preservado: o chamador recebe o 401
    // tipado (status/requestId), não o erro cru do refresh.
    expect(err).toBeInstanceOf(UnauthorizedError)
    expect((err as UnauthorizedError).status).toBe(401)
    expect((err as UnauthorizedError).requestId).toBe('req-123')
    expect(refreshed).toHaveBeenCalledTimes(1)
  })

  it('não deve injetar headers de resposta por padrão', async () => {
    mockFetch((_url, init) => {
      const headers = new Headers(init.headers)
      expect(headers.get('x-frame-options')).toBeNull()
      expect(headers.get('x-content-type-options')).toBeNull()
      return json({ ok: true })
    })
    await client().get('/users/me')
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

  it('não dorme dias com Retry-After gigante (cap no backoff)', async () => {
    const delays: number[] = []
    mockFetch(() => ({
      status: 429,
      headers: { 'retry-after': '999999' },
      body: undefined,
    }))

    await client({
      delay: async (ms) => {
        delays.push(ms)
      },
    })
      .get('/items/MLB1')
      .catch(() => {})

    // 3 tentativas (2 retries) — cada backoff capped em MAX_WAIT_MS (5 min).
    expect(delays).toHaveLength(2)
    for (const d of delays) {
      expect(d).toBeLessThanOrEqual(5 * 60 * 1000)
    }
  })

  it('deve lançar ApiError em 400 sem retry', async () => {
    const spy = mockFetch(() => json({ message: 'bad request' }, 400))
    const err = await client()
      .get('/items/MLB1')
      .catch((e) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('deve rejeitar path absoluto ou protocol-relative (guard de origem)', async () => {
    const spy = mockFetch(() => json({ ok: true }))

    const err1 = await client({ auth: provider('token-123') })
      .get('https://evil.com/y')
      .catch((e) => e)
    expect(err1).toBeInstanceOf(InputValidationError)

    const err2 = await client({ auth: provider('token-123') })
      .get('//evil.example.com/x')
      .catch((e) => e)
    expect(err2).toBeInstanceOf(InputValidationError)

    expect(spy).not.toHaveBeenCalled() // o token nunca sai do processo
  })

  it('deve rejeitar bypass do origin guard por whitespace/C0 leading (Rodada 8)', async () => {
    const spy = mockFetch(() => json({ ok: true }))
    const clientInstance = client({ auth: provider('token-123') })

    // O WHATWG URL parser ignora whitespace/C0 leading: `  //evil.com/x` e
    // `\thttps://evil.com/y` passam no guard antigo (regex/startsWith no input)
    // e resolvem para outro origin — exfiltrando o Authorization.
    const vectors = [
      '  //evil.com/x', // espaço leading
      '\t//evil.com/x', // tab leading
      '\r//evil.com/x', // CR leading
      '\u0001//evil.com/x', // C0 control leading
      '\f//evil.com/x', // form feed leading
      ' https://evil.com/z', // espaço leading + scheme
      '\thttps://evil.com/y', // tab leading + scheme
    ]
    for (const path of vectors) {
      const err = await clientInstance.get(path).catch((e) => e)
      expect(err).toBeInstanceOf(InputValidationError)
    }

    expect(spy).not.toHaveBeenCalled() // nenhum vetor chegou ao fetch
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

  it('deve devolver null (não a string "null") para corpo JSON literal null (Rodada 9)', async () => {
    mockFetch(() => json(null))
    const result = await client().get<unknown>('/endpoint')
    expect(result).toBeNull()
    expect(typeof result).not.toBe('string')
  })

  it('deve devolver false e 0 (valores JSON falsy) preservados (Rodada 9)', async () => {
    mockFetch(() => json(false))
    expect(await client().get<unknown>('/endpoint')).toBe(false)
    mockFetch(() => json(0))
    expect(await client().get<unknown>('/endpoint')).toBe(0)
  })

  it('deve devolver ArrayBuffer com responseType arraybuffer', async () => {
    const pdf = new Uint8Array([37, 80, 68, 70]) // "%PDF"
    const spy = vi.fn(async () => new Response(pdf, { status: 200 }))
    vi.stubGlobal('fetch', spy)

    const result = await client().get<ArrayBuffer>('/shipment_labels', {
      responseType: 'arraybuffer',
    })

    expect(result).toBeInstanceOf(ArrayBuffer)
    expect(new Uint8Array(result)).toEqual(pdf)
  })

  it('deve devolver texto com responseType text', async () => {
    const spy = vi.fn(async () => new Response('conteúdo plano', { status: 200 }))
    vi.stubGlobal('fetch', spy)

    const result = await client().get<string>('/endpoint', { responseType: 'text' })
    expect(result).toBe('conteúdo plano')
  })
})

describe('HttpClient — redirecionamentos seguros', () => {
  it('segue redirect do mesmo host', async () => {
    const spy = mockFetch((url) => {
      if (url.pathname === '/antigo') {
        return { status: 302, headers: { location: '/novo' }, body: undefined }
      }
      return json({ ok: true })
    })

    const result = await client().get<{ ok: boolean }>('/antigo')
    expect(result.ok).toBe(true)
    // 1 chamada no /antigo + 1 no /novo
    expect(spy).toHaveBeenCalledTimes(2)
  })

  it('não reenvia Authorization em redirect cross-origin autorizado', async () => {
    const seenAuth: Array<string | null> = []
    const spy = mockFetch((url, init) => {
      const headers = new Headers(init.headers)
      seenAuth.push(headers.get('authorization'))
      if (url.pathname === '/antigo') {
        return {
          status: 302,
          headers: { location: 'https://api.mercadolivre.com.br/final' },
          body: undefined,
        }
      }
      return json({ ok: true })
    })

    await client({ auth: provider('SECRET_TOKEN'), retry: { maxRetries: 0 } }).get('/antigo')

    // O Bearer vai na origem (api.mercadolibre.com) e é removido no hop
    // cross-origin (api.mercadolivre.com.br) — comportamento do fetch.
    expect(seenAuth).toEqual(['Bearer SECRET_TOKEN', null])
    expect(spy).toHaveBeenCalledTimes(2)
  })

  it('mantém o Authorization em redirect same-origin', async () => {
    const seenAuth: Array<string | null> = []
    mockFetch((url, init) => {
      const headers = new Headers(init.headers)
      seenAuth.push(headers.get('authorization'))
      if (url.pathname === '/antigo') {
        return {
          status: 302,
          headers: { location: '/novo' },
          body: undefined,
        }
      }
      return json({ ok: true })
    })

    await client({ auth: provider('SECRET_TOKEN'), retry: { maxRetries: 0 } }).get('/antigo')
    expect(seenAuth).toEqual(['Bearer SECRET_TOKEN', 'Bearer SECRET_TOKEN'])
  })

  it('bloqueia redirect para host não autorizado', async () => {
    const spy = mockFetch(() => ({
      status: 302,
      headers: { location: 'http://evil.example.com/steal' },
      body: undefined,
    }))

    const err = await client({ retry: { maxRetries: 0 } })
      .get('/antigo')
      .catch((e) => e)

    expect(err).toBeInstanceOf(NetworkError)
    expect(spy).toHaveBeenCalledTimes(1) // nunca chega no host malicioso
  })

  it('bloqueia downgrade https→http no redirect', async () => {
    const spy = mockFetch(() => ({
      status: 302,
      headers: { location: 'http://api.mercadolibre.com/novo' },
      body: undefined,
    }))

    const err = await client({ retry: { maxRetries: 0 } })
      .get('/antigo')
      .catch((e) => e)

    expect(err).toBeInstanceOf(NetworkError)
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('bloqueia loop infinito de redirects', async () => {
    const spy = mockFetch(() => ({
      status: 302,
      headers: { location: '/loop' },
      body: undefined,
    }))

    const err = await client({ retry: { maxRetries: 0 } })
      .get('/loop')
      .catch((e) => e)

    expect(err).toBeInstanceOf(NetworkError)
    // 1 inicial + 5 hops máximos
    expect(spy).toHaveBeenCalledTimes(6)
  })

  it('emite evento response com clone — listener pode consumir body sem quebrar o SDK (O4)', async () => {
    let emittedResponse: Response | null = null
    mockFetch(() => json({ data: 'ok' }))

    const http = client()
    http.on('response', (res) => {
      emittedResponse = res
    })

    const result = await http.get<{ data: string }>('/test')
    expect(result.data).toBe('ok')

    // O listener recebeu um clone — o body do original ainda pode ser lido pelo SDK.
    expect(emittedResponse).toBeInstanceOf(Response)
    // Clone ainda tem o body legível.
    const text = await (emittedResponse as unknown as Response).text()
    expect(text).toContain('"data":"ok"')
  })
})
