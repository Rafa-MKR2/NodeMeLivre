import { type PageFetcher, paginate, type ResourceTransport, toQuery } from '@nodemelivre/core'
import type {
  Item,
  ItemDescription,
  ItemInput,
  ItemSearchParams,
  ItemSearchResponse,
  ItemStatus,
} from '@nodemelivre/types'

/** Recursos de anúncios (itens). */
export class Items {
  constructor(private readonly transport: ResourceTransport) {}

  /** Detalhes de um item. */
  get(itemId: string): Promise<Item> {
    return this.transport.get(`/items/${itemId}`)
  }

  /** Descrição do anúncio. */
  getDescription(itemId: string): Promise<ItemDescription> {
    return this.transport.get(`/items/${itemId}/description`)
  }

  /** Cria um anúncio novo. */
  create(input: ItemInput): Promise<Item> {
    return this.transport.post('/items', input)
  }

  /** Atualiza campos do anúncio. */
  update(itemId: string, changes: Partial<ItemInput>): Promise<Item> {
    return this.transport.put(`/items/${itemId}`, changes)
  }

  /** Substitui a descrição do anúncio. */
  updateDescription(itemId: string, text: string): Promise<ItemDescription> {
    return this.transport.put(`/items/${itemId}/description`, { plain_text: text })
  }

  /** Altera o status do anúncio (ex.: fechar, pausar). */
  updateStatus(itemId: string, status: ItemStatus): Promise<Item> {
    return this.transport.post(`/items/${itemId}/status`, { status })
  }

  /** Busca de itens por site. */
  search(siteId: string, params: ItemSearchParams = {}): Promise<ItemSearchResponse> {
    return this.transport.get(`/sites/${siteId}/search`, { query: toQuery(params) })
  }

  /**
   * Itera todos os itens de uma busca, página após página, item a item.
   *
   * ```ts
   * for await (const item of ml.items.list('MLB', { q: 'fone' })) {
   *   console.log(item.title)
   * }
   * ```
   */
  list(siteId: string, params: ItemSearchParams = {}): AsyncGenerator<Item, void, void> {
    const fetchPage: PageFetcher<Item> = (offset, limit) =>
      this.transport.get<ItemSearchResponse>(`/sites/${siteId}/search`, {
        query: toQuery({ ...params, offset, limit }),
      })
    return paginate(fetchPage, params.limit === undefined ? {} : { limit: params.limit })
  }
  /** Publica um anúncio (alias de `updateStatus('active')`). */
  publish(itemId: string): Promise<Item> {
    return this.updateStatus(itemId, 'active')
  }

  /** Pausa um anúncio (alias de `updateStatus('paused')`). */
  pause(itemId: string): Promise<Item> {
    return this.updateStatus(itemId, 'paused')
  }
}
