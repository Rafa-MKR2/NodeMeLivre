/** Tópicos de notificação enviados pela API do Mercado Livre. */
export type WebhookTopic =
  | 'items'
  | 'questions'
  | 'orders'
  | 'orders_v2'
  | 'created_orders'
  | 'payments'
  | 'pictures'
  | 'messages'

/** Ação reportada por notificações do tópico `messages`. */
export type WebhookMessageAction = 'created' | 'read'

/**
 * Notificação enviada pela API do Mercado Livre para o callback configurado
 * na aplicação. O Mercado Livre **não** assina o payload com HMAC — a
 * autenticação é feita validando o `application_id` e, opcionalmente,
 * consultando o `resource`.
 */
export interface WebhookNotification {
  /** Id interno da notificação (presente em algumas notificações). */
  _id?: string
  /** Recurso relacionado (ex.: `/orders/123`, ou um hash para `messages`). */
  resource: string
  /** Id do usuário dono do recurso. */
  user_id: number
  topic: WebhookTopic
  /** Id da aplicação dona do callback — usado para autenticar a notificação. */
  application_id?: number
  attempts?: number
  sent?: string
  received?: string
  /** Presente apenas no tópico `messages`: ações da notificação. */
  actions?: WebhookMessageAction[]
}

/** Payload já parseado e validado por `Webhooks.parse`. */
export type ParsedWebhookNotification = WebhookNotification
