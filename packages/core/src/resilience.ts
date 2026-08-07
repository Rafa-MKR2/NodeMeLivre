import { ApiError } from '@nodemelivre/errors'
import type { ResourceTransport } from './transport.js'

/** Resultado de uma operação que pode falhar parcialmente. */
export interface PartialResult<T> {
  /** Dados retornados com sucesso. */
  data: T
  /** Erros parciais (não lançam exceção). */
  errors: PartialError[]
}

/** Erro parcial que não interrompe o fluxo. */
export interface PartialError {
  /** Identificador do recurso/operação que falhou. */
  resource: string
  /** Código do erro. */
  code: string
  /** Mensagem legível. */
  message: string
  /** Erro original. */
  cause?: Error
  /** Status HTTP se aplicável. */
  status?: number
}

type OperationEntry<T> = [string, () => Promise<T>]

/**
 * Executa múltiplas operações em paralelo, coletando sucessos e falhas.
 * Não lança exceção se alguma falhar — retorna tudo em `PartialResult`.
 *
 * ```ts
 * const result = await parallel({
 *   users: () => ml.users.me(),
 *   orders: () => ml.orders.search({ status: 'paid' }),
 *   questions: () => ml.questions.search({ status: 'unanswered' }),
 * })
 *
 * // Sempre tem dados (parciais) e lista de erros
 * console.log(result.data.users)
 * console.log(result.errors) // ex.: [{ resource: 'questions', code: 'RATE_LIMIT', ... }]
 * ```
 */
export async function parallel<T extends Record<string, () => Promise<unknown>>>(
  operations: T,
): Promise<PartialResult<{ [K in keyof T]: Awaited<ReturnType<T[K]>> }>> {
  const entries = Object.entries(operations) as OperationEntry<unknown>[]

  const promises = entries.map(([, fn]) => fn())
  const results = await Promise.allSettled(promises)

  const data: Record<string, unknown> = {}
  const errors: PartialError[] = []

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]
    const result = results[i]

    if (!entry || !result) continue

    const [resource] = entry

    if (result.status === 'fulfilled') {
      data[resource] = result.value
    } else {
      const error = result.reason
      let code = 'UNKNOWN_ERROR'
      let message = 'Erro desconhecido'
      let status: number | undefined

      if (error instanceof ApiError) {
        code = error.apiCode ?? `HTTP_${error.status}`
        message = error.message
        status = error.status
      } else if (error instanceof Error) {
        message = error.message
      }

      errors.push({
        resource,
        code,
        message,
        ...(error instanceof Error ? { cause: error } : {}),
        ...(status !== undefined ? { status } : {}),
      })
    }
  }

  return {
    data: data as PartialResult<{ [K in keyof T]: Awaited<ReturnType<T[K]>> }>['data'],
    errors,
  }
}

/**
 * Versão simplificada que retorna apenas os dados, logando erros.
 * Útil quando a UI deve mostrar o que conseguiu carregar.
 */
export async function parallelBestEffort<T extends Record<string, () => Promise<unknown>>>(
  operations: T,
  onError?: (error: PartialError) => void,
): Promise<Partial<{ [K in keyof T]: Awaited<ReturnType<T[K]>> }>> {
  const result = await parallel(operations)
  if (onError) {
    for (const error of result.errors) onError(error)
  }
  return result.data
}

/**
 * Wrapper para transport que não lança em erros 4xx/5xx, retorna erro como valor.
 * Permite que o consumidor decida como tratar falhas parciais.
 */
export class ResilientTransport {
  constructor(private readonly transport: ResourceTransport) {}

  async get<T>(
    path: string,
    request?: Parameters<ResourceTransport['get']>[1],
  ): Promise<{ data?: T; error?: PartialError }> {
    try {
      const data = await this.transport.get<T>(path, request)
      return { data }
    } catch (error) {
      return { error: this.toPartialError('GET', path, error) }
    }
  }

  async post<T>(
    path: string,
    body?: unknown,
    request?: Parameters<ResourceTransport['post']>[2],
  ): Promise<{ data?: T; error?: PartialError }> {
    try {
      const data = await this.transport.post<T>(path, body, request)
      return { data }
    } catch (error) {
      return { error: this.toPartialError('POST', path, error) }
    }
  }

  async put<T>(
    path: string,
    body?: unknown,
    request?: Parameters<ResourceTransport['put']>[2],
  ): Promise<{ data?: T; error?: PartialError }> {
    try {
      const data = await this.transport.put<T>(path, body, request)
      return { data }
    } catch (error) {
      return { error: this.toPartialError('PUT', path, error) }
    }
  }

  async patch<T>(
    path: string,
    body?: unknown,
    request?: Parameters<ResourceTransport['patch']>[2],
  ): Promise<{ data?: T; error?: PartialError }> {
    try {
      const data = await this.transport.patch<T>(path, body, request)
      return { data }
    } catch (error) {
      return { error: this.toPartialError('PATCH', path, error) }
    }
  }

  async delete<T>(
    path: string,
    request?: Parameters<ResourceTransport['delete']>[1],
  ): Promise<{ data?: T; error?: PartialError }> {
    try {
      const data = await this.transport.delete<T>(path, request)
      return { data }
    } catch (error) {
      return { error: this.toPartialError('DELETE', path, error) }
    }
  }

  private toPartialError(method: string, path: string, error: unknown): PartialError {
    if (error instanceof ApiError) {
      return {
        resource: `${method} ${path}`,
        code: error.apiCode ?? `HTTP_${error.status}`,
        message: error.message,
        cause: error,
        status: error.status,
      }
    }
    if (error instanceof Error) {
      return {
        resource: `${method} ${path}`,
        code: 'NETWORK_ERROR',
        message: error.message,
        cause: error,
      }
    }
    return {
      resource: `${method} ${path}`,
      code: 'UNKNOWN_ERROR',
      message: String(error),
    }
  }
}
