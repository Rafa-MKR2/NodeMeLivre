import { describe, expect, it, vi } from 'vitest'
import { toQuery } from './transport.js'
import {
  deepOmitEmpty,
  generateStateToken,
  isValidStateToken,
  mapWithConcurrency,
  omitEmpty,
  omitUndefined,
  UNSAFE_KEYS,
} from './utils.js'

describe('toQuery — chaves perigosas', () => {
  it('ignora __proto__/constructor/prototype nos query params', () => {
    const query = toQuery(JSON.parse('{"q":"fone","__proto__":{"x":1}}'))
    expect(query).toEqual({ q: 'fone' })
    expect(JSON.stringify(query)).not.toContain('__proto__')
    expect((query as Record<string, unknown>).x).toBeUndefined()
  })
})

describe('omitUndefined', () => {
  it('deve remover apenas chaves undefined (mantém null)', () => {
    expect(omitUndefined({ a: 1, b: undefined, c: null })).toEqual({ a: 1, c: null })
  })
})

describe('omitEmpty', () => {
  it('deve remover undefined, null e objetos vazios (shallow)', () => {
    expect(omitEmpty({ a: 1, b: undefined, c: null, d: {}, e: [], f: { x: 1 } })).toEqual({
      a: 1,
      e: [],
      f: { x: 1 },
    })
  })
})

describe('deepOmitEmpty', () => {
  it('deve remover recursivamente undefined e objetos vazios, preservando null', () => {
    const input = {
      title: 'Camiseta',
      shipping: {},
      price: 49.9,
      attributes: [{ name: 'Tamanho', value_name: 'M', extra: {} }],
      empty: undefined,
      nested: { a: null, b: { c: {} } },
    }

    expect(deepOmitEmpty(input)).toEqual({
      title: 'Camiseta',
      price: 49.9,
      attributes: [{ name: 'Tamanho', value_name: 'M' }],
      nested: { a: null },
    })
  })

  it('não deve quebrar com null/undefined em qualquer nível (regressão)', () => {
    expect(deepOmitEmpty(null)).toBeNull()
    expect(deepOmitEmpty(undefined)).toBeUndefined()
    expect(deepOmitEmpty({ a: null })).toEqual({ a: null })
    expect(deepOmitEmpty({ a: { b: null } })).toEqual({ a: { b: null } })
    expect(deepOmitEmpty({ a: [null, { b: null }] })).toEqual({ a: [null, { b: null }] })
  })

  it('deve preservar arrays vazios e valores falsy', () => {
    expect(deepOmitEmpty({ a: [], b: 0, c: false, d: '' })).toEqual({
      a: [],
      b: 0,
      c: false,
      d: '',
    })
  })

  it('deve retornar primitivos intactos', () => {
    expect(deepOmitEmpty(0)).toBe(0)
    expect(deepOmitEmpty('x')).toBe('x')
  })

  it('não deve vazar chaves perigosas (__proto__/constructor/prototype)', () => {
    // JSON.parse cria `__proto__` como own key — o atacante não pode mais
    // acionar o setter de prototype nem injetar `constructor.prototype`.
    const evil = JSON.parse(
      '{"title":"x","__proto__":{"polluted":true},"constructor":{"prototype":{"polluted2":true}}}',
    )

    const cleaned = deepOmitEmpty(evil)
    expect(JSON.stringify(cleaned)).not.toContain('__proto__')
    expect(JSON.stringify(cleaned)).not.toContain('constructor')
    expect(JSON.stringify(cleaned)).not.toContain('polluted')
    // Sem poluição global do Object.prototype.
    expect(({} as Record<string, boolean>).polluted).toBeUndefined()
    expect(({} as Record<string, boolean>).polluted2).toBeUndefined()
  })

  it('omitEmpty/omitUndefined não acionam o setter de __proto__', () => {
    const evil = JSON.parse('{"__proto__":{"polluted":true},"a":1}')

    const empty = omitEmpty(evil)
    const undef = omitUndefined(evil)
    expect((empty as Record<string, boolean>).polluted).toBeUndefined()
    expect((undef as Record<string, boolean>).polluted).toBeUndefined()
    expect(JSON.stringify(empty)).not.toContain('polluted')
    expect(JSON.stringify(undef)).not.toContain('polluted')
  })

  it('não estoura a pilha com profundidade extrema (anti-DoS, Rodada 5)', () => {
    // Input do usuário pode ter profundidade arbitrária; a versão recursiva
    // lançava RangeError (~10k frames) e derrubava o processo do integrador.
    let nested: unknown = { leaf: 1 }
    for (let i = 0; i < 50_000; i++) nested = { a: nested }

    let result: unknown
    expect(() => {
      result = deepOmitEmpty(nested)
    }).not.toThrow()
    expect(typeof result).toBe('object')

    let nestedArr: unknown[] = [1]
    for (let i = 0; i < 50_000; i++) nestedArr = [nestedArr]
    expect(() => deepOmitEmpty(nestedArr)).not.toThrow()
  })

  it('não estoura a memória com objeto circular (anti-OOM, Rodada 9)', () => {
    // Referência circular (ex.: objeto montado em JS pelo integrador) entrava
    // em loop infinito na pilha explícita até OOM do processo (confirmado por
    // execução na Rodada 9). O ciclo é detectado e o valor omitido.
    const circular: Record<string, unknown> = { title: 'x' }
    circular.self = circular
    circular.nested = { a: 1 }
    ;(circular.nested as Record<string, unknown>).back = circular

    let result: unknown
    expect(() => {
      result = deepOmitEmpty(circular)
    }).not.toThrow()

    // O valor circular (self → circular, nested.back → circular) é omitido;
    // o resto permanece limpo e serializável.
    const cleaned = result as Record<string, unknown>
    expect(cleaned.title).toBe('x')
    expect(cleaned.self).toBeUndefined()
    expect((cleaned.nested as Record<string, unknown>).a).toBe(1)
    expect((cleaned.nested as Record<string, unknown>).back).toBeUndefined()
    // Resultado 100% serializável (JSON.stringify não lança).
    expect(() => JSON.stringify(cleaned)).not.toThrow()
  })

  it('preserva DAGs legítimos (mesmo objeto em dois ramos — não é ciclo)', () => {
    // O rastreio é por CAMINHO atual (não por visita global): um objeto
    // referenciado por dois ramos irmãos não pode ser confundido com ciclo.
    const shared = { v: 42, deep: { w: 1 } }
    const input = { a: shared, b: shared }
    const result = deepOmitEmpty(input) as Record<string, unknown>
    expect((result.a as Record<string, unknown>).v).toBe(42)
    expect((result.b as Record<string, unknown>).v).toBe(42)
    expect((result.a as Record<string, unknown>).deep).toEqual({ w: 1 })
  })

  it('omite item circular dentro de array sem travar', () => {
    const circular: unknown[] = [1]
    circular.push(circular) // [1, <self>]
    let result: unknown
    expect(() => {
      result = deepOmitEmpty(circular)
    }).not.toThrow()
    expect(Array.isArray(result)).toBe(true)
    expect((result as unknown[])[0]).toBe(1)
    // O item circular foi omitido (sem referência própria no resultado).
    const json = JSON.stringify(result)
    expect(json).toBe('[1]')
  })
})

describe('mapWithConcurrency', () => {
  it('deve preservar a ordem dos resultados', async () => {
    const results = await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (n) => n * 2)
    expect(results).toEqual([2, 4, 6, 8, 10])
  })

  it('deve respeitar o limite de execuções paralelas', async () => {
    let inFlight = 0
    let peak = 0
    const mapper = vi.fn(async (n: number) => {
      inFlight += 1
      peak = Math.max(peak, inFlight)
      await new Promise((r) => setTimeout(r, 5))
      inFlight -= 1
      return n
    })

    await mapWithConcurrency([1, 2, 3, 4, 5, 6], 3, mapper)

    expect(peak).toBeLessThanOrEqual(3)
    expect(mapper).toHaveBeenCalledTimes(6)
  })

  it('deve processar tudo em paralelo quando o limite é maior ou igual ao tamanho', async () => {
    const mapper = vi.fn(async (n: number) => {
      await new Promise((r) => setTimeout(r, 5))
      return n
    })
    await mapWithConcurrency([1, 2], 10, mapper)
    expect(mapper).toHaveBeenCalledTimes(2)
  })

  it('deve devolver array vazio para entrada vazia', async () => {
    await expect(mapWithConcurrency([], 3, async (n: number) => n)).resolves.toEqual([])
  })

  it('deve propagar a primeira rejeição do mapper', async () => {
    await expect(
      mapWithConcurrency([1, 2, 3], 2, async (n) => {
        if (n === 2) throw new Error('boom')
        return n
      }),
    ).rejects.toThrow('boom')
  })

  it('deve tratar limite inválido como 1', async () => {
    const mapper = vi.fn(async (n: number) => n)
    await mapWithConcurrency([1, 2, 3], 0, mapper)
    expect(mapper).toHaveBeenCalledTimes(3)
  })
})

describe('deepOmitEmpty — fuzzing (Rodada 9+, determinístico)', () => {
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
   * ampliando a cobertura para rodadas mais longas (N seeds × grafos).
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

  type FuzzNode = Record<string, unknown> | unknown[]

  /** Constrói um grafo aleatório com ciclos, DAGs, chaves perigosas e vazios. */
  function buildRandomGraph(rand: () => number): { root: unknown; nodeCount: number } {
    const nodeCount = 2 + Math.floor(rand() * 9) // 2–10 nós
    const nodes: FuzzNode[] = Array.from({ length: nodeCount }, () => (rand() < 0.5 ? {} : []))

    const dangerousKeys = [...UNSAFE_KEYS]
    const pickKey = (): string => {
      const r = rand()
      if (r < 0.12) {
        return dangerousKeys[Math.floor(rand() * dangerousKeys.length)] as string
      }
      return `k${Math.floor(rand() * 20)}`
    }

    const pickNode = (): FuzzNode => nodes[Math.floor(rand() * nodes.length)] as FuzzNode

    for (let i = 0; i < nodeCount; i++) {
      const node = nodes[i] as FuzzNode
      const fieldCount = Math.floor(rand() * 5) // 0–4 campos
      for (let f = 0; f < fieldCount; f++) {
        const r = rand()
        const value: unknown =
          r < 0.35
            ? // Primitivo (inclui undefined/null/falsy)
              pickPrimitive(rand)
            : r < 0.55
              ? // Referência a nó do pool: cria DAG e/ou CICLO
                pickNode()
              : r < 0.75
                ? // Objeto aninhado novo (pode conter ciclos depois)
                  {}
                : r < 0.9
                  ? // Array aninhado novo
                    []
                  : // undefined — será omitido pelo deepOmitEmpty
                    undefined
        const key = pickKey()
        if (Array.isArray(node)) {
          ;(node as unknown[]).push(value)
        } else {
          setOwnKey(node, key, value)
        }
      }
    }
    // Âncora: metade dos grafos referencia nós de volta (ciclo explícito),
    // a outra metade já tem ciclos/DAGs pelos pickNode acima.
    if (rand() < 0.5) {
      const target = pickNode()
      const host = pickNode()
      if (Array.isArray(host)) {
        ;(host as unknown[]).push(target)
      } else {
        setOwnKey(host, pickKey(), target)
      }
    }
    return { root: pickNode(), nodeCount }
  }

  /** Primitivo aleatório JSON-safe (nunca lança em JSON.stringify). */
  function pickPrimitive(rand: () => number): unknown {
    const r = rand()
    if (r < 0.25) return Math.floor(rand() * 1_000_000)
    if (r < 0.4) return rand() < 0.5 ? '' : `s${Math.floor(rand() * 100)}`
    if (r < 0.55) return rand() < 0.5
    if (r < 0.7) return null
    if (r < 0.8) return undefined
    if (r < 0.9) return Number.NaN
    return Number.POSITIVE_INFINITY
  }

  /** Atribui chave própria, inclusive as perigosas (como JSON.parse faria). */
  function setOwnKey(target: Record<string, unknown>, key: string, value: unknown): void {
    if (UNSAFE_KEYS.has(key)) {
      // `__proto__`/`constructor`/`prototype` precisam virar OWN KEY sem
      // acionar o setter de prototype — mesmo resultado de JSON.parse.
      Object.defineProperty(target, key, {
        value,
        enumerable: true,
        writable: true,
        configurable: true,
      })
    } else {
      target[key] = value
    }
  }

  /**
   * Chave de comparação de folha — distingue NaN/±Infinity de `null`
   * (o JSON.stringify colapsaria os três em "null", enfraquecendo a
   * invariante "nenhum dado se perde").
   */
  function leafKey(leaf: unknown): string {
    if (typeof leaf === 'number') {
      if (Number.isNaN(leaf)) return 'number:NaN'
      if (leaf === Number.POSITIVE_INFINITY) return 'number:+Infinity'
      if (leaf === Number.NEGATIVE_INFINITY) return 'number:-Infinity'
    }
    return `${typeof leaf}:${String(leaf)}`
  }

  /**
   * Coleta TODOS os valores folha (primitivos) do grafo, sem loops infinitos.
   * NOTA: recursiva — usar só em grafos rasos (os 500 grafos do fuzz têm
   * ≤ 10 nós). Para cadeias profundas (2k+), use `deepFindLeaf` (iterativo).
   */
  function collectLeafValues(root: unknown): unknown[] {
    const out: unknown[] = []
    const visited = new WeakSet<object>()
    const walk = (value: unknown): void => {
      if (value === null || typeof value !== 'object') {
        out.push(value)
        return
      }
      if (visited.has(value)) return
      visited.add(value)
      if (Array.isArray(value)) {
        for (const item of value) walk(item)
        return
      }
      for (const [key, val] of Object.entries(value)) {
        if (UNSAFE_KEYS.has(key)) continue // chaves perigosas são descartadas
        walk(val)
      }
    }
    walk(root)
    return out
  }

  /**
   * Varre uma cadeia de objetos `{ next }` de profundidade arbitrária em
   * busca do primeiro valor `leaf` (iterativo — sem JSON.stringify nem
   * recursão, imune ao RangeError do V8 em ~10k de aninhamento).
   */
  function deepFindLeaf(chain: unknown, depth: number): unknown {
    let cursor = chain as Record<string, unknown>
    for (let i = 0; i < depth; i++) {
      const next = cursor.next
      if (next === null || typeof next !== 'object') break
      cursor = next as Record<string, unknown>
    }
    return cursor.leaf
  }

  /** Serializa de forma estável para comparar estrutura (sem depender de ordem). */
  function stableJson(value: unknown): string {
    return JSON.stringify(sortDeep(value))
  }

  /** Ordena chaves de objetos recursivamente (normaliza ordem de inserção). */
  function sortDeep(value: unknown): unknown {
    if (Array.isArray(value)) return value.map((item) => sortDeep(item))
    if (value !== null && typeof value === 'object') {
      const sorted: Record<string, unknown> = {}
      for (const key of Object.keys(value).sort()) {
        sorted[key] = sortDeep((value as Record<string, unknown>)[key])
      }
      return sorted
    }
    return value
  }

  it('nunca lança, nunca trava e preserva todos os dados (500 grafos aleatórios)', () => {
    forEachFuzzSeed(0xdee0_0000, (rand) => {
      for (let g = 0; g < 500; g++) {
        const { root } = buildRandomGraph(rand)

        // Invariante 1: nunca lança (nem RangeError de stack nem OOM por ciclo).
        let result: unknown
        expect(() => {
          result = deepOmitEmpty(root)
        }).not.toThrow()

        // Invariante 2: o resultado é 100% serializável (nenhum ciclo sobreviveu).
        expect(() => JSON.stringify(result)).not.toThrow()

        // Invariante 3: NENHUM dado legítimo se perdeu — todo valor folha
        // (exceto chaves perigosas e undefined) que existia no input continua
        // no output. A chave de comparação (`leafKey`) distingue NaN/±Infinity
        // de null — o JSON.stringify colapsaria os três em "null".
        const leaves = collectLeafValues(root)
        const resultLeaves = collectLeafValues(result)
        const resultKeys = new Set(
          resultLeaves.filter((leaf) => leaf !== undefined).map((leaf) => leafKey(leaf)),
        )
        for (const leaf of leaves) {
          if (leaf === undefined) continue // undefined é omitido por design
          const key = leafKey(leaf)
          expect(resultKeys.has(key), `grafo ${g}: valor ${key} se perdeu`).toBe(true)
        }

        // Invariante 4: idempotência — aplicar de novo não muda nada.
        const once = result as unknown
        const twice = deepOmitEmpty(once)
        expect(stableJson(twice), `grafo ${g}: deepOmitEmpty não é idempotente`).toBe(
          stableJson(once),
        )

        // Invariante 5: nenhuma chave perigosa vazou para o output.
        const serialized = JSON.stringify(result)
        expect(serialized).not.toContain('__proto__')
        expect(serialized).not.toContain('constructor')
        expect(serialized).not.toContain('prototype')

        // Invariante 6: nada poluiu o Object.prototype global.
        expect(({} as Record<string, unknown>).polluted).toBeUndefined()
      }
    })
  })

  it('cadeias profundas + ciclos no fundo não estouram pilha nem memória', () => {
    forEachFuzzSeed(0xbeef_cafe, (rand) => {
      for (let g = 0; g < 20; g++) {
        // Profundidade alta mas abaixo do limite de pilha do JSON.stringify
        // do V8 (~10k) — o próprio serializador recursivo lançaria RangeError
        // independente do cleanDeep, então a verificação do leaf é iterativa.
        const depth = 2_000 + Math.floor(rand() * 3_000) // 2k–5k
        let chain: unknown = { leaf: 1 }
        for (let i = 0; i < depth; i++) chain = { next: chain }
        // Fecha o ciclo no fundo: next aponta de volta para o topo.
        let cursor = chain as Record<string, unknown>
        for (let i = 0; i < depth; i++) {
          cursor = cursor.next as Record<string, unknown>
        }
        cursor.next = chain as unknown

        let result: unknown
        expect(() => {
          result = deepOmitEmpty(chain)
        }).not.toThrow()
        // A cadeia limpa preserva o leaf (o ciclo foi cortado no fundo).
        expect(deepFindLeaf(result, depth)).toBe(1)
      }
    })
  })

  it('DAGs densos (objeto compartilhado por muitos ramos) não são confundidos com ciclo', () => {
    for (let g = 0; g < 50; g++) {
      const shared: Record<string, unknown> = { value: g, nested: { deep: true } }
      const root: Record<string, unknown> = {}
      for (let i = 0; i < 30; i++) {
        root[`branch${i}`] = shared
      }
      const result = deepOmitEmpty(root) as Record<string, unknown>
      // Todos os 30 ramos preservados (DAG ≠ ciclo — o WeakSet é por caminho).
      expect(Object.keys(result).length).toBe(30)
      expect((result.branch0 as Record<string, unknown>).value).toBe(g)
      expect(() => JSON.stringify(result)).not.toThrow()
    }
  })

  it('chaves __proto__/constructor/prototype nunca vazam nem poluem em fuzz', () => {
    for (let g = 0; g < 200; g++) {
      const root: Record<string, unknown> = { legit: { a: 1 } }
      for (const [idx, key] of [...UNSAFE_KEYS].entries()) {
        setOwnKey(root, key, { polluted: idx, self: root }) // até com ciclo
      }
      const result = deepOmitEmpty(root) as Record<string, unknown>
      const serialized = JSON.stringify(result)
      expect(serialized).not.toContain('__proto__')
      expect(serialized).not.toContain('constructor')
      expect(serialized).not.toContain('prototype')
      expect(serialized).toContain('"legit"')
      // Sem poluição global.
      expect(({} as Record<string, unknown>).polluted).toBeUndefined()
      expect(({} as Record<string, unknown>).self).toBeUndefined()
    }
  })
})

describe('generateStateToken / isValidStateToken', () => {
  it('deve gerar tokens hex de 64 chars e diferentes entre si', () => {
    const a = generateStateToken()
    const b = generateStateToken()

    expect(a).toMatch(/^[a-f0-9]{64}$/)
    expect(b).toMatch(/^[a-f0-9]{64}$/)
    expect(a).not.toBe(b)
  })

  it('deve validar o formato do token', () => {
    const token = generateStateToken()

    expect(isValidStateToken(token)).toBe(true)
    expect(isValidStateToken(token.toUpperCase())).toBe(false)
    expect(isValidStateToken(token.slice(0, 63))).toBe(false)
    expect(isValidStateToken(`x${token.slice(1)}`)).toBe(false)
    expect(isValidStateToken('')).toBe(false)
  })
})
