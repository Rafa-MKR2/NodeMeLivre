import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type AccessToken, FileTokenStore, InMemoryTokenStore } from './token.js'

function token(overrides: Partial<AccessToken> = {}): AccessToken {
  return {
    accessToken: 'access-1',
    tokenType: 'bearer',
    scope: 'offline_access read write',
    userId: 123,
    expiresAt: Date.now() + 60_000,
    ...overrides,
  }
}

describe('InMemoryTokenStore', () => {
  it('deve começar vazio', async () => {
    const store = new InMemoryTokenStore()
    expect(await store.get()).toBeNull()
  })

  it('deve guardar e limpar o token', async () => {
    const store = new InMemoryTokenStore()
    await store.set(token())
    expect(await store.get()).toMatchObject({ accessToken: 'access-1' })
    await store.clear()
    expect(await store.get()).toBeNull()
  })
})

describe('FileTokenStore', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'nodemelivre-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('deve persistir o token em arquivo e ler de volta', async () => {
    const store = new FileTokenStore({ filePath: join(dir, 'token.json') })
    await store.set(token({ refreshToken: 'refresh-1' }))

    const read = await store.get()
    expect(read).toMatchObject({ accessToken: 'access-1', refreshToken: 'refresh-1' })
  })

  it('deve retornar null quando o arquivo não existe', async () => {
    const store = new FileTokenStore({ filePath: join(dir, 'nope.json') })
    expect(await store.get()).toBeNull()
  })

  it('deve limpar o arquivo ao chamar clear', async () => {
    const store = new FileTokenStore({ filePath: join(dir, 'token.json') })
    await store.set(token())
    await store.clear()
    expect(await store.get()).toBeNull()
  })

  it('deve retornar null para arquivo com conteúdo inválido', async () => {
    const store = new FileTokenStore({ filePath: join(dir, 'broken.json') })
    const { writeFile } = await import('node:fs/promises')
    await writeFile(join(dir, 'broken.json'), 'not json')
    expect(await store.get()).toBeNull()
  })
})
