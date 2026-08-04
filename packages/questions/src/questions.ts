import { type ResourceTransport, toQuery } from '@nodemelivre/core'
import type {
  Question,
  QuestionAnswer,
  QuestionAnswerInput,
  QuestionSearchParams,
  QuestionSearchResponse,
} from '@nodemelivre/types'

/** Recursos de perguntas e respostas. */
export class Questions {
  constructor(private readonly transport: ResourceTransport) {}

  /** Busca de perguntas por item ou vendedor. */
  search(params: QuestionSearchParams = {}): Promise<QuestionSearchResponse> {
    return this.transport.get('/questions/search', { query: toQuery(params) })
  }

  /** Detalhes de uma pergunta. */
  get(questionId: number | string): Promise<Question> {
    return this.transport.get(`/questions/${questionId}`)
  }

  /** Responde uma pergunta pendente. */
  answer(input: QuestionAnswerInput): Promise<QuestionAnswer> {
    return this.transport.post('/answers', {
      question_id: input.questionId,
      text: input.text,
    })
  }
}
