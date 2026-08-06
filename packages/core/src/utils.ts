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
