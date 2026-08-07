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
    if (input.title === undefined) throw new InputValidationError('title é obrigatório na criação')
    if (input.price === undefined) throw new InputValidationError('price é obrigatório na criação')
    if (input.available_quantity === undefined) {
      throw new InputValidationError('available_quantity é obrigatório na criação')
    }
  }
}
