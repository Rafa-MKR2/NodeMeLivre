import { ApiError } from '@nodemelivre/errors'
import { describe, expect, it } from 'vitest'
import { parallel, parallelBestEffort, ResilientTransport } from './resilience.js'
import { fakeTransport } from './test-utils.js'

describe('parallel', () => {
  it('deve resolver todas as operações com sucesso', async () => {
    const result = await parallel({
      users: async () => 'u1',
      orders: async () => 'o1',
    })
    expect(result.data).toEqual({ users: 'u1', orders: 'o1' })
    expect(result.errors).toEqual([])
  })

  it('deve coletar falhas parciais sem lançar', async () => {
    const boom = new ApiError({ message: 'rate limited', status: 429, apiCode: 'rate_limit' })
    const result = await parallel({
      users: async () => 'u1',
      orders: async () => {
        throw boom
      },
    })
    expect(result.data.users).toBe('u1')
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toMatchObject({
      resource: 'orders',
      code: 'rate_limit',
      status: 429,
    })
    expect(result.errors[0]?.cause).toBe(boom)
  })

  it('deve marcar erros sem ApiError como UNKNOWN_ERROR', async () => {
    const result = await parallel({
      a: async () => {
        throw new Error('boom')
      },
    })
    expect(result.errors[0]).toMatchObject({ code: 'UNKNOWN_ERROR', message: 'boom' })
  })
})

describe('parallelBestEffort', () => {
  it('deve retornar apenas os dados resolvidos', async () => {
    const data = await parallelBestEffort({
      ok: async () => 1,
      fail: async () => {
        throw new Error('x')
      },
    })
    expect(data).toEqual({ ok: 1 })
  })

  it('deve chamar onError para cada falha', async () => {
    const called: unknown[] = []
    await parallelBestEffort(
      {
        a: async () => {
          throw new Error('a')
        },
      },
      (e) => {
        called.push(e)
      },
    )
    expect(called).toHaveLength(1)
    expect(called[0]).toMatchObject({ resource: 'a', code: 'UNKNOWN_ERROR' })
  })
})

describe('ResilientTransport', () => {
  const transport = fakeTransport(() => ({ ok: true }))

  it('deve retornar dados quando a chamada tem sucesso', async () => {
    const resilient = new ResilientTransport(transport)
    const result = await resilient.get<{ ok: boolean }>('/users/me')
    expect(result.data).toEqual({ ok: true })
    expect(result.error).toBeUndefined()
  })

  it('deve retornar erro como valor em falha da API', async () => {
    const failing = fakeTransport(() => {
      throw new ApiError({ message: 'not found', status: 404 })
    })
    const resilient = new ResilientTransport(failing)
    const result = await resilient.get('/items/x')
    expect(result.data).toBeUndefined()
    expect(result.error).toMatchObject({ status: 404, code: 'HTTP_404', resource: 'GET /items/x' })
  })

  it('deve propagar falha de rede como NETWORK_ERROR', async () => {
    const failing = fakeTransport(() => {
      throw new Error('connection refused')
    })
    const resilient = new ResilientTransport(failing)
    const result = await resilient.post('/items', {})
    expect(result.error).toMatchObject({ code: 'NETWORK_ERROR', message: 'connection refused' })
  })

  it('deve expor todos os métodos HTTP', async () => {
    const transport = fakeTransport(() => ({ ok: true }))
    const resilient = new ResilientTransport(transport)
    await resilient.get('/x')
    await resilient.post('/x', {})
    await resilient.put('/x', {})
    await resilient.patch('/x', {})
    await resilient.delete('/x')
    expect(transport.calls.map((c) => c.method)).toEqual(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])
  })
})
