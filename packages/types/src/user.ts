export type UserType = 'normal' | 'merchant' | 'power_seller' | 'vip'

export type SiteStatus = 'active' | 'inactive'

export type ReputationLevelId =
  | '5_yellow'
  | '4_light_green'
  | '3_yellow'
  | '2_yellow'
  | '1_red'
  | '0_red'

export interface User {
  id: number
  nickname: string
  first_name?: string
  last_name?: string
  email?: string
  country_id?: string
  site_id?: string
  permalink?: string
  user_type?: UserType
  tags?: string[]
  seller_reputation?: {
    level_id?: ReputationLevelId
    transactions?: {
      total?: number
      completed?: number
      canceled?: number
      period?: string
    }
  }
  status?: {
    site_status?: SiteStatus
  }
}
