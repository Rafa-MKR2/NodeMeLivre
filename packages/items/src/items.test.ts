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

  it('deve iterar itens de todas as páginas com list()', async () => {
    const pages: Record<
      number,
      { results: unknown[]; paging: { total: number; offset: number; limit: number } }
    > = {
      0: { results: [item, { ...item, id: 'MLB2' }], paging: { total: 3, offset: 0, limit: 2 } },
      2: { results: [{ ...item, id: 'MLB3' }], paging: { total: 3, offset: 2, limit: 2 } },
    }
    const transport = fakeTransport((call) => pages[Number(call?.query?.offset)] ?? pages[0])

    const ids: string[] = []
    for await (const i of new Items(transport).list('MLB', { limit: 2 })) {
      ids.push(i.id)
    }

    expect(ids).toEqual(['MLB1', 'MLB2', 'MLB3'])
    expect(transport.calls).toHaveLength(2)
    expect(transport.calls[1]?.query).toEqual({ limit: 2, offset: 2 })
  })

  it('deve publicar um anúncio', async () => {
    const transport = fakeTransport(() => ({ ...item, status: 'active' }))
    await new Items(transport).publish('MLB1')
    expect(transport.calls[0]).toMatchObject({
      method: 'POST',
      path: '/items/MLB1/status',
      body: { status: 'active' },
    })
  })

  it('deve pausar um anúncio', async () => {
    const transport = fakeTransport(() => ({ ...item, status: 'paused' }))
    await new Items(transport).pause('MLB1')
    expect(transport.calls[0]).toMatchObject({
      method: 'POST',
      path: '/items/MLB1/status',
      body: { status: 'paused' },
    })
  })
})
