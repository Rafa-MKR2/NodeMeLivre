import { fakeTransport } from '@nodemelivre/core/test-utils'
import { describe, expect, it } from 'vitest'
import { Images } from './images.js'

const uploaded = {
  id: '123-MLA456_112021',
  variations: [
    {
      size: '500x280',
      url: 'http://http2.mlstatic.com/a.jpg',
      secure_url: 'https://http2.mlstatic.com/a.jpg',
    },
  ],
}

describe('Images', () => {
  it('deve enviar a imagem via multipart para o endpoint de upload', async () => {
    const transport = fakeTransport(() => uploaded)
    const images = new Images(transport)

    await images.upload(new Blob(['fake-bytes']), { filename: 'foto.jpg' })

    const call = transport.calls[0]
    expect(call).toBeDefined()
    expect(call?.method).toBe('POST')
    expect(call?.path).toBe('/pictures/items/upload')
    expect(call?.body).toBeInstanceOf(FormData)
  })

  it('deve aceitar Buffer do Node como fonte da imagem', async () => {
    const transport = fakeTransport(() => uploaded)
    const images = new Images(transport)

    await images.upload(Buffer.from('fake-bytes'), { filename: 'foto.png' })

    expect(transport.calls[0]?.body).toBeInstanceOf(FormData)
  })

  it('deve aceitar Uint8Array como fonte da imagem', async () => {
    const transport = fakeTransport(() => uploaded)
    await new Images(transport).upload(new Uint8Array([1, 2, 3]))
    expect(transport.calls[0]?.body).toBeInstanceOf(FormData)
  })

  it('deve aceitar ArrayBuffer como fonte da imagem', async () => {
    const transport = fakeTransport(() => uploaded)
    await new Images(transport).upload(new ArrayBuffer(8))
    expect(transport.calls[0]?.body).toBeInstanceOf(FormData)
  })

  it('deve usar nome padrão com extensão quando filename não é informado', async () => {
    const transport = fakeTransport(() => uploaded)
    await new Images(transport).upload(new Blob(['x']))

    const call = transport.calls[0]
    expect(call).toBeDefined()
    const file = (call?.body as FormData).get('file') as File
    expect(file.name).toBe('image.bin')
  })
})
