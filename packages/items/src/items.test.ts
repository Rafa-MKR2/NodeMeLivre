import { fakeTransport } from '@nodemelivre/core/test-utils'
import { InputValidationError } from '@nodemelivre/errors'
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

  it('deve buscar itens do vendedor resolvendo os IDs em itens completos', async () => {
    const searchPage = { results: ['MLB1', 'MLB2'], paging: { total: 2, offset: 0, limit: 10 } }
    const transport = fakeTransport((call) => {
      if (call?.path === '/users/123/items/search') return searchPage
      const id = call?.path?.split('/').at(-1)
      return { id, title: `Produto ${id}`, status: 'active' }
    })

    const page = await new Items(transport).searchBySeller(123, { status: 'active' })

    expect(page.results).toEqual([
      { id: 'MLB1', title: 'Produto MLB1', status: 'active' },
      { id: 'MLB2', title: 'Produto MLB2', status: 'active' },
    ])
    // 1 chamada para a busca + 1 por ID
    expect(transport.calls[0]?.path).toBe('/users/123/items/search')
    expect(transport.calls[0]?.query).toEqual({ status: 'active' })
    expect(transport.calls.map((c) => c?.path)).toEqual([
      '/users/123/items/search',
      '/items/MLB1',
      '/items/MLB2',
    ])
  })

  it('deve iterar itens do vendedor resolvendo IDs com listBySeller()', async () => {
    const pages: Record<
      number,
      { results: string[]; paging: { total: number; offset: number; limit: number } }
    > = {
      0: { results: ['MLB1', 'MLB2'], paging: { total: 3, offset: 0, limit: 2 } },
      2: { results: ['MLB3'], paging: { total: 3, offset: 2, limit: 2 } },
    }
    const transport = fakeTransport((call) => {
      if (call?.path?.startsWith('/users/')) {
        return pages[Number(call?.query?.offset)] ?? pages[0]
      }
      const id = call?.path?.split('/').at(-1)
      return { id, title: `Produto ${id}`, status: 'active' }
    })

    const ids: string[] = []
    for await (const i of new Items(transport).listBySeller(123, { limit: 2 })) {
      ids.push(i.id)
    }

    expect(ids).toEqual(['MLB1', 'MLB2', 'MLB3'])
    expect(transport.calls[0]?.path).toBe('/users/123/items/search')
    expect(transport.calls[1]?.path).toBe('/items/MLB1')
    expect(transport.calls[2]?.path).toBe('/items/MLB2')
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

  it('createAndPublish deve apenas criar quando o item já nasce ativo', async () => {
    const transport = fakeTransport(() => item)
    const items = new Items(transport)
    await items.createAndPublish({ title: 'Produto', price: 10, available_quantity: 5 })

    expect(transport.calls).toHaveLength(1)
    expect(transport.calls[0]).toMatchObject({ method: 'POST', path: '/items' })
  })

  it('createAndPublish deve publicar quando o item nasce em outro status', async () => {
    const transport = fakeTransport((call) =>
      call?.path === '/items' ? { ...item, status: 'under_review' } : item,
    )
    const items = new Items(transport)
    await items.createAndPublish({ title: 'Produto', price: 10, available_quantity: 5 })

    expect(transport.calls).toHaveLength(2)
    expect(transport.calls[1]).toMatchObject({
      method: 'POST',
      path: '/items/MLB1/status',
      body: { status: 'active' },
    })
  })
})

describe('Items — validação de entrada', () => {
  it('create rejeita sem title nem family_name', async () => {
    const items = new Items(fakeTransport(() => item))
    await expect(items.create({ price: 10, available_quantity: 5 })).rejects.toThrow(
      'title ou family_name é obrigatório',
    )
    await expect(items.create({ price: 10, available_quantity: 5 })).rejects.toBeInstanceOf(
      InputValidationError,
    )
  })

  it('create aceita family_name (modelo User Product) em vez de title', async () => {
    const transport = fakeTransport(() => ({
      ...item,
      family_name: 'Fone Bluetooth TWS',
      title: 'Fone Bluetooth TWS',
    }))
    const input = { family_name: 'Fone Bluetooth TWS', price: 10, available_quantity: 5 }
    await new Items(transport).create(input)
    expect(transport.calls[0]).toMatchObject({ method: 'POST', path: '/items', body: input })
  })

  it('create rejeita title e family_name juntos (mutuamente exclusivos)', async () => {
    const items = new Items(fakeTransport(() => item))
    await expect(
      items.create({
        title: 'Título antigo',
        family_name: 'Família nova',
        price: 10,
        available_quantity: 5,
      }),
    ).rejects.toThrow('mutuamente exclusivos')
  })

  it('create rejeita family_name vazio', async () => {
    const items = new Items(fakeTransport(() => item))
    await expect(
      items.create({ family_name: '', price: 10, available_quantity: 5 }),
    ).rejects.toThrow('family_name deve ser uma string não vazia')
  })

  it('create rejeita preço não positivo', async () => {
    const items = new Items(fakeTransport(() => item))
    await expect(items.create({ title: 'x', price: 0, available_quantity: 5 })).rejects.toThrow(
      'price deve ser um número positivo',
    )
    await expect(items.create({ title: 'x', price: -1, available_quantity: 5 })).rejects.toThrow(
      'price',
    )
  })

  it('update rejeita estoque não inteiro ou negativo', async () => {
    const items = new Items(fakeTransport(() => item))
    await expect(items.update('MLB1', { available_quantity: 1.5 })).rejects.toThrow(
      'available_quantity deve ser um inteiro',
    )
    await expect(items.update('MLB1', { available_quantity: -2 })).rejects.toThrow(
      'available_quantity',
    )
  })

  it('update aceita campos parciais válidos', async () => {
    const transport = fakeTransport(() => item)
    await new Items(transport).update('MLB1', { price: 20 })
    expect(transport.calls[0]).toMatchObject({
      method: 'PUT',
      path: '/items/MLB1',
      body: { price: 20 },
    })
  })
})
