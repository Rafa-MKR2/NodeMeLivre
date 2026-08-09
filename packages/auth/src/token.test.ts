import { chmod, mkdtemp, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { OAuthError } from '@nodemelivre/errors'
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

  it('set() incrementa a versão (monotônica — mesmo contrato do FileTokenStore, Rodada 9)', async () => {
    const store = new InMemoryTokenStore()
    await store.compareAndSet(token({ accessToken: 'v1' }), null) // versão 1
    await store.compareAndSet(token({ accessToken: 'v2' }), null) // versão 2

    // O código antigo RESETAVA a versão para 1 aqui (createVersioned default),
    // regredindo o contador e quebrando CAS concorrentes que esperavam v2.
    await store.set(token({ accessToken: 'v3' }))
    const after = await store.getWithVersion()
    expect(after?.version).toBe(3)
    expect(after?.token.accessToken).toBe('v3')
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

  it('clear também remove o backup (.bak) — sem vazar segredo (O8)', async () => {
    const filePath = join(dir, 'token.json')
    const store = new FileTokenStore({ filePath })
    await store.set(token({ accessToken: 'segredo' }))

    await expect(stat(`${filePath}.bak`)).resolves.toBeDefined()
    await store.clear()

    await expect(stat(filePath)).rejects.toThrow()
    await expect(stat(`${filePath}.bak`)).rejects.toThrow()
  })

  it('escreve token/backup com 0600 e diretório com 0700 (segredo em disco)', async () => {
    const filePath = join(dir, 'sub', 'token.json')
    const store = new FileTokenStore({ filePath })
    await store.set(token({ accessToken: 'segredo' }))

    const mode = (p: string) => stat(p).then((s) => s.mode & 0o777)
    await expect(mode(filePath)).resolves.toBe(0o600)
    await expect(mode(`${filePath}.bak`)).resolves.toBe(0o600)
    await expect(mode(join(dir, 'sub'))).resolves.toBe(0o700)
  })

  it('re-permissiona backup pré-existente com permissão frouxa (0644 → 0600)', async () => {
    const filePath = join(dir, 'token.json')
    const store = new FileTokenStore({ filePath })
    await store.set(token({ accessToken: 'primeiro' }))

    // Simula um backup legado com permissão frouxa (como se criado antes do
    // hardening): a próxima escrita re-permissiona para 0600.
    await chmod(`${filePath}.bak`, 0o644)

    await store.set(token({ accessToken: 'segundo' }))

    const mode = (await stat(`${filePath}.bak`)).mode & 0o777
    expect(mode).toBe(0o600)
  })

  it('get() com principal corrompido serve o backup SEM reescrever o principal (O1)', async () => {
    const filePath = join(dir, 'token.json')
    const store = new FileTokenStore({ filePath })
    await store.set(token({ accessToken: 'access-backup' }))

    // Corrompe o arquivo principal; o backup continua íntegro.
    const { writeFile } = await import('node:fs/promises')
    await writeFile(filePath, 'corrompido {{')

    const read = await store.get()
    expect(read).toMatchObject({ accessToken: 'access-backup' })

    // A leitura NÃO reescreve o principal (só a próxima escrita, sob lock, repara).
    const after = await import('node:fs/promises')
    expect(await after.readFile(filePath, 'utf8')).toBe('corrompido {{')

    // A próxima escrita repara o arquivo (atômico, sob lock).
    await store.set(token({ accessToken: 'access-novo' }))
    expect((await store.get())?.accessToken).toBe('access-novo')
  })

  it('deve retornar null para arquivo com conteúdo inválido', async () => {
    const store = new FileTokenStore({ filePath: join(dir, 'broken.json') })
    const { writeFile } = await import('node:fs/promises')
    await writeFile(join(dir, 'broken.json'), 'not json')
    expect(await store.get()).toBeNull()
  })

  it('migra arquivo legacy v1 (AccessToken direto) para versionado (M1, pente fino)', async () => {
    // Um token v1 (pré-versionamento) é um JSON VÁLIDO que não bate a shape
    // de `VersionedToken` — o fallback legacy só rodava quando o JSON.parse
    // LANÇAVA, então um token v1 legítimo era silenciosamente descartado
    // (perda de token na migração) e o usuário era forçado a re-autenticar.
    const filePath = join(dir, 'legacy.json')
    const legacy = token({ accessToken: 'access-legacy' })
    const { writeFile } = await import('node:fs/promises')
    await writeFile(filePath, JSON.stringify(legacy))

    const store = new FileTokenStore({ filePath })
    const versioned = await store.getWithVersion()
    expect(versioned).not.toBeNull()
    expect(versioned?.token.accessToken).toBe('access-legacy')
    expect(versioned?.version).toBe(1)
    expect((await store.get())?.accessToken).toBe('access-legacy')
  })

  it('deve escrever token e lease com permissão 0o600 (disciplina de segredos)', async () => {
    const filePath = join(dir, 'token.json')
    const store = new FileTokenStore({ filePath })

    await store.set(token())
    await store.acquireLease({ holderId: 'h1' })

    const tokenMode = (await stat(filePath)).mode & 0o777
    expect(tokenMode).toBe(0o600)

    // O lease não contém segredo, mas segue a mesma disciplina (Rodada 6).
    const leaseMode = (await stat(`${filePath}.lease`)).mode & 0o777
    expect(leaseMode).toBe(0o600)
  })

  it('deve assumir lock órfão (stale) e prosseguir (ACHADO 32)', async () => {
    const filePath = join(dir, 'token.json')
    const lockPath = `${filePath}.lock`
    // Simula crash: .lock deixado para trás por um processo morto.
    await writeFile(lockPath, JSON.stringify({ createdAt: 0 }))
    const old = (Date.now() - 60_000) / 1000 // 60s atrás
    await utimes(lockPath, old, old)

    const store = new FileTokenStore({ filePath })
    await store.set(token()) // não deve travar nem lançar

    expect(await store.get()).toMatchObject({ accessToken: 'access-1' })
    // O lock órfão foi removido e um novo foi adquirido/releaseado.
    await expect(stat(lockPath)).rejects.toThrow()
  })

  it('deve lançar OAuthError ao estourar o timeout de lock (anti-deadlock) (ACHADO 32)', async () => {
    const filePath = join(dir, 'token.json')
    const lockPath = `${filePath}.lock`
    // Lock "vivo" (mtime recente): não é stale, então não é assumido.
    await writeFile(lockPath, JSON.stringify({ createdAt: Date.now() }))

    const store = new FileTokenStore({ filePath, lockTimeoutMs: 50, lockStaleMs: 60_000 })
    const err = await store.set(token()).catch((e) => e)
    expect(err).toBeInstanceOf(OAuthError)
  })
})
