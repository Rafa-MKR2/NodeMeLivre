import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

/** Token de acesso do Mercado Livre, com expiração já resolvida em epoch ms. */
export interface AccessToken {
  accessToken: string
  tokenType: 'bearer'
  scope: string
  userId: number
  /** Epoch ms em que o token expira. */
  expiresAt: number
  refreshToken?: string
}

/** Contrato de persistência do token. Permite plugar redis, banco, etc. */
export interface TokenStore {
  get(): Promise<AccessToken | null>
  set(token: AccessToken): Promise<void>
  clear(): Promise<void>
}

/** Armazena o token só em memória — some quando o processo reinicia. */
export class InMemoryTokenStore implements TokenStore {
  private token: AccessToken | null = null

  async get(): Promise<AccessToken | null> {
    return this.token
  }

  async set(token: AccessToken): Promise<void> {
    this.token = token
  }

  async clear(): Promise<void> {
    this.token = null
  }
}

export interface FileTokenStoreOptions {
  /** Caminho do arquivo de persistência. Padrão: `~/.nodemelivre/sdk-token.json`. */
  filePath?: string
}

/**
 * Persiste o token em arquivo JSON com permissão 0600.
 * Útil para CLIs e servidores single-instance.
 */
export class FileTokenStore implements TokenStore {
  private readonly filePath: string

  constructor(options: FileTokenStoreOptions = {}) {
    this.filePath = options.filePath ?? defaultTokenFilePath()
  }

  async get(): Promise<AccessToken | null> {
    try {
      const raw = await readFile(this.filePath, 'utf8')
      return parseToken(raw)
    } catch (error) {
      if (isFileNotFound(error)) return null
      throw error
    }
  }

  async set(token: AccessToken): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true })
    await writeFile(this.filePath, JSON.stringify(token, null, 2), {
      mode: 0o600,
      encoding: 'utf8',
    })
  }

  async clear(): Promise<void> {
    try {
      await rm(this.filePath)
    } catch (error) {
      if (!isFileNotFound(error)) throw error
    }
  }
}

function defaultTokenFilePath(): string {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? '.'
  return `${home}/.nodemelivre/sdk-token.json`
}

function isAccessToken(value: unknown): value is AccessToken {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return (
    typeof record.accessToken === 'string' &&
    record.tokenType === 'bearer' &&
    typeof record.scope === 'string' &&
    typeof record.userId === 'number' &&
    typeof record.expiresAt === 'number'
  )
}

/** Lê o JSON e devolve null se o conteúdo for inválido. */
function parseToken(raw: string): AccessToken | null {
  try {
    const parsed = JSON.parse(raw) as unknown
    return isAccessToken(parsed) ? parsed : null
  } catch {
    return null
  }
}

function isFileNotFound(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}
