import { assertValidId, type ResourceTransport, toQuery } from '@nodemelivre/core'
import { InputValidationError } from '@nodemelivre/errors'
import type { Shipment, ShipmentLabelFormat } from '@nodemelivre/types'

/** Opções da impressão de etiqueta. */
export interface PrintLabelOptions {
  /** Formato da etiqueta. Padrão: `pdf`. */
  format?: ShipmentLabelFormat
}

/** Recursos de envios. */
export class Shipments {
  constructor(private readonly transport: ResourceTransport) {}

  /** Detalhes de um envio (rastreio, endereços, status). */
  get(shipmentId: number | string): Promise<Shipment> {
    assertValidId(shipmentId, 'shipment_id')
    return this.transport.get(`/shipments/${shipmentId}`)
  }

  /**
   * Gera a etiqueta de envio (PDF ou ZPL) para um ou mais envios e retorna
   * o binário. Disponível quando o envio está `ready_to_ship`.
   */
  printLabel(
    shipmentIds: number | string | Array<number | string>,
    options: PrintLabelOptions = {},
  ): Promise<ArrayBuffer> {
    const ids = Array.isArray(shipmentIds) ? shipmentIds : [shipmentIds]
    // Array vazio é bug do chamador: sem o guard, iria à API com
    // `shipment_ids: ''` e falharia com erro confuso (fail fast).
    if (ids.length === 0) {
      throw new InputValidationError('informe ao menos um shipment_id para gerar a etiqueta')
    }
    for (const id of ids) {
      assertValidId(id, 'shipment_id')
    }
    const query = {
      shipment_ids: ids.join(','),
      response_type: options.format ?? 'pdf',
    }
    return this.transport.get('/shipment_labels', {
      query: toQuery(query),
      responseType: 'arraybuffer',
    })
  }
}
