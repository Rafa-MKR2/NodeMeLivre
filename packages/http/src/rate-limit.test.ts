import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MAX_WAIT_MS, RateLimiter, rateLimitKey } from './rate-limit.js'

function headers(extra?: Record<string, string>): Headers {
  const h = new Headers()
  for (const [k, v] of Object.entries(extra ?? {})) h.set(k, v)
  return h
}

describe('RateLimiter', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(1_750_000_000_000)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('deve ler limit, remaining e reset dos headers', () => {
    const limiter = new RateLimiter()
    limiter.update(
      '/items/MLB1',
      headers({
        'x-rate-limit-limit': '1000',
        'x-rate-limit-remaining': '42',
        'x-rate-limit-reset': '1700000000',
      }),
    )
    const state = limiter.stateOf('/items/MLB1')
    expect(state?.limit).toBe(1000)
    expect(state?.remaining).toBe(42)
    expect(state?.resetAt).toBe(1_700_000_000_000)
  })

  it('deve interpretar reset em milissegundos (epoch)', () => {
    const limiter = new RateLimiter()
    limiter.update(
      '/items/MLB1',
      headers({ 'x-rate-limit-reset': '1750000000000', 'x-rate-limit-remaining': '0' }),
    )
    expect(limiter.stateOf('/items/MLB1')?.resetAt).toBe(1_750_000_000_000)
  })

  it('deve interpretar reset relativo em segundos', () => {
    const limiter = new RateLimiter()
    limiter.update(
      '/items/MLB1',
      headers({ 'x-rate-limit-reset': '30', 'x-rate-limit-remaining': '0' }),
    )
    expect(limiter.stateOf('/items/MLB1')?.resetAt).toBe(1_750_000_030_000)
  })

  it('deve ignorar respostas sem headers de rate limit', () => {
    const limiter = new RateLimiter()
    limiter.update('/users/me', headers())
    expect(limiter.stateOf('/users/me')).toBeUndefined()
  })

  it('não deve esperar quando ainda há requisições restantes', async () => {
    const limiter = new RateLimiter()
    limiter.update(
      '/orders/search',
      headers({
        'x-rate-limit-remaining': '5',
        'x-rate-limit-reset': '1700000001',
      }),
    )
    await limiter.waitIfNeeded('/orders/search')
    expect(limiter.stateOf('/orders/search')?.remaining).toBe(5)
  })

  it('deve esperar até o reset quando o recurso está esgotado', async () => {
    const limiter = new RateLimiter()
    const resetAt = 1_750_000_005_000 // daqui a 5s
    limiter.update(
      '/items/MLB1',
      headers({
        'x-rate-limit-remaining': '0',
        'x-rate-limit-reset': String(resetAt / 1000),
      }),
    )

    let resolved = false
    const waiting = limiter.waitIfNeeded('/items/MLB1').then(() => {
      resolved = true
    })

    await vi.advanceTimersByTimeAsync(4_000)
    expect(resolved).toBe(false)
    await vi.advanceTimersByTimeAsync(1_000)
    await waiting
    expect(resolved).toBe(true)
  })

  it('deve limitar a espera quando o reset está muito no futuro (anti-DoS)', async () => {
    // Rodada 5: um `x-rate-limit-reset` no futuro distante (header corrompido
    // ou malicioso) fazia o SDK dormir dias. A espera agora é limitada a 5 min.
    const limiter = new RateLimiter()
    const resetAt = 9_999_999_999_999 // ~2286
    limiter.update(
      '/items/MLB1',
      headers({
        'x-rate-limit-remaining': '0',
        'x-rate-limit-reset': String(resetAt),
      }),
    )

    let resolved = false
    const waiting = limiter.waitIfNeeded('/items/MLB1').then(() => {
      resolved = true
    })

    // 5 min - 1s: ainda aguardando
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000 - 1_000)
    expect(resolved).toBe(false)
    // Último segundo do teto de 5 min: resolve
    await vi.advanceTimersByTimeAsync(1_000)
    await waiting
    expect(resolved).toBe(true)
  })

  it('deve limpar o estado quando a janela já expirou', async () => {
    const limiter = new RateLimiter()
    limiter.update(
      '/items/MLB1',
      headers({
        'x-rate-limit-remaining': '0',
        'x-rate-limit-reset': '1700000000',
      }),
    )
    await limiter.waitIfNeeded('/items/MLB1')
    expect(limiter.stateOf('/items/MLB1')).toBeUndefined()
  })

  it('deve compartilhar a espera entre chamadas concorrentes (single-flight)', async () => {
    const resolves: Array<() => void> = []
    const delay = () =>
      new Promise<void>((resolve) => {
        resolves.push(resolve)
      })
    const limiter = new RateLimiter({ delay })

    limiter.update(
      '/items/MLB1',
      headers({
        'x-rate-limit-remaining': '0',
        'x-rate-limit-reset': '60',
      }),
    )

    const p1 = limiter.waitIfNeeded('/items/MLB1')
    const p2 = limiter.waitIfNeeded('/items/MLB1')

    expect(resolves.length).toBe(1)

    resolves[0]?.()
    await p1
    await p2

    expect(resolves.length).toBe(1)
  })

  it('deve limpar o estado esgotado após o reset', async () => {
    const resolves: Array<() => void> = []
    const delay = () =>
      new Promise<void>((resolve) => {
        resolves.push(resolve)
      })
    const limiter = new RateLimiter({ delay })

    limiter.update(
      '/items/MLB1',
      headers({
        'x-rate-limit-remaining': '0',
        'x-rate-limit-reset': '60',
      }),
    )

    const waiting = limiter.waitIfNeeded('/items/MLB1')
    resolves[0]?.()
    await waiting

    expect(limiter.stateOf('/items/MLB1')).toBeUndefined()
  })

  it('reset relativo implausível (>5 min) é ignorado — não bloqueia (O3)', async () => {
    // 500s * 1000 = 500_000ms > MAX_WAIT_MS (300_000ms) → parseResetAt retorna undefined
    const limiter = new RateLimiter()
    limiter.update(
      '/items/MLB1',
      headers({
        'x-rate-limit-remaining': '0',
        'x-rate-limit-reset': '500', // segundos relativos
      }),
    )

    // resetAt não é definido → waitIfNeeded resolve imediatamente
    await expect(limiter.waitIfNeeded('/items/MLB1')).resolves.toBeUndefined()
  })

  it('remaining vazio/só-espaço não bloqueia (F3, pente fino)', async () => {
    // `Number('')`/`Number('  ')` = 0: antes, um gateway que enviasse o
    // header vazio fazia o SDK dormir até o reset mesmo com o recurso
    // disponível (DoS auto-infligido). Parse estrito → remaining undefined →
    // waitIfNeeded não bloqueia.
    const limiter = new RateLimiter()
    limiter.update(
      '/items/MLB1',
      headers({ 'x-rate-limit-remaining': '', 'x-rate-limit-reset': '30' }),
    )
    expect(limiter.stateOf('/items/MLB1')?.remaining).toBeUndefined()
    await expect(limiter.waitIfNeeded('/items/MLB1')).resolves.toBeUndefined()

    const limiter2 = new RateLimiter()
    limiter2.update(
      '/items/MLB1',
      headers({ 'x-rate-limit-remaining': '   ', 'x-rate-limit-reset': '30' }),
    )
    expect(limiter2.stateOf('/items/MLB1')?.remaining).toBeUndefined()
    await expect(limiter2.waitIfNeeded('/items/MLB1')).resolves.toBeUndefined()
  })

  it('remaining ausente (sem header) não bloqueia mesmo com reset presente (F3, pente fino)', async () => {
    const limiter = new RateLimiter()
    limiter.update('/items/MLB1', headers({ 'x-rate-limit-reset': '30' }))
    expect(limiter.stateOf('/items/MLB1')?.remaining).toBeUndefined()
    await expect(limiter.waitIfNeeded('/items/MLB1')).resolves.toBeUndefined()
  })

  it('remaining em notação não-decimal (hex) é rejeitado (F3, pente fino)', async () => {
    // `Number('0x10')` = 16 — um header hex não é um inteiro decimal válido
    // e não deve virar "16 restantes" nem "16 = esgotado".
    const limiter = new RateLimiter()
    limiter.update('/items/MLB1', headers({ 'x-rate-limit-remaining': '0x10' }))
    expect(limiter.stateOf('/items/MLB1')?.remaining).toBeUndefined()
    await expect(limiter.waitIfNeeded('/items/MLB1')).resolves.toBeUndefined()
  })
})

describe('rateLimitKey', () => {
  it('deve agrupar por método e primeiro segmento do path', () => {
    expect(rateLimitKey('GET', '/items/MLB1')).toBe('GET:items')
    expect(rateLimitKey('GET', '/items/MLB2')).toBe('GET:items')
    expect(rateLimitKey('POST', '/items')).toBe('POST:items')
    expect(rateLimitKey('GET', '/sites/MLB/search')).toBe('GET:sites')
  })

  it('deve usar o path como recurso quando não há segmento', () => {
    expect(rateLimitKey('GET', '/')).toBe('GET:/')
    expect(rateLimitKey('GET', 'sem-slash')).toBe('GET:sem-slash')
  })
})

describe('RateLimiter — fuzzing (Rodada 9+, determinístico)', () => {
  /** PRNG determinístico (mulberry32) — fuzz reproduzível no CI, sem flakiness. */
  function mulberry32(seed: number): () => number {
    let a = seed >>> 0
    return () => {
      a = (a + 0x6d2b79f5) | 0
      let t = Math.imul(a ^ (a >>> 15), 1 | a)
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
  }

  /**
   * Seeds do fuzz. NO CI (sem `FUZZ_SEEDS`): a seed fixa — 100%
   * determinística e reproduzível, comportamento padrão inalterado. FORA do
   * CI, a env `FUZZ_SEEDS` (hex `0x…` ou decimal, separados por
   * vírgula/espaço) ROTACIONA as seeds: cada teste roda uma vez por seed,
   * ampliando a cobertura para rodadas mais longas (N seeds × casos).
   * Valor inválido/vazio → fallback para a seed fixa (nunca degrada o CI).
   */
  function fuzzSeeds(fixed: number): number[] {
    const raw = process.env.FUZZ_SEEDS
    if (raw === undefined || raw.trim() === '') return [fixed]
    const seeds = [
      ...new Set(
        raw
          .split(/[\s,]+/)
          .map((s) => Number.parseInt(s, 0))
          .filter((n) => Number.isFinite(n))
          .map((n) => n >>> 0),
      ),
    ]
    return seeds.length > 0 ? seeds : [fixed]
  }

  /** Roda o corpo do fuzz uma vez por seed ativa (rotativas fora do CI). */
  function forEachFuzzSeed(fixed: number, fn: (rand: () => number) => void): void {
    for (const seed of fuzzSeeds(fixed)) fn(mulberry32(seed))
  }

  /** Versão assíncrona — o RateLimiter espera via Promise. */
  async function forEachFuzzSeedAsync(
    fixed: number,
    fn: (rand: () => number) => Promise<void>,
  ): Promise<void> {
    for (const seed of fuzzSeeds(fixed)) await fn(mulberry32(seed))
  }

  /** Escolhe um item do pool (rand ∈ [0, 1) → índice sempre válido). */
  function pick<T>(rand: () => number, pool: readonly T[]): T {
    return pool[Math.floor(rand() * pool.length)] as T
  }

  /**
   * Pool de `x-rate-limit-reset`: epochs (ms/s), relativos plausíveis,
   * limites de formato (> 1e12 / > 1e9 / ≤ 1e9), relativos implausíveis
   * (O3, Rodada 8), futuros distantes, negativos e lixo.
   */
  const RESET_VALUES = [
    '1750000000000', // epoch ms == now (expira imediatamente)
    '1700000000', // epoch s no passado
    '1700000000.5', // epoch s fracionário
    '1000000001', // > 1e9 → epoch s (futuro distante → teto)
    '60', // relativo plausível (60s)
    '1', // 1s
    '299', // relativo ≤ teto (299s < 300s → aceito)
    '300', // = MAX_WAIT_MS em s (exato → aceito)
    '301', // relativo > teto → descartado (O3)
    '500000', // relativo gigante → descartado
    '999999999999999', // epoch ms no futuro distante → espera capped
    '1e13', // notação científica (Number ok)
    '1e9', // exatamente 1e9 → relativo gigante → descartado
    '-5',
    'abc',
    'NaN',
    'Infinity',
    '',
  ] as const

  /** Pool de `x-rate-limit-remaining` — inclui 0 (esgotado) e lixo. */
  const REMAINING_VALUES = ['0', '1', '42', '999', '-1', 'abc', '', 'Infinity'] as const

  /** Pool de `x-rate-limit-limit`. */
  const LIMIT_VALUES = ['1000', '0', '1', '5000', '-3', 'abc', '', '1e6'] as const

  it('nunca espera mais que MAX_WAIT_MS nem menos que 1ms (1000 combinações de headers)', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_750_000_000_000)
    try {
      await forEachFuzzSeedAsync(0xbeef_0000, async (rand) => {
        for (let g = 0; g < 1000; g++) {
          const delays: number[] = []
          const limiter = new RateLimiter({
            delay: async (ms) => {
              delays.push(ms)
            },
          })
          const key = `${pick(rand, ['GET', 'POST', 'PUT'])}:${pick(rand, ['items', 'orders', 'search', 'x'])}`
          const h = headers({
            'x-rate-limit-limit': pick(rand, LIMIT_VALUES),
            'x-rate-limit-remaining': pick(rand, REMAINING_VALUES),
            'x-rate-limit-reset': pick(rand, RESET_VALUES),
          })

          // Headers arbitrários (garbage in) nunca lançam.
          expect(() => limiter.update(key, h), `grafo ${g}`).not.toThrow()
          await expect(limiter.waitIfNeeded(key), `grafo ${g}`).resolves.toBeUndefined()

          // INVARIANTE-CHAVE (Rodada 5): nenhuma espera acima do teto de
          // 5 min nem espera vazia/negativa — um `x-rate-limit-reset`
          // corrompido/gateway/atacante nunca pode fazer o SDK dormir dias.
          for (const ms of delays) {
            expect(ms, `grafo ${g}: espera de ${ms}ms acima do teto`).toBeLessThanOrEqual(
              MAX_WAIT_MS,
            )
            expect(ms, `grafo ${g}: espera de ${ms}ms não positiva`).toBeGreaterThanOrEqual(1)
          }
        }
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('esperas concorrentes no mesmo recurso compartilham UMA única chamada de delay', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_750_000_000_000)
    try {
      await forEachFuzzSeedAsync(0xc0ffee_00, async (rand) => {
        for (let g = 0; g < 200; g++) {
          const delays: number[] = []
          const limiter = new RateLimiter({
            delay: async (ms) => {
              delays.push(ms)
            },
          })
          limiter.update(
            'GET:items',
            headers({ 'x-rate-limit-remaining': '0', 'x-rate-limit-reset': '30' }),
          )

          // Concorrência aleatória (1-4) — sem single-flight, cada chamada
          // dormiria o mesmo tempo e disparam juntas no reset (herd).
          const concurrent = 1 + Math.floor(rand() * 4)
          await Promise.all(
            Array.from({ length: concurrent }, () => limiter.waitIfNeeded('GET:items')),
          )
          expect(delays.length, `grafo ${g}: single-flight quebrado`).toBe(1)
        }
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('rateLimitKey nunca lança e agrupa pelo primeiro segmento (500 paths aleatórios)', () => {
    forEachFuzzSeed(0x5eed_0000, (rand) => {
      for (let g = 0; g < 500; g++) {
        const segments = Array.from({ length: Math.floor(rand() * 4) }, () =>
          pick(rand, ['items', 'orders', 'MLB1', 'search', '', 'a b', 'ç']),
        )
        const path = `/${segments.join('/')}`
        const key = rateLimitKey('GET', path)
        expect(typeof key, `grafo ${g}`).toBe('string')
        const first = path.split('/').find((s) => s !== '')
        expect(key, `grafo ${g}: path ${JSON.stringify(path)}`).toBe(`GET:${first ?? path}`)
      }
    })
  })
})
