import { fakeTransport } from '@nodemelivre/core/test-utils'
import { describe, expect, it } from 'vitest'
import { Messages } from './messages.js'

const message = {
  id: 987654,
  from: { user_id: 123 },
  to: { user_id: 456, resource: 'orders/2195160686' },
  text: 'Olá, seu pedido foi enviado',
  date_created: '2026-01-01T10:00:00Z',
}

describe('Messages', () => {
  it('deve listar mensagens de um pack', async () => {
    const transport = fakeTransport(() => [message])
    await new Messages(transport).list(2000000000, 123)

    const call = transport.calls[0]
    expect(call).toBeDefined()
    expect(call?.path).toBe('/messages/packs/2000000000/sellers/123')
    expect(call?.query).toEqual({ tag: 'post_sale' })
  })

  it('deve listar sem marcar como lido quando markAsRead=false', async () => {
    const transport = fakeTransport(() => [])
    await new Messages(transport).list('abc', '123', { markAsRead: false })
    expect(transport.calls[0]?.query).toEqual({ tag: 'post_sale', mark_as_read: false })
  })

  it('deve buscar uma mensagem pelo id', async () => {
    const transport = fakeTransport(() => message)
    await new Messages(transport).get(987654)
    expect(transport.calls[0]).toMatchObject({
      method: 'GET',
      path: '/messages/987654',
      query: { tag: 'post_sale' },
    })
  })

  it('deve enviar uma mensagem', async () => {
    const transport = fakeTransport(() => message)
    await new Messages(transport).send({
      from: { user_id: 123 },
      to: { user_id: 456, resource: 'orders/2195160686', site_id: 'MLB' },
      text: 'Olá, seu pedido foi enviado',
    })

    expect(transport.calls[0]).toMatchObject({
      method: 'POST',
      path: '/messages',
      query: { tag: 'post_sale' },
      body: {
        from: { user_id: 123 },
        to: { user_id: 456, resource: 'orders/2195160686', site_id: 'MLB' },
        text: 'Olá, seu pedido foi enviado',
      },
    })
  })
})
