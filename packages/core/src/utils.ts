/** Remove chaves com valor `undefined` de um objeto (shallow). */
export function omitUndefined<T extends object>(obj: T): Partial<T> {
  const out: Partial<T> = {}
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) {
      out[key as keyof T] = value
    }
  }
  return out
}

/** Remove chaves com valor `undefined`, `null`, ou objeto vazio `{}` (shallow). */
export function omitEmpty<T extends object>(obj: T): Partial<T> {
  const out: Partial<T> = {}
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined && value !== null) {
      if (typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0) {
        continue
      }
      out[key as keyof T] = value
    }
  }
  return out
}

/**
 * Remove recursivamente chaves com valor `undefined` ou objeto vazio.
 *
 * `null` é **preservado**: na API do Mercado Livre, enviar `null` é a forma
 * de limpar/desativar um campo (ex.: remover um atributo em `PUT /items`).
 * Apenas objetos que ficam vazios após a limpeza recursiva são omitidos.
 */
export function deepOmitEmpty<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map(deepOmitEmpty) as T
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, val] of Object.entries(value as object)) {
      const cleaned = deepOmitEmpty(val)
      if (cleaned === undefined) continue
      if (
        cleaned !== null &&
        typeof cleaned === 'object' &&
        !Array.isArray(cleaned) &&
        Object.keys(cleaned).length === 0
      ) {
        continue
      }
      out[key] = cleaned
    }
    return out as T
  }
  return value
}

/**
 * Aplica `mapper` a cada item respeitando um limite de execuções paralelas.
 *
 * Mantém a ordem dos resultados (igual ao `Array.prototype.map`) e nunca
 * lança mais do que a primeira rejeição do mapper. Útil para operações N+1
 * (ex.: resolver IDs em objetos completos) sem estourar rate limit da API.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const safeLimit = Number.isInteger(limit) && limit > 0 ? limit : 1
  const results: R[] = new Array<R>(items.length)
  let cursor = 0

  const worker = async (): Promise<void> => {
    while (cursor < items.length) {
      const index = cursor
      cursor += 1
      const item = items[index] as T
      results[index] = await mapper(item, index)
    }
  }

  const workers = Array.from({ length: Math.min(safeLimit, items.length) }, () => worker())
  await Promise.all(workers)
  return results
}

/**
 * Sleep com suporte a cancelamento via `AbortSignal`.
 *
 * Se o signal disparar durante a espera, a promise rejeita (com o `reason`
 * do signal se for `Error`, senão um `AbortError`). Sem signal, aguarda
 * `ms` milissegundos — mesmo contrato usado por operações de polling.
 */
export function sleepWithAbort(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const onAbort = (): void => {
      clearTimeout(timer)
      reject(signal?.reason instanceof Error ? signal.reason : toAbortError(signal?.reason))
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

function toAbortError(reason: unknown): Error {
  if (typeof DOMException === 'function') {
    return new DOMException('Operação cancelada', 'AbortError')
  }
  const error = new Error('Operação cancelada')
  error.name = 'AbortError'
  if (reason !== undefined) error.cause = reason
  return error
}

/** Gera um token aleatório seguro para state OAuth. */
export function generateStateToken(): string {
  const array = new Uint8Array(32)
  crypto.getRandomValues(array)
  return Array.from(array, (b) => b.toString(16).padStart(2, '0')).join('')
}

/** Verifica se um token de state é válido (formato hex 64 chars). */
export function isValidStateToken(token: string): boolean {
  return /^[a-f0-9]{64}$/.test(token)
}
