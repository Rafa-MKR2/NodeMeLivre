import {
  assertValid,
  orderSearchParamsSchema,
  type PageFetcher,
  paginate,
  paginationOptions,
  type ResourceTransport,
  sleepWithAbort,
  toQuery,
} from '@nodemelivre/core'
import { PollingTimeoutError } from '@nodemelivre/errors'
import type { Order, OrderItem, OrderSearchParams, OrderSearchResponse } from '@nodemelivre/types'

/** Recursos de vendas (orders). */
export class Orders {
  constructor(private readonly transport: ResourceTransport) {}

  /** Detalhes de uma venda. */
  get(orderId: number | string): Promise<Order> {
    return this.transport.get(`/orders/${orderId}`)
  }

  /** Busca de vendas por vendedor, comprador, status, etc. */
  search(params: OrderSearchParams = {}): Promise<OrderSearchResponse> {
    assertValid(orderSearchParamsSchema, params)
    return this.transport.get('/orders/search', { query: toQuery(params) })
  }

  /**
   * Itera todas as vendas de uma busca, página após página, pedido a pedido.
   *
   * ```ts
   * for await (const order of ml.orders.list({ seller: me.id })) {
   *   console.log(order.id, order.status)
   * }
   * ```
   *
   * Aceita um `AbortSignal` opcional: o `for await` rejeita com AbortError
   * quando o signal dispara, sem buscar a página seguinte.
   */
  list(params: OrderSearchParams = {}, signal?: AbortSignal): AsyncGenerator<Order, void, void> {
    assertValid(orderSearchParamsSchema, params)
    const fetchPage: PageFetcher<Order> = (offset, limit, pageSignal) =>
      this.transport.get<OrderSearchResponse>('/orders/search', {
        query: toQuery({ ...params, offset, limit }),
        ...(pageSignal !== undefined ? { signal: pageSignal } : {}),
      })
    return paginate(fetchPage, paginationOptions(params, signal))
  }

  /** Itens de uma venda. */
  items(orderId: number | string): Promise<OrderItem[]> {
    return this.transport.get(`/orders/${orderId}/items`)
  }

  /**
   * Aguarda o pedido sair de `payment_required` e ficar pago, fazendo
   * polling com intervalo fixo até o timeout (padrão 60s).
   *
   * Aceita um `AbortSignal` para cancelar antecipadamente (ex.: usuário
   * fechou a página). Lança `PollingTimeoutError` se o pedido não pagar
   * dentro do tempo.
   */
  async waitUntilPaid(
    orderId: number | string,
    options: { timeoutMs?: number; intervalMs?: number; signal?: AbortSignal } = {},
  ): Promise<Order> {
    const timeoutMs = options.timeoutMs ?? 60_000
    const intervalMs = options.intervalMs ?? 2_000
    const signal = options.signal
    const deadline = Date.now() + timeoutMs

    let order = await this.get(orderId)
    while (order.status !== 'paid') {
      signal?.throwIfAborted()
      if (Date.now() >= deadline) {
        throw new PollingTimeoutError(
          `Pedido ${orderId} não foi pago dentro de ${timeoutMs}ms (status: ${order.status})`,
        )
      }
      await sleepWithAbort(intervalMs, signal)
      signal?.throwIfAborted()
      order = await this.get(orderId)
    }
    return order
  }
}
