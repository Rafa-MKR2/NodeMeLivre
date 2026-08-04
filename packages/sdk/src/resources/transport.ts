/**
 * Contrato mínimo de transporte usado pelos resources.
 * O `HttpClient` implementa estruturalmente — mantém os resources
 * desacoplados do transport e fáceis de testar.
 */

export interface ResourceRequest {
  query?: QueryParams
  headers?: Record<string, string>
  timeoutMs?: number
  signal?: AbortSignal
}

/** Query params aceitos pelo transport. */
export type QueryParams = Record<string, string | number | boolean | undefined>

/** Converte um objeto de parâmetros (tipos de interface) em QueryParams. */
export function toQuery(params: object): QueryParams {
  const out: QueryParams = {}
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) {
      out[key] = value as string | number | boolean
    }
  }
  return out
}

export interface ResourceTransport {
  get<T>(path: string, request?: ResourceRequest): Promise<T>
  post<T>(path: string, body?: unknown, request?: ResourceRequest): Promise<T>
  put<T>(path: string, body?: unknown, request?: ResourceRequest): Promise<T>
  patch<T>(path: string, body?: unknown, request?: ResourceRequest): Promise<T>
  delete<T>(path: string, request?: ResourceRequest): Promise<T>
}
