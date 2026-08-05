import { type QueryParams, type ResourceTransport, toQuery } from '@nodemelivre/core'
import type { Message, MessageSendInput } from '@nodemelivre/types'

/** Parâmetros da listagem de mensagens de um pack. */
export interface MessagesListParams {
  /** Marca as mensagens como lidas na consulta (padrão `true`). */
  markAsRead?: boolean
}

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
  send(input: MessageSendInput): Promise<Message> {
    return this.transport.post('/messages', input, { query: { tag: 'post_sale' } })
  }
}
