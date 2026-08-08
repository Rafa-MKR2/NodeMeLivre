import { MockMercadoLivreServer } from '@nodemelivre/core/test-utils'
import { ApiError, NetworkError } from '@nodemelivre/errors'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HttpClient, type HttpClientOptions, type TokenProvider } from './client.js'
import { RateLimiter } from './rate-limit.js'

function provider(
  token: string | (() => string | undefined),
  refresh?: () => Promise<void>,
): TokenProvider {
  const resolve = typeof token === 'function' ? token : () => token
  return { getToken: vi.fn(async () => resolve()), ...(refresh !== undefined ? { refresh } : {}) }
}

/**
 * Testes de integração real: fetch nativo contra um mock server HTTP do
 * Mercado Livre (node:http, zero dependências). Valida o contrato HTTP e os
 * comportamentos de resiliência que os testes unitários (mock de fetch) não
 * cobrem: rede real, conexão recusada, timeout e espera de rate limit.
 */
describe('Integração HTTP real — contrato e resiliência', () => {
  let server: MockMercadoLivreServer
  let baseUrl: string

  beforeEach(async () => {
    server = new MockMercadoLivreServer()
    baseUrl = await server.start()
  })

  afterEach(async () => {
    await server.stop()
  })

  function createClient(overrides: HttpClientOptions = {}): HttpClient {
    return new HttpClient({
      baseUrl,
      retry: { maxRetries: 2, baseDelayMs: 5, jitter: false },
      ...overrides,
    })
  }

  describe('Contrato HTTP', () => {
    it('GET: envia método, path, query e Authorization corretos', async () => {
      server.respond('GET', '/items/MLB1', 200, { id: 'MLB1', title: 'Produto' })

      const result = await createClient({ auth: provider('token-1') }).get<{ id: string }>(
        '/items/MLB1',
        { query: { attr: 'price', skip: undefined } },
      )

      expect(result.id).toBe('MLB1')
      expect(server.requests).toHaveLength(1)
      const req = server.requests[0]
      expect(req?.method).toBe('GET')
      expect(req?.path).toBe('/items/MLB1')
      expect(req?.query.get('attr')).toBe('price')
      expect(req?.query.has('skip')).toBe(false)
      expect(req?.headers.authorization).toBe('Bearer token-1')
    })

    it('POST: serializa JSON e define content-type no body', async () => {
      server.route('POST', '/items', () => ({ json: { id: 'MLB2' } }))

      const result = await createClient().post<{ id: string }>('/items', { title: 'Novo' })

      expect(result.id).toBe('MLB2')
      const req = server.requests[0]
      expect(req?.body).toEqual({ title: 'Novo' })
      expect(req?.headers['content-type']).toContain('application/json')
    })

    it('mescla headers padrão e por requisição', async () => {
      server.route('GET', '/users/me', () => ({ json: { id: 1 } }))
      await createClient({ defaultHeaders: { 'x-tracker': 'sdk-v1' } }).get('/users/me', {
        headers: { 'x-custom': 'yes' },
      })

      const req = server.requests[0]
      expect(req?.headers['x-tracker']).toBe('sdk-v1')
      expect(req?.headers['x-custom']).toBe('yes')
    })

    it('parse de resposta: text e arraybuffer', async () => {
      server.route('GET', '/texto', () => ({ text: 'conteúdo plano' }))
      server.respond('GET', '/binario', 200, { bytes: true })

      const text = await createClient().get<string>('/texto', { responseType: 'text' })
      expect(text).toBe('conteúdo plano')

      const buf = await createClient().get<ArrayBuffer>('/binario', {
        responseType: 'arraybuffer',
      })
      expect(buf).toBeInstanceOf(ArrayBuffer)
    })

    it('devole undefined em 204', async () => {
      server.respond('DELETE', '/items/MLB1', 204)
      const result = await createClient().delete<undefined>('/items/MLB1')
      expect(result).toBeUndefined()
      expect(server.requests[0]?.method).toBe('DELETE')
    })
  })

  describe('Resiliência', () => {
    it('retenta 5xx com backoff e emite o evento retry', async () => {
      let calls = 0
      server.route('GET', '/instavel', () => {
        calls += 1
        return calls < 3
          ? { status: 503, json: { message: 'tente de novo' } }
          : { json: { ok: true } }
      })

      const http = createClient()
      const onRetry = vi.fn()
      http.on('retry', onRetry)

      const result = await http.get<{ ok: boolean }>('/instavel')

      expect(result.ok).toBe(true)
      expect(calls).toBe(3)
      expect(onRetry).toHaveBeenCalledTimes(2)
    })

    it('lança ApiError com o status real após esgotar os retries', async () => {
      server.respond('GET', '/quebrado', 500, { message: 'erro interno' })

      const http = createClient()
      const onError = vi.fn()
      http.on('httpError', onError)

      const err = await http.get('/quebrado').catch((e) => e)

      expect(err).toBeInstanceOf(ApiError)
      expect((err as ApiError).status).toBe(500)
      expect(server.requests).toHaveLength(3) // 1 tentativa + 2 retries
      expect(onError).toHaveBeenCalledTimes(3)
    })

    it('retenta 429 usando Retry-After', async () => {
      let calls = 0
      server.route('GET', '/limitado', () => {
        calls += 1
        return calls === 1
          ? {
              status: 429,
              headers: { 'retry-after': '0' },
              json: { message: 'muitas requisições' },
            }
          : { json: { ok: true } }
      })

      const result = await createClient().get<{ ok: boolean }>('/limitado')

      expect(result.ok).toBe(true)
      expect(calls).toBe(2)
    })

    it('retenta POST em 5xx (a política retenta 5xx independente do método)', async () => {
      server.respond('POST', '/items', 500, { message: 'erro interno' })

      const err = await createClient()
        .post('/items', {})
        .catch((e) => e)

      expect(err).toBeInstanceOf(ApiError)
      expect((err as ApiError).status).toBe(500)
      expect(server.requests).toHaveLength(3) // 5xx sempre entra no orçamento de retry
    })

    it('renova o token em 401 e repete a requisição com o token novo', async () => {
      let token = 'token-antigo'
      server.route('GET', '/autenticado', (req) =>
        req.headers.authorization === 'Bearer token-novo'
          ? { json: { ok: true } }
          : { status: 401, json: { message: 'token expirado' } },
      )

      const refreshed = vi.fn(async () => {
        token = 'token-novo'
      })
      const http = createClient({ auth: provider(() => token, refreshed) })
      const result = await http.get<{ ok: boolean }>('/autenticado')

      expect(result.ok).toBe(true)
      expect(refreshed).toHaveBeenCalledTimes(1)
      expect(server.requests).toHaveLength(2)
      expect(server.requests[0]?.headers.authorization).toBe('Bearer token-antigo')
      expect(server.requests[1]?.headers.authorization).toBe('Bearer token-novo')
    })

    it('timeout aborta a requisição e vira NetworkError', async () => {
      server.route('GET', '/lento', () => ({ delayMs: 500, json: { ok: true } }))

      // Sem retry: o teste isola o comportamento de timeout em si.
      const err = await createClient({ defaultTimeoutMs: 100, retry: { maxRetries: 0 } })
        .get('/lento')
        .catch((e) => e)

      expect(err).toBeInstanceOf(NetworkError)
    })
  })

  describe('Rate limit e falhas de rede', () => {
    it('espera o reset do rate limit por recurso antes de prosseguir', async () => {
      let calls = 0
      server.route('GET', '/recursos', () => {
        calls += 1
        if (calls === 1) {
          return {
            json: { ok: true },
            headers: {
              'x-rate-limit-limit': '10',
              'x-rate-limit-remaining': '0',
              'x-rate-limit-reset': String(Date.now() + 250),
            },
          }
        }
        return { json: { ok: true } }
      })

      const http = new HttpClient({ baseUrl, rateLimiter: new RateLimiter() })
      const onRateLimit = vi.fn()
      http.on('rateLimit', onRateLimit)

      const startedAt = Date.now()
      await http.get('/recursos')
      await http.get('/recursos')
      const elapsed = Date.now() - startedAt

      expect(calls).toBe(2)
      expect(onRateLimit).toHaveBeenCalledTimes(1)
      // A segunda requisição só saiu depois do reset (~250ms).
      expect(elapsed).toBeGreaterThanOrEqual(200)
    })

    it('rede particionada: conexão recusada vira NetworkError', async () => {
      const dead = new MockMercadoLivreServer()
      try {
        const deadUrl = await dead.start()
        await dead.stop() // derruba o servidor: próximas conexões são recusadas

        const err = await new HttpClient({ baseUrl: deadUrl }).get('/items/MLB1').catch((e) => e)

        expect(err).toBeInstanceOf(NetworkError)
      } finally {
        await dead.stop() // garante que o servidor é derrubado mesmo em falha
      }
    })

    it('rede particionada em POST não é retentada (método não-idempotente)', async () => {
      const dead = new MockMercadoLivreServer()
      try {
        const deadUrl = await dead.start()
        await dead.stop()

        const http = new HttpClient({
          baseUrl: deadUrl,
          retry: { maxRetries: 2, baseDelayMs: 5, jitter: false },
        })
        const onError = vi.fn()
        http.on('httpError', onError)

        const err = await http.post('/items', {}).catch((e) => e)

        expect(err).toBeInstanceOf(NetworkError)
        // Método não-idempotente não entra no retry de falha de rede.
        expect(onError).toHaveBeenCalledTimes(1)
      } finally {
        await dead.stop()
      }
    })
  })
})
