import { fakeTransport } from '@nodemelivre/core/test-utils'
import { describe, expect, it } from 'vitest'
import { Shipments } from './shipments.js'

const shipment = { id: 9, status: 'shipped', tracking_number: 'T-1' }

describe('Shipments', () => {
  it('deve buscar um envio pelo id', async () => {
    const transport = fakeTransport(() => shipment)
    await new Shipments(transport).get(9)
    expect(transport.calls[0]).toMatchObject({ method: 'GET', path: '/shipments/9' })
  })

  it('deve gerar etiqueta em PDF por padrão', async () => {
    const transport = fakeTransport(() => new ArrayBuffer(0))
    await new Shipments(transport).printLabel(9)

    const call = transport.calls[0]
    expect(call).toBeDefined()
    expect(call?.method).toBe('GET')
    expect(call?.path).toBe('/shipment_labels')
    expect(call?.query).toEqual({ shipment_ids: '9', response_type: 'pdf' })
  })

  it('deve gerar etiqueta em ZPL e aceitar múltiplos envios', async () => {
    const transport = fakeTransport(() => new ArrayBuffer(0))
    await new Shipments(transport).printLabel([9, 10], { format: 'zpl2' })

    expect(transport.calls[0]?.query).toEqual({
      shipment_ids: '9,10',
      response_type: 'zpl2',
    })
  })
})
