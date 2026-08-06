/**
 * Controle de rate limit do Mercado Livre.
 *
 * A API informa os limites por recurso nos headers `X-Rate-Limit-*`.
 * O limiter guarda o estado por recurso e, antes de cada requisição,
 * espera quando o recurso estiver esgotado até o reset.
 */

export interface RateLimitState {
  /** Limite total de requisições por janela do recurso. */
  limit: number | undefined
  /** Requisições restantes na janela atual. */
  remaining: number | undefined
  /** Timestamp (epoch ms) do reset da janela. */
  resetAt: number | undefined
}

const RATE_LIMIT_HEADERS = {
  limit: 'x-rate-limit-limit',
  remaining: 'x-rate-limit-remaining',
  reset: 'x-rate-limit-reset',
} as const

function parsePositive(raw: string | null): number | undefined {
  if (raw === null) return undefined
  const value = Number(raw)
  return Number.isFinite(value) && value >= 0 ? value : undefined
}

/**
 * Converte o header `x-rate-limit-reset` para epoch ms.
 *
 * O Mercado Livre envia um timestamp absoluto (segundos ou ms), mas alguns
 * gateways devolvem a janela restante em segundos relativos. Tratamos os
 * três formatos:
 * - valor > 1e12 → epoch em ms.
 * - valor > 1e9 → epoch em segundos.
 * - valor <= 1e9 → segundos restantes (relativo a `now`).
 */
function parseResetAt(raw: string | null, now: number = Date.now()): number | undefined {
  const value = parsePositive(raw)
  if (value === undefined) return undefined
  if (value > 1e12) return value
  if (value > 1e9) return value * 1000
  return now + value * 1000
}

/**
 * Chave de rate limit por recurso (primeiro segmento do path) + método.
 *
 * O limite do Mercado Livre vale para o recurso inteiro — usar o path
 * literal (`/items/MLB1`, `/items/MLB2`) fragmentaria o tracking. Agrupar
 * por `método:recurso` mantém o estado compartilhado entre os IDs.
 */
export function rateLimitKey(method: string, path: string): string {
  const resource = path.split('/').filter(Boolean)[0] ?? path
  return `${method}:${resource}`
}

export interface RateLimiterOptions {
  /** Sleep injetável para esperas de rate limit — útil em testes. */
  delay?: (ms: number) => Promise<void>
}

export class RateLimiter {
  private readonly states = new Map<string, RateLimitState>()
  private readonly waits = new Map<string, Promise<void>>()
  private readonly delay: (ms: number) => Promise<void>

  constructor(options: RateLimiterOptions = {}) {
    this.delay = options.delay ?? sleep
  }

  /** Atualiza o estado a partir dos headers da resposta. */
  update(key: string, headers: Headers): void {
    const limit = parsePositive(headers.get(RATE_LIMIT_HEADERS.limit))
    const remaining = parsePositive(headers.get(RATE_LIMIT_HEADERS.remaining))
    const resetAt = parseResetAt(headers.get(RATE_LIMIT_HEADERS.reset))

    if (limit === undefined && remaining === undefined && resetAt === undefined) {
      return
    }

    this.states.set(key, {
      limit: limit ?? undefined,
      remaining: remaining ?? undefined,
      resetAt: resetAt ?? undefined,
    })
  }

  /** Espera até o reset se o recurso estiver esgotado. */
  async waitIfNeeded(key: string): Promise<void> {
    const state = this.states.get(key)
    if (state === undefined) return
    if (state.remaining !== undefined && state.remaining > 0) return

    const resetAt = state.resetAt ?? 0
    const delayMs = resetAt - Date.now()
    if (delayMs <= 0) {
      // Janela já expirou; limpa o estado para não bloquear à toa.
      this.states.delete(key)
      return
    }

    // Single-flight: chamadas concorrentes no mesmo recurso esgotado
    // compartilham a mesma espera — evita o "thundering herd" no reset,
    // em que todas as requisições dormem o mesmo tempo e disparam juntas.
    const existing = this.waits.get(key)
    if (existing !== undefined) return existing

    const wait = this.delay(delayMs).then(() => {
      // Após a janela, limpa o estado esgotado — apenas se ainda for o
      // mesmo reset (uma resposta fresca pode ter atualizado o estado).
      const current = this.states.get(key)
      if (current !== undefined && current.resetAt === resetAt && current.remaining === 0) {
        this.states.delete(key)
      }
    })
    this.waits.set(key, wait)
    try {
      await wait
    } finally {
      this.waits.delete(key)
    }
  }

  stateOf(key: string): RateLimitState | undefined {
    return this.states.get(key)
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
