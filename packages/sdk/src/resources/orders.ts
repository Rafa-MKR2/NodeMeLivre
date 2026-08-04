import type { Order, OrderItem, OrderSearchParams, OrderSearchResponse } from '../types/order.js'
import { type ResourceTransport, toQuery } from './transport.js'

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
}
