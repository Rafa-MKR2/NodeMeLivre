import { describe, expect, it } from 'vitest'
import { fakeTransport } from '../test-utils.js'
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
})
