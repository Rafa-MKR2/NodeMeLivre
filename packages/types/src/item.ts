export type ItemStatus = 'active' | 'paused' | 'closed' | 'under_review' | 'inactive'

export type ItemCondition = 'new' | 'used'

export type ListingTypeId = 'free' | 'gold_special' | 'gold_pro' | 'gold' | 'silver' | 'bronze'

export type ShippingMode = 'me1' | 'me2' | 'me_gratis' | 'custom' | 'not_specified'

export type BuyingMode = 'buy_it_now' | 'classified'

export interface ItemPicture {
  id: string
  url: string
  secure_url: string
  size?: string
  max_size?: string
}

export interface ItemAttribute {
  id: string
  name: string
  value_id?: string
  value_name?: string
  values?: { id?: string; name: string; struct?: unknown }[]
}

/** Combinação de atributos que define uma variação (ex.: cor + tamanho). */
export interface VariationAttribute {
  id?: string
  name: string
  value_id?: string
  value_name?: string
}

/** Variação de um item (ex.: "vermelho, G"). */
export interface ItemVariation {
  id: number
  attribute_combinations: VariationAttribute[]
  price?: number
  available_quantity?: number
  sold_quantity?: number
  picture_ids?: string[]
  sale_terms?: unknown[]
}

/** Payload de variação para criação/atualização de item. */
export interface ItemVariationInput {
  attribute_combinations: VariationAttribute[]
  price?: number
  available_quantity?: number
  picture_ids?: string[]
  sale_terms?: unknown[]
}

export interface Item {
  id: string
  site_id: string
  title: string
  family_name?: string
  subtitle?: string
  seller_id: number
  category_id: string
  price: number
  base_price?: number
  currency_id: string
  available_quantity: number
  sold_quantity: number
  buying_mode: BuyingMode
  listing_type_id: ListingTypeId
  condition: ItemCondition
  pictures?: ItemPicture[]
  video_id?: string
  description_id?: string
  status: ItemStatus
  permalink?: string
  thumbnail?: string
  date_created: string
  last_updated: string
  tags?: string[]
  attributes?: ItemAttribute[]
  variations?: ItemVariation[]
  shipping?: {
    free_shipping?: boolean
    mode?: ShippingMode
    tags?: string[]
    dimensions?: string
  }
}

/** Payload para criação/atualização de item. */
export interface ItemInput {
  site_id?: string
  /**
   * Título do anúncio (modelo legado). Em contas migradas para o modelo
   * "User Product" (famílias de produtos) o ML exige `family_name` e
   * rejeita `title` com o erro 369/374 — envie apenas um dos dois.
   */
  title?: string
  /**
   * Nome da família do produto (modelo "User Product"). Quando presente,
   * o ML gera o título publicável automaticamente a partir do family_name
   * + atributos; `title` não deve ser enviado junto.
   */
  family_name?: string
  category_id?: string
  price?: number
  currency_id?: string
  available_quantity?: number
  condition?: ItemCondition
  listing_type_id?: ListingTypeId
  buying_mode?: BuyingMode
  pictures?: { source: string }[]
  video_id?: string
  attributes?: ItemAttribute[]
  variations?: ItemVariationInput[]
  shipping?: { free_shipping?: boolean; mode?: ShippingMode }
}

export interface ItemDescription {
  id: string
  created_date: string
  last_updated: string
  text: string
  plain_text: string
}

export interface ItemSearchParams {
  q?: string
  category?: string
  status?: ItemStatus
  price?: string
  offset?: number
  limit?: number
}

export interface ItemSearchResponse {
  site_id?: string
  query?: string
  paging: import('./common.js').Paging
  results: Item[]
}
