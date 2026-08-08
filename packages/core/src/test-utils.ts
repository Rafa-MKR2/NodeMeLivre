import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
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
  signal: AbortSignal | undefined
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
      signal: request?.signal,
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
      signal: request?.signal,
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

// ---------------------------------------------------------------------------
// Mock server de integração (HTTP real, zero dependências)
// ---------------------------------------------------------------------------

/** Requisição recebida pelo mock server, já normalizada. */
export interface MockRequest {
  method: string
  /** Pathname (sem query). */
  path: string
  query: URLSearchParams
  headers: IncomingMessage['headers']
  /** Body JSON parseado (ou `undefined` quando não é JSON). */
  body: unknown
  /** Corpo cru em texto (JSON serializado ou texto plano). */
  rawBody: string
  /** Epoch ms em que o servidor recebeu a requisição. */
  receivedAt: number
}

export interface MockResponse {
  status?: number
  headers?: Record<string, string>
  json?: unknown
  text?: string
  /** Latência simulada antes de responder (ms) — simula rede lenta. */
  delayMs?: number
}

export type MockHandler = (req: MockRequest) => MockResponse | Promise<MockResponse>

export interface MockRoute {
  method: string | undefined
  path: string | RegExp
  handler: MockHandler
}

/**
 * Política de chaos aplicada sobre as respostas do mock.
 *
 * - `failureRate` — probabilidade (0..1) de responder com `failStatus`
 *   (instabilidade intermitente).
 * - `latencyMs`/`jitterMs` — atraso antes de responder (latência variável;
 *   o jitter adiciona 0..jitterMs aleatório).
 * - `random` — fonte aleatória injetável para testes determinísticos.
 */
export interface ChaosConfig {
  /** Probabilidade (0..1) de responder com falha (padrão de falha: 503). */
  failureRate?: number
  /** Status da falha injetada (padrão: 503). */
  failStatus?: number
  /** Atraso fixo antes de responder (ms). */
  latencyMs?: number
  /** Jitter: atraso aleatório adicional de 0..jitterMs (ms). */
  jitterMs?: number
  /** Fonte aleatória injetável (determinismo em testes). */
  random?: () => number
}

/**
 * Servidor HTTP real simulando a API do Mercado Livre (zero dependências).
 *
 * Usado pelos testes de integração do SDK/HttpClient para validar o contrato
 * HTTP (método/path/query/headers), retry (429/5xx), rate limit, timeout e
 * falhas de rede — tudo com fetch real contra `127.0.0.1`.
 *
 * ```ts
 * const server = new MockMercadoLivreServer()
 * const baseUrl = await server.start()
 * server.respond('GET', '/items/MLB1', 200, { id: 'MLB1' })
 * const client = new HttpClient({ baseUrl })
 * await client.get('/items/MLB1')
 * expect(server.requests[0]?.headers.authorization).toBe('Bearer token')
 * await server.stop()
 * ```
 */
export class MockMercadoLivreServer {
  private server: Server | null = null
  private routes: MockRoute[] = []
  readonly requests: MockRequest[] = []
  baseUrl = ''

  /** Registra rota para qualquer método. */
  route(path: string | RegExp, handler: MockHandler): this
  /** Registra rota para um método específico. */
  route(method: string, path: string | RegExp, handler: MockHandler): this
  route(a: string | RegExp, b: string | RegExp | MockHandler, c?: MockHandler): this {
    if (typeof b === 'function') {
      this.routes.push({ method: undefined, path: a as string | RegExp, handler: b })
      return this
    }
    this.routes.push({ method: a as string, path: b, handler: c as MockHandler })
    return this
  }

  /** Atalho para resposta JSON fixa. */
  respond(
    method: string,
    path: string | RegExp,
    status: number,
    json?: unknown,
    headers?: Record<string, string>,
  ): this {
    return this.route(method, path, () => {
      const response: MockResponse = { status }
      if (json !== undefined) response.json = json
      if (headers !== undefined) response.headers = headers
      return response
    })
  }

  /** Aplica política de chaos global (toda requisição). */
  chaos(config: ChaosConfig): this
  /** Aplica política de chaos por endpoint (prefixo do path; o mais específico vence). */
  chaos(prefix: string, config: ChaosConfig): this
  chaos(a: string | ChaosConfig, b?: ChaosConfig): this {
    if (typeof a === 'string') {
      if (b === undefined) {
        throw new Error('chaos(prefix) exige um ChaosConfig')
      }
      this.chaosByPrefix.push({ prefix: a, config: b })
      return this
    }
    this.chaosGlobal = a
    return this
  }

  /** Sobe o servidor numa porta efêmera e devolve a baseUrl. */
  async start(): Promise<string> {
    const server = createServer((req, res) => {
      void this.handle(req, res)
    })
    // Conexões abortadas (timeout/cancelamento) não podem derrubar o servidor.
    server.on('clientError', () => {})
    this.server = server
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address() as AddressInfo
    this.baseUrl = `http://127.0.0.1:${address.port}`
    return this.baseUrl
  }

  /** Derruba o servidor e libera a porta (usado para simular falha de rede). */
  async stop(): Promise<void> {
    const server = this.server
    if (server === null) return
    this.server = null
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err !== undefined ? reject(err) : resolve()))
      server.closeAllConnections?.()
    })
  }

  /** Limpa rotas, políticas de chaos e histórico de requisições. */
  clear(): this {
    this.routes = []
    this.requests.length = 0
    this.chaosGlobal = null
    this.chaosByPrefix = []
    return this
  }
  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    res.on('error', () => {})
    req.on('error', () => {})

    let mockReq: MockRequest
    try {
      mockReq = await this.buildRequest(req)
    } catch {
      // Cliente abortou durante a leitura do corpo (timeout/cancelamento).
      if (!res.writableEnded) res.destroy()
      return
    }
    this.requests.push(mockReq)

    const route = this.routes.find(
      (r) =>
        (r.method === undefined || r.method === mockReq.method) &&
        matchesPath(r.path, mockReq.path),
    )
    if (route === undefined) {
      this.writeJson(res, 404, {
        message: `No mock route for ${mockReq.method} ${mockReq.path}`,
      })
      return
    }

    let response: MockResponse
    try {
      response = await route.handler(mockReq)
    } catch (error) {
      // Falha do handler (asserção ou bug do mock): expõe a causa ao cliente —
      // o teste falha com a mensagem visível em vez de um erro de rede genérico.
      this.writeJson(res, 500, { message: `Mock handler error: ${String(error)}` })
      return
    }

    // Chaos: injeta falha ou latência sobre a resposta (simula produção instável).
    const chaosConfig = this.resolveChaos(mockReq.path)
    if (chaosConfig !== null) {
      response = applyChaos(response, chaosConfig)
    }

    // A escrita pode falhar quando o cliente abortou (timeout/cancelamento).
    try {
      if (response.delayMs !== undefined && response.delayMs > 0) {
        await new Promise((r) => setTimeout(r, response.delayMs))
      }
      const status = response.status ?? 200
      const headers = {
        'content-type':
          response.text !== undefined ? 'text/plain; charset=utf-8' : 'application/json',
        ...response.headers,
      }
      const payload =
        response.text !== undefined ? response.text : JSON.stringify(response.json ?? {})
      res.writeHead(status, headers)
      res.end(payload)
    } catch {
      if (!res.writableEnded) res.destroy()
    }
  }

  /** Política de chaos global (aplica-se a toda requisição). */
  private chaosGlobal: ChaosConfig | null = null
  /** Políticas de chaos por prefixo de path (a mais específica vence). */
  private chaosByPrefix: Array<{ prefix: string; config: ChaosConfig }> = []

  private resolveChaos(path: string): ChaosConfig | null {
    let best: ChaosConfig | null = null
    let bestLength = -1
    for (const { prefix, config } of this.chaosByPrefix) {
      // Casa por segmento do path: '/items' afeta '/items/MLB1', mas não '/itemscart'.
      const matches = path === prefix || path.startsWith(`${prefix}/`)
      if (matches && prefix.length > bestLength) {
        best = config
        bestLength = prefix.length
      }
    }
    return best ?? this.chaosGlobal
  }

  private async buildRequest(req: IncomingMessage): Promise<MockRequest> {
    const url = new URL(req.url ?? '/', this.baseUrl === '' ? 'http://localhost' : this.baseUrl)
    const rawBody = await readRawBody(req)
    return {
      method: req.method ?? 'GET',
      path: url.pathname,
      query: url.searchParams,
      headers: req.headers,
      body: parseJsonBody(req.headers['content-type'], rawBody),
      rawBody,
      receivedAt: Date.now(),
    }
  }

  private writeJson(res: ServerResponse, status: number, body: unknown): void {
    try {
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(JSON.stringify(body))
    } catch {
      res.destroy()
    }
  }
}

async function readRawBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(chunk as Buffer)
  }
  return Buffer.concat(chunks).toString('utf8')
}

function parseJsonBody(contentType: string | undefined, raw: string): unknown {
  if (contentType === undefined || !contentType.includes('application/json')) return undefined
  if (raw.trim() === '') return undefined
  try {
    return JSON.parse(raw) as unknown
  } catch {
    return raw
  }
}

function matchesPath(route: string | RegExp, path: string): boolean {
  return typeof route === 'string' ? route === path : route.test(path)
}

/** Aplica a política de chaos sobre a resposta do handler. */
function applyChaos(response: MockResponse, chaos: ChaosConfig): MockResponse {
  const random = chaos.random ?? Math.random

  // Instabilidade intermitente: sorteia a falha injetada.
  if (chaos.failureRate !== undefined && random() < chaos.failureRate) {
    return { status: chaos.failStatus ?? 503, json: { message: 'chaos: falha injetada' } }
  }

  // Latência variável: fixa + jitter aleatório.
  const latency =
    (chaos.latencyMs ?? 0) + (chaos.jitterMs !== undefined ? random() * chaos.jitterMs : 0)
  if (latency > 0) {
    return { ...response, delayMs: (response.delayMs ?? 0) + latency }
  }
  return response
}
