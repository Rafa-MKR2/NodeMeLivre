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

export type PageFetcher<T> = (
  offset: number,
  limit: number,
  signal?: AbortSignal,
) => Promise<PaginatedResponse<T>>

/**
 * Monta as opções do `paginate()` a partir dos params de busca, sem passar
 * `undefined` explícito (mantém o payload de cada página enxuto).
 *
 * Compartilhado entre resources paginados (items, orders, questions) — antes
 * duplicado em cada pacote.
 */
export function paginationOptions(
  params: { limit?: number },
  signal?: AbortSignal,
): { limit?: number; signal?: AbortSignal } {
  const options: { limit?: number; signal?: AbortSignal } = {}
  if (params.limit !== undefined) options.limit = params.limit
  if (signal !== undefined) options.signal = signal
  return options
}

/**
 * Itera todos os resultados de uma busca paginada, item a item.
 *
 * - Página vazia ou fim do `paging.total` encerra a iteração.
 * - O consumidor pode parar cedo com `break`.
 * - `offset` inicial e tamanho de página são configuráveis.
 * - Com `signal`, a iteração aborta entre páginas (o fetcher decide se
 *   repassa o signal à requisição em voo) e o `for await` rejeita com um
 *   erro do tipo AbortError.
 */
export async function* paginate<T>(
  fetchPage: PageFetcher<T>,
  options: { offset?: number; limit?: number; signal?: AbortSignal } = {},
): AsyncGenerator<T, void, void> {
  const limit = options.limit ?? 50
  let offset = options.offset ?? 0
  const signal = options.signal

  while (true) {
    signal?.throwIfAborted()
    const page = await fetchPage(offset, limit, signal)
    const results = page.results
    for (const item of results) {
      signal?.throwIfAborted()
      yield item
    }

    const total = page.paging.total
    if (total !== null && offset + results.length >= total) return
    if (results.length === 0) return
    offset += results.length
  }
}
