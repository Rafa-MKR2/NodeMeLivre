import { fakeTransport } from '@nodemelivre/core/test-utils'
import { PollingTimeoutError } from '@nodemelivre/errors'
import { describe, expect, it, vi } from 'vitest'
import { Orders } from './orders.js'

const order = { id: 123, total_amount: 50, order_items: [] }

describe('Orders', () => {
  it('deve buscar uma venda pelo id', async () => {
    const transport = fakeTransport(() => order)
    await new Orders(transport).get(123)
    expect(transport.calls[0]).toMatchObject({ method: 'GET', path: '/orders/123' })
  })

  it('deve buscar vendas com query', async () => {
    const transport = fakeTransport(() => ({
      results: [order],
      paging: { total: 1, offset: 0, limit: 10 },
    }))
    await new Orders(transport).search({ seller: 42, status: 'paid' })

    const call = transport.calls[0]
    expect(call).toBeDefined()
    expect(call?.path).toBe('/orders/search')
    expect(call?.query).toEqual({ seller: 42, status: 'paid' })
  })

  it('deve listar os itens de uma venda', async () => {
    const transport = fakeTransport(() => [])
    await new Orders(transport).items(123)
    expect(transport.calls[0]).toMatchObject({ path: '/orders/123/items' })
  })

  it('deve retornar a venda já paga sem aguardar', async () => {
    const transport = fakeTransport(() => ({ ...order, status: 'paid' }))
    const paid = await new Orders(transport).waitUntilPaid(123, { timeoutMs: 100, intervalMs: 10 })
    expect(paid.status).toBe('paid')
    expect(transport.calls).toHaveLength(1)
  })

  it('deve aguardar até o pedido ser pago', async () => {
    const statuses = ['payment_required', 'payment_required', 'paid']
    const transport = fakeTransport(() => {
      const status = statuses.shift() ?? 'paid'
      return { ...order, status }
    })

    const paid = await new Orders(transport).waitUntilPaid(123, {
      timeoutMs: 1_000,
      intervalMs: 10,
    })
    expect(paid.status).toBe('paid')
    expect(transport.calls).toHaveLength(3)
  })

  it('deve lançar PollingTimeoutError quando o pedido não pagar a tempo', async () => {
    vi.useFakeTimers()
    try {
      const transport = fakeTransport(() => ({ ...order, status: 'payment_required' }))
      const orders = new Orders(transport)

      const promise = orders.waitUntilPaid(123, { timeoutMs: 100, intervalMs: 50 }).then(
        () => undefined,
        (e) => e,
      )
      await vi.advanceTimersByTimeAsync(250)

      await expect(promise).resolves.toBeInstanceOf(PollingTimeoutError)
    } finally {
      vi.useRealTimers()
    }
  })

  it('deve abortar o polling quando o signal é cancelado', async () => {
    vi.useFakeTimers()
    try {
      const transport = fakeTransport(() => ({ ...order, status: 'payment_required' }))
      const controller = new AbortController()
      const orders = new Orders(transport)

      const promise = orders
        .waitUntilPaid(123, { timeoutMs: 10_000, intervalMs: 50, signal: controller.signal })
        .then(
          () => undefined,
          (e) => e,
        )

      controller.abort()
      await vi.advanceTimersByTimeAsync(100)

      const err = await promise
      expect(err).toBeInstanceOf(Error)
      expect((err as Error).name).toBe('AbortError')
    } finally {
      vi.useRealTimers()
    }
  })
})
