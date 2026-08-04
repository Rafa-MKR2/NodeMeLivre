import type { User } from '../types/user.js'
import type { ResourceTransport } from './transport.js'

/** Recursos de usuários. */
export class Users {
  constructor(private readonly transport: ResourceTransport) {}

  /** Dados do vendedor autenticado. */
  me(): Promise<User> {
    return this.transport.get('/users/me')
  }

  /** Dados públicos de um usuário. */
  get(userId: number | string): Promise<User> {
    return this.transport.get(`/users/${userId}`)
  }
}
