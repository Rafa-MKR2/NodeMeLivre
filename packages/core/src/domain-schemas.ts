import type {
  ItemAttribute,
  ItemInput,
  ItemVariationInput,
  OrderSearchParams,
} from '@nodemelivre/types'
import {
  arrayOf,
  booleanValue,
  enumOf,
  makeSchema,
  number,
  object,
  optional,
  type SchemaIssue,
  string,
  type ValidationSchema,
} from './schemas.js'

/**
 * Schemas de domínio — fonte única da verdade para a validação de entrada.
 *
 * Centralizados no core (e não espalhados por `private function` em cada
 * resource), são testáveis em isolamento e reutilizados por items/orders.
 * As mensagens reproduzem as validações históricas de `assertValidItemInput`
 * para não quebrar consumidores.
 */

const ITEM_CONDITIONS = ['new', 'used'] as const
const LISTING_TYPES = ['free', 'gold_special', 'gold_pro', 'gold', 'silver', 'bronze'] as const
const BUYING_MODES = ['buy_it_now', 'classified'] as const
const SHIPPING_MODES = ['me1', 'me2', 'me_gratis', 'custom', 'not_specified'] as const

/** String não vazia após trim (mesmo critério do item.title/family_name). */
function nonEmptyString(field: string): ValidationSchema<string> {
  return makeSchema((value) =>
    typeof value === 'string' && value.trim().length > 0
      ? []
      : [`${field} deve ser uma string não vazia`],
  )
}

const positivePrice: ValidationSchema<number> = makeSchema((value) =>
  typeof value === 'number' && Number.isFinite(value) && value > 0
    ? []
    : ['price deve ser um número positivo'],
)

const stockQuantity: ValidationSchema<number> = makeSchema((value) =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0
    ? []
    : ['available_quantity deve ser um inteiro >= 0'],
)

/** Array de elementos que o SDK não modela em profundidade (falha rápido se não for array). */
function looseArray<T>(): ValidationSchema<T[]> {
  return makeSchema((value) => (Array.isArray(value) ? [] : ['deve ser um array']))
}

/** Shape compartilhado entre criação e atualização parcial de item. */
const itemInputShape: { [K in keyof ItemInput]-?: ValidationSchema<ItemInput[K]> } = {
  site_id: optional(string()),
  title: optional(nonEmptyString('title')),
  family_name: optional(nonEmptyString('family_name')),
  category_id: optional(string()),
  price: optional(positivePrice),
  currency_id: optional(string()),
  available_quantity: optional(stockQuantity),
  condition: optional(enumOf(ITEM_CONDITIONS)),
  listing_type_id: optional(enumOf(LISTING_TYPES)),
  buying_mode: optional(enumOf(BUYING_MODES)),
  pictures: optional(arrayOf(object<{ source: string }>({ source: string() }))),
  video_id: optional(string()),
  // attributes/variations são estruturas ricas que o SDK não modela em
  // profundidade — validamos apenas que sejam arrays (falha rápido).
  attributes: optional(looseArray<ItemAttribute>()),
  variations: optional(looseArray<ItemVariationInput>()),
  shipping: optional(
    object<NonNullable<ItemInput['shipping']>>({
      free_shipping: optional(booleanValue()),
      mode: optional(enumOf(SHIPPING_MODES)),
    }),
  ),
}

const mutualExclusion = (value: ItemInput): SchemaIssue | null =>
  value.title !== undefined && value.family_name !== undefined
    ? 'title e family_name são mutuamente exclusivos: envie apenas um (modelo User Product)'
    : null

const requireTitleOrFamilyName = (value: ItemInput): SchemaIssue | null =>
  value.title === undefined && value.family_name === undefined
    ? 'title ou family_name é obrigatório na criação'
    : null

const requirePrice = (value: ItemInput): SchemaIssue | null =>
  value.price === undefined ? 'price é obrigatório na criação' : null

const requireQuantity = (value: ItemInput): SchemaIssue | null =>
  value.available_quantity === undefined ? 'available_quantity é obrigatório na criação' : null

/** Validação completa para criação de item (campos obrigatórios). */
export const itemInputCreateSchema = object<ItemInput>(itemInputShape, {
  refinements: [mutualExclusion, requireTitleOrFamilyName, requirePrice, requireQuantity],
})

/** Validação de atualização parcial (apenas campos enviados; sem obrigatórios). */
export const itemInputPartialSchema = object<ItemInput>(itemInputShape, {
  refinements: [mutualExclusion],
})

const ORDER_STATUSES = ['confirmed', 'payment_required', 'cancelled', 'invalid', 'paid'] as const

/** Parâmetros de busca de vendas — falha rápido antes de chamar a API. */
export const orderSearchParamsSchema = object<OrderSearchParams>({
  seller: optional(number()),
  buyer: optional(number()),
  q: optional(string()),
  status: optional(enumOf(ORDER_STATUSES)),
  date_created: optional(string()),
  sort: optional(string()),
  offset: optional(number({ integer: true, min: 0 })),
  limit: optional(number({ integer: true, positive: true })),
})
