import { describe, expect, it } from 'vitest'
import {
  deepOmitEmpty,
  generateStateToken,
  isValidStateToken,
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
