import { WebhookError } from '@nodemelivre/errors'
import type { WebhookNotification, WebhookTopic } from '@nodemelivre/types'

const REQUIRED_KEYS = ['resource', 'user_id', 'topic'] as const
const TOPICS: WebhookTopic[] = [
  'items',
  'questions',
  'orders',
  'orders_v2',
  'created_orders',
  'payments',
  'pictures',
  'messages',
]

/**
 * Recursos de notificações (webhooks).
 *
 * O Mercado Livre envia um POST no callback configurado na aplicação com o
 * payload da notificação. Diferente do Mercado Pago, **não há assinatura
 * HMAC** para verificar — a autenticação é feita validando que o
 * `application_id` pertence à sua aplicação (e, se quiser segurança extra,
 * consultando o `resource` via API).
 */
export class Webhooks {
  /**
   * Valida que a notificação pertence à sua aplicação.
   *
   * - Confere os campos obrigatórios (`resource`, `user_id`, `topic`).
   * - Confere que o `application_id` bate com o da sua aplicação.
   *
   * Lança `WebhookError` se o payload for inválido ou de outra aplicação.
   */
  verify(payload: unknown, applicationId: number | string): WebhookNotification {
    const notification = this.parse(payload)
    if (notification.application_id !== Number(applicationId)) {
      throw new WebhookError(
        `Webhook rejeitado: application_id ${notification.application_id} não pertence à aplicação ${applicationId}`,
      )
    }
    return notification
  }

  /**
   * `verify` + validação do dono: além do `application_id`, confere que a
   * notificação é do usuário esperado (o `user_id` cujo token você possui).
   *
   * Como o Mercado Livre não assina webhooks, o `application_id` é público —
   * validar o `user_id` contra o vendedor autenticado é o controle real para
   * rejeitar notificações forjadas de outros vendedores antes de gastar
   * chamadas à API.
   */
  verifyForUser(
    payload: unknown,
    applicationId: number | string,
    expectedUserId: number | string,
  ): WebhookNotification {
    const notification = this.verify(payload, applicationId)
    if (notification.user_id !== Number(expectedUserId)) {
      throw new WebhookError(
        `Webhook rejeitado: user_id ${notification.user_id} não pertence ao vendedor ${expectedUserId}`,
      )
    }
    return notification
  }

  /**
   * Converte o corpo bruto do callback em uma notificação tipada.
   * Aceita a string do body ou o objeto já parseado.
   */
  parse(payload: string | unknown): WebhookNotification {
    const data = this.toRecord(payload)
    for (const key of REQUIRED_KEYS) {
      if (data[key] === undefined || data[key] === null || data[key] === '') {
        throw new WebhookError(`Webhook inválido: campo obrigatório "${key}" ausente`)
      }
    }
    if (typeof data.resource !== 'string' || typeof data.topic !== 'string') {
      throw new WebhookError('Webhook inválido: resource e topic devem ser strings')
    }
    if (typeof data.user_id !== 'number') {
      throw new WebhookError('Webhook inválido: user_id deve ser um número')
    }
    if (!TOPICS.includes(data.topic as WebhookTopic)) {
      throw new WebhookError(`Webhook inválido: tópico desconhecido "${data.topic}"`)
    }
    return data as unknown as WebhookNotification
  }

  private toRecord(payload: string | unknown): Record<string, unknown> {
    let data: unknown = payload
    if (typeof payload === 'string') {
      try {
        data = JSON.parse(payload)
      } catch {
        throw new WebhookError('Webhook inválido: corpo não é um JSON válido')
      }
    }
    if (typeof data !== 'object' || data === null || Array.isArray(data)) {
      throw new WebhookError('Webhook inválido: corpo deve ser um objeto JSON')
    }
    return data as Record<string, unknown>
  }
}
