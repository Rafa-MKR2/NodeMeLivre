import { type QueryParams, type ResourceTransport, toQuery } from '@nodemelivre/core'
import { InputValidationError } from '@nodemelivre/errors'
import type { Message, MessageSendInput } from '@nodemelivre/types'

/** Parâmetros da listagem de mensagens de um pack. */
export interface MessagesListParams {
  /** Marca as mensagens como lidas na consulta (padrão `true`). */
  markAsRead?: boolean
}

/** Limite de caracteres do texto de uma mensagem imposto pela API. */
export const MESSAGE_TEXT_MAX_LENGTH = 350

/** Recursos do chat pós-venda (mensagens de comprador). */
export class Messages {
  constructor(private readonly transport: ResourceTransport) {}

  /**
   * Lista as mensagens de um pack (pedido/agrupamento de pedidos).
   * Todos os endpoints de mensagens usam `tag=post_sale`.
   */
  list(
    packId: number | string,
    sellerId: number | string,
    params: MessagesListParams = {},
  ): Promise<Message[]> {
    const query: QueryParams = { tag: 'post_sale' }
    if (params.markAsRead !== undefined) {
      query.mark_as_read = params.markAsRead
    }
    return this.transport.get(`/messages/packs/${packId}/sellers/${sellerId}`, {
      query: toQuery(query),
    })
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
