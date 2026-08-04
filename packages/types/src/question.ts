export interface QuestionAnswer {
  text: string
  status: string
  date_created: string
}

export interface Question {
  id: number
  answer?: QuestionAnswer
  date_created: string
  item_id: string
  seller_id: number
  status: string
  text: string
  product_id?: string
}

export interface QuestionSearchParams {
  item_id?: string
  seller_id?: number
  status?: 'UNANSWERED' | 'ANSWERED' | 'ANSWERED_LATE'
  api_version?: number
  from?: string
  to?: string
}

export interface QuestionSearchResponse {
  questions: Question[]
  filters?: {
    exclude?: {
      excluded_items?: string[]
      exclude_no_stock_items?: boolean
    }
  }
  related_questions?: Record<string, Question>
  total: number
  paging?: import('./common.js').Paging
}

export interface QuestionAnswerInput {
  questionId: number
  text: string
}
