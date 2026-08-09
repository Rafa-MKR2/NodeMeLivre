import { InputValidationError } from '@nodemelivre/errors'
import { describe, expect, it } from 'vitest'
import { buildUrl, type UrlQuery } from './url.js'

describe('buildUrl — fuzzing (Rodada 9+, determinístico)', () => {
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

  /** Escolhe um item do pool (rand ∈ [0, 1) → índice sempre válido). */
  function pick<T>(rand: () => number, pool: readonly T[]): T {
    return pool[Math.floor(rand() * pool.length)] as T
  }

  /** Bases válidas — o invariante de origin precisa valer para todas. */
  const BASES = [
    'https://api.mercadolibre.com',
    'https://api.mercadolivre.com.br',
    'http://localhost:3000',
  ] as const

  /** Fragmentos que tentam ESCAPAR o origin (path absoluto, protocol-relative...). */
  const ESCAPE_FRAGMENTS = [
    '//evil.com/x',
    '///evil.com/x',
    'https://evil.com/x',
    'http://evil.com:8443/x',
    'https://evil.com@localhost/x', // userinfo → host localhost (origin ≠ base)
    'https://localhost@evil.com/x', // userinfo → host evil.com
    'https://user:pass@evil.com/x',
    '//user@evil.com/x',
    'https://evil.com.evil.org/x', // host exótico, não termina em .com
    'http://127.0.0.1/x',
    'http://169.254.169.254/latest/meta-data/',
    'http://[::ffff:7f00:1]/x', // IPv4-mapeado loopback
    'http://[::1]/x',
    'https://evil.com.evil.com/evil.com',
  ] as const

  /** CRLF / control chars / whitespace-C0 (vetor da Rodada 8) / backslash. */
  const CONTROL_FRAGMENTS = [
    '  //evil.com/x',
    '\t//evil.com/x',
    '\r\n//evil.com/x',
    '\x00\x01\x1f//evil.com/x',
    '\nhttps://evil.com/x',
    '\rhttps://evil.com/x',
    '//evil.com/x  ',
    '//evil.com/x\t',
    '//evil.com/\u0000x',
    '/\\evil.com/x', // slash + backslash = protocol-relative (escapou no probe)
    'http://evil.com\r\nX-Injected: 1/x', // CRLF no host → parser rejeita
    'https://evil.com\r\nHost: injected.example/x',
    'https://evil.com%0d%0aX-Injected: 1/x', // %0d%0a no host → parser rejeita
  ] as const

  /** Paths relativos legítimos — devem PASSAR com origin preservado. */
  const LEGIT_PATHS = [
    '/items/MLB123',
    'items/MLB123',
    '/orders/search',
    '/items/MLB1/description',
    '?q=fone',
    '#frag',
    '/a/./b/../c',
    '/a b c',
    '/%2e%2e/x',
    '/a%20b',
    '/',
    '',
    'https:/evil.com/x', // scheme sem // → RELATIVO (verificado por probe)
    'https:evil.com/x', // idem
  ] as const

  /** Nomes de query — inclui chaves perigosas (anti prototype pollution). */
  const QUERY_NAMES = ['q', 'limit', 'offset', 'ids', '__proto__', 'constructor', 'status'] as const

  /** Caracteres injetados pela mutação (hostis ao parser/URL). */
  const MUTATION_CHARS = [
    '\r',
    '\n',
    '\t',
    '\x00',
    '\x1f',
    '\\',
    ' ',
    '%',
    ':',
    '/',
    '#',
    '?',
    '@',
  ] as const

  function randomQueryValue(rand: () => number): string | number | boolean | undefined {
    return pick(rand, [
      'fone de ouvido',
      '',
      'x',
      'a b c',
      0,
      42,
      true,
      false,
      undefined,
      'çáé',
      '1000',
      '\r\n',
    ])
  }

  /** Injeta caracteres hostis em posições aleatórias do path (ou devolve intacto). */
  function mutate(rand: () => number, seed: string): string {
    const r = rand()
    if (r < 0.5) return seed
    const injections = 1 + Math.floor(rand() * 3)
    let out = seed
    for (let i = 0; i < injections; i++) {
      const pos = Math.floor(rand() * (out.length + 1))
      const ch = pick(rand, MUTATION_CHARS)
      out = out.slice(0, pos) + ch + out.slice(pos)
    }
    return out
  }

  function buildRandomCase(rand: () => number): {
    base: string
    path: string
    query: UrlQuery | undefined
  } {
    const base = pick(rand, BASES)
    const r = rand()
    const path =
      r < 0.4
        ? pick(rand, ESCAPE_FRAGMENTS)
        : r < 0.6
          ? pick(rand, CONTROL_FRAGMENTS)
          : r < 0.75
            ? pick(rand, LEGIT_PATHS)
            : mutate(rand, pick(rand, [...ESCAPE_FRAGMENTS, ...LEGIT_PATHS]))
    const query: UrlQuery | undefined =
      rand() < 0.5 ? { [pick(rand, QUERY_NAMES)]: randomQueryValue(rand) } : undefined
    return { base, path, query }
  }

  it('nunca vaza o origin e nunca lança erro nativo do parser (500 casos aleatórios)', () => {
    forEachFuzzSeed(0xbfa9_0000, (rand) => {
      for (let g = 0; g < 500; g++) {
        const { base, path, query } = buildRandomCase(rand)
        const baseOrigin = new URL(base).origin

        let url: URL | null = null
        let thrown: unknown = null
        try {
          url = buildUrl(base, path, query)
        } catch (err) {
          thrown = err
        }

        // INVARIANTE 1: o único erro permitido é InputValidationError tipado —
        // um TypeError/RangeError nativo do parser URL nunca pode escapar (o
        // integrador precisa conseguir capturar com o erro tipado do SDK).
        if (thrown !== null) {
          expect(
            thrown instanceof InputValidationError,
            `grafo ${g}: erro nativo escapou para path ${JSON.stringify(path)} → ${String(thrown)}`,
          ).toBe(true)
        }

        // INVARIANTE 2 (SEGURANÇA): se retorna, o origin É o do baseUrl — nenhuma
        // forma de escape (CRLF, backslash, whitespace/C0, protocolos exóticos,
        // userinfo, percent-encoding) pode desviar o Authorization para outro
        // origin. O guard por RESULTADO (Rodadas 6+8) tem que pegar tudo.
        if (url !== null) {
          expect(url.origin, `grafo ${g}: origin escapou para path ${JSON.stringify(path)}`).toBe(
            baseOrigin,
          )

          // INVARIANTE 3: sem CR/LF crus no resultado serializado — nada de
          // log/header injection via URL.
          expect(url.href, `grafo ${g}: CR/LF no href para ${JSON.stringify(path)}`).not.toMatch(
            /[\r\n]/,
          )

          // INVARIANTE 4: query round-trip — o valor entra codificado e sai
          // idêntico (searchParams.set codifica; o get decodifica).
          if (query !== undefined) {
            for (const [name, value] of Object.entries(query)) {
              if (value !== undefined) {
                expect(url.searchParams.get(name), `grafo ${g}: query ${name}`).toBe(String(value))
              }
            }
          }
        }
      }
    })
    // INVARIANTE 5: nada poluiu o Object.prototype (nomes __proto__/constructor).
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })

  it('CRLF/controle no host e payloads de header injection nunca passam', () => {
    const payloads = [
      'http://evil.com\r\nX-Injected: 1/x',
      'https://evil.com\r\nHost: injected.example/x',
      'https://evil.com%0d%0aX-Injected: 1/x',
      '//evil.com/\u0000x',
    ]
    for (const p of payloads) {
      // Ou o parser rejeita (erro tipado) ou o guard de origin bloqueia —
      // jamais um origin diferente chega ao fetch.
      expect(
        () => buildUrl('https://api.mercadolibre.com', p),
        `payload: ${JSON.stringify(p)}`,
      ).toThrow(InputValidationError)
    }
  })

  it('whitespace/C0 leading, backslash e userinfo não contornam o guard (Rodada 8)', () => {
    const payloads = [
      '  //evil.com/x',
      '\t//evil.com/x',
      '\r\n//evil.com/x',
      '  \x00\x1f//evil.com/x',
      '\t//evil.com/x  \r\n',
      '/\\evil.com/x',
      '//evil.com/x',
      '///evil.com/x',
      'https://evil.com@localhost/x',
      'https://localhost@evil.com/x',
      '//user:pass@evil.com/x',
      'https://evil.com.evil.org/x',
      'http://[::ffff:7f00:1]/x',
      'http://[::1]/x',
    ]
    for (const p of payloads) {
      expect(
        () => buildUrl('https://api.mercadolibre.com', p),
        `payload: ${JSON.stringify(p)}`,
      ).toThrow(InputValidationError)
    }
  })

  it('protocolos exóticos e schemes não-HTTP nunca vazam o origin', () => {
    const schemes = [
      'javascript:',
      'data:',
      'file:',
      'ftp:',
      'ws:',
      'wss:',
      'gopher:',
      'about:',
      'blob:',
      'chrome:',
      'vbscript:',
      'mailto:',
      'tel:',
      'c:',
      'a:',
      'x:',
      'http+unix:',
    ] as const
    const bodies = ['//evil.com/x', 'evil.com/x', 'alert(1)', '/etc/passwd', ''] as const
    for (const scheme of schemes) {
      for (const body of bodies) {
        const p = `${scheme}${body}`
        let url: URL | null = null
        let err: unknown = null
        try {
          url = buildUrl('https://api.mercadolibre.com', p)
        } catch (e) {
          err = e
        }
        if (err !== null) {
          expect(err, `scheme ${scheme}: erro nativo`).toBeInstanceOf(InputValidationError)
        } else if (url !== null) {
          // Schemes com origin nulo (javascript:/data:/c:...) ou outro host
          // (blob:/ftp:/ws:...) nunca podem virar o destino do request.
          expect(url.origin, `scheme ${scheme}: origin vazou`).toBe('https://api.mercadolibre.com')
        }
      }
    }
  })

  it('paths relativos legítimos passam com origin preservado e query round-trip', () => {
    for (const p of [
      '/items/MLB123',
      'items/MLB123',
      '/orders/search',
      '?q=fone',
      '#frag',
      '/a/./b/../c',
      '/a b c',
      '/',
      '',
      // Scheme sem `//` (https:evil.com/x) é RELATIVO para schemes especiais
      // (a spec exige `//` para virar absoluto) — fica sob o baseUrl, com
      // origin preservado. Não "corrigir" para tratar como absoluto.
      'https:/evil.com/x',
      'https:evil.com/x',
    ]) {
      const url = buildUrl('https://api.mercadolibre.com', p)
      expect(url.origin).toBe('https://api.mercadolibre.com')
      expect(url.href).not.toMatch(/[\r\n]/)
    }
    const url = buildUrl('https://api.mercadolibre.com', '/items/MLB1', {
      q: 'fone de ouvido',
      limit: 10,
      active: true,
      nada: undefined,
    })
    expect(url.searchParams.get('q')).toBe('fone de ouvido')
    expect(url.searchParams.get('limit')).toBe('10')
    expect(url.searchParams.get('active')).toBe('true')
    expect(url.searchParams.has('nada')).toBe(false)
  })

  // NOTA: o assert `pathname.length > 1M` assume que o parser preserva o
  // path — comportamento atual do WHATWG URL (sem limite de comprimento).
  // Se o Node um dia impuser um teto de tamanho de URL, este assert é o
  // primeiro a quebrar (e o teste passa a exigir reavaliação, não remoção).
  it('paths e queries gigantes não derrubam o processo (anti-DoS)', () => {
    const big = `/${'a'.repeat(2_000_000)}`
    const url = buildUrl('https://api.mercadolibre.com', big, { q: 'b'.repeat(500_000) })
    expect(url.origin).toBe('https://api.mercadolibre.com')
    expect(url.pathname.length).toBeGreaterThan(1_000_000)
    expect(url.searchParams.get('q')).toBe('b'.repeat(500_000))
  })
})
