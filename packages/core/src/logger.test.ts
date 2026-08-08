import { describe, expect, it, vi } from 'vitest'
import { createConsoleLogger, DeduplicatingLogger, silentLogger } from './logger.js'

describe('DeduplicatingLogger', () => {
  it('deve registrar a primeira ocorrência de cada mensagem', () => {
    const inner = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const logger = new DeduplicatingLogger(inner, { maxRepeats: 1 })

    logger.error({ err: 'a' }, 'falhou')
    logger.error({ err: 'a' }, 'falhou')

    expect(inner.error).toHaveBeenCalledTimes(1)
    logger.stop()
  })

  it('deve registrar até maxRepeats repetições', () => {
    const inner = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const logger = new DeduplicatingLogger(inner, { maxRepeats: 3 })

    for (let i = 0; i < 5; i++) {
      logger.warn('algo repetido')
    }

    expect(inner.warn).toHaveBeenCalledTimes(3)
    logger.stop()
  })

  it('deve diferenciar mensagens por nível e contexto', () => {
    const inner = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const logger = new DeduplicatingLogger(inner)

    logger.error({ id: 1 }, 'mesma mensagem')
    logger.warn({ id: 1 }, 'mesma mensagem')
    logger.error({ id: 2 }, 'mesma mensagem')

    expect(inner.error).toHaveBeenCalledTimes(2)
    expect(inner.warn).toHaveBeenCalledTimes(1)
    logger.stop()
  })

  it('deve resetar o cache no clear', () => {
    const inner = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const logger = new DeduplicatingLogger(inner)

    logger.error('x')
    logger.clear()
    logger.error('x')

    expect(inner.error).toHaveBeenCalledTimes(2)
    logger.stop()
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

  it('deve remover entradas expiradas no cleanup periódico (sem memory leak)', () => {
    vi.useFakeTimers()
    try {
      const inner = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
      const logger = new DeduplicatingLogger(inner, { windowMs: 1_000 })

      logger.error('unica-1')
      logger.error('unica-2')
      expect(logger.size).toBe(2)

      vi.advanceTimersByTime(1_001)

      expect(logger.size).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('deve respeitar o limite máximo de entradas (maxEntries)', () => {
    const inner = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const logger = new DeduplicatingLogger(inner, { windowMs: 60_000, maxEntries: 2 })

    logger.info('m1')
    logger.info('m2')
    logger.info('m3') // remove a mais antiga (m1)
    expect(logger.size).toBe(2)

    logger.info('m1') // entrada removida → conta como nova
    expect(inner.info).toHaveBeenCalledTimes(4)
    logger.stop()
  })

  it('deve emitir o resumo na expiração periódica dos logs suprimidos', () => {
    vi.useFakeTimers()
    try {
      const inner = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
      const logger = new DeduplicatingLogger(inner, { maxRepeats: 1, windowMs: 1_000 })

      logger.error('expira')
      logger.error('expira')
      logger.error('expira')
      expect(inner.warn).not.toHaveBeenCalled()

      vi.advanceTimersByTime(1_001)

      expect(inner.warn).toHaveBeenCalledTimes(1)
      expect(inner.warn.mock.calls[0]?.[0]).toMatchObject({ count: 3 })
    } finally {
      vi.useRealTimers()
    }
  })

  it('deve parar a limpeza periódica com stop()', () => {
    vi.useFakeTimers()
    try {
      const inner = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
      const logger = new DeduplicatingLogger(inner, { maxRepeats: 1, windowMs: 1_000 })

      logger.error('z')
      logger.error('z')
      logger.error('z')
      logger.stop()

      vi.advanceTimersByTime(5_000)

      expect(inner.warn).not.toHaveBeenCalled()
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
