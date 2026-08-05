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
 */
export class DeduplicatingLogger implements Logger {
  private readonly logger: Logger
  private readonly windowMs: number
  private readonly maxRepeats: number
  private readonly seen = new Map<
    string,
    { count: number; firstSeen: number; lastLogged: number }
  >()

  constructor(logger: Logger, options: { windowMs?: number; maxRepeats?: number } = {}) {
    this.logger = logger
    this.windowMs = options.windowMs ?? 60_000 // 1 minuto
    this.maxRepeats = options.maxRepeats ?? 3
  }

  private makeKey(level: string, message: string, context?: unknown): string {
    const ctxStr = context ? JSON.stringify(context) : ''
    return `${level}:${message}:${ctxStr}`
  }

  private shouldLog(key: string): boolean {
    const now = Date.now()
    const entry = this.seen.get(key)

    if (!entry) {
      this.seen.set(key, { count: 1, firstSeen: now, lastLogged: now })
      return true
    }

    // Limpa entradas antigas
    if (now - entry.firstSeen > this.windowMs) {
      this.seen.set(key, { count: 1, firstSeen: now, lastLogged: now })
      return true
    }

    entry.count++

    // Loga nas primeiras N vezes, depois a cada janela
    if (entry.count <= this.maxRepeats) {
      entry.lastLogged = now
      return true
    }

    // Loga resumo periodicamente
    if (now - entry.lastLogged > this.windowMs) {
      this.logger.warn(
        { count: entry.count, message: key.split(':').slice(1).join(':') },
        `Log repetido ${entry.count}x na última janela (suprimindo)`,
      )
      entry.lastLogged = now
    }

    return false
  }

  debug(obj?: unknown, msg?: string): void {
    const key = this.makeKey('debug', msg ?? '', obj)
    if (this.shouldLog(key)) this.logger.debug(obj, msg)
  }

  info(obj?: unknown, msg?: string): void {
    const key = this.makeKey('info', msg ?? '', obj)
    if (this.shouldLog(key)) this.logger.info(obj, msg)
  }

  warn(obj?: unknown, msg?: string): void {
    const key = this.makeKey('warn', msg ?? '', obj)
    if (this.shouldLog(key)) this.logger.warn(obj, msg)
  }

  error(obj?: unknown, msg?: string): void {
    const key = this.makeKey('error', msg ?? '', obj)
    if (this.shouldLog(key)) this.logger.error(obj, msg)
  }

  /** Limpa o cache de deduplicação. */
  clear(): void {
    this.seen.clear()
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
