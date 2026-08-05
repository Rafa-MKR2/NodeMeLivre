export type ShipmentStatus =
  | 'pending'
  | 'handed_to_carrier'
  | 'shipped'
  | 'delivered'
  | 'cancelled'
  | 'not_delivered'
  | 'failed'
  | 'available_for_pickup'

export type ShippingType = 'custom' | 'me1' | 'me2' | 'me3'

/** Formato da etiqueta de envio. */
export type ShipmentLabelFormat = 'pdf' | 'zpl2'

export interface ShipmentAddress {
  id?: number
  address_line: string
  city: { id?: string; name?: string }
  state: { id?: string; name?: string }
  country: { id?: string; name?: string }
  zip_code?: string
  latitude?: number
  longitude?: number
  receiver_name?: string
  receiver_phone?: string
}

export interface Shipment {
  id: number
  status: ShipmentStatus
  status_history?: Record<string, string>
  date_created: string
  date_first_printed?: string
  shipping_type: ShippingType
  service_id?: number
  sender_address: ShipmentAddress
  receiver_address: ShipmentAddress
  tracking_number?: string
  order_id?: number
  site_id?: string
  item_id?: string
  cost?: number
  currency_id?: string
}
