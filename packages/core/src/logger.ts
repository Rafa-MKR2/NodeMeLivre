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
    { count: number; firstSeen: number; lastLogged: number; message: string }
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

  private shouldLog(key: string, message: string): boolean {
    const now = Date.now()
    const entry = this.seen.get(key)

    if (!entry) {
      this.seen.set(key, { count: 1, firstSeen: now, lastLogged: now, message })
      return true
    }

    // Janela expirada: emite resumo do que foi suprimido e reinicia a contagem.
    if (now - entry.firstSeen > this.windowMs) {
      if (entry.count > this.maxRepeats) {
        this.logger.warn(
          { count: entry.count, message: entry.message },
          `Log repetido ${entry.count}x na última janela (suprimindo)`,
        )
      }
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
