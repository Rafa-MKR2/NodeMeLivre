import { fakeTransport } from '@nodemelivre/core/test-utils'
import { describe, expect, it } from 'vitest'
import { Users } from './users.js'

const user = { id: 42, nickname: 'vendedor' }

describe('Users', () => {
  it('deve buscar o usuário autenticado', async () => {
    const transport = fakeTransport(() => user)
    await new Users(transport).me()
    expect(transport.calls[0]).toMatchObject({ method: 'GET', path: '/users/me' })
  })

  it('deve buscar um usuário pelo id', async () => {
    const transport = fakeTransport(() => user)
    await new Users(transport).get(42)
    expect(transport.calls[0]).toMatchObject({ path: '/users/42' })
  })
})
