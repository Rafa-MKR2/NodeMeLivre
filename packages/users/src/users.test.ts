import { fakeTransport } from '@nodemelivre/core/test-utils'
import { InputValidationError } from '@nodemelivre/errors'
import { describe, expect, it } from 'vitest'
import { Users } from './users.js'

const user = { id: 42, nickname: 'vendedor' }

describe('Users', () => {
  it('deve buscar o usuário autenticado sem query', async () => {
    const transport = fakeTransport(() => user)
    await new Users(transport).me()
    expect(transport.calls[0]).toMatchObject({ method: 'GET', path: '/users/me' })
    expect(transport.calls[0]?.query).toBeUndefined()
  })

  it('deve buscar um usuário pelo id numérico', async () => {
    const transport = fakeTransport(() => user)
    await new Users(transport).get(42)
    expect(transport.calls[0]).toMatchObject({ method: 'GET', path: '/users/42' })
  })

  it('deve buscar um usuário pelo id string', async () => {
    const transport = fakeTransport(() => user)
    await new Users(transport).get('42')
    expect(transport.calls[0]?.path).toBe('/users/42')
  })

  it('deve aceitar ids alfanuméricos válidos (padrão do assertValidId)', async () => {
    const transport = fakeTransport(() => user)
    await new Users(transport).get('user_abc-123')
    expect(transport.calls[0]?.path).toBe('/users/user_abc-123')
  })

  it('rejeita user_id com path traversal antes de chamar o transport', () => {
    const transport = fakeTransport(() => user)
    expect(() => new Users(transport).get('../../users/me')).toThrow(InputValidationError)
    expect(transport.calls).toHaveLength(0)
  })

  it('rejeita user_id com caracteres que alteram a URL', () => {
    const transport = fakeTransport(() => user)
    // barra inicial, espaço e percent-encoding são formas de escapar do path.
    expect(() => new Users(transport).get('/users/me')).toThrow(InputValidationError)
    expect(() => new Users(transport).get('a b')).toThrow(InputValidationError)
    expect(() => new Users(transport).get('..%2F..%2Fme')).toThrow(InputValidationError)
    expect(transport.calls).toHaveLength(0)
  })

  it('rejeita user_id vazio ou numérico inválido', () => {
    const transport = fakeTransport(() => user)
    expect(() => new Users(transport).get('')).toThrow(InputValidationError)
    expect(() => new Users(transport).get(-5)).toThrow(InputValidationError)
    expect(() => new Users(transport).get(1.5)).toThrow(InputValidationError)
    expect(() => new Users(transport).get(Number.NaN)).toThrow(InputValidationError)
    expect(transport.calls).toHaveLength(0)
  })

  it('rejeita user_id acima do limite de 100 caracteres', () => {
    const transport = fakeTransport(() => user)
    expect(() => new Users(transport).get('a'.repeat(101))).toThrow(InputValidationError)
    expect(transport.calls).toHaveLength(0)
  })
})
