import { fakeTransport } from '@nodemelivre/core/test-utils'
import { InputValidationError } from '@nodemelivre/errors'
import { describe, expect, it } from 'vitest'
import { Shipments } from './shipments.js'

const shipment = { id: 9, status: 'shipped', tracking_number: 'T-1' }

describe('Shipments', () => {
  it('deve buscar um envio pelo id numérico', async () => {
    const transport = fakeTransport(() => shipment)
    await new Shipments(transport).get(9)
    expect(transport.calls[0]).toMatchObject({ method: 'GET', path: '/shipments/9' })
  })

  it('deve buscar um envio pelo id string', async () => {
    const transport = fakeTransport(() => shipment)
    await new Shipments(transport).get('9')
    expect(transport.calls[0]?.path).toBe('/shipments/9')
  })

  it('rejeita shipment_id com path traversal antes de chamar o transport', () => {
    const transport = fakeTransport(() => shipment)
    expect(() => new Shipments(transport).get('../../users/me')).toThrow(InputValidationError)
    expect(transport.calls).toHaveLength(0)
  })

  it('rejeita shipment_id inválido (caracteres de URL, vazio, negativo)', () => {
    const transport = fakeTransport(() => shipment)
    expect(() => new Shipments(transport).get('/x')).toThrow(InputValidationError)
    expect(() => new Shipments(transport).get('')).toThrow(InputValidationError)
    expect(() => new Shipments(transport).get(-1)).toThrow(InputValidationError)
    expect(() => new Shipments(transport).get(1.5)).toThrow(InputValidationError)
    expect(transport.calls).toHaveLength(0)
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

  it('deve aceitar um id string único em printLabel', async () => {
    const transport = fakeTransport(() => new ArrayBuffer(0))
    await new Shipments(transport).printLabel('abc-9', { format: 'zpl2' })

    expect(transport.calls[0]?.query).toEqual({
      shipment_ids: 'abc-9',
      response_type: 'zpl2',
    })
  })

  it('rejeita printLabel com id inválido no array antes de chamar o transport', () => {
    const transport = fakeTransport(() => new ArrayBuffer(0))
    expect(() => new Shipments(transport).printLabel([9, '../../x'])).toThrow(InputValidationError)
    expect(() => new Shipments(transport).printLabel([9, 'a b'])).toThrow(InputValidationError)
    expect(transport.calls).toHaveLength(0)
  })

  it('rejeita printLabel com array vazio (fail fast, sem shipment_ids vazio na API)', () => {
    const transport = fakeTransport(() => new ArrayBuffer(0))
    expect(() => new Shipments(transport).printLabel([])).toThrow(InputValidationError)
    expect(transport.calls).toHaveLength(0)
  })
})
