import { describe, expect, it, vi } from 'vitest'
import { createConsoleLogger, DeduplicatingLogger, silentLogger } from './logger.js'

describe('DeduplicatingLogger', () => {
  it('deve registrar a primeira ocorrência de cada mensagem', () => {
    const inner = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const logger = new DeduplicatingLogger(inner, { maxRepeats: 1 })

    logger.error({ err: 'a' }, 'falhou')
    logger.error({ err: 'a' }, 'falhou')

    expect(inner.error).toHaveBeenCalledTimes(1)
    logger.stop()
  })

  it('deve registrar até maxRepeats repetições', () => {
    const inner = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const logger = new DeduplicatingLogger(inner, { maxRepeats: 3 })

    for (let i = 0; i < 5; i++) {
      logger.warn('algo repetido')
    }

    expect(inner.warn).toHaveBeenCalledTimes(3)
    logger.stop()
  })

  it('deve diferenciar mensagens por nível e contexto', () => {
    const inner = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const logger = new DeduplicatingLogger(inner)

    logger.error({ id: 1 }, 'mesma mensagem')
    logger.warn({ id: 1 }, 'mesma mensagem')
    logger.error({ id: 2 }, 'mesma mensagem')

    expect(inner.error).toHaveBeenCalledTimes(2)
    expect(inner.warn).toHaveBeenCalledTimes(1)
    logger.stop()
  })

  it('deve resetar o cache no clear', () => {
    const inner = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const logger = new DeduplicatingLogger(inner)

    logger.error('x')
    logger.clear()
    logger.error('x')

    expect(inner.error).toHaveBeenCalledTimes(2)
    logger.stop()
  })

  it('não deve lançar com contexto circular (ACHADO 33, Rodada 8)', () => {
    const inner = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const logger = new DeduplicatingLogger(inner)

    const circulo: { self?: unknown; err?: unknown } = {}
    circulo.self = circulo
    const err = new TypeError('network failure')
    err.cause = circulo // cadeia de cause circular como a do undici
    circulo.err = err

    expect(() =>
      logger.error({ err, url: 'https://api.mercadolibre.com/x' }, 'falha'),
    ).not.toThrow()
    // O log é emitido normalmente (deduplicação por chave estável).
    expect(inner.error).toHaveBeenCalledTimes(1)
    logger.stop()
  })

  it('deve emitir resumo periódico para logs suprimidos', () => {
    vi.useFakeTimers()
    try {
      const inner = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
      const logger = new DeduplicatingLogger(inner, { maxRepeats: 1, windowMs: 1_000 })

      logger.error('repete')
      logger.error('repete')
      logger.error('repete')
      expect(inner.error).toHaveBeenCalledTimes(1)

      vi.advanceTimersByTime(1_001)
      logger.error('repete')

      expect(inner.warn).toHaveBeenCalledTimes(1)
      expect(inner.warn.mock.calls[0]?.[0]).toMatchObject({ count: 3 })
      expect(inner.error).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('deve remover entradas expiradas no cleanup periódico (sem memory leak)', () => {
    vi.useFakeTimers()
    try {
      const inner = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
      const logger = new DeduplicatingLogger(inner, { windowMs: 1_000 })

      logger.error('unica-1')
      logger.error('unica-2')
      expect(logger.size).toBe(2)

      vi.advanceTimersByTime(1_001)

      expect(logger.size).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('deve respeitar o limite máximo de entradas (maxEntries)', () => {
    const inner = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const logger = new DeduplicatingLogger(inner, { windowMs: 60_000, maxEntries: 2 })

    logger.info('m1')
    logger.info('m2')
    logger.info('m3') // remove a mais antiga (m1)
    expect(logger.size).toBe(2)

    logger.info('m1') // entrada removida → conta como nova
    expect(inner.info).toHaveBeenCalledTimes(4)
    logger.stop()
  })

  it('deve emitir o resumo na expiração periódica dos logs suprimidos', () => {
    vi.useFakeTimers()
    try {
      const inner = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
      const logger = new DeduplicatingLogger(inner, { maxRepeats: 1, windowMs: 1_000 })

      logger.error('expira')
      logger.error('expira')
      logger.error('expira')
      expect(inner.warn).not.toHaveBeenCalled()

      vi.advanceTimersByTime(1_001)

      expect(inner.warn).toHaveBeenCalledTimes(1)
      expect(inner.warn.mock.calls[0]?.[0]).toMatchObject({ count: 3 })
    } finally {
      vi.useRealTimers()
    }
  })

  it('deve parar a limpeza periódica com stop()', () => {
    vi.useFakeTimers()
    try {
      const inner = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
      const logger = new DeduplicatingLogger(inner, { maxRepeats: 1, windowMs: 1_000 })

      logger.error('z')
      logger.error('z')
      logger.error('z')
      logger.stop()

      vi.advanceTimersByTime(5_000)

      expect(inner.warn).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('deve manter a mensagem original no resumo (inclusive com dois-pontos)', () => {
    vi.useFakeTimers()
    try {
      const inner = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
      const logger = new DeduplicatingLogger(inner, { maxRepeats: 1, windowMs: 1_000 })

      logger.error({}, 'falhou: conexão recusada')
      logger.error({}, 'falhou: conexão recusada')
      logger.error({}, 'falhou: conexão recusada')

      vi.advanceTimersByTime(1_001)
      logger.error({}, 'falhou: conexão recusada')

      expect(inner.warn.mock.calls[0]?.[0]).toMatchObject({
        count: 3,
        message: 'falhou: conexão recusada',
      })
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('createConsoleLogger', () => {
  it('deve expor os quatro níveis', () => {
    const logger = createConsoleLogger()
    expect(typeof logger.debug).toBe('function')
    expect(typeof logger.info).toBe('function')
    expect(typeof logger.warn).toBe('function')
    expect(typeof logger.error).toBe('function')
  })
})

describe('silentLogger', () => {
  it('não deve lançar em nenhum nível', () => {
    silentLogger.debug({}, 'm')
    silentLogger.info({}, 'm')
    silentLogger.warn({}, 'm')
    silentLogger.error({}, 'm')
  })
})

describe('DeduplicatingLogger — fuzzing (Rodada 9+, determinístico)', () => {
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

  /** Tipo spy de logger — o inner NUNCA inspeciona o contexto (só registra). */
  function spyLogger(): {
    debug: ReturnType<typeof vi.fn>
    info: ReturnType<typeof vi.fn>
    warn: ReturnType<typeof vi.fn>
    error: ReturnType<typeof vi.fn>
  } {
    return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  }

  /** Objeto/autorreferente e mutuamente circular — fix ACHADO 33 (WeakSet). */
  function buildCircular(rand: () => number): unknown {
    const kind = rand()
    if (kind < 0.33) {
      const o: Record<string, unknown> = { meta: 'self', n: 1 }
      o.self = o
      return o
    }
    if (kind < 0.66) {
      const arr: unknown[] = [1, 'x']
      arr.push(arr) // array que se contém
      return arr
    }
    const x: Record<string, unknown> = { nome: 'x' }
    const y: Record<string, unknown> = { x }
    x.y = y
    return x
  }

  /** Cadeia de `cause` circular profunda, como as do undici (ACHADO 33). */
  function circularCauseChain(depth: number): Record<string, unknown> {
    const head: Record<string, unknown> = { depth }
    let cursor = head
    for (let i = 0; i < depth; i++) {
      const next: Record<string, unknown> = { i }
      cursor.cause = next
      cursor = next
    }
    cursor.cause = head // fecha o ciclo no fundo
    return head
  }

  /** Objeto com getter que LANÇA — em qualquer profundidade de aninhamento. */
  function throwingGetterObject(depth: number): Record<string, unknown> {
    const o: Record<string, unknown> = { id: 'boom' }
    Object.defineProperty(o, 'boom', {
      enumerable: true,
      get() {
        throw new Error('getter boom')
      },
    })
    if (depth > 0) o.nested = throwingGetterObject(depth - 1)
    return o
  }

  /** `toJSON` hostil: lança, devolve BigInt ou re-cria o ciclo (RangeError). */
  function buildToJSON(rand: () => number): unknown {
    const kind = rand()
    if (kind < 0.34) {
      return {
        toJSON() {
          throw new Error('toJSON boom')
        },
      }
    }
    if (kind < 0.67) {
      // toJSON devolve objeto NOVO sempre → recursão sem fim → RangeError
      // do V8 (~10k frames) — o try/catch do safeStringify precisa capturar.
      return {
        toJSON() {
          return { self: this }
        },
      }
    }
    return {
      toJSON() {
        return 10n // BigInt pós-toJSON — JSON.stringify lança TypeError
      },
    }
  }

  /** Composto: BigInt + símbolo + ciclo + não-JSON no MESMO objeto. */
  function buildComposite(rand: () => number): Record<string, unknown> {
    const err: Record<string, unknown> = { tipo: 'erro' }
    err.self = err
    const meta: Record<string, unknown> = {
      big: 10n ** BigInt(10 + Math.floor(rand() * 190)),
      sym: Symbol('composto'),
      nano: rand() < 0.5 ? undefined : null,
    }
    return {
      err,
      meta,
      list: [1n, Symbol(), undefined, null, Number.NaN],
      [Symbol('oculto')]: 'nunca serializado', // chave símbolo é ignorada
    }
  }

  /** Primitivos hostis: NaN/±Infinity/-0, símbolos, BigInt, string gigante. */
  function pickHostilePrimitive(rand: () => number): unknown {
    return pick(rand, [
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      -0,
      undefined,
      null,
      '',
      'x'.repeat(50_000),
      0,
      false,
      Symbol('folha'),
      Symbol.for('compartilhado'),
      1n,
      -1n,
      10n ** 200n,
    ])
  }

  /** Objetos exóticos: Date/Map/Set/typed array/null-proto/funções/boxed. */
  function buildExotic(rand: () => number): unknown {
    return pick(rand, [
      new Date(1_700_000_000_000),
      /ab+c/gi,
      new Map<string, number>([['k', 1]]),
      new Set([1, 2]),
      new WeakMap(),
      new WeakSet(),
      new Uint8Array([1, 2, 3]),
      new ArrayBuffer(8),
      Object.create(null, { a: { value: 1, enumerable: true } }),
      () => 1,
      function named(): number {
        return 1
      },
      new String('boxed'),
    ])
  }

  /** Cadeia com profundidade acima do limite do V8 (~10k) — RangeError. */
  function buildDeepChain(rand: () => number): unknown {
    const depth = 1_000 + Math.floor(rand() * 19_000) // 1k–20k
    let node: unknown = { leaf: 'fim' }
    for (let i = 0; i < depth; i++) {
      node = rand() < 0.5 ? { next: node } : [node]
    }
    return node
  }

  /** Chaves perigosas vindas de JSON.parse (own keys reais de verdade). */
  function buildDangerousKeys(): unknown {
    return JSON.parse('{"__proto__":{"polluted":true},"constructor":{"prototype":{"x":1}},"ok":1}')
  }

  /** Proxy com traps que LANÇAM — o JSON.stringify os invoca ([[Get]]). */
  function buildProxy(rand: () => number): unknown {
    const kind = rand()
    if (kind < 0.34) {
      return new Proxy(
        { a: 1 },
        {
          get() {
            throw new Error('proxy get')
          },
        },
      )
    }
    if (kind < 0.67) {
      return new Proxy(
        {},
        {
          getOwnPropertyDescriptor() {
            throw new Error('proxy desc')
          },
        },
      )
    }
    return new Proxy([1, 2], {
      get(target, prop, receiver) {
        if (prop === Symbol.iterator) return Reflect.get(target, prop, receiver)
        throw new Error('proxy iter')
      },
    })
  }

  /**
   * Monta um contexto hostil aleatório combinando todas as categorias.
   *
   * DETERMINISMO por design: nenhum builder usa getter com side-effect/
   * Math.random — getters ou lançam incondicionalmente ou são ausentes. A
   * invariante de estabilidade da chave de dedup depende disso: um getter
   * que muda entre chamadas quebraria a chave POR NATUREZA (o logger não
   * pode deduplicar o que muda), não por bug do logger.
   */
  function buildHostileContext(rand: () => number): unknown {
    const r = rand()
    if (r < 0.14) return buildCircular(rand)
    if (r < 0.28) return circularCauseChain(Math.floor(rand() * 200))
    if (r < 0.4) return throwingGetterObject(Math.floor(rand() * 12))
    if (r < 0.5) return buildToJSON(rand)
    if (r < 0.62) return buildComposite(rand)
    if (r < 0.72) return pickHostilePrimitive(rand)
    if (r < 0.82) return buildExotic(rand)
    if (r < 0.91) return buildDeepChain(rand)
    if (r < 0.96) return buildDangerousKeys()
    return buildProxy(rand)
  }

  it('nunca lança ao logar 500 contextos hostis nos 4 níveis', () => {
    const graphs = 500
    forEachFuzzSeed(0x10c0_0000, (rand) => {
      const inner = spyLogger()
      const logger = new DeduplicatingLogger(inner, { maxRepeats: 1 })
      try {
        for (let g = 0; g < graphs; g++) {
          const ctx = buildHostileContext(rand)
          // INVARIANTE-CHAVE: logar NUNCA lança. Getter que lança, BigInt
          // (JSON.stringify lança TypeError), ciclo, toJSON que lança/re-cria e
          // profundidade >10k (RangeError do V8) não podem derrubar o processo
          // do integrador — o safeStringify do ACHADO 33 tem que absorver tudo.
          expect(() => logger.debug(ctx, `d-${g}`), `grafo ${g}: debug lançou`).not.toThrow()
          expect(() => logger.info(ctx, `i-${g}`), `grafo ${g}: info lançou`).not.toThrow()
          expect(() => logger.warn(ctx, `w-${g}`), `grafo ${g}: warn lançou`).not.toThrow()
          expect(() => logger.error(ctx, `e-${g}`), `grafo ${g}: error lançou`).not.toThrow()
        }
        // Cache de deduplicação populado sem estourar: cada (nível, mensagem)
        // é único → exatamente graphs × 4 entradas (maxEntries padrão 10k,
        // sem eviction). A contagem deriva da constante — não do número mágico.
        expect(logger.size).toBe(graphs * 4)
      } finally {
        logger.stop()
      }
    })
  })

  it('chave de deduplicação estável: repetição hostil é suprimida', () => {
    forEachFuzzSeed(0xfeed_0000, (rand) => {
      for (let g = 0; g < 200; g++) {
        const inner = spyLogger()
        const logger = new DeduplicatingLogger(inner, { maxRepeats: 1 })
        try {
          const ctx = buildHostileContext(rand)
          logger.error(ctx, 'estavel')
          logger.error(ctx, 'estavel')
          // A chave do dedup não pode depender de serialização aleatória:
          // o safeStringify é determinístico por objeto ([Circular]/
          // [unserializable] estáveis), então 2 logs → 1 chamada ao inner.
          expect(inner.error, `grafo ${g}: repetição hostil não suprimida`).toHaveBeenCalledTimes(1)
        } finally {
          logger.stop()
        }
      }
    })
  })

  it('expiração + resumo de logs suprimidos nunca lançam com contextos hostis', () => {
    vi.useFakeTimers()
    try {
      forEachFuzzSeed(0xaced_0000, (rand) => {
        for (let g = 0; g < 100; g++) {
          const inner = spyLogger()
          const logger = new DeduplicatingLogger(inner, { maxRepeats: 1, windowMs: 1_000 })
          try {
            const ctx = buildHostileContext(rand)
            logger.error(ctx, 'resumo')
            logger.error(ctx, 'resumo') // suprimida
            logger.error(ctx, 'resumo') // suprimida → count 3
            // cleanup periódico + emitSummary: o resumo também passa pelo
            // logger — nunca pode lançar com contexto hostil em jogo.
            expect(() => vi.advanceTimersByTime(2_000)).not.toThrow()
            expect(inner.warn).toHaveBeenCalledTimes(1)
            expect(inner.warn.mock.calls[0]?.[0]).toMatchObject({ count: 3 })
          } finally {
            logger.stop()
          }
        }
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('eviction do cache (maxEntries) nunca lança com contextos hostis', () => {
    forEachFuzzSeed(0xcafe_0000, (rand) => {
      const inner = spyLogger()
      const logger = new DeduplicatingLogger(inner, { windowMs: 60_000, maxEntries: 3 })
      try {
        for (let g = 0; g < 100; g++) {
          const ctx = buildHostileContext(rand)
          expect(() => logger.error(ctx, `evict-${g}`), `grafo ${g}: eviction lançou`).not.toThrow()
        }
        expect(logger.size).toBeLessThanOrEqual(3)
      } finally {
        logger.stop()
      }
    })
  })

  it('cadeia de cause circular profunda (undici-like) nunca lança nem quebra o dedup', () => {
    forEachFuzzSeed(0xbeef_0000, (rand) => {
      for (let g = 0; g < 20; g++) {
        const depth = 100 + Math.floor(rand() * 400) // 100–500 de profundidade
        const err = circularCauseChain(depth)
        const inner = spyLogger()
        const logger = new DeduplicatingLogger(inner, { maxRepeats: 1 })
        try {
          const ctx = { err, url: 'https://api.mercadolibre.com/x' }
          expect(() => logger.error(ctx, 'falha'), `grafo ${g}: falhou`).not.toThrow()
          logger.error(ctx, 'falha') // repetição — chave estável via WeakSet
          expect(inner.error).toHaveBeenCalledTimes(1)
        } finally {
          logger.stop()
        }
      }
    })
  })

  it('getters que lançam, símbolos e BigInt em qualquer posição nunca lançam', () => {
    const inner = spyLogger()
    const logger = new DeduplicatingLogger(inner, { maxRepeats: 1 })
    const cases: unknown[] = [
      throwingGetterObject(10),
      {
        a: {
          b: {
            get boom(): never {
              throw new TypeError('deep boom')
            },
          },
        },
      },
      new (class G {
        get boom(): never {
          throw new Error('proto boom')
        }
      })(),
      Symbol('raiz'),
      Symbol.for('raiz-compartilhada'),
      [Symbol('a'), Symbol.for('b'), 1n, { big: 999n }],
      { big: 1n, nested: [2n, { deep: 3n }], sym: Symbol(), [Symbol('k')]: 1n },
      10n ** 100n,
      {
        getterBig(): bigint {
          return 1n
        },
      },
    ]
    try {
      for (const [i, ctx] of cases.entries()) {
        expect(() => logger.debug(ctx, `c-${i}`), `caso ${i}: debug`).not.toThrow()
        expect(() => logger.info(ctx, `c-${i}`), `caso ${i}: info`).not.toThrow()
        expect(() => logger.warn(ctx, `c-${i}`), `caso ${i}: warn`).not.toThrow()
        expect(() => logger.error(ctx, `c-${i}`), `caso ${i}: error`).not.toThrow()
      }
    } finally {
      logger.stop()
    }
  })

  it('profundidade extrema (10k–20k) nunca lança nem estoura a pilha', () => {
    const inner = spyLogger()
    const logger = new DeduplicatingLogger(inner, { maxRepeats: 1 })
    try {
      for (const depth of [10_000, 15_000, 20_000]) {
        let chain: unknown = { leaf: 1 }
        for (let i = 0; i < depth; i++) chain = { next: chain }
        // JSON.stringify do V8 lança RangeError ~10k de profundidade — o
        // safeStringify captura e devolve '[unserializable]'; o log NUNCA lança.
        expect(
          () => logger.error({ chain }, `profundo-${depth}`),
          `profundidade ${depth}: error lançou`,
        ).not.toThrow()
        expect(
          () => logger.warn({ chain }, `profundo-${depth}`),
          `profundidade ${depth}: warn lançou`,
        ).not.toThrow()
      }
    } finally {
      logger.stop()
    }
  })

  it('chaves perigosas e proxies com traps que lançam nunca lançam', () => {
    forEachFuzzSeed(0xd00d_0000, (rand) => {
      const inner = spyLogger()
      const logger = new DeduplicatingLogger(inner, { maxRepeats: 1 })
      try {
        for (let g = 0; g < 50; g++) {
          expect(() => logger.error(buildDangerousKeys(), `perigoso-${g}`)).not.toThrow()
          expect(() => logger.error(buildProxy(rand), `proxy-${g}`)).not.toThrow()
        }
      } finally {
        logger.stop()
      }
    })
  })

  // Escopo: valida que o WRAPPER do createConsoleLogger nunca lança ao
  // repassar contextos hostis ao console. O comportamento do console real
  // (util.inspect) é do Node e está fora do contrato do SDK — por isso o
  // spy com mockImplementation silencia a saída sem inspecionar o valor.
  it('createConsoleLogger nunca lança ao logar contextos hostis', () => {
    const spies = {
      debug: vi.spyOn(console, 'debug').mockImplementation(() => {}),
      info: vi.spyOn(console, 'info').mockImplementation(() => {}),
      warn: vi.spyOn(console, 'warn').mockImplementation(() => {}),
      error: vi.spyOn(console, 'error').mockImplementation(() => {}),
    }
    try {
      forEachFuzzSeed(0xdead_0000, (rand) => {
        const logger = createConsoleLogger()
        for (let g = 0; g < 100; g++) {
          const ctx = buildHostileContext(rand)
          expect(() => logger.debug(ctx, `d-${g}`), `grafo ${g}: debug`).not.toThrow()
          expect(() => logger.info(ctx, `i-${g}`), `grafo ${g}: info`).not.toThrow()
          expect(() => logger.warn(ctx, `w-${g}`), `grafo ${g}: warn`).not.toThrow()
          expect(() => logger.error(ctx, `e-${g}`), `grafo ${g}: error`).not.toThrow()
        }
      })
    } finally {
      for (const spy of Object.values(spies)) spy.mockRestore()
    }
  })
})
