import { vi } from 'vitest'
import type { ResourceRequest, ResourceTransport } from './resources/transport.js'

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
}

/** Transport falso que registra chamadas e devolve valores programados. */
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
    const call: RecordedCall = { method, path, body, query: request?.query }
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
