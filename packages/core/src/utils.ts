import { randomBytes } from 'node:crypto'

/**
 * Chaves perigosas em objetos vindos de `JSON.parse` de fonte não confiável.
 * `__proto__` aciona o setter de prototype ao atribuir; `constructor`/`prototype`
 * permitem contornar o shadowing. São puladas em todas as funções que copiam
 * objetos (defesa contra prototype pollution — local e herança indesejada).
 */
export const UNSAFE_KEYS: ReadonlySet<string> = new Set(['__proto__', 'constructor', 'prototype'])

/** Atribui `out[key] = value` ignorando chaves que acionam o prototype. */
function assignOwn<T>(out: T, key: string, value: unknown): void {
  if (UNSAFE_KEYS.has(key)) return
  const target = out as Record<string, unknown>
  target[key] = value
}

/** Remove chaves com valor `undefined` de um objeto (shallow). */
export function omitUndefined<T extends object>(obj: T): Partial<T> {
  const out: Partial<T> = {}
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) {
      assignOwn(out, key, value)
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
      assignOwn(out, key, value)
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
 *
 * Implementação **iterativa** (pilha explícita): input do usuário pode ter
 * profundidade arbitrária, e a versão recursiva estoura a pilha do V8
 * (~10k frames → `RangeError`) derrubando o processo do integrador — DoS
 * local confirmado por execução (Rodada 5 da auditoria).
 *
 * **Ciclos também são tratados** (Rodada 9): a pilha explícita por si só não
 * detecta objetos com referência circular (`obj.self = obj`) — sem proteção,
 * o loop empilhava frames para sempre até **OOM do processo** (confirmado
 * por execução). Objetos no caminho atual são rastreados em um `WeakSet`;
 * ao reencontrar um deles (ciclo), o valor é **omitido** (mesma regra de
 * `undefined` — um valor circular não pode ser serializado para a API de
 * qualquer forma). DAGs legítimos (o mesmo objeto referenciado em dois
 * ramos diferentes) continuam intactos, pois o `WeakSet` só contém o
 * caminho atual (removido ao desempilhar).
 */
export function deepOmitEmpty<T>(value: T): T {
  return cleanDeep(value) as T
}

interface CleanConsumer {
  kind: 'array-item' | 'object-value'
  out: unknown[] | Record<string, unknown>
  key?: string
}

interface CleanFrame {
  kind: 'array' | 'object'
  items?: unknown[]
  entries?: [string, unknown][]
  index: number
  out: unknown[] | Record<string, unknown>
  consumer: CleanConsumer | null
  /** Objeto dono deste frame (para remover do caminho ao desempilhar). */
  owner: object
}

/** Iterativo — semântica idêntica à recursão original (sem stack overflow nem OOM por ciclo). */
function cleanDeep(value: unknown): unknown {
  const isContainer = (v: unknown): v is object => v !== null && typeof v === 'object'
  const stack: CleanFrame[] = []
  // Caminho atual (objetos ainda sendo processados). Detecta ciclos sem
  // confundir DAGs: um objeto fora do caminho (já finalizado) pode ser
  // re-processado normalmente.
  const inPath = new WeakSet<object>()
  let rootResult: unknown = value

  /**
   * Empilha um container. Retorna `false` quando o node é um CICLO (já está
   * no caminho atual) — o chamador então omite o valor (array-item não é
   * empurrado; object-value não é atribuído).
   */
  const pushFrame = (node: object, consumer: CleanConsumer | null): boolean => {
    if (inPath.has(node)) return false
    inPath.add(node)
    if (Array.isArray(node)) {
      stack.push({ kind: 'array', items: node, index: 0, out: [], consumer, owner: node })
    } else {
      stack.push({
        kind: 'object',
        entries: Object.entries(node),
        index: 0,
        out: {},
        consumer,
        owner: node,
      })
    }
    return true
  }

  const popFrame = (): CleanFrame => {
    const frame = stack.pop() as CleanFrame
    inPath.delete(frame.owner)
    return frame
  }

  const deliver = (result: unknown, consumer: CleanConsumer | null): void => {
    if (consumer === null) return
    if (consumer.kind === 'array-item') {
      ;(consumer.out as unknown[]).push(result)
      return
    }
    // object-value: omite `undefined` e objetos que ficaram vazios.
    if (result === undefined) return
    const isEmptyObj =
      result !== null &&
      typeof result === 'object' &&
      !Array.isArray(result) &&
      Object.keys(result).length === 0
    if (isEmptyObj) return
    assignOwn(consumer.out as Record<string, unknown>, consumer.key as string, result)
  }

  if (!isContainer(value)) return value
  if (!pushFrame(value, null)) return value

  while (stack.length > 0) {
    const frame = stack[stack.length - 1] as CleanFrame

    if (frame.kind === 'array') {
      const items = frame.items as unknown[]
      if (frame.index >= items.length) {
        const done = popFrame()
        deliver(done.out, done.consumer)
        if (stack.length === 0) rootResult = done.out
        continue
      }
      const item = items[frame.index]
      frame.index++
      if (isContainer(item)) {
        // Ciclo em array: o item é omitido (não pode ser serializado).
        if (!pushFrame(item, { kind: 'array-item', out: frame.out })) {
          /* omitido */
        }
      } else {
        ;(frame.out as unknown[]).push(item)
      }
      continue
    }

    const entries = frame.entries as [string, unknown][]
    if (frame.index >= entries.length) {
      const done = popFrame()
      deliver(done.out, done.consumer)
      if (stack.length === 0) rootResult = done.out
      continue
    }
    const [key, val] = entries[frame.index] as [string, unknown]
    frame.index++
    if (isContainer(val)) {
      // Ciclo em objeto: a chave é omitida (mesma regra de `undefined`).
      if (!pushFrame(val, { kind: 'object-value', out: frame.out, key })) {
        /* omitido */
      }
    } else if (val !== undefined) {
      assignOwn(frame.out as Record<string, unknown>, key, val)
    }
  }

  return rootResult
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

/**
 * Gera um token aleatório seguro para state OAuth (CSPRNG, 256 bits).
 *
 * Usa `randomBytes` de `node:crypto` (não o global `crypto`): o global
 * `globalThis.crypto` só existe por padrão a partir do Node 19 — no Node 18
 * (mínimo declarado no `engines`) ele exige a flag
 * `--experimental-global-webcrypto` e `crypto` é `undefined`, quebrando o
 * fluxo OAuth com `ReferenceError` (Rodada 9 da auditoria).
 */
export function generateStateToken(): string {
  return randomBytes(32).toString('hex')
}

/** Verifica se um token de state é válido (formato hex 64 chars). */
export function isValidStateToken(token: string): boolean {
  return /^[a-f0-9]{64}$/.test(token)
}
