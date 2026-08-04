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
})
