import { vi } from 'vitest'
import type { ResourceRequest, ResourceTransport } from './transport.js'

/** Resultado esperado de uma chamada de fetch simulada. */
export interface MockFetchResult {
  status?: number
  body?: unknown
  headers?: Record<string, string>
}

export type FetchHandler = (
  url: URL,
  init: RequestInit,
) => MockFetchResult | Promise<MockFetchResult>

/** Simula o fetch global. Retorna o spy para inspecionar chamadas. */
export function mockFetch(handler: FetchHandler): ReturnType<typeof vi.fn> {
  const fn = vi.fn(async (input: URL, init?: RequestInit): Promise<Response> => {
    const url = toUrl(input)
    const result = await handler(url, init ?? {})
    const status = result.status ?? 200
    const body = status === 204 ? null : JSON.stringify(result.body)
    return new Response(body, {
      status,
      headers: {
        'content-type': 'application/json',
        ...(result.headers ?? {}),
      },
    })
  })
  vi.stubGlobal('fetch', fn)
  return fn
}

/** Response JSON simples. */
export function json(body: unknown, status = 200): MockFetchResult {
  return { body, status }
}

export function restoreFetch(): void {
  vi.unstubAllGlobals()
}

export interface RecordedCall {
  method: string
  path: string
  body: unknown
  query: ResourceRequest['query']
  headers: Record<string, string>
  timeoutMs: number | undefined
}

/**
 * Transport falso para testes — não faz requisições reais.
 *
 * Uso:
 * ```ts
 * const transport = new MockTransport()
 *   .onGet('/items/MLB1', { id: 'MLB1', title: 'Produto' })
 *   .onPost('/items', { id: 'MLB2' })
 *
 * const items = new Items(transport)
 * const item = await items.get('MLB1')
 * expect(transport.calls).toHaveLength(1)
 * ```
 */
export class MockTransport implements ResourceTransport {
  private handlers = new Map<string, (call: RecordedCall) => unknown>()
  public calls: RecordedCall[] = []
  private defaultDelay = 0
  private shouldThrow: Error | null = null

  /** Define delay simulado em ms para todas as chamadas. */
  withDelay(ms: number): this {
    this.defaultDelay = ms
    return this
  }

  /** Faz a próxima chamada lançar erro. */
  withError(error: Error): this {
    this.shouldThrow = error
    return this
  }

  /** Registra handler para GET. */
  onGet(path: string, response: unknown): this {
    this.handlers.set(`GET:${path}`, () => response)
    return this
  }

  /** Registra handler para POST. */
  onPost(path: string, response: unknown): this {
    this.handlers.set(`POST:${path}`, () => response)
    return this
  }

  /** Registra handler para PUT. */
  onPut(path: string, response: unknown): this {
    this.handlers.set(`PUT:${path}`, () => response)
    return this
  }

  /** Registra handler para PATCH. */
  onPatch(path: string, response: unknown): this {
    this.handlers.set(`PATCH:${path}`, () => response)
    return this
  }

  /** Registra handler para DELETE. */
  onDelete(path: string, response: unknown): this {
    this.handlers.set(`DELETE:${path}`, () => response)
    return this
  }

  /** Handler genérico por método + path. */
  on(method: string, path: string, response: unknown): this {
    this.handlers.set(`${method}:${path}`, () => response)
    return this
  }

  /** Handler com função dinâmica. */
  onCall(method: string, path: string, fn: (call: RecordedCall) => unknown): this {
    this.handlers.set(`${method}:${path}`, fn)
    return this
  }

  private async run<T>(
    method: string,
    path: string,
    body: unknown,
    request?: ResourceRequest,
  ): Promise<T> {
    if (this.defaultDelay > 0) {
      await new Promise((r) => setTimeout(r, this.defaultDelay))
    }
    if (this.shouldThrow) {
      const err = this.shouldThrow
      this.shouldThrow = null
      throw err
    }

    const call: RecordedCall = {
      method,
      path,
      body,
      query: request?.query,
      headers: request?.headers ?? {},
      timeoutMs: request?.timeoutMs,
    }
    this.calls.push(call)

    const handler = this.handlers.get(`${method}:${path}`)
    if (!handler) {
      throw new Error(`MockTransport: nenhum handler para ${method} ${path}`)
    }
    return handler(call) as T
  }

  get<T>(path: string, request?: ResourceRequest): Promise<T> {
    return this.run<T>('GET', path, undefined, request)
  }

  post<T>(path: string, body?: unknown, request?: ResourceRequest): Promise<T> {
    return this.run<T>('POST', path, body, request)
  }

  put<T>(path: string, body?: unknown, request?: ResourceRequest): Promise<T> {
    return this.run<T>('PUT', path, body, request)
  }

  patch<T>(path: string, body?: unknown, request?: ResourceRequest): Promise<T> {
    return this.run<T>('PATCH', path, body, request)
  }

  delete<T>(path: string, request?: ResourceRequest): Promise<T> {
    return this.run<T>('DELETE', path, undefined, request)
  }

  /** Limpa histórico e handlers. */
  reset(): this {
    this.calls = []
    this.handlers.clear()
    this.defaultDelay = 0
    this.shouldThrow = null
    return this
  }

  /** Verifica se uma chamada foi feita. */
  calledWith(method: string, path: string): boolean {
    return this.calls.some((c) => c.method === method && c.path === path)
  }

  /** Retorna última chamada. */
  lastCall(): RecordedCall | undefined {
    return this.calls[this.calls.length - 1]
  }
}

/** Cria um MockTransport com handlers rápidos (API legada). */
export function fakeTransport(
  handler: (call: RecordedCall) => unknown,
): ResourceTransport & { calls: RecordedCall[] } {
  const calls: RecordedCall[] = []
  const run = async <T>(
    method: string,
    path: string,
    body: unknown,
    request?: ResourceRequest,
  ): Promise<T> => {
    const call: RecordedCall = {
      method,
      path,
      body,
      query: request?.query,
      headers: request?.headers ?? {},
      timeoutMs: request?.timeoutMs,
    }
    calls.push(call)
    return handler(call) as T
  }
  return {
    calls,
    get: <T>(path: string, request?: ResourceRequest) => run<T>('GET', path, undefined, request),
    post: <T>(path: string, body?: unknown, request?: ResourceRequest) =>
      run<T>('POST', path, body, request),
    put: <T>(path: string, body?: unknown, request?: ResourceRequest) =>
      run<T>('PUT', path, body, request),
    patch: <T>(path: string, body?: unknown, request?: ResourceRequest) =>
      run<T>('PATCH', path, body, request),
    delete: <T>(path: string, request?: ResourceRequest) =>
      run<T>('DELETE', path, undefined, request),
  }
}

function toUrl(input: URL | string): URL {
  if (input instanceof URL) return new URL(input.toString())
  return new URL(input)
}
