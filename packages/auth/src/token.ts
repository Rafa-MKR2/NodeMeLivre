import { createHash } from 'node:crypto'
import type { FileHandle } from 'node:fs/promises'
import { constants, mkdir, open, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { OAuthError } from '@nodemelivre/errors'

/** Idade máxima de um lock órfão antes de ser assumido (mesma política de TTL do lease). */
const LOCK_STALE_MS = 30_000
/** Tempo máximo esperando por um lock ocupado (anti-deadlock). */
const LOCK_ACQUIRE_TIMEOUT_MS = 15_000

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

/** Token com metadados de versão para controle de concorrência otimista. */
export interface VersionedToken {
  token: AccessToken
  /** Versão monotônica (incrementada a cada write bem-sucedido). */
  version: number
  /** Timestamp da última atualização. */
  updatedAt: number
  /** Checksum SHA-256 do token para detecção de corrupção. */
  checksum: string
}

/** Opções de lease para operações atômicas. */
export interface TokenLeaseOptions {
  /** Duração do lease em ms (padrão: 30s). */
  ttlMs?: number
  /** Identificador único do holder do lease. */
  holderId: string
}

/** Resultado de tentativa de aquisição de lease. */
export interface LeaseResult {
  /** Se o lease foi adquirido. */
  acquired: boolean
  /** Token atual (se adquirido ou se já existia). */
  token: VersionedToken | null
  /** Tempo restante do lease em ms. */
  leaseExpiresAt: number | null
}

/** Contrato de persistência do token v2 com versionamento e atomicidade. */
export interface TokenStore {
  /** Obtém o token atual sem metadados de versão (compatibilidade v1). */
  get(): Promise<AccessToken | null>
  /** Obtém o token com metadados de versão. */
  getWithVersion(): Promise<VersionedToken | null>
  /**
   * Define o token atomicamente com compare-and-set.
   * @param token Novo token a armazenar
   * @param expectedVersion Versão esperada (null = primeira escrita, 0 = só se não existir)
   * @returns Nova versão se bem-sucedido, null se falhou (conflito de versão)
   */
  compareAndSet(token: AccessToken, expectedVersion: number | null): Promise<number | null>
  /** Define o token (sobrescreve) — para compatibilidade v1. */
  set(token: AccessToken): Promise<void>
  /** Remove o token. */
  clear(): Promise<void>
  /**
   * Adquire lease exclusivo para operações de refresh.
   * Previne múltiplos refreshes concorrentes em multi-instância.
   */
  acquireLease(options: TokenLeaseOptions): Promise<LeaseResult>
  /** Renova lease existente. */
  renewLease(holderId: string, ttlMs: number): Promise<boolean>
  /** Libera lease. */
  releaseLease(holderId: string): Promise<void>
}

/** Opções do store em memória. */
export interface InMemoryTokenStoreOptions {
  /** Clock injetável — usado no `updatedAt` e no lease (padrão: `Date.now`). */
  clock?: () => number
}

/** Armazena o token só em memória — some quando o processo reinicia. */
export class InMemoryTokenStore implements TokenStore {
  private readonly clock: () => number
  private token: VersionedToken | null = null
  private leaseHolder: { holderId: string; expiresAt: number } | null = null

  constructor(options: InMemoryTokenStoreOptions = {}) {
    this.clock = options.clock ?? Date.now
  }

  async get(): Promise<AccessToken | null> {
    return this.token?.token ?? null
  }

  async getWithVersion(): Promise<VersionedToken | null> {
    return this.token
  }

  async compareAndSet(token: AccessToken, expectedVersion: number | null): Promise<number | null> {
    if (expectedVersion === null) {
      // Primeira escrita ou força sobrescrita — incrementa da versão atual
      // (mesmo comportamento do FileTokenStore: a versão nunca regride).
      this.token = this.createVersioned(token, (this.token?.version ?? 0) + 1)
      return this.token.version
    }
    if (this.token === null) {
      if (expectedVersion === 0) {
        this.token = this.createVersioned(token)
        return this.token.version
      }
      return null // Esperava vazio mas não está
    }
    if (this.token.version !== expectedVersion) {
      return null // Conflito de versão
    }
    this.token = this.createVersioned(token, this.token.version + 1)
    return this.token.version
  }

  async set(token: AccessToken): Promise<void> {
    // Mesmo contrato do FileTokenStore (Rodada 9): `set` é sobrescrita, mas a
    // versão é MONOTÔNICA — nunca regride. O código antigo chamava
    // `createVersioned(token)` com default `version = 1`, RESETANDO o contador
    // após um `compareAndSet` chegar a 2+; um CAS que esperava a versão antiga
    // podia aceitar (ou rejeitar) escritas com base em uma versão regredida.
    this.token = this.createVersioned(token, (this.token?.version ?? 0) + 1)
  }

  async clear(): Promise<void> {
    this.token = null
    this.leaseHolder = null
  }

  async acquireLease(options: TokenLeaseOptions): Promise<LeaseResult> {
    const now = this.clock()
    const ttlMs = options.ttlMs ?? 30_000
    const expiresAt = now + ttlMs

    // Verifica se já há lease válido de outro holder
    if (
      this.leaseHolder &&
      this.leaseHolder.expiresAt > now &&
      this.leaseHolder.holderId !== options.holderId
    ) {
      return {
        acquired: false,
        token: this.token,
        leaseExpiresAt: this.leaseHolder.expiresAt,
      }
    }

    this.leaseHolder = { holderId: options.holderId, expiresAt }
    return {
      acquired: true,
      token: this.token,
      leaseExpiresAt: expiresAt,
    }
  }

  async renewLease(holderId: string, ttlMs: number): Promise<boolean> {
    const now = this.clock()
    if (
      this.leaseHolder &&
      this.leaseHolder.holderId === holderId &&
      this.leaseHolder.expiresAt > now
    ) {
      this.leaseHolder.expiresAt = now + ttlMs
      return true
    }
    return false
  }

  async releaseLease(holderId: string): Promise<void> {
    if (this.leaseHolder && this.leaseHolder.holderId === holderId) {
      this.leaseHolder = null
    }
  }

  private createVersioned(token: AccessToken, version = 1): VersionedToken {
    const json = JSON.stringify(token)
    return {
      token,
      version,
      updatedAt: this.clock(),
      checksum: createHash('sha256').update(json).digest('hex'),
    }
  }
}

export interface FileTokenStoreOptions {
  /** Caminho do arquivo de persistência. Padrão: `~/.nodemelivre/sdk-token.json`. */
  filePath?: string
  /** Idade máxima de um lock órfão antes de ser assumido. Padrão: 30s (mesma política do lease). */
  lockStaleMs?: number
  /** Tempo máximo esperando por um lock ocupado. Padrão: 15s. */
  lockTimeoutMs?: number
  /** Clock injetável — usado no `updatedAt` e no lease (padrão: `Date.now`). */
  clock?: () => number
}

/**
 * Persiste o token em arquivo JSON com escrita atômica, file locking e checksum.
 * v2: Suporte a versionamento otimista (compareAndSet) e lease para refresh concorrente.
 */
export class FileTokenStore implements TokenStore {
  private readonly filePath: string
  private readonly backupPath: string
  private readonly lockPath: string
  private readonly leasePath: string
  private readonly lockStaleMs: number
  private readonly lockTimeoutMs: number
  private readonly clock: () => number

  constructor(options: FileTokenStoreOptions = {}) {
    this.filePath = options.filePath ?? defaultTokenFilePath()
    this.backupPath = `${this.filePath}.bak`
    this.lockPath = `${this.filePath}.lock`
    this.leasePath = `${this.filePath}.lease`
    this.lockStaleMs = options.lockStaleMs ?? LOCK_STALE_MS
    this.lockTimeoutMs = options.lockTimeoutMs ?? LOCK_ACQUIRE_TIMEOUT_MS
    this.clock = options.clock ?? Date.now
  }

  async get(): Promise<AccessToken | null> {
    const versioned = await this.getWithVersion()
    return versioned?.token ?? null
  }

  async getWithVersion(): Promise<VersionedToken | null> {
    try {
      const raw = await readFile(this.filePath, 'utf8')
      const parsed = this.parseVersionedToken(raw)
      if (!parsed) {
        // Arquivo corrompido ou vazio — tenta backup
        return this.readBackup()
      }
      // Verifica checksum
      if (!this.verifyChecksum(parsed)) {
        // Token corrompido — tenta ler backup
        return this.readBackup()
      }
      return parsed
    } catch (error) {
      if (isFileNotFound(error)) return null
      throw error
    }
  }

  async compareAndSet(token: AccessToken, expectedVersion: number | null): Promise<number | null> {
    const lock = await this.acquireLock()
    try {
      const current = await this.getWithVersionUnlocked()

      if (expectedVersion === null) {
        // Primeira escrita ou força sobrescrita
        const versioned = this.createVersioned(token, (current?.version ?? 0) + 1)
        await this.writeVersionedUnlocked(versioned)
        return versioned.version
      }

      if (current === null) {
        if (expectedVersion === 0) {
          const versioned = this.createVersioned(token, 1)
          await this.writeVersionedUnlocked(versioned)
          return 1
        }
        return null
      }

      if (current.version !== expectedVersion) {
        return null // Conflito de versão
      }

      const versioned = this.createVersioned(token, current.version + 1)
      await this.writeVersionedUnlocked(versioned)
      return versioned.version
    } finally {
      await this.releaseLock(lock)
    }
  }

  async set(token: AccessToken): Promise<void> {
    const lock = await this.acquireLock()
    try {
      const current = await this.getWithVersionUnlocked()
      const versioned = this.createVersioned(token, (current?.version ?? 0) + 1)
      await this.writeVersionedUnlocked(versioned)
    } finally {
      await this.releaseLock(lock)
    }
  }

  async clear(): Promise<void> {
    const lock = await this.acquireLock()
    try {
      await rm(this.filePath, { force: true })
      await rm(this.backupPath, { force: true })
      await rm(this.leasePath, { force: true })
    } finally {
      await this.releaseLock(lock)
    }
  }

  async acquireLease(options: TokenLeaseOptions): Promise<LeaseResult> {
    const lock = await this.acquireLock()
    try {
      const now = this.clock()
      const ttlMs = options.ttlMs ?? 30_000
      const expiresAt = now + ttlMs

      // Lê lease atual
      let currentLease: { holderId: string; expiresAt: number } | null = null
      try {
        const leaseRaw = await readFile(this.leasePath, 'utf8')
        currentLease = JSON.parse(leaseRaw)
      } catch {
        // Ignora se não existe
      }

      // Verifica se já há lease válido de outro holder
      if (
        currentLease &&
        currentLease.expiresAt > now &&
        currentLease.holderId !== options.holderId
      ) {
        const token = await this.getWithVersionUnlocked()
        return {
          acquired: false,
          token,
          leaseExpiresAt: currentLease.expiresAt,
        }
      }

      // Escreve novo lease
      await writeFile(this.leasePath, JSON.stringify({ holderId: options.holderId, expiresAt }), {
        encoding: 'utf8',
        mode: 0o600,
      })

      const token = await this.getWithVersionUnlocked()
      return {
        acquired: true,
        token,
        leaseExpiresAt: expiresAt,
      }
    } finally {
      await this.releaseLock(lock)
    }
  }

  async renewLease(holderId: string, ttlMs: number): Promise<boolean> {
    const lock = await this.acquireLock()
    try {
      const now = this.clock()
      let currentLease: { holderId: string; expiresAt: number } | null = null
      try {
        const leaseRaw = await readFile(this.leasePath, 'utf8')
        currentLease = JSON.parse(leaseRaw)
      } catch {
        return false
      }

      if (currentLease && currentLease.holderId === holderId && currentLease.expiresAt > now) {
        currentLease.expiresAt = now + ttlMs
        await writeFile(this.leasePath, JSON.stringify(currentLease), {
          encoding: 'utf8',
          mode: 0o600,
        })
        return true
      }
      return false
    } finally {
      await this.releaseLock(lock)
    }
  }

  async releaseLease(holderId: string): Promise<void> {
    const lock = await this.acquireLock()
    try {
      let currentLease: { holderId: string; expiresAt: number } | null = null
      try {
        const leaseRaw = await readFile(this.leasePath, 'utf8')
        currentLease = JSON.parse(leaseRaw)
      } catch {
        return
      }
      if (currentLease && currentLease.holderId === holderId) {
        await rm(this.leasePath, { force: true })
      }
    } finally {
      await this.releaseLock(lock)
    }
  }

  /**
   * Adquire lock de arquivo (cross-platform usando O_EXCL).
   *
   * Recuperação de lock órfão (ACHADO 32, Rodada 8): um crash (SIGKILL/OOM/
   * deploy) deixava o `.lock` para trás e o antigo `while(true)` girava para
   * sempre em `EEXIST` — deadlock permanente de TODAS as operações de token.
   * Agora: (1) locks com idade > `LOCK_STALE_MS` são assumidos como mortos
   * (mesma política de TTL do lease) e removidos antes de tentar de novo;
   * (2) a espera total é limitada por `LOCK_ACQUIRE_TIMEOUT_MS` — ao estourar,
   * lança `OAuthError` em vez de girar infinitamente.
   */
  private async acquireLock(): Promise<FileHandle> {
    await mkdir(dirname(this.lockPath), { recursive: true })
    const startedAt = Date.now()
    for (;;) {
      try {
        const fd = await open(
          this.lockPath,
          constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
          0o600,
        )
        // Marca o lock com o timestamp de criação (diagnóstico/debug). A
        // detecção de stale usa o mtime do arquivo — robusto até para locks
        // vazios deixados por versões antigas do SDK.
        await fd.writeFile(JSON.stringify({ createdAt: Date.now() }), { encoding: 'utf8' })
        return fd
      } catch (error: unknown) {
        if (!(error instanceof Error) || !('code' in error) || error.code !== 'EEXIST') {
          throw error
        }
        // Anti-deadlock: nunca girar para sempre por um lock ocupado.
        if (Date.now() - startedAt >= this.lockTimeoutMs) {
          throw new OAuthError(
            'lock_acquire_timeout',
            `Não foi possível adquirir o lock de token em ${this.lockTimeoutMs}ms (${this.lockPath})`,
          )
        }
        // Lock órfão (idade > TTL): assume como morto e remove antes de tentar de novo.
        if (await this.isLockStale()) {
          await rm(this.lockPath, { force: true })
          continue
        }
        // Lock ocupado por um processo vivo: aguarda um pouco e tenta novamente.
        await new Promise((r) => setTimeout(r, 10))
      }
    }
  }

  /** `true` se o lock existir e estiver órfão (mtime mais velho que o TTL). */
  private async isLockStale(): Promise<boolean> {
    try {
      const info = await stat(this.lockPath)
      return Date.now() - info.mtimeMs > this.lockStaleMs
    } catch {
      // Lock removido entre o EEXIST e o stat (ou já assumido) — não é stale.
      return false
    }
  }

  /** Libera lock de arquivo. */
  private async releaseLock(fd: FileHandle): Promise<void> {
    try {
      await fd.close()
    } catch {
      // Ignora
    }
    try {
      await rm(this.lockPath, { force: true })
    } catch {
      // Ignora
    }
  }

  /** Lê token versionado sem lock (chamado dentro de lock). */
  private async getWithVersionUnlocked(): Promise<VersionedToken | null> {
    try {
      const raw = await readFile(this.filePath, 'utf8')
      return this.parseVersionedToken(raw)
    } catch {
      return null
    }
  }

  /** Escreve token versionado atomicamente (temp + rename). */
  private async writeVersionedUnlocked(versioned: VersionedToken): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true })
    const tempPath = `${this.filePath}.tmp`
    const json = JSON.stringify(versioned, null, 2)
    await writeFile(tempPath, json, { encoding: 'utf8', mode: 0o600 })
    // Atomic rename (POSIX e Windows)
    await import('node:fs/promises').then((fs) => fs.rename(tempPath, this.filePath))
    // Cria backup para recuperação de corrupção
    await writeFile(this.backupPath, json, { encoding: 'utf8', mode: 0o600 })
  }

  /**
   * Tenta ler backup em caso de corrupção.
   *
   * O1 (Rodada 8): o restore do arquivo principal é feito APENAS sob lock na
   * próxima escrita — esta leitura é lock-free e NUNCA reescreve o arquivo.
   * Reescrever aqui criaria uma corrida com uma escrita concorrente (que tem
   * o lock), podendo regredir um token recém-gravado para o estado antigo do
   * backup. Sem o restore, leituras seguintes continuam servindo o backup até
   * a próxima escrita reparar o arquivo (as escritas sobrescrevem com atômico).
   */
  private async readBackup(): Promise<VersionedToken | null> {
    try {
      const raw = await readFile(this.backupPath, 'utf8')
      const parsed = this.parseVersionedToken(raw)
      if (parsed && this.verifyChecksum(parsed)) {
        return parsed
      }
    } catch {
      // Backup não existe ou corrompido
    }
    return null
  }

  private createVersioned(token: AccessToken, version = 1): VersionedToken {
    const json = JSON.stringify(token)
    return {
      token,
      version,
      updatedAt: this.clock(),
      checksum: createHash('sha256').update(json).digest('hex'),
    }
  }

  private parseVersionedToken(raw: string): VersionedToken | null {
    let parsed: unknown
    try {
      parsed = JSON.parse(raw) as unknown
    } catch {
      return null
    }
    if (isVersionedToken(parsed)) return parsed
    // Formato legacy (v1): o arquivo é um `AccessToken` direto (sem
    // versionamento). O fallback legacy só rodava quando o `JSON.parse`
    // LANÇAVA — um token v1 legítimo (JSON válido que não bate a shape de
    // `VersionedToken`) caía em `return null` e o token era silenciosamente
    // descartado na migração (M1, pente fino).
    const legacy = parseToken(raw)
    if (legacy) {
      return this.createVersioned(legacy, 1)
    }
    return null
  }

  private verifyChecksum(versioned: VersionedToken): boolean {
    const json = JSON.stringify(versioned.token)
    const expected = createHash('sha256').update(json).digest('hex')
    return expected === versioned.checksum
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

/** Distingue o formato versionado (v2) do legacy (v1, `AccessToken` direto). */
function isVersionedToken(value: unknown): value is VersionedToken {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return (
    typeof record.version === 'number' &&
    typeof record.updatedAt === 'number' &&
    typeof record.checksum === 'string' &&
    typeof record.token === 'object' &&
    record.token !== null &&
    isAccessToken(record.token)
  )
}

/** Lê o JSON e devolve null se o conteúdo for inválido (formato legacy). */
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
