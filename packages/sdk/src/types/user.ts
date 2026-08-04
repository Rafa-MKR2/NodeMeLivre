export interface User {
  id: number
  nickname: string
  first_name?: string
  last_name?: string
  email?: string
  country_id?: string
  site_id?: string
  permalink?: string
  user_type?: string
  tags?: string[]
  seller_reputation?: {
    level_id?: string
    transactions?: {
      total?: number
      completed?: number
      canceled?: number
      period?: string
    }
  }
  status?: {
    site_status?: string
  }
}
