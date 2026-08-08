import { parallel, parallelBestEffort, ResilientTransport } from '@nodemelivre/core'
import { MockMercadoLivreServer } from '@nodemelivre/core/test-utils'
import { ApiError } from '@nodemelivre/errors'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HttpClient } from './client.js'

/**
 * Chaos testing (Fase 4 do ANALISE_QUALIDADE_TECNICA): injeta latência,
 * instabilidade intermitente e partição por endpoint no mock server, e
 * valida a DEGRADAÇÃO PARCIAL do SDK — o que funciona segue, o que falha
 * vira erro parcial (padrão do painel: stats com `null` em vez de 500).
 */
describe('Chaos: latência, instabilidade e partição por endpoint', () => {
  let server: MockMercadoLivreServer
  let baseUrl: string

  beforeEach(async () => {
    server = new MockMercadoLivreServer()
    baseUrl = await server.start()
  })

  afterEach(async () => {
    await server.stop()
  })

  // Sem retry: os testes isolam o comportamento do chaos em si (o retry real
  // já é coberto em integration.test.ts).
  function createClient(): HttpClient {
    return new HttpClient({ baseUrl, retry: { maxRetries: 0 } })
  }

  it('latência fixa: a resposta chega depois do atraso injetado', async () => {
    server.respond('GET', '/lento', 200, { ok: true })
    server.chaos({ latencyMs: 150 })

    const startedAt = Date.now()
    const result = await createClient().get<{ ok: boolean }>('/lento')
    const elapsed = Date.now() - startedAt

    expect(result.ok).toBe(true)
    expect(elapsed).toBeGreaterThanOrEqual(120)
  })

  it('jitter: atraso determinístico com fonte aleatória injetável', async () => {
    server.respond('GET', '/com-jitter', 200, { ok: true })
    // random() = 0.5 → atraso = 0.5 * 100 = 50ms (não o máximo do jitter).
    server.chaos({ jitterMs: 100, random: () => 0.5 })

    const startedAt = Date.now()
    await createClient().get('/com-jitter')
    const elapsed = Date.now() - startedAt

    expect(elapsed).toBeGreaterThanOrEqual(40)
  })

  it('instabilidade intermitente determinística (sorteio injetado)', async () => {
    server.respond('GET', '/intermitente', 200, { ok: true })
    // Determinismo: cada requisição consome EXATAMENTE um sorteio (só o
    // failureRate chama random()); se um futuro recurso de chaos adicionar
    // outra chamada de random(), esta sequência precisa ser revista.
    const rolls = [0.1, 0.6, 0.2, 0.9] // < 0.5 falha; >= 0.5 passa
    let rollIndex = 0
    server.chaos({
      failureRate: 0.5,
      failStatus: 503,
      random: () => rolls[rollIndex++] ?? 1,
    })

    const results = await Promise.all(
      [0, 1, 2, 3].map(() =>
        createClient()
          .get<{ ok: boolean }>('/intermitente')
          .catch((e) => e),
      ),
    )

    const failures = results.filter((r): r is ApiError => r instanceof ApiError)
    const successes = results.filter((r): r is { ok: boolean } => !(r instanceof ApiError))

    expect(failures).toHaveLength(2) // 0.1 e 0.2 sortearam falha
    expect(successes).toHaveLength(2) // 0.6 e 0.9 passaram
    for (const failure of failures) {
      expect(failure.status).toBe(503)
    }
    for (const success of successes) {
      expect(success.ok).toBe(true)
    }
  })

  it('partição por endpoint: /items sempre 500, /orders lento, /users saudável', async () => {
    server.respond('GET', '/items/MLB1', 200, { id: 'MLB1' })
    server.respond('GET', '/orders/123', 200, { id: 123, status: 'paid' })
    server.respond('GET', '/users/me', 200, { id: 1 })
    server.chaos('/items', { failureRate: 1, failStatus: 500 })
    server.chaos('/orders', { latencyMs: 120 })

    const http = createClient()

    const itemsErr = await http.get('/items/MLB1').catch((e) => e)
    expect(itemsErr).toBeInstanceOf(ApiError)
    expect((itemsErr as ApiError).status).toBe(500)

    const startedAt = Date.now()
    const order = await http.get<{ id: number }>('/orders/123')
    const elapsed = Date.now() - startedAt
    expect(order.id).toBe(123)
    expect(elapsed).toBeGreaterThanOrEqual(90)

    const me = await http.get<{ id: number }>('/users/me')
    expect(me.id).toBe(1)
  })
})

describe('Degradação parcial sob chaos', () => {
  let server: MockMercadoLivreServer
  let baseUrl: string

  beforeEach(async () => {
    server = new MockMercadoLivreServer()
    baseUrl = await server.start()
    server.respond('GET', '/users/me', 200, { id: 1, nickname: 'vendedor' })
    server.respond('GET', '/orders/123', 200, { id: 123, status: 'paid' })
    server.respond('GET', '/items/MLB1', 200, { id: 'MLB1' })
    // /items fora do ar, /orders lento, /users saudável.
    server.chaos('/items', { failureRate: 1, failStatus: 500 })
    server.chaos('/orders', { latencyMs: 100 })
  })

  afterEach(async () => {
    await server.stop()
  })

  function createClient(): HttpClient {
    return new HttpClient({ baseUrl, retry: { maxRetries: 0 } })
  }

  it('parallelBestEffort: mantém o que funcionou e degrada o que falhou', async () => {
    const http = createClient()
    const onError = vi.fn()

    const data = await parallelBestEffort(
      {
        users: () => http.get('/users/me'),
        orders: () => http.get('/orders/123'),
        items: () => http.get('/items/MLB1'),
      },
      onError,
    )

    // Degradação parcial — padrão do painel: o que falha vira undefined,
    // o restante do dashboard continua funcionando.
    expect(data.users).toEqual({ id: 1, nickname: 'vendedor' })
    expect(data.orders).toEqual({ id: 123, status: 'paid' })
    expect(data.items).toBeUndefined()
    expect(onError).toHaveBeenCalledTimes(1)
    expect(onError.mock.calls[0]?.[0]).toMatchObject({ resource: 'items', status: 500 })
  })

  it('parallel: coleta os erros parciais com status sem lançar', async () => {
    const http = createClient()
    const result = await parallel({
      users: () => http.get('/users/me'),
      items: () => http.get('/items/MLB1'),
    })

    expect(result.data.users).toEqual({ id: 1, nickname: 'vendedor' })
    expect(result.data.items).toBeUndefined()
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toMatchObject({ resource: 'items', status: 500 })
  })

  it('ResilientTransport: retorna o erro como valor, sem lançar', async () => {
    const resilient = new ResilientTransport(createClient())

    const result = await resilient.get('/items/MLB1')

    expect(result.data).toBeUndefined()
    expect(result.error).toMatchObject({ resource: 'GET /items/MLB1', status: 500 })
  })
})
