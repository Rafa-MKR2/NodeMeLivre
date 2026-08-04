import { fakeTransport } from '@nodemelivre/core/test-utils'
import { describe, expect, it } from 'vitest'
import { Items } from './items.js'

const item = { id: 'MLB1', title: 'Produto', status: 'active' }

describe('Items', () => {
  it('deve buscar um item pelo id', async () => {
    const transport = fakeTransport(() => item)
    const items = new Items(transport)

    await items.get('MLB1')

    expect(transport.calls[0]).toMatchObject({ method: 'GET', path: '/items/MLB1' })
  })

  it('deve buscar a descrição do item', async () => {
    const transport = fakeTransport(() => ({ text: 'desc' }))
    await new Items(transport).getDescription('MLB1')
    expect(transport.calls[0]).toMatchObject({ path: '/items/MLB1/description' })
  })

  it('deve criar um anúncio', async () => {
    const transport = fakeTransport(() => item)
    const input = { title: 'Produto', price: 10, available_quantity: 5 }
    await new Items(transport).create(input)
    expect(transport.calls[0]).toMatchObject({ method: 'POST', path: '/items', body: input })
  })

  it('deve atualizar campos do anúncio', async () => {
    const transport = fakeTransport(() => item)
    await new Items(transport).update('MLB1', { price: 12 })
    expect(transport.calls[0]).toMatchObject({
      method: 'PUT',
      path: '/items/MLB1',
      body: { price: 12 },
    })
  })

  it('deve atualizar a descrição', async () => {
    const transport = fakeTransport(() => ({ id: 'd1', text: 'x' }))
    await new Items(transport).updateDescription('MLB1', 'nova descrição')
    expect(transport.calls[0]).toMatchObject({
      method: 'PUT',
      path: '/items/MLB1/description',
      body: { plain_text: 'nova descrição' },
    })
  })

  it('deve alterar o status do anúncio', async () => {
    const transport = fakeTransport(() => item)
    await new Items(transport).updateStatus('MLB1', 'closed')
    expect(transport.calls[0]).toMatchObject({
      method: 'POST',
      path: '/items/MLB1/status',
      body: { status: 'closed' },
    })
  })

  it('deve buscar itens por site com query montada', async () => {
    const transport = fakeTransport(() => ({
      results: [item],
      paging: { total: 1, offset: 0, limit: 10 },
    }))
    await new Items(transport).search('MLB', { q: 'fone', offset: 20, status: 'active' })

    const call = transport.calls[0]
    expect(call).toBeDefined()
    expect(call?.path).toBe('/sites/MLB/search')
    expect(call?.query).toEqual({ q: 'fone', offset: 20, status: 'active' })
  })
})
