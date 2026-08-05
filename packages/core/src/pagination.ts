/**
 * Paginação assíncrona reutilizável entre resources.
 *
 * Um fetcher de página retorna `PaginatedResponse<T>` (mesmo formato das
 * buscas da API: `results` + `paging`). `paginate()` itera item a item,
 * avançando o `offset` automaticamente até o fim (ou quando o fetcher
 * devolve uma página vazia).
 *
 * ```ts
 * for await (const item of paginate(
 *   (offset, limit) => transport.get('/sites/MLB/search', { query: { q, offset, limit } }),
 * )) {
 *   // item a item, página após página
 * }
 * ```
 */

export interface PaginatedResponse<T> {
  results: T[]
  paging: {
    total: number | null
    offset: number
    limit: number
  }
}

export type PageFetcher<T> = (offset: number, limit: number) => Promise<PaginatedResponse<T>>

/**
 * Itera todos os resultados de uma busca paginada, item a item.
 *
 * - Página vazia ou fim do `paging.total` encerra a iteração.
 * - O consumidor pode parar cedo com `break`.
 * - `offset` inicial e tamanho de página são configuráveis.
 */
export async function* paginate<T>(
  fetchPage: PageFetcher<T>,
  options: { offset?: number; limit?: number } = {},
): AsyncGenerator<T, void, void> {
  const limit = options.limit ?? 50
  let offset = options.offset ?? 0

  while (true) {
    const page = await fetchPage(offset, limit)
    const results = page.results
    for (const item of results) {
      yield item
    }

    const total = page.paging.total
    if (total !== null && offset + results.length >= total) return
    if (results.length === 0) return
    offset += results.length
  }
}
