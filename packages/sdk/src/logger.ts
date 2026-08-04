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
