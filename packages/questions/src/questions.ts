import {
  assertValidId,
  type PageFetcher,
  paginate,
  paginationOptions,
  type ResourceTransport,
  toQuery,
} from '@nodemelivre/core'
import { InputValidationError } from '@nodemelivre/errors'
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

  /**
   * Itera todas as perguntas de uma busca, página após página, pergunta a
   * pergunta.
   *
   * ```ts
   * for await (const question of ml.questions.list({ seller_id: me.id })) {
   *   console.log(question.text)
   * }
   * ```
   *
   * Aceita um `AbortSignal` opcional: o `for await` rejeita com AbortError
   * quando o signal dispara, sem buscar a página seguinte.
   */
  list(
    params: QuestionSearchParams = {},
    signal?: AbortSignal,
  ): AsyncGenerator<Question, void, void> {
    // A resposta de /questions/search usa `questions` (não `results`); o
    // adaptador abaixo normaliza para o formato do `paginate()`.
    const fetchPage: PageFetcher<Question> = async (offset, limit, pageSignal) => {
      const page = await this.transport.get<QuestionSearchResponse>('/questions/search', {
        query: toQuery({ ...params, offset, limit }),
        ...(pageSignal !== undefined ? { signal: pageSignal } : {}),
      })
      return {
        results: page.questions ?? [],
        paging: {
          total: page.total,
          offset: page.paging?.offset ?? offset,
          limit: page.paging?.limit ?? limit,
        },
      }
    }
    return paginate(fetchPage, paginationOptions(params, signal))
  }

  /** Detalhes de uma pergunta. */
  get(questionId: number | string): Promise<Question> {
    assertValidId(questionId, 'question_id')
    return this.transport.get(`/questions/${questionId}`)
  }

  /** Responde uma pergunta pendente. */
  answer(input: QuestionAnswerInput): Promise<QuestionAnswer> {
    return this.transport.post('/answers', {
      question_id: input.questionId,
      text: input.text,
    })
  }

  /** Responde uma pergunta e a marca como respondida (alias de `answer`). */
  reply(questionId: number | string, text: string): Promise<QuestionAnswer> {
    assertValidId(questionId, 'question_id')
    const numericId = Number(questionId)
    if (!Number.isSafeInteger(numericId) || numericId <= 0) {
      throw new InputValidationError('question_id deve ser um número positivo')
    }
    return this.answer({ questionId: numericId, text })
  }
}
