import { fakeTransport } from '@nodemelivre/core/test-utils'
import { InputValidationError } from '@nodemelivre/errors'
import { describe, expect, it } from 'vitest'
import { MESSAGE_TEXT_MAX_LENGTH, Messages } from './messages.js'

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

  it('deve normalizar resposta objeto { messages: [...] } do ML', async () => {
    // O ML às vezes devolve um objeto (com paging/from/to) em vez de array.
    const transport = fakeTransport(() => ({ messages: [message], paging: { total: 1 } }))
    const msgs = await new Messages(transport).list(2000000000, 123)
    expect(msgs).toHaveLength(1)
    expect(msgs[0]).toMatchObject({ id: 987654 })
  })

  it('deve devolver [] para resposta com formato inesperado (sem crash)', async () => {
    const transport = fakeTransport(() => ({ foo: 'bar' }))
    const msgs = await new Messages(transport).list(2000000000, 123)
    expect(msgs).toEqual([])
  })

  it('conversation expõe o envelope com from/to (Agente) e messages', async () => {
    const transport = fakeTransport(() => ({
      pack_id: 2000000000,
      from: { user_id: 123, nickname: 'vendedor' },
      to: { user_id: 789, nickname: 'Agente MLB' },
      messages: [message],
    }))
    const convo = await new Messages(transport).conversation(2000000000, 123)

    expect(convo.messages).toHaveLength(1)
    expect(convo.from?.user_id).toBe(123)
    expect(convo.to?.user_id).toBe(789)
    expect(transport.calls[0]?.path).toBe('/messages/packs/2000000000/sellers/123')
    expect(transport.calls[0]?.query).toEqual({ tag: 'post_sale' })
  })

  it('conversation trata array direto e markAsRead=false', async () => {
    const transport = fakeTransport(() => [message])
    const convo = await new Messages(transport).conversation(2000000000, 123, { markAsRead: false })
    expect(convo.messages).toHaveLength(1)
    expect(convo.to).toBeUndefined()
    expect(transport.calls[0]?.query).toEqual({ tag: 'post_sale', mark_as_read: false })
  })

  it('conversation aceita participante com id em vez de user_id', async () => {
    const transport = fakeTransport(() => ({ to: { id: 789 }, messages: [] }))
    const convo = await new Messages(transport).conversation(2000000000, 123)
    expect(convo.to?.user_id).toBe(789)
  })

  it('conversation não lança em formato inesperado', async () => {
    const transport = fakeTransport(() => 'estranho')
    const convo = await new Messages(transport).conversation(2000000000, 123)
    expect(convo.messages).toEqual([])
    expect(convo.to).toBeUndefined()
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

  it('deve rejeitar texto acima do limite de caracteres', async () => {
    const transport = fakeTransport(() => message)
    const longText = 'a'.repeat(MESSAGE_TEXT_MAX_LENGTH + 1)

    const err = await new Messages(transport)
      .send({
        from: { user_id: 123 },
        to: { user_id: 456, resource: 'orders/1', site_id: 'MLB' },
        text: longText,
      })
      .catch((e) => e)

    expect(err).toBeInstanceOf(InputValidationError)
    expect(transport.calls).toHaveLength(0)
  })

  it('deve aceitar texto exatamente no limite', async () => {
    const transport = fakeTransport(() => message)
    const text = 'a'.repeat(MESSAGE_TEXT_MAX_LENGTH)
    await new Messages(transport).send({
      from: { user_id: 123 },
      to: { user_id: 456, resource: 'orders/1', site_id: 'MLB' },
      text,
    })
    expect(transport.calls).toHaveLength(1)
  })
})
