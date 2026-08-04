import { describe, expect, it } from 'vitest'
import { fakeTransport } from '../test-utils.js'
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
})
