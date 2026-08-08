import { InputValidationError } from '@nodemelivre/errors'
import { describe, expect, it } from 'vitest'
import {
  itemInputCreateSchema,
  itemInputPartialSchema,
  orderSearchParamsSchema,
} from './domain-schemas.js'
import {
  arrayOf,
  assertValid,
  booleanValue,
  enumOf,
  httpUrlSchema,
  makeSchema,
  nonEmptyFileSchema,
  number,
  object,
  optional,
  string,
} from './schemas.js'

describe('DSL de schemas — primitivas', () => {
  it('string valida tipo e comprimentos', () => {
    expect(string().check(123)).toEqual(['deve ser uma string'])
    expect(string({ minLength: 3 }).check('ab')).toEqual(['comprimento mínimo de 3 caracteres'])
    expect(string({ maxLength: 3 }).check('abcd')).toEqual(['comprimento máximo de 3 caracteres'])
    expect(string().check('ok')).toEqual([])
  })

  it('number valida tipo, finitude, inteiro e positividade', () => {
    expect(number().check('10')).toEqual(['deve ser um número'])
    expect(number({ integer: true }).check(1.5)).toEqual(['deve ser um inteiro'])
    expect(number({ positive: true }).check(0)).toEqual(['deve ser um número positivo'])
    expect(number({ positive: true }).check(-1)).toEqual(['deve ser um número positivo'])
    expect(number({ min: 0 }).check(-1)).toEqual(['mínimo de 0'])
    expect(number().check(10)).toEqual([])
  })

  it('enumOf aceita apenas membros da union', () => {
    const status = enumOf(['active', 'paused', 'closed'] as const)
    expect(status.check('active')).toEqual([])
    expect(status.check('inexistente')).toEqual(['deve ser um de: active, paused, closed'])
    expect(status.check(1)).toEqual(['deve ser um de: active, paused, closed'])
  })

  it('booleanValue e optional', () => {
    expect(booleanValue().check(true)).toEqual([])
    expect(booleanValue().check('sim')).toEqual(['deve ser um booleano'])
    expect(optional(string()).check(undefined)).toEqual([])
    expect(optional(string()).check(123)).toEqual(['deve ser uma string'])
  })

  it('arrayOf valida cada elemento', () => {
    expect(arrayOf(string()).check(['a', 'b'])).toEqual([])
    expect(arrayOf(string()).check(['a', 1])).toEqual(['deve ser uma string'])
    expect(arrayOf(string()).check('não-array')).toEqual(['deve ser um array'])
  })

  it('object valida shape e refinements entre campos', () => {
    const schema = object<{ a?: number; b?: number }>(
      { a: optional(number()), b: optional(number()) },
      {
        refinements: [
          (value) =>
            value.a !== undefined && value.b !== undefined
              ? 'a e b são mutuamente exclusivos'
              : null,
        ],
      },
    )
    expect(schema.check({ a: 1, b: 2 })).toEqual(['a e b são mutuamente exclusivos'])
    expect(schema.check({ a: 1 })).toEqual([])
    expect(schema.check('não-objeto')).toEqual(['deve ser um objeto'])
  })

  it('parse lança InputValidationError com a primeira falha', () => {
    const schema = object<{ a: number }>({ a: number() })
    expect(() => schema.parse({ a: 'x' })).toThrow(InputValidationError)
    expect(() => schema.parse({ a: 'x' })).toThrow('deve ser um número')
    expect(schema.parse({ a: 5 })).toEqual({ a: 5 })
  })

  it('makeSchema permite regras custom com mensagens próprias', () => {
    const par = makeSchema<number>((value) =>
      typeof value === 'number' && value % 2 === 0 ? [] : ['deve ser par'],
    )
    expect(par.check(3)).toEqual(['deve ser par'])
    expect(par.check(4)).toEqual([])
  })

  it('assertValid devolve o valor quando válido', () => {
    expect(assertValid(string(), 'ok')).toBe('ok')
    expect(() => assertValid(string(), 42)).toThrow(InputValidationError)
  })
})

describe('Schemas genéricos do core', () => {
  it('httpUrlSchema aceita apenas http(s)', () => {
    expect(httpUrlSchema.check('https://exemplo.com/foto.jpg')).toEqual([])
    expect(httpUrlSchema.check('http://exemplo.com/foto.jpg')).toEqual([])
    expect(httpUrlSchema.check('file:///etc/passwd')).toEqual([
      'URL deve ser http(s) válida para upload por URL',
    ])
    expect(httpUrlSchema.check('não é uma url')).toEqual([
      'URL deve ser http(s) válida para upload por URL',
    ])
  })

  it('nonEmptyFileSchema rejeita Blob vazio', () => {
    expect(nonEmptyFileSchema.check(new Blob(['x']))).toEqual([])
    expect(nonEmptyFileSchema.check(new Blob([]))).toEqual([
      'Imagem vazia — envie um arquivo com conteúdo',
    ])
  })
})

describe('itemInputCreateSchema', () => {
  it('aceita title no modelo legado', () => {
    expect(
      itemInputCreateSchema.check({ title: 'Produto', price: 10, available_quantity: 5 }),
    ).toEqual([])
  })

  it('aceita family_name (modelo User Product)', () => {
    expect(
      itemInputCreateSchema.check({ family_name: 'Família', price: 10, available_quantity: 5 }),
    ).toEqual([])
  })

  it('rejeita sem title nem family_name', () => {
    const issues = itemInputCreateSchema.check({ price: 10, available_quantity: 5 })
    expect(issues).toEqual(['title ou family_name é obrigatório na criação'])
    expect(() => itemInputCreateSchema.parse({ price: 10, available_quantity: 5 })).toThrow(
      'title ou family_name é obrigatório',
    )
  })

  it('rejeita title e family_name juntos', () => {
    const issues = itemInputCreateSchema.check({
      title: 'T',
      family_name: 'F',
      price: 10,
      available_quantity: 5,
    })
    expect(issues).toEqual([
      'title e family_name são mutuamente exclusivos: envie apenas um (modelo User Product)',
    ])
  })

  it('rejeita family_name vazio', () => {
    expect(
      itemInputCreateSchema.check({ family_name: '', price: 10, available_quantity: 5 }),
    ).toEqual(['family_name deve ser uma string não vazia'])
  })

  it('rejeita preço não positivo', () => {
    expect(itemInputCreateSchema.check({ title: 'x', price: 0, available_quantity: 5 })).toEqual([
      'price deve ser um número positivo',
    ])
    expect(itemInputCreateSchema.check({ title: 'x', price: -1, available_quantity: 5 })).toEqual([
      'price deve ser um número positivo',
    ])
  })

  it('rejeita estoque não inteiro ou negativo', () => {
    expect(itemInputCreateSchema.check({ title: 'x', price: 10, available_quantity: 1.5 })).toEqual(
      ['available_quantity deve ser um inteiro >= 0'],
    )
    expect(itemInputCreateSchema.check({ title: 'x', price: 10, available_quantity: -2 })).toEqual([
      'available_quantity deve ser um inteiro >= 0',
    ])
  })

  it('rejeita shipping com mode fora da union', () => {
    const issues = itemInputCreateSchema.check({
      title: 'x',
      price: 10,
      available_quantity: 5,
      shipping: { mode: 'expresso' },
    })
    expect(issues).toEqual(['deve ser um de: me1, me2, me_gratis, custom, not_specified'])
  })
})

describe('itemInputPartialSchema (atualização)', () => {
  it('aceita objeto vazio (atualização sem campos)', () => {
    expect(itemInputPartialSchema.check({})).toEqual([])
  })

  it('aceita campos parciais válidos', () => {
    expect(itemInputPartialSchema.check({ price: 20 })).toEqual([])
  })

  it('continua rejeitando title e family_name juntos', () => {
    expect(itemInputPartialSchema.check({ title: 'a', family_name: 'b' })).toEqual([
      'title e family_name são mutuamente exclusivos: envie apenas um (modelo User Product)',
    ])
  })

  it('não exige campos obrigatórios da criação', () => {
    expect(itemInputPartialSchema.check({ price: 20 })).toEqual([])
    expect(itemInputPartialSchema.check({ available_quantity: 3 })).toEqual([])
  })
})

describe('orderSearchParamsSchema', () => {
  it('aceita busca válida e objeto vazio', () => {
    expect(orderSearchParamsSchema.check({ seller: 42, status: 'paid', limit: 50 })).toEqual([])
    expect(orderSearchParamsSchema.check({})).toEqual([])
  })

  it('rejeita status fora da union', () => {
    expect(orderSearchParamsSchema.check({ status: 'inexistente' })).toEqual([
      'deve ser um de: confirmed, payment_required, cancelled, invalid, paid',
    ])
  })

  it('rejeita limit/offset inválidos', () => {
    expect(orderSearchParamsSchema.check({ limit: -1 })).toEqual(['deve ser um número positivo'])
    expect(orderSearchParamsSchema.check({ limit: 1.5 })).toEqual(['deve ser um inteiro'])
    expect(orderSearchParamsSchema.check({ offset: -1 })).toEqual(['mínimo de 0'])
    expect(orderSearchParamsSchema.check({ offset: 0 })).toEqual([])
  })
})
