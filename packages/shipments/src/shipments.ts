import type { ResourceTransport } from '@nodemelivre/core'
import type { Shipment } from '@nodemelivre/types'

/** Recursos de envios. */
export class Shipments {
  constructor(private readonly transport: ResourceTransport) {}

  /** Detalhes de um envio (rastreio, endereços, status). */
  get(shipmentId: number | string): Promise<Shipment> {
    return this.transport.get(`/shipments/${shipmentId}`)
  }
}
