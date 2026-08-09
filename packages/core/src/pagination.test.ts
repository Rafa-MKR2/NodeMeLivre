import { describe, expect, it, vi } from 'vitest'
import { type PageFetcher, type PaginatedResponse, paginate } from './pagination.js'

function page<T>(
  results: T[],
  total: number,
  offset: number,
): { results: T[]; paging: { total: number; offset: number; limit: number } } {
  return { results, paging: { total, offset, limit: 2 } }
}

describe('paginate', () => {
  it('deve iterar todas as páginas até o total', async () => {
    const fetchPage: PageFetcher<number> = vi.fn(async (offset) => {
      if (offset === 0) return page([1, 2], 5, 0)
      if (offset === 2) return page([3, 4], 5, 2)
      return page([5], 5, 4)
    })

    const items: number[] = []
    for await (const n of paginate(fetchPage, { limit: 2 })) {
      items.push(n)
    }

    expect(items).toEqual([1, 2, 3, 4, 5])
    expect(fetchPage).toHaveBeenCalledTimes(3)
  })

  it('deve parar quando a página vier vazia antes do total', async () => {
    const fetchPage: PageFetcher<number> = vi.fn(async (offset) => {
      if (offset === 0) return page([1, 2], 99, 0)
      return page([], 99, 2)
    })

    const items: number[] = []
    for await (const n of paginate(fetchPage, { limit: 2 })) {
      items.push(n)
    }

    expect(items).toEqual([1, 2])
    expect(fetchPage).toHaveBeenCalledTimes(2)
  })

  it('deve respeitar o break do consumidor sem buscar a próxima página', async () => {
    const fetchPage: PageFetcher<number> = vi.fn(async (offset) => {
      if (offset === 0) return page([1, 2], 99, 0)
      if (offset === 2) return page([3, 4], 99, 2)
      return page([], 99, 4)
    })

    const items: number[] = []
    for await (const n of paginate(fetchPage, { limit: 2 })) {
      items.push(n)
      if (items.length >= 3) break
    }

    expect(items).toEqual([1, 2, 3])
    expect(fetchPage).toHaveBeenCalledTimes(2)
  })

  it('deve repassar o signal ao fetcher', async () => {
    const controller = new AbortController()
    const fetchPage: PageFetcher<number> = vi.fn(async (_offset, _limit, signal) => {
      expect(signal).toBe(controller.signal)
      return page([1], 1, 0)
    })

    for await (const _n of paginate(fetchPage, { signal: controller.signal })) {
      // apenas consome
    }
    expect(fetchPage).toHaveBeenCalledTimes(1)
  })

  it('deve abortar a iteração entre páginas quando o signal dispara', async () => {
    const controller = new AbortController()
    const fetchPage: PageFetcher<number> = vi.fn(async (offset) => {
      if (offset === 0) return page([1, 2], 99, 0)
      controller.abort()
      return page([3, 4], 99, 2)
    })

    const items: number[] = []
    const iterate = async (): Promise<void> => {
      for await (const n of paginate(fetchPage, { limit: 2, signal: controller.signal })) {
        items.push(n)
      }
    }
    await expect(iterate()).rejects.toThrow(/aborted/i)
    expect(items).toEqual([1, 2])
  })

  it('deve abortar antes da primeira chamada quando o signal já disparou', async () => {
    const controller = new AbortController()
    controller.abort()
    const fetchPage: PageFetcher<number> = vi.fn(async () => page([1], 1, 0))

    const iterate = async (): Promise<void> => {
      for await (const _n of paginate(fetchPage, { signal: controller.signal })) {
        // nunca deve entrar
      }
    }
    await expect(iterate()).rejects.toThrow(/aborted/i)
    expect(fetchPage).not.toHaveBeenCalled()
  })

  it('deve parar quando a API devolve a mesma página (não avança o offset)', async () => {
    // Cenário de DoS da Rodada 5: API ignora `offset` e devolve sempre a
    // mesma página com `total: null` — antes, o loop nunca terminava.
    const fetchPage: PageFetcher<number> = vi.fn(async () => ({
      results: [1, 2],
      paging: { total: null, offset: 0, limit: 2 },
    }))

    const items: number[] = []
    for await (const n of paginate(fetchPage, { limit: 2 })) {
      items.push(n)
    }

    // Itens da primeira página são entregues, e a iteração para no ciclo.
    expect(items).toEqual([1, 2])
    expect(fetchPage).toHaveBeenCalledTimes(2)
  })

  it('deve parar quando o primeiro item é `undefined` (fetcher customizado)', async () => {
    // Um fetcher do integrador pode devolver `[undefined]` repetido — antes
    // do `?? null`, `JSON.stringify(undefined)` era `undefined` e a chave
    // nunca batia com a anterior (o guard nunca disparava = loop infinito,
    // mesma classe de DoS do ACHADO 17).
    const fetchPage: PageFetcher<undefined> = vi.fn(async () => ({
      results: [undefined],
      paging: { total: null, offset: 0, limit: 1 },
    }))

    const items: unknown[] = []
    for await (const n of paginate(fetchPage, { limit: 1 })) {
      items.push(n)
    }

    expect(items).toEqual([undefined])
    expect(fetchPage).toHaveBeenCalledTimes(2)
  })

  it('deve abortar entre os itens de uma mesma página', async () => {
    const controller = new AbortController()
    const fetchPage: PageFetcher<number> = vi.fn(async () => {
      if (!controller.signal.aborted) {
        // primeira página com 2 itens; aborta após o 1º yield
        return page([1, 2, 3], 3, 0)
      }
      return page([], 3, 0)
    })

    const items: number[] = []
    const iterate = async (): Promise<void> => {
      for await (const n of paginate(fetchPage, { signal: controller.signal })) {
        items.push(n)
        controller.abort()
      }
    }
    await expect(iterate()).rejects.toThrow(/aborted/i)
    expect(items).toEqual([1])
    expect(fetchPage).toHaveBeenCalledTimes(1)
  })

  it('total como STRING não encolhe nem encerra a paginação cedo (F4, pente fino)', async () => {
    // Um gateway/proxy pode entregar `paging.total` como string: `"0"`
    // (string) num `>=` coercia a 0 e o SDK devolvia só a 1ª página (perda
    // silenciosa de dados); `"abc"` coercio a NaN nunca encerrava. A coerção
    // explícita trata "4" como 4, "0"/NaN como "total desconhecido".
    const fetchPage: PageFetcher<number> = vi.fn(async (offset) => {
      if (offset === 0) {
        return { results: [1, 2], paging: { total: '4' as unknown as number, offset: 0, limit: 2 } }
      }
      if (offset === 2) {
        return { results: [3, 4], paging: { total: '4' as unknown as number, offset: 2, limit: 2 } }
      }
      return { results: [], paging: { total: '4' as unknown as number, offset: 4, limit: 2 } }
    })

    const items: number[] = []
    for await (const n of paginate(fetchPage, { limit: 2 })) items.push(n)
    expect(items).toEqual([1, 2, 3, 4])
    expect(fetchPage).toHaveBeenCalledTimes(2)
  })

  it('total string não-numérica ("abc") não entra em loop infinito (F4, pente fino)', async () => {
    let calls = 0
    const fetchPage: PageFetcher<number> = vi.fn(async () => {
      calls += 1
      return { results: [1, 2], paging: { total: 'abc' as unknown as number, offset: 0, limit: 2 } }
    })

    const items: number[] = []
    for await (const n of paginate(fetchPage, { limit: 2 })) items.push(n)
    // Sem total válido, o guard de página repetida encerra na 2ª chamada.
    expect(items).toEqual([1, 2])
    expect(calls).toBeLessThanOrEqual(2)
  })
})

describe('paginate — fuzzing (Rodada 9+, determinístico)', () => {
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

  /** Versão assíncrona do iterador de seeds — o `paginate` itera via `for await`. */
  async function forEachFuzzSeedAsync(
    fixed: number,
    fn: (rand: () => number) => Promise<void>,
  ): Promise<void> {
    for (const seed of fuzzSeeds(fixed)) await fn(mulberry32(seed))
  }

  /**
   * Item JSON-safe (mesmo universo dos dados da API — o guard do paginate
   * compara o primeiro item via JSON.stringify, que nunca é undefined para
   * dados JSON). O valor deriva do grafo/página/índice: itens de páginas
   * DIFERENTES nunca colidem (evita falso positivo do guard de página
   * repetida nos testes de entrega).
   */
  function uniqueItem(g: number, p: number, i: number): unknown {
    const base = g * 10_000 + p * 100 + i
    const kind = (g + p + i) % 4
    if (kind === 0) return { id: base, tag: `t${g % 7}` }
    if (kind === 1) return base
    if (kind === 2) return `item-${base}`
    return [base, base + 1]
  }

  function pageOf<T>(results: T[], total: number | null, offset: number): PaginatedResponse<T> {
    return { results, paging: { total, offset, limit: 50 } }
  }

  it('páginas que não avançam NUNCA entram em loop infinito (anti-DoS, Rodada 5)', async () => {
    await forEachFuzzSeedAsync(0xa11ce_0000, async (rand) => {
      for (let g = 0; g < 300; g++) {
        // API ignora `offset` e devolve SEMPRE a mesma página (primeiro item
        // idêntico) — o cenário exato do ACHADO 17: antes, o loop nunca
        // terminava e as requisições eram infinitas.
        const pageItems: unknown[] = [uniqueItem(g, 0, 0)]
        const extra = Math.floor(rand() * 4)
        for (let i = 1; i <= extra; i++) pageItems.push(uniqueItem(g, 0, i))
        const total = rand() < 0.5 ? null : 99_999

        const fetchPage: PageFetcher<unknown> = vi.fn(async (offset) => {
          // Cede ao event loop a cada chamada: se o guard `previousFirstKey`
          // regredir, o vitest derruba o teste por timeout (testTimeout) em
          // vez de a iteração infinitar em microtasks e pendurar o worker
          // (starve — confirmado por mutação hang-safe).
          await new Promise((resolve) => setImmediate(resolve))
          return pageOf(pageItems, total, offset)
        })

        const items: unknown[] = []
        // SEM o guard `previousFirstKey`, esta iteração penduraria para
        // sempre (o vitest derrubaria o teste por timeout).
        for await (const n of paginate(fetchPage, { limit: 50 })) items.push(n)

        // O guard detecta a repetição na 2ª chamada: nunca mais que 2
        // fetches, com os itens da 1ª página entregues uma única vez.
        expect(
          (fetchPage as ReturnType<typeof vi.fn>).mock.calls.length,
          `grafo ${g}: fetch chamado ${(fetchPage as ReturnType<typeof vi.fn>).mock.calls.length}x`,
        ).toBeLessThanOrEqual(2)
        expect(items, `grafo ${g}: itens da 1ª página entregues`).toEqual(pageItems)
      }
    })
  })

  it('entrega todos os itens exatamente uma vez, em ordem, quando a API avança (500 streams)', async () => {
    await forEachFuzzSeedAsync(0xbeaf_0000, async (rand) => {
      for (let g = 0; g < 500; g++) {
        const pageCount = 1 + Math.floor(rand() * 6) // 1-6 páginas
        const pages: unknown[][] = []
        for (let p = 0; p < pageCount; p++) {
          const len = 1 + Math.floor(rand() * 5) // 1-5 itens
          pages.push(Array.from({ length: len }, (_, i) => uniqueItem(g, p, i)))
        }
        const total = pages.reduce((n, p) => n + p.length, 0)

        let call = 0
        const offsets: number[] = []
        const fetchPage: PageFetcher<unknown> = vi.fn(async (offset) => {
          offsets.push(offset)
          const results = pages[call] ?? []
          call += 1
          return pageOf(results, total, offset)
        })

        const items: unknown[] = []
        for await (const n of paginate(fetchPage, { limit: 2 + Math.floor(rand() * 4) })) {
          items.push(n)
        }

        // Contrato: itens completos, na ordem, sem perda nem duplicação.
        expect(items, `grafo ${g}`).toEqual(pages.flat())
        // Offset inicial 0 e avanços estritamente crescentes.
        expect(offsets[0], `grafo ${g}`).toBe(0)
        for (let i = 1; i < offsets.length; i++) {
          expect(offsets[i] as number, `grafo ${g}: offset não-monotônico`).toBeGreaterThan(
            offsets[i - 1] as number,
          )
        }
        // A última página satisfaz o `paging.total` autoritativo: nenhuma
        // chamada extra além das páginas geradas.
        expect(call, `grafo ${g}: fetch além do total`).toBe(pageCount)
      }
    })
  })

  it('total null com páginas que avançam termina na página vazia (200 streams)', async () => {
    await forEachFuzzSeedAsync(0xfeed_0000, async (rand) => {
      for (let g = 0; g < 200; g++) {
        const pageCount = 1 + Math.floor(rand() * 5) // 1-5 páginas com itens
        let call = 0
        const fetchPage: PageFetcher<unknown> = vi.fn(async (offset) => {
          if (call >= pageCount) return pageOf([], null, offset) // página vazia termina
          const len = 1 + Math.floor(rand() * 4)
          const results = Array.from({ length: len }, (_, i) => uniqueItem(g, call, i))
          call += 1
          return pageOf(results, null, offset)
        })

        const items: unknown[] = []
        for await (const n of paginate(fetchPage, { limit: 50 })) items.push(n)

        // Sem `total` autoritativo, a iteração termina quando a API devolve
        // uma página vazia — exatamente `pageCount + 1` fetches.
        expect(
          (fetchPage as ReturnType<typeof vi.fn>).mock.calls.length,
          `grafo ${g}: não terminou na página vazia`,
        ).toBe(pageCount + 1)
        expect(items.length, `grafo ${g}: itens entregues`).toBeGreaterThanOrEqual(pageCount)
      }
    })
  })

  it('páginas diferentes com o mesmo PRIMEIRO item terminam (tradeoff documentado)', async () => {
    await forEachFuzzSeedAsync(0x4a11_0000, async (_rand) => {
      for (let g = 0; g < 100; g++) {
        // Overlap real (featured item repetido no topo de páginas
        // consecutivas) — o guard compara o primeiro item e para. É o
        // tradeoff documentado: falso positivo só com mesmo primeiro item
        // consecutivo, e parar é o comportamento seguro (nunca loop).
        const shared = { id: 1, featured: true }
        const pageA = [shared, uniqueItem(g, 0, 1)]
        const pageB = [shared, uniqueItem(g, 1, 1)]
        const fetchPage: PageFetcher<unknown> = vi.fn(async (offset) => {
          // Mesmo cuidado do teste anti-DoS: cede ao event loop para que uma
          // regressão do guard falhe por timeout, não por starve de microtask.
          await new Promise((resolve) => setImmediate(resolve))
          return offset === 0 ? pageOf(pageA, null, 0) : pageOf(pageB, null, 0)
        })

        const items: unknown[] = []
        for await (const n of paginate(fetchPage, { limit: 50 })) items.push(n)

        expect(
          (fetchPage as ReturnType<typeof vi.fn>).mock.calls.length,
          `grafo ${g}: deve parar no 2º fetch`,
        ).toBeLessThanOrEqual(2)
        expect(items, `grafo ${g}`).toEqual(pageA)
      }
    })
  })
})
