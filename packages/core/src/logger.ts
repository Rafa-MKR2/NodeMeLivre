/** Contrato mínimo de logger estruturado. Compatível com pino e similares. */
export interface Logger {
  debug(obj?: unknown, msg?: string): void
  info(obj?: unknown, msg?: string): void
  warn(obj?: unknown, msg?: string): void
  error(obj?: unknown, msg?: string): void
}

/** Logger silencioso usado como padrão — o SDK não loga nada se não for configurado. */
export const silentLogger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
}

/**
 * Logger com deduplicação de mensagens repetidas.
 * Evita poluição de logs quando o mesmo erro ocorre múltiplas vezes.
 *
 * O cache de deduplicação tem vida limitada:
 * - Entradas expiradas são removidas periodicamente e o resumo dos logs
 *   suprimidos é emitido na expiração (observabilidade sem vazamento);
 * - Há um limite máximo de entradas (`maxEntries`) — mensagens únicas
 *   (ex.: `requestId`/`userId` diferentes) não podem crescer a memória sem
 *   limite em aplicações de alto throughput.
 */
export class DeduplicatingLogger implements Logger {
  private readonly logger: Logger
  private readonly windowMs: number
  private readonly maxRepeats: number
  private readonly maxEntries: number
  private readonly seen = new Map<
    string,
    { count: number; firstSeen: number; lastLogged: number; message: string }
  >()
  private cleanupTimer: ReturnType<typeof setInterval> | null = null

  constructor(
    logger: Logger,
    options: { windowMs?: number; maxRepeats?: number; maxEntries?: number } = {},
  ) {
    this.logger = logger
    this.windowMs = options.windowMs ?? 60_000 // 1 minuto
    this.maxRepeats = options.maxRepeats ?? 3
    this.maxEntries = options.maxEntries ?? 10_000
    this.startCleanupTimer()
  }

  private makeKey(level: string, message: string, context?: unknown): string {
    const ctxStr = context ? JSON.stringify(context) : ''
    return `${level}:${message}:${ctxStr}`
  }

  private shouldLog(key: string, message: string): boolean {
    const now = Date.now()
    const entry = this.seen.get(key)

    if (!entry) {
      this.evictIfNeeded()
      this.seen.set(key, { count: 1, firstSeen: now, lastLogged: now, message })
      return true
    }

    // Janela expirada: emite resumo do que foi suprimido e reinicia a contagem.
    // Usa `>=` — mesmo limite do cleanup periódico (semântica consistente).
    if (now - entry.firstSeen >= this.windowMs) {
      this.emitSummary(entry)
      this.seen.set(key, { count: 1, firstSeen: now, lastLogged: now, message: entry.message })
      return true
    }

    // Referências imutáveis: a entry é sempre substituída por um novo objeto,
    // nunca mutada no lugar — evita corridas de concorrência sobre o objeto
    // compartilhado no Map.
    const count = entry.count + 1
    this.seen.set(key, {
      count,
      firstSeen: entry.firstSeen,
      lastLogged: count <= this.maxRepeats ? now : entry.lastLogged,
      message: entry.message,
    })

    return count <= this.maxRepeats
  }

  debug(obj?: unknown, msg?: string): void {
    const message = msg ?? ''
    const key = this.makeKey('debug', message, obj)
    if (this.shouldLog(key, message)) this.logger.debug(obj, msg)
  }

  info(obj?: unknown, msg?: string): void {
    const message = msg ?? ''
    const key = this.makeKey('info', message, obj)
    if (this.shouldLog(key, message)) this.logger.info(obj, msg)
  }

  warn(obj?: unknown, msg?: string): void {
    const message = msg ?? ''
    const key = this.makeKey('warn', message, obj)
    if (this.shouldLog(key, message)) this.logger.warn(obj, msg)
  }

  error(obj?: unknown, msg?: string): void {
    const message = msg ?? ''
    const key = this.makeKey('error', message, obj)
    if (this.shouldLog(key, message)) this.logger.error(obj, msg)
  }

  /** Limpa o cache de deduplicação. */
  clear(): void {
    this.seen.clear()
  }

  /** Número de entradas no cache de deduplicação (observabilidade/debug). */
  get size(): number {
    return this.seen.size
  }

  /** Interrompe a limpeza periódica (liberação explícita de recursos). */
  stop(): void {
    if (this.cleanupTimer !== null) {
      clearInterval(this.cleanupTimer)
      this.cleanupTimer = null
    }
  }

  /**
   * Remove entradas expiradas, emitindo o resumo dos logs suprimidos — sem
   * isso, mensagens únicas acumulariam no Map indefinidamente (memory leak).
   */
  private cleanup(): void {
    const now = Date.now()
    for (const [key, entry] of this.seen.entries()) {
      if (now - entry.firstSeen >= this.windowMs) {
        this.emitSummary(entry)
        this.seen.delete(key)
      }
    }
  }

  /** Emite o resumo de logs suprimidos, se houve supressão na janela. */
  private emitSummary(entry: { count: number; message: string }): void {
    if (entry.count > this.maxRepeats) {
      this.logger.warn(
        { count: entry.count, message: entry.message },
        `Log repetido ${entry.count}x na última janela (suprimindo)`,
      )
    }
  }

  /**
   * Limite máximo de entradas no cache (hard cap à prova de throughput):
   * remove a entrada mais antiga (o Map preserva ordem de inserção).
   */
  private evictIfNeeded(): void {
    if (this.seen.size < this.maxEntries) return
    const oldest = this.seen.keys().next().value
    if (oldest !== undefined) this.seen.delete(oldest)
  }

  private startCleanupTimer(): void {
    this.cleanupTimer = setInterval(() => {
      this.cleanup()
    }, this.windowMs)
    // Não impede o processo de sair.
    if (this.cleanupTimer.unref) {
      this.cleanupTimer.unref()
    }
  }
}

/** Cria um logger console simples para desenvolvimento. */
export function createConsoleLogger(): Logger {
  return {
    debug(obj, msg) {
      console.debug(`[DEBUG] ${msg ?? ''}`, obj ?? '')
    },
    info(obj, msg) {
      console.info(`[INFO] ${msg ?? ''}`, obj ?? '')
    },
    warn(obj, msg) {
      console.warn(`[WARN] ${msg ?? ''}`, obj ?? '')
    },
    error(obj, msg) {
      console.error(`[ERROR] ${msg ?? ''}`, obj ?? '')
    },
  }
}
