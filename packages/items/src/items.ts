import {
  assertValid,
  deepOmitEmpty,
  itemInputCreateSchema,
  itemInputPartialSchema,
  mapWithConcurrency,
  type PageFetcher,
  paginate,
  paginationOptions,
  type ResourceTransport,
  toQuery,
} from '@nodemelivre/core'
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
  async create(input: ItemInput): Promise<Item> {
    assertValid(itemInputCreateSchema, input)
    return this.transport.post('/items', deepOmitEmpty(input))
  }

  /** Atualiza campos do anúncio. */
  async update(itemId: string, changes: Partial<ItemInput>): Promise<Item> {
    assertValid(itemInputPartialSchema, changes)
    return this.transport.put(`/items/${itemId}`, deepOmitEmpty(changes))
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
   * Itera todos os itens de uma busca pública, página após página, item a
   * item.
   *
   * ```ts
   * for await (const item of ml.items.list('MLB', { q: 'fone' })) {
   *   console.log(item.title)
   * }
   * ```
   */
  list(
    siteId: string,
    params: ItemSearchParams = {},
    signal?: AbortSignal,
  ): AsyncGenerator<Item, void, void> {
    const fetchPage: PageFetcher<Item> = (offset, limit, pageSignal) =>
      this.transport.get<ItemSearchResponse>(`/sites/${siteId}/search`, {
        query: toQuery({ ...params, offset, limit }),
        ...(pageSignal !== undefined ? { signal: pageSignal } : {}),
      })
    return paginate(fetchPage, paginationOptions(params, signal))
  }

  /**
   * Busca os anúncios de um vendedor específico (token proprietário) e
   * resolve os itens completos.
   *
   * O ML restringiu a busca pública `/sites/{site}/search` para aplicações;
   * o caminho recomendado para listar os próprios anúncios é
   * `/users/{seller_id}/items/search` — que só funciona com o token do
   * próprio vendedor. Atenção: esse endpoint devolve apenas os **IDs** em
   * `results`; aqui resolvemos cada ID com `GET /items/{id}` para entregar
   * itens completos (mesmo contrato de `search`).
   *
   * ```ts
   * const me = await ml.users.me()
   * const page = await ml.items.searchBySeller(me.id, { status: 'active' })
   * ```
   */
  async searchBySeller(
    sellerId: number,
    params: ItemSearchParams = {},
  ): Promise<ItemSearchResponse> {
    const page = await this.transport.get<ItemSearchResponse>(`/users/${sellerId}/items/search`, {
      query: toQuery(params),
    })
    const results = await resolveSellerItems(this.transport, page.results)
    return { ...page, results }
  }

  /**
   * Itera todos os anúncios de um vendedor, página após página, item a item.
   * (equivalente a `list()`, mas usando o endpoint do vendedor — recomendado
   * pós-restrição da busca pública do ML). Os IDs retornados são resolvidos
   * para itens completos antes de entregar.
   *
   * ```ts
   * for await (const item of ml.items.listBySeller(me.id)) {
   *   console.log(item.title)
   * }
   * ```
   */
  listBySeller(
    sellerId: number,
    params: ItemSearchParams = {},
    signal?: AbortSignal,
  ): AsyncGenerator<Item, void, void> {
    const fetchPage: PageFetcher<Item> = async (offset, limit, pageSignal) => {
      const page = await this.transport.get<ItemSearchResponse>(`/users/${sellerId}/items/search`, {
        query: toQuery({ ...params, offset, limit }),
        ...(pageSignal !== undefined ? { signal: pageSignal } : {}),
      })
      const results = await resolveSellerItems(this.transport, page.results)
      return { ...page, results }
    }
    return paginate(fetchPage, paginationOptions(params, signal))
  }
  /** Publica um anúncio (alias de `updateStatus('active')`). */
  publish(itemId: string): Promise<Item> {
    return this.updateStatus(itemId, 'active')
  }

  /** Pausa um anúncio (alias de `updateStatus('paused')`). */
  pause(itemId: string): Promise<Item> {
    return this.updateStatus(itemId, 'paused')
  }

  /**
   * Cria um anúncio novo e garante que fique publicado (`active`).
   * Se o item já nascer ativo (comum), apenas cria; caso contrário,
   * publica via `updateStatus('active')`.
   */
  async createAndPublish(input: ItemInput): Promise<Item> {
    const item = await this.create(input)
    if (item.status !== 'active') {
      return this.publish(item.id)
    }
    return item
  }
}

/**
 * O endpoint `/users/{seller_id}/items/search` devolve apenas os IDs dos
 * anúncios em `results` (array de strings). Resolve cada ID para o item
 * completo respeitando um limite de requisições paralelas — sem isso, um
 * vendedor com milhares de anúncios estouraria o rate limit da API com uma
 * rajada de `GET /items/{id}`.
 */
const ITEM_RESOLUTION_CONCURRENCY = 10

async function resolveSellerItems(
  transport: ResourceTransport,
  results: unknown[],
): Promise<Item[]> {
  const ids = results
    .map((entry) => (typeof entry === 'string' ? entry : (entry as Item | null)?.id))
    .filter((id): id is string => typeof id === 'string' && id !== '')
  if (ids.length === 0) return []
  return mapWithConcurrency(ids, ITEM_RESOLUTION_CONCURRENCY, (id) =>
    transport.get<Item>(`/items/${id}`),
  )
}
