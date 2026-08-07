import {
  deepOmitEmpty,
  type PageFetcher,
  paginate,
  type ResourceTransport,
  toQuery,
} from '@nodemelivre/core'
import { InputValidationError } from '@nodemelivre/errors'
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
    assertValidItemInput(input)
    return this.transport.post('/items', deepOmitEmpty(input))
  }

  /** Atualiza campos do anúncio. */
  async update(itemId: string, changes: Partial<ItemInput>): Promise<Item> {
    assertValidItemInput(changes, { partial: true })
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
  list(siteId: string, params: ItemSearchParams = {}): AsyncGenerator<Item, void, void> {
    const fetchPage: PageFetcher<Item> = (offset, limit) =>
      this.transport.get<ItemSearchResponse>(`/sites/${siteId}/search`, {
        query: toQuery({ ...params, offset, limit }),
      })
    return paginate(fetchPage, params.limit === undefined ? {} : { limit: params.limit })
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
  listBySeller(sellerId: number, params: ItemSearchParams = {}): AsyncGenerator<Item, void, void> {
    const fetchPage: PageFetcher<Item> = async (offset, limit) => {
      const page = await this.transport.get<ItemSearchResponse>(
        `/users/${sellerId}/items/search`,
        {
          query: toQuery({ ...params, offset, limit }),
        },
      )
      const results = await resolveSellerItems(this.transport, page.results)
      return { ...page, results }
    }
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
 * completo em paralelo, mantendo o contrato `results: Item[]`.
 */
async function resolveSellerItems(
  transport: ResourceTransport,
  results: unknown[],
): Promise<Item[]> {
  const ids = results
    .map((entry) => (typeof entry === 'string' ? entry : (entry as Item | null)?.id))
    .filter((id): id is string => typeof id === 'string' && id !== '')
  if (ids.length === 0) return []
  return Promise.all(ids.map((id) => transport.get<Item>(`/items/${id}`)))
}

/**
 * Valida campos essenciais antes de enviar à API (falha rápido, sem payload
 * parcialmente inválido — mesmo padrão de `InputValidationError` de
 * messages/images). Em atualização parcial, valida apenas os campos enviados.
 */
function assertValidItemInput(
  input: Partial<ItemInput>,
  { partial = false }: { partial?: boolean } = {},
): void {
  if (input.title !== undefined && (typeof input.title !== 'string' || input.title.trim() === '')) {
    throw new InputValidationError('title deve ser uma string não vazia')
  }
  if (
    input.family_name !== undefined &&
    (typeof input.family_name !== 'string' || input.family_name.trim() === '')
  ) {
    throw new InputValidationError('family_name deve ser uma string não vazia')
  }
  if (input.title !== undefined && input.family_name !== undefined) {
    throw new InputValidationError(
      'title e family_name são mutuamente exclusivos: envie apenas um (modelo User Product)',
    )
  }
  if (input.price !== undefined && (!Number.isFinite(input.price) || input.price <= 0)) {
    throw new InputValidationError('price deve ser um número positivo')
  }
  if (
    input.available_quantity !== undefined &&
    (!Number.isInteger(input.available_quantity) || input.available_quantity < 0)
  ) {
    throw new InputValidationError('available_quantity deve ser um inteiro >= 0')
  }
  if (!partial) {
    if (input.title === undefined && input.family_name === undefined) {
      throw new InputValidationError('title ou family_name é obrigatório na criação')
    }
    if (input.price === undefined) throw new InputValidationError('price é obrigatório na criação')
    if (input.available_quantity === undefined) {
      throw new InputValidationError('available_quantity é obrigatório na criação')
    }
  }
}
