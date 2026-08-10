import { ApiError, NetworkError } from '@nodemelivre/errors'
import { describe, expect, it } from 'vitest'
import { HttpClient, type HttpClientOptions } from './client.js'
import { MAX_WAIT_MS } from './rate-limit.js'
import { MAX_REDIRECTS } from './url.js'

/**
 * FUZZING determinístico do caminho HTTP REAL (Rodada 10+, supply/robustez).
 *
 * Os fuzzers anteriores (Estágios 3-7) cobrem utilidades isoladas (deepOmitEmpty,
 * logger, buildUrl, paginate, RateLimiter). Este exercita o `HttpClient.request`
 * por inteiro com um fetch HOSTIL que devolve cadeias aleatórias de redirects,
 * status de retry, retry-after corrompido e bodies malformados — e verifica os
 * invariantes de SEGURANÇA e orçamento que a auditoria garantiu:
 *
 *   1. Authorization NUNCA é enviado a um origin ≠ do baseUrl (nem via redirect
 *      cross-origin — o token só vale para o origin original);
 *   2. NUNCA mais que MAX_REDIRECTS+1 fetches (anti-loop de redirect);
 *   3. downgrade https→http bloqueado (nenhum fetch vai para http://);
 *   4. Location vazio/corrompido → NetworkError tipado (nunca erro nativo);
 *   5. orçamento de retry respeitado: no máximo maxRetries+1 tentativas (5xx/429);
 *   retry-after corrompido nunca dorme além de MAX_WAIT_MS;
 *   6. resposta corrompida/inválida nunca lança erro nativo de parse — cai no
 *      contrato do SDK (texto/undefined), o fetch/parse nunca derruba o processo.
 */
describe('HttpClient — fuzzing (Rodada 10+, determinístico)', () => {
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

  /** Seeds rotativas via FUZZ_SEEDS (fora do CI); seed fixa no CI. */
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

  async function forEachFuzzSeed(
    fixed: number,
    fn: (rand: () => number) => void | Promise<void>,
  ): Promise<void> {
    for (const seed of fuzzSeeds(fixed)) await fn(mulberry32(seed))
  }

  function pick<T>(rand: () => number, pool: readonly T[]): T {
    return pool[Math.floor(rand() * pool.length)] as T
  }

  const BASE = 'https://api.mercadolibre.com'

  const noDelay = async (): Promise<void> => {}

  function client(overrides: HttpClientOptions = {}): HttpClient {
    return new HttpClient({
      delay: noDelay,
      retry: { maxRetries: 2, jitter: false, baseDelayMs: 1 },
      ...overrides,
    })
  }

  /** Locations: mesmos hosts oficiais, hosts maliciosos, downgrades e lixo. */
  const LOCATIONS = [
    '/items/MLB1',
    'https://api.mercadolivre.com.br/items/MLB1',
    'https://api.mercadolibre.com/items/MLB1',
    'https://sub.api.mercadolibre.com/items/MLB1',
    'https://evil.com/steal',
    'http://api.mercadolibre.com/items/MLB1',
    'http://evil.com/steal',
    'file:///etc/passwd',
    'javascript:alert(1)',
    'data:text/plain,x',
    '//evil.com/steal',
    'https://api.mercadolibre.com.evil.com/steal',
    '',
    '  ',
    'https://api.mercadolibre.com/%0d%0aX:y',
    'https://api.mercadolibre.com\\evil.com/x',
  ] as const

  const RETRY_STATUSES = [429, 500, 502, 503, 504] as const

  function isRedirect(status: number): boolean {
    return status === 301 || status === 302 || status === 303 || status === 307 || status === 308
  }

  it('nunca vaza Authorization cross-origin, nunca excede MAX_REDIRECTS e nunca faz downgrade (400 cadeias)', async () => {
    await forEachFuzzSeed(0xc01d_0000, async (rand) => {
      for (let g = 0; g < 400; g++) {
        // Gera uma cadeia de redirects aleatória (0..MAX_REDIRECTS+2 hops).
        const chain = Array.from({ length: Math.floor(rand() * (MAX_REDIRECTS + 3)) }, () => ({
          location: pick(rand, LOCATIONS),
          status: pick(rand, [301, 302, 303, 307, 308] as const),
        }))
        const finalStatus = rand() < 0.5 ? 200 : pick(rand, RETRY_STATUSES)

        const seenUrls: string[] = []
        const authSeen: boolean[] = []
        let call = 0

        const hostileFetch: typeof fetch = async (input, init) => {
          const url = new URL(input as string)
          seenUrls.push(url.href)
          const headers = new Headers(init?.headers)
          authSeen.push(headers.has('authorization'))
          const hop = chain[call]
          call++
          if (hop !== undefined && isRedirect(hop.status)) {
            return new Response(null, { status: hop.status, headers: { location: hop.location } })
          }
          return new Response(JSON.stringify({ ok: true, call }), { status: finalStatus })
        }

        let result: unknown = 'never'
        let thrown: unknown = null
        try {
          result = await client({
            fetchImpl: hostileFetch,
            auth: { getToken: async () => 'SECRET_TOKEN' },
          }).get('/items/MLB1', { retry: false })
        } catch (err) {
          thrown = err
        }

        // INVARIANTE 1 (SEGURANÇA): nenhum fetch cross-origin carregou o Bearer.
        for (let i = 0; i < seenUrls.length; i++) {
          const url = seenUrls[i]
          if (url === undefined) {
            throw new Error(`grafo ${g}: seenUrls[${i}] ausente (invariante do fuzz)`)
          }
          const origin = new URL(url).origin
          if (origin !== new URL(BASE).origin) {
            expect(authSeen[i], `grafo ${g}: Authorization vazou para ${url} (hop ${i})`).toBe(
              false,
            )
          }
        }

        // INVARIANTE 2: nunca mais que MAX_REDIRECTS+1 fetches (anti-loop).
        expect(
          seenUrls.length,
          `grafo ${g}: ${seenUrls.length} fetches (loop?) — chain ${chain.length}`,
        ).toBeLessThanOrEqual(MAX_REDIRECTS + 1)

        // INVARIANTE 3: base https → nenhum fetch pode ir para http://.
        for (const u of seenUrls) {
          expect(new URL(u).protocol, `grafo ${g}: downgrade para ${u}`).toBe('https:')
        }

        // INVARIANTE 4: erros são SEMPRE tipados do SDK (NetworkError para o
        // loop/bloqueio de redirect; ApiError para o status final de erro) —
        // um erro nativo do parser/URL/fetch nunca pode escapar.
        if (thrown !== null) {
          expect(
            thrown instanceof NetworkError || thrown instanceof ApiError,
            `grafo ${g}: erro nativo escapou: ${String(thrown)}`,
          ).toBe(true)
        }
        // Ou sucesso, ou NetworkError — nunca outro tipo.
        if (thrown === null) {
          expect(result).not.toBe('never')
        }

        // INVARIANTE 5: sucesso só quando a cadeia terminou em status ok.
        if (result !== 'never') {
          expect(finalStatus).toBeLessThan(400)
          expect(seenUrls.length).toBeLessThanOrEqual(chain.length + 1)
        }
      }
    })
  })

  it('orçamento de retry é EXATO: nunca mais que maxRetries+1 tentativas em 5xx/429 (300 grafos)', async () => {
    await forEachFuzzSeed(0x5e77e_0000, async (rand) => {
      for (let g = 0; g < 300; g++) {
        const maxRetries = pick(rand, [0, 1, 2, 3] as const)
        const retryStatuses = [pick(rand, RETRY_STATUSES), pick(rand, RETRY_STATUSES)]
        let call = 0
        const hostileFetch: typeof fetch = async () => {
          call++
          return new Response(JSON.stringify({ e: 'x' }), {
            status: call <= retryStatuses.length ? pick(rand, retryStatuses) : 200,
          })
        }
        let thrown: unknown = null
        try {
          await client({
            fetchImpl: hostileFetch,
            retry: { maxRetries, jitter: false, baseDelayMs: 1 },
          }).get('/items/MLB1')
        } catch (err) {
          thrown = err
        }
        // Nunca mais que maxRetries+1 tentativas; sucesso antes disso é ok.
        expect(
          call,
          `grafo ${g}: maxRetries=${maxRetries} → ${call} tentativas`,
        ).toBeLessThanOrEqual(maxRetries + 1)
        if (thrown !== null) {
          expect(thrown, `grafo ${g}`).toBeInstanceOf(ApiError)
          expect(call).toBe(maxRetries + 1)
        }
      }
    })
  })

  it('retry-after corrompido nunca dorme além de MAX_WAIT_MS (200 casos)', async () => {
    await forEachFuzzSeed(0x7a17a_0000, async (rand) => {
      const garbage = [
        '',
        ' ',
        'abc',
        '-5',
        '0x10',
        '999999999999999999999999',
        '0',
        '1e9',
        '1.5',
      ] as const
      for (let g = 0; g < 200; g++) {
        const sleptMax: number[] = []
        const hostileFetch: typeof fetch = async () => {
          return new Response(JSON.stringify({ e: 'rate' }), {
            status: 429,
            headers: { 'retry-after': pick(rand, garbage) },
          })
        }
        try {
          await client({
            fetchImpl: hostileFetch,
            delay: async (ms) => {
              sleptMax.push(ms)
            },
            retry: { maxRetries: 1, jitter: false, baseDelayMs: 1 },
          }).get('/items/MLB1')
        } catch {
          // esperado — 429 persistente esgota o retry.
        }
        for (const ms of sleptMax) {
          expect(ms, `grafo ${g}: delay ${ms}ms`).toBeLessThanOrEqual(MAX_WAIT_MS)
          expect(ms, `grafo ${g}: delay negativo`).toBeGreaterThanOrEqual(0)
        }
      }
    })
  })

  it('bodies hostis nunca lançam erro nativo de parse (300 casos)', async () => {
    await forEachFuzzSeed(0x50a15e_0000, async (rand) => {
      const bodies = [
        '',
        'not json',
        'null',
        '{"a":1',
        '[1,2',
        '{"__proto__":{"polluted":true}}',
        '\u0000',
        '\r\n\r\n',
        JSON.stringify({ a: 'b' }),
        '123456789012345678901234567890',
      ] as const
      for (let g = 0; g < 300; g++) {
        const body = pick(rand, bodies)
        const hostileFetch: typeof fetch = async () =>
          new Response(body, {
            status: 200,
            headers: { 'content-type': 'application/json' },
          })
        let value: unknown
        let thrown: unknown = null
        try {
          value = await client({ fetchImpl: hostileFetch }).get('/items/MLB1')
        } catch (err) {
          thrown = err
        }
        // Nunca um erro de parse escapa — corpo inválido vira texto/undefined.
        if (thrown !== null) {
          expect(thrown, `grafo ${g}: parse de "${JSON.stringify(body)}"`).toBeInstanceOf(
            NetworkError,
          )
        }
        void value
      }
    })
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })

  it('clone emitido no evento response não quebra o parse do SDK (O4, 100 casos)', async () => {
    await forEachFuzzSeed(0xc101e_0000, async (rand) => {
      for (let g = 0; g < 100; g++) {
        const payload = {
          id: `MLB${Math.floor(rand() * 1000)}`,
          t: pick(rand, ['a', 'b', 'c'] as const),
        }
        const hostileFetch: typeof fetch = async () =>
          new Response(JSON.stringify(payload), { status: 200 })

        const http = client({ fetchImpl: hostileFetch })
        let clonedRead: string | null = null
        http.on('response', (res) => {
          // Listener consome o body do clone — não pode quebrar o parse do SDK.
          void res.text().then((t) => {
            clonedRead = t
          })
        })

        let value: unknown = null
        let thrown: unknown = null
        try {
          value = await http.get('/items/MLB1')
        } catch (err) {
          thrown = err
        }
        expect(thrown, `grafo ${g}`).toBeNull()
        expect(value, `grafo ${g}`).toEqual(payload)
        expect(clonedRead, `grafo ${g}`).toBe(JSON.stringify(payload))
      }
    })
  })
})
