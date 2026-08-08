import { fakeTransport } from '@nodemelivre/core/test-utils'
import { describe, expect, it } from 'vitest'
import { Questions } from './questions.js'

const question = { id: 5, text: 'Tem garantia?', item_id: 'MLB1' }

describe('Questions', () => {
  it('deve buscar perguntas com query', async () => {
    const transport = fakeTransport(() => ({ questions: [question], total: 1 }))
    await new Questions(transport).search({ item_id: 'MLB1', status: 'UNANSWERED' })

    const call = transport.calls[0]
    expect(call).toBeDefined()
    expect(call?.path).toBe('/questions/search')
    expect(call?.query).toEqual({ item_id: 'MLB1', status: 'UNANSWERED' })
  })

  it('deve buscar uma pergunta pelo id', async () => {
    const transport = fakeTransport(() => question)
    await new Questions(transport).get(5)
    expect(transport.calls[0]).toMatchObject({ method: 'GET', path: '/questions/5' })
  })

  it('deve responder uma pergunta', async () => {
    const transport = fakeTransport(() => ({
      text: 'Sim',
      status: 'ANSWERED',
      date_created: '2026-01-01',
    }))
    await new Questions(transport).answer({ questionId: 5, text: 'Sim, tem garantia' })

    expect(transport.calls[0]).toMatchObject({
      method: 'POST',
      path: '/answers',
      body: { question_id: 5, text: 'Sim, tem garantia' },
    })
  })

  it('reply deve responder e marcar como respondida (alias de answer)', async () => {
    const transport = fakeTransport(() => ({
      text: 'Sim',
      status: 'ANSWERED',
      date_created: '2026-01-01',
    }))
    await new Questions(transport).reply(5, 'Sim, tem garantia')

    expect(transport.calls[0]).toMatchObject({
      method: 'POST',
      path: '/answers',
      body: { question_id: 5, text: 'Sim, tem garantia' },
    })
  })

  it('deve iterar todas as perguntas de uma busca paginada (resposta com `questions`)', async () => {
    const pages = [
      { questions: [{ ...question, id: 1 }], total: 3 },
      {
        questions: [
          { ...question, id: 2 },
          { ...question, id: 3 },
        ],
        total: 3,
      },
    ]
    const transport = fakeTransport(() => pages.shift() ?? { questions: [], total: 3 })

    const ids: number[] = []
    for await (const item of new Questions(transport).list({ seller_id: 42 })) {
      ids.push(item.id)
    }

    expect(ids).toEqual([1, 2, 3])
    expect(transport.calls).toHaveLength(2)
    expect(transport.calls[0]?.query).toMatchObject({ seller_id: 42, offset: 0, limit: 50 })
    expect(transport.calls[1]?.query).toMatchObject({ seller_id: 42, offset: 1, limit: 50 })
  })

  it('deve respeitar o limit informado pelo consumidor', async () => {
    const transport = fakeTransport(() => ({
      questions: [{ ...question, id: 1 }],
      total: 1,
    }))

    const ids: number[] = []
    for await (const item of new Questions(transport).list({ limit: 5 })) {
      ids.push(item.id)
    }

    expect(ids).toEqual([1])
    expect(transport.calls[0]?.query).toMatchObject({ offset: 0, limit: 5 })
  })

  it('deve repassar o AbortSignal para a requisição em voo', async () => {
    const transport = fakeTransport(() => ({ questions: [{ ...question, id: 1 }], total: 1 }))
    const controller = new AbortController()

    const ids: number[] = []
    for await (const item of new Questions(transport).list({}, controller.signal)) {
      ids.push(item.id)
    }

    expect(ids).toEqual([1])
    expect(transport.calls[0]?.signal).toBe(controller.signal)
  })

  it('deve abortar entre as páginas quando o signal dispara', async () => {
    const transport = fakeTransport(() => ({
      questions: [{ ...question, id: 1 }],
      total: 100,
    }))
    const controller = new AbortController()

    const ids: number[] = []
    const iterate = async (): Promise<void> => {
      for await (const item of new Questions(transport).list({}, controller.signal)) {
        ids.push(item.id)
        controller.abort()
      }
    }

    await expect(iterate()).rejects.toThrow(/aborted/i)
    expect(ids).toEqual([1])
    expect(transport.calls).toHaveLength(1)
  })
})
