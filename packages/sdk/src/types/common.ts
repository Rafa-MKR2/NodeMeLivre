/** Tipos compartilhados entre resources. */

/** Paginação usada nos endpoints de busca da API. */
export interface Paging {
  total: number | null
  offset: number
  limit: number
  primary_results?: number
}

/** Envelope comum de respostas de busca. */
export interface SearchResponse<T> {
  paging: Paging
  results: T[]
}
