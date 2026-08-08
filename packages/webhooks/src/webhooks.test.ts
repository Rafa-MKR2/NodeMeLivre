import { WebhookError } from '@nodemelivre/errors'
import { describe, expect, it } from 'vitest'
import { Webhooks } from './webhooks.js'

const notification = {
  _id: 'f9f08571',
  resource: '/orders/2195160686',
  user_id: 468424240,
  topic: 'orders_v2',
  application_id: 1234567890,
  attempts: 1,
}

describe('Webhooks.parse', () => {
  it('deve parsear um payload JSON (string)', () => {
    const parsed = new Webhooks().parse(JSON.stringify(notification))
    expect(parsed).toEqual(notification)
  })

  it('deve aceitar um objeto já parseado', () => {
    const parsed = new Webhooks().parse(notification)
    expect(parsed.topic).toBe('orders_v2')
  })

  it('deve rejeitar JSON inválido', () => {
    expect(() => new Webhooks().parse('{nao-json')).toThrow(WebhookError)
  })

  it('deve rejeitar corpo que não é objeto', () => {
    expect(() => new Webhooks().parse('"texto"')).toThrow(WebhookError)
    expect(() => new Webhooks().parse('[1,2]')).toThrow(WebhookError)
  })

  it('deve rejeitar payload sem campo obrigatório', () => {
    const { resource: _resource, ...semResource } = notification
    expect(() => new Webhooks().parse(semResource)).toThrow(/resource/)
  })

  it('deve rejeitar tópico desconhecido', () => {
    expect(() => new Webhooks().parse({ ...notification, topic: 'desconhecido' })).toThrow(
      /tópico desconhecido/,
    )
  })
})

describe('Webhooks.verify', () => {
  it('deve validar application_id da própria aplicação', () => {
    const parsed = new Webhooks().verify(notification, 1234567890)
    expect(parsed.application_id).toBe(1234567890)
  })

  it('deve aceitar application_id em string', () => {
    expect(() => new Webhooks().verify(notification, '1234567890')).not.toThrow()
  })

  it('deve rejeitar notificação de outra aplicação', () => {
    expect(() => new Webhooks().verify(notification, 999)).toThrow(WebhookError)
  })

  it('deve rejeitar payload inválido no verify', () => {
    expect(() => new Webhooks().verify('{invalido', 1234567890)).toThrow(WebhookError)
  })
})

describe('Webhooks.verifyForUser', () => {
  it('deve validar application_id e user_id do vendedor esperado', () => {
    const parsed = new Webhooks().verifyForUser(notification, 1234567890, notification.user_id)
    expect(parsed.user_id).toBe(notification.user_id)
  })

  it('deve aceitar user_id em string', () => {
    expect(() =>
      new Webhooks().verifyForUser(notification, 1234567890, String(notification.user_id)),
    ).not.toThrow()
  })

  it('deve rejeitar notificação de outro vendedor', () => {
    expect(() => new Webhooks().verifyForUser(notification, 1234567890, 999)).toThrow(
      /não pertence ao vendedor/,
    )
  })

  it('deve rejeitar application_id de outra aplicação antes de checar o user', () => {
    expect(() => new Webhooks().verifyForUser(notification, 999, notification.user_id)).toThrow(
      WebhookError,
    )
  })
})
