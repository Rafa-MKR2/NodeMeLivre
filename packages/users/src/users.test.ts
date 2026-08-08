import { fakeTransport } from '@nodemelivre/core/test-utils'
import { InputValidationError } from '@nodemelivre/errors'
import { describe, expect, it } from 'vitest'
import { Users } from './users.js'

const user = { id: 42, nickname: 'vendedor' }

describe('Users', () => {
  it('deve buscar o usuário autenticado', async () => {
    const transport = fakeTransport(() => user)
    await new Users(transport).me()
    expect(transport.calls[0]).toMatchObject({ method: 'GET', path: '/users/me' })
  })

  it('rejeita user_id com path traversal antes de chamar o transport', () => {
    const transport = fakeTransport(() => user)

    expect(() => new Users(transport).get('../../users/me')).toThrow(InputValidationError)
    expect(transport.calls).toHaveLength(0)
  })

  it('deve buscar um usuário pelo id', async () => {
    const transport = fakeTransport(() => user)
    await new Users(transport).get(42)
    expect(transport.calls[0]).toMatchObject({ path: '/users/42' })
  })
})
