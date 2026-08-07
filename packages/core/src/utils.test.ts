import { describe, expect, it, vi } from 'vitest'
import {
  deepOmitEmpty,
  generateStateToken,
  isValidStateToken,
  mapWithConcurrency,
  omitEmpty,
  omitUndefined,
} from './utils.js'

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
