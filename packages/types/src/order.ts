export interface OrderBuyerSeller {
  id: number
  nickname: string
}

export interface OrderItemDetail {
  id: string
  title?: string
  category_id?: string
  variation_id?: string
}

export interface OrderItem {
  id: string
  item: OrderItemDetail
  quantity: number
  unit_price: number
  full_unit_price: number
  sale_fee: number
}

export type OrderStatus = 'confirmed' | 'payment_required' | 'cancelled' | 'invalid'

export type PaymentStatus =
  | 'approved'
  | 'pending'
  | 'rejected'
  | 'cancelled'
  | 'in_process'
  | 'refunded'
  | 'charged_back'

export type ShipmentType = 'custom' | 'me1' | 'me2' | 'me3'

export interface Order {
  id: number
  status: OrderStatus
  status_detail?: string
  date_created: string
  date_closed?: string
  order_items: OrderItem[]
  total_amount: number
  currency_id: string
  buyer: OrderBuyerSeller
  seller: OrderBuyerSeller
  payments?: {
    id: number
    order_id: number
    status?: PaymentStatus
    status_detail?: string
    transaction_amount: number
    currency_id: string
    date_created: string
    date_last_updated?: string
  }[]
  shipping?: {
    id: number
    shipment_type?: ShipmentType
    date_created?: string
  }
}

export interface OrderSearchParams {
  seller?: number
  buyer?: number
  q?: string
  status?: OrderStatus
  date_created?: string
  sort?: string
  offset?: number
  limit?: number
}

export interface OrderSearchResponse {
  query?: string
  results: Order[]
  paging: import('./common.js').Paging
}
