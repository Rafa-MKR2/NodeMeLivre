import type { Shipment } from '../types/shipment.js'
import type { ResourceTransport } from './transport.js'

/** Recursos de envios. */
export class Shipments {
  constructor(private readonly transport: ResourceTransport) {}

  /** Detalhes de um envio (rastreio, endereços, status). */
  get(shipmentId: number | string): Promise<Shipment> {
    return this.transport.get(`/shipments/${shipmentId}`)
  }
}
