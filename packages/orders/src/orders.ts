import { type ResourceTransport, toQuery } from '@nodemelivre/core'
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
    return this.transport.get('/orders/search', { query: toQuery(params) })
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
      await sleep(intervalMs, signal)
      signal?.throwIfAborted()
      order = await this.get(orderId)
    }
    return order
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const onAbort = (): void => {
      clearTimeout(timer)
      reject(signal?.reason instanceof Error ? signal.reason : abortError(signal?.reason))
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    if (signal !== undefined) {
      if (signal.aborted) {
        onAbort()
        return
      }
      signal.addEventListener('abort', onAbort, { once: true })
    }
  })
}

function abortError(reason: unknown): Error {
  if (typeof DOMException === 'function') {
    return new DOMException('Operação cancelada', 'AbortError')
  }
  const error = new Error('Operação cancelada')
  error.name = 'AbortError'
  if (reason !== undefined) error.cause = reason
  return error
}
