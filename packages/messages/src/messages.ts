import { type QueryParams, type ResourceTransport, toQuery } from '@nodemelivre/core'
import { InputValidationError } from '@nodemelivre/errors'
import type { Message, MessageSendInput, MessageUser } from '@nodemelivre/types'

/** Parâmetros da listagem de mensagens de um pack. */
export interface MessagesListParams {
  /** Marca as mensagens como lidas na consulta (padrão `true`). */
  markAsRead?: boolean
}

/** Limite de caracteres do texto de uma mensagem imposto pela API. */
export const MESSAGE_TEXT_MAX_LENGTH = 350

/**
 * Envelope de uma conversa do chat pós-venda.
 *
 * O ML devolve o histórico como objeto `{ messages, from, to, ... }` (e às
 * vezes como array direto). Na migração 2026 do chat, o `to` do envelope é o
 * usuário **Agente** que media a conversa — o vendedor envia para ele, não
 * direto para o comprador.
 */
export interface MessagesConversation {
  /** Histórico normalizado (nunca `undefined`). */
  messages: Message[]
  /** Participante "de" do envelope, quando presente. */
  from?: MessageUser
  /** Participante "para" do envelope — migração 2026: o Agente. */
  to?: MessageUser
}

/** Recursos do chat pós-venda (mensagens de comprador). */
export class Messages {
  constructor(private readonly transport: ResourceTransport) {}

  /**
   * Lista as mensagens de um pack (pedido/agrupamento de pedidos).
   * Todos os endpoints de mensagens usam `tag=post_sale`.
   */
  async list(
    packId: number | string,
    sellerId: number | string,
    params: MessagesListParams = {},
  ): Promise<Message[]> {
    const conversation = await this.conversation(packId, sellerId, params)
    return conversation.messages
  }

  /**
   * Traz o envelope completo da conversa (histórico + participantes `from`/`to`).
   * Útil para descobrir o usuário **Agente** da migração 2026: o `to` do
   * envelope é quem recebe as mensagens do vendedor.
   */
  async conversation(
    packId: number | string,
    sellerId: number | string,
    params: MessagesListParams = {},
  ): Promise<MessagesConversation> {
    const query: QueryParams = { tag: 'post_sale' }
    if (params.markAsRead !== undefined) {
      query.mark_as_read = params.markAsRead
    }
    const raw = await this.transport.get<unknown>(`/messages/packs/${packId}/sellers/${sellerId}`, {
      query: toQuery(query),
    })
    return normalizeConversation(raw)
  }

  /** Detalhes de uma mensagem pelo id. */
  get(messageId: number | string): Promise<Message> {
    return this.transport.get(`/messages/${messageId}`, { query: { tag: 'post_sale' } })
  }

  /** Envia uma mensagem ao comprador. Máximo de 350 caracteres. */
  async send(input: MessageSendInput): Promise<Message> {
    if (input.text.length > MESSAGE_TEXT_MAX_LENGTH) {
      throw new InputValidationError(
        `Texto da mensagem excede o limite de ${MESSAGE_TEXT_MAX_LENGTH} caracteres (recebidos: ${input.text.length})`,
      )
    }
    return this.transport.post('/messages', input, { query: { tag: 'post_sale' } })
  }
}

/**
 * A API de mensagens do ML às vezes devolve um objeto `{ messages: [...] }`
 * (com paging/from/to) em vez de um array direto. Normaliza para o contrato
 * `MessagesConversation` e nunca lança por formato inesperado.
 */
function normalizeConversation(raw: unknown): MessagesConversation {
  if (Array.isArray(raw)) {
    return { messages: raw as Message[] }
  }
  if (typeof raw === 'object' && raw !== null) {
    const record = raw as Record<string, unknown>
    const conversation: MessagesConversation = {
      messages: Array.isArray(record.messages) ? (record.messages as Message[]) : [],
    }
    const from = asMessageUser(record.from)
    if (from !== undefined) conversation.from = from
    const to = asMessageUser(record.to)
    if (to !== undefined) conversation.to = to
    return conversation
  }
  return { messages: [] }
}

/** Extrai `{ user_id }` de um participante do envelope (formato tolerante). */
function asMessageUser(value: unknown): MessageUser | undefined {
  if (typeof value === 'object' && value !== null) {
    const user = value as Record<string, unknown>
    if (typeof user.user_id === 'number') return { user_id: user.user_id }
    if (typeof user.id === 'number') return { user_id: user.id }
  }
  return undefined
}
