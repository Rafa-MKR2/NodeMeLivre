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
  assertValidId,
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

  it('httpUrlSchema bloqueia hosts de SSRF (localhost, privados, metadata)', () => {
    const blocked = [
      'http://localhost:3000/x',
      'http://127.0.0.1/x',
      'http://169.254.169.254/latest/meta-data/',
      'http://10.0.0.1/x',
      'http://192.168.0.1/x',
      'http://172.16.0.1/x',
      'http://[::1]/x',
      'http://metadata.google.internal/x',
      // IPv4-mapeado em IPv6 — roteia para loopback/privado em muitos sistemas
      'http://[::ffff:127.0.0.1]/x',
      'http://[::ffff:169.254.169.254]/x',
      'http://[::ffff:10.0.0.1]/x',
      // Trailing dot: `localhost.` resolve para 127.0.0.1 na maioria dos
      // resolvers (FQDN absoluto) — era um bypass do bloqueio SSRF.
      'http://localhost./x',
      'http://localhost../x',
      'http://metadata./x',
      'http://metadata.google.internal./x',
      'http://127.0.0.1./x',
      // DNS wildcard público que resolve para IPs locais (Rodada 6)
      'http://127.0.0.1.nip.io/x',
      'http://localhost.nip.io/x',
      'http://sslip.io/x',
      'http://1.2.3.4.sslip.io/x',
      'http://localtest.me/x',
      'http://foo.localtest.me/x',
      'http://xip.io/x',
      'http://127.0.0.1.xip.io/x',
      'http://lvh.me/x',
      'http://vcap.me/x',
      // Mecanismos de transição IPv6 que embutem IPv4 local (Rodada 6)
      'http://[64:ff9b::127.0.0.1]/x', // NAT64 WKP dotted
      'http://[64:ff9b::7f00:1]/x', // NAT64 WKP hex (forma normalizada)
      'http://[2002:7f00:1::]/x', // 6to4 → 127.0.0.1
      'http://[2002:a00:1::]/x', // 6to4 → 10.0.0.1 (privado)
      'http://[::7f00:1]/x', // IPv4-compatível → 127.0.0.1
      // Link-local IPv6 é fe80::/10 (fe80–febf) — o bloqueio antigo só
      // cobria o primeiro bloco (`fe80`); os demais passavam (Rodada 9).
      'http://[fe80::1]/x',
      'http://[fe90::1]/x',
      'http://[fea0::1]/x',
      'http://[feb0::1]/x',
      'http://[febf::1]/x',
      // ULA fc00::/7 (fc00–fdff)
      'http://[fc00::1]/x',
      'http://[fd00::1]/x',
      'http://[fdff::1]/x',
    ]
    for (const url of blocked) {
      expect(httpUrlSchema.check(url)).toEqual([
        'URL bloqueada: endereços locais, privados ou de metadados não são permitidos',
      ])
    }
    // Hosts públicos seguem válidos.
    expect(httpUrlSchema.check('https://img.example.com/foto.jpg')).toEqual([])
    expect(httpUrlSchema.check('https://s3.amazonaws.com/x.png')).toEqual([])
    // IPv6 legítimo (Google DNS) continua aceito.
    expect(httpUrlSchema.check('http://[2001:4860:4860::8888]/x')).toEqual([])
  })

  it('nonEmptyFileSchema rejeita Blob vazio', () => {
    expect(nonEmptyFileSchema.check(new Blob(['x']))).toEqual([])
    expect(nonEmptyFileSchema.check(new Blob([]))).toEqual([
      'Imagem vazia — envie um arquivo com conteúdo',
    ])
  })
})

describe('assertValidId — proteção contra path traversal', () => {
  it('aceita IDs válidos do Mercado Livre', () => {
    expect(() => assertValidId('MLB1', 'item_id')).not.toThrow()
    expect(() => assertValidId('MLB1234567890', 'item_id')).not.toThrow()
    expect(() => assertValidId(123, 'order_id')).not.toThrow()
    expect(() => assertValidId('abc_def-1', 'pack_id')).not.toThrow()
  })

  it('rejeita path traversal e caracteres que alteram a URL', () => {
    const invalid = [
      '../../users/me',
      'MLB1/../../users/me',
      '/items/1',
      'a b',
      'a?b=1',
      'a#frag',
      'a%2Fb',
      '',
      '..',
      '.',
    ]
    for (const id of invalid) {
      expect(() => assertValidId(id, 'item_id')).toThrow(InputValidationError)
    }
  })

  it('rejeita números inválidos', () => {
    expect(() => assertValidId(NaN, 'order_id')).toThrow(InputValidationError)
    expect(() => assertValidId(-1, 'order_id')).toThrow(InputValidationError)
    expect(() => assertValidId(1.5, 'order_id')).toThrow(InputValidationError)
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
