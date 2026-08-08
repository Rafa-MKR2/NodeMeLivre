import { MockMercadoLivreServer } from '@nodemelivre/core/test-utils'
import { InputValidationError, PollingTimeoutError } from '@nodemelivre/errors'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createMercadoLivre, InMemoryTokenStore } from './index.js'

/**
 * Operações nível 3 por HTTP real contra o mock server do Mercado Livre:
 * `items.createAndPublish` (compor criação + publicação), `orders.waitUntilPaid`
 * (polling real com timeout/abort) e `questions.reply` (responder + marcar).
 */
describe('Integração nível 3 — fluxos compostos reais', () => {
  let server: MockMercadoLivreServer
  let baseUrl: string
  let ml: ReturnType<typeof createMercadoLivre>

  beforeEach(async () => {
    server = new MockMercadoLivreServer()
    baseUrl = await server.start()
    const tokenStore = new InMemoryTokenStore()
    await tokenStore.compareAndSet(
      {
        accessToken: 'token-l3',
        tokenType: 'bearer',
        scope: 'read write',
        userId: 123,
        expiresAt: Date.now() + 3_600_000,
      },
      0,
    )
    ml = createMercadoLivre({
      clientId: 'APP_ID',
      clientSecret: 'SECRET',
      baseUrl,
      tokenStore,
    })
  })

  afterEach(async () => {
    await server.stop()
  })

  describe('items.createAndPublish', () => {
    it('cria e não publica quando o item já nasce ativo', async () => {
      server.route('POST', '/items', () => ({
        json: { id: 'MLB1', status: 'active', title: 'Produto' },
      }))

      const item = await ml.items.createAndPublish({
        title: 'Produto',
        price: 10,
        available_quantity: 5,
      })

      expect(item.status).toBe('active')
      const posts = server.requests.filter((r) => r.method === 'POST')
      expect(posts).toHaveLength(1)
      expect(posts[0]?.path).toBe('/items')
      expect(posts[0]?.headers.authorization).toBe('Bearer token-l3')
    })

    it('cria e publica quando o item nasce sob revisão', async () => {
      server.route('POST', '/items', () => ({
        json: { id: 'MLB1', status: 'under_review', title: 'Produto' },
      }))
      server.route('POST', '/items/MLB1/status', () => ({
        json: { id: 'MLB1', status: 'active', title: 'Produto' },
      }))

      const item = await ml.items.createAndPublish({
        title: 'Produto',
        price: 10,
        available_quantity: 5,
      })

      expect(item.status).toBe('active')
      const posts = server.requests.filter((r) => r.method === 'POST')
      expect(posts).toHaveLength(2)
      expect(posts[0]?.path).toBe('/items')
      expect(posts[1]?.path).toBe('/items/MLB1/status')
      expect(posts[1]?.body).toEqual({ status: 'active' })
    })

    it('rejeita input inválido antes de chamar a API (fail fast)', async () => {
      const err = await ml.items
        .createAndPublish({ title: '', price: 10, available_quantity: 5 })
        .catch((e) => e)

      expect(err).toBeInstanceOf(InputValidationError)
      expect(server.requests).toHaveLength(0)
    })
  })

  describe('orders.waitUntilPaid (polling real)', () => {
    it('retorna imediatamente quando o pedido já está pago', async () => {
      server.route('GET', '/orders/123', () => ({
        json: { id: 123, status: 'paid', total_amount: 50, order_items: [] },
      }))

      const order = await ml.orders.waitUntilPaid(123)

      expect(order.status).toBe('paid')
      expect(server.requests).toHaveLength(1)
    })

    it('aguarda até o pedido ser pago (várias chamadas reais)', async () => {
      const statuses = ['payment_required', 'payment_required', 'paid']
      server.route('GET', '/orders/123', () => {
        const status = statuses.shift() ?? 'paid'
        return { json: { id: 123, status, total_amount: 50, order_items: [] } }
      })

      const order = await ml.orders.waitUntilPaid(123, { timeoutMs: 2_000, intervalMs: 30 })

      expect(order.status).toBe('paid')
      expect(server.requests).toHaveLength(3)
    })

    it('lança PollingTimeoutError quando o pedido não paga a tempo', async () => {
      server.route('GET', '/orders/123', () => ({
        json: { id: 123, status: 'payment_required', total_amount: 50, order_items: [] },
      }))

      // Budget maior que um único GET (localhost pode demorar sob carga do CI):
      // garante que o polling rode pelo menos 2 requisições antes do throw.
      const err = await ml.orders
        .waitUntilPaid(123, { timeoutMs: 300, intervalMs: 30 })
        .catch((e) => e)

      expect(err).toBeInstanceOf(PollingTimeoutError)
      expect(server.requests.length).toBeGreaterThanOrEqual(2)
    })

    it('AbortSignal cancela o polling com AbortError', async () => {
      server.route('GET', '/orders/123', () => ({
        json: { id: 123, status: 'payment_required', total_amount: 50, order_items: [] },
      }))
      const controller = new AbortController()

      const promise = ml.orders
        .waitUntilPaid(123, { timeoutMs: 5_000, intervalMs: 50, signal: controller.signal })
        .then(
          () => undefined,
          (e) => e,
        )
      setTimeout(() => controller.abort(), 30)

      const err = await promise
      expect((err as Error).name).toBe('AbortError')
    })
  })

  describe('questions.reply', () => {
    it('responde a pergunta via POST /answers com question_id e text', async () => {
      server.route('POST', '/answers', () => ({
        json: { text: 'Sim, disponível!', status: 'ANSWERED', date_created: '2026-01-01' },
      }))

      const answer = await ml.questions.reply(42, 'Sim, disponível!')

      expect(answer.status).toBe('ANSWERED')
      expect(answer.text).toBe('Sim, disponível!')
      const req = server.requests[0]
      expect(req?.method).toBe('POST')
      expect(req?.path).toBe('/answers')
      expect(req?.body).toEqual({ question_id: 42, text: 'Sim, disponível!' })
    })

    it('reply converte questionId string para número no payload', async () => {
      server.route('POST', '/answers', () => ({
        json: { text: 'ok', status: 'ANSWERED', date_created: '2026-01-01' },
      }))

      await ml.questions.reply('987', 'ok')

      expect(server.requests[0]?.body).toEqual({ question_id: 987, text: 'ok' })
    })
  })
})
