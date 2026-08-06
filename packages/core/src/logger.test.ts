import { describe, expect, it, vi } from 'vitest'
import { createConsoleLogger, DeduplicatingLogger, silentLogger } from './logger.js'

describe('DeduplicatingLogger', () => {
  it('deve registrar a primeira ocorrência de cada mensagem', () => {
    const inner = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const logger = new DeduplicatingLogger(inner, { maxRepeats: 1 })

    logger.error({ err: 'a' }, 'falhou')
    logger.error({ err: 'a' }, 'falhou')

    expect(inner.error).toHaveBeenCalledTimes(1)
  })

  it('deve registrar até maxRepeats repetições', () => {
    const inner = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const logger = new DeduplicatingLogger(inner, { maxRepeats: 3 })

    for (let i = 0; i < 5; i++) {
      logger.warn('algo repetido')
    }

    expect(inner.warn).toHaveBeenCalledTimes(3)
  })

  it('deve diferenciar mensagens por nível e contexto', () => {
    const inner = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const logger = new DeduplicatingLogger(inner)

    logger.error({ id: 1 }, 'mesma mensagem')
    logger.warn({ id: 1 }, 'mesma mensagem')
    logger.error({ id: 2 }, 'mesma mensagem')

    expect(inner.error).toHaveBeenCalledTimes(2)
    expect(inner.warn).toHaveBeenCalledTimes(1)
  })

  it('deve resetar o cache no clear', () => {
    const inner = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const logger = new DeduplicatingLogger(inner)

    logger.error('x')
    logger.clear()
    logger.error('x')

    expect(inner.error).toHaveBeenCalledTimes(2)
  })

  it('deve emitir resumo periódico para logs suprimidos', () => {
    vi.useFakeTimers()
    try {
      const inner = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
      const logger = new DeduplicatingLogger(inner, { maxRepeats: 1, windowMs: 1_000 })

      logger.error('repete')
      logger.error('repete')
      logger.error('repete')
      expect(inner.error).toHaveBeenCalledTimes(1)

      vi.advanceTimersByTime(1_001)
      logger.error('repete')

      expect(inner.warn).toHaveBeenCalledTimes(1)
      expect(inner.warn.mock.calls[0]?.[0]).toMatchObject({ count: 3 })
      expect(inner.error).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('deve manter a mensagem original no resumo (inclusive com dois-pontos)', () => {
    vi.useFakeTimers()
    try {
      const inner = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
      const logger = new DeduplicatingLogger(inner, { maxRepeats: 1, windowMs: 1_000 })

      logger.error({}, 'falhou: conexão recusada')
      logger.error({}, 'falhou: conexão recusada')
      logger.error({}, 'falhou: conexão recusada')

      vi.advanceTimersByTime(1_001)
      logger.error({}, 'falhou: conexão recusada')

      expect(inner.warn.mock.calls[0]?.[0]).toMatchObject({
        count: 3,
        message: 'falhou: conexão recusada',
      })
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('createConsoleLogger', () => {
  it('deve expor os quatro níveis', () => {
    const logger = createConsoleLogger()
    expect(typeof logger.debug).toBe('function')
    expect(typeof logger.info).toBe('function')
    expect(typeof logger.warn).toBe('function')
    expect(typeof logger.error).toBe('function')
  })
})

describe('silentLogger', () => {
  it('não deve lançar em nenhum nível', () => {
    silentLogger.debug({}, 'm')
    silentLogger.info({}, 'm')
    silentLogger.warn({}, 'm')
    silentLogger.error({}, 'm')
  })
})
