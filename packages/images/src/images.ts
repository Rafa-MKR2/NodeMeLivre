import type { ResourceTransport } from '@nodemelivre/core'
import type { ImageUploadOptions, ImageUploadResponse } from '@nodemelivre/types'

/** Recursos de imagens. */
export class Images {
  constructor(private readonly transport: ResourceTransport) {}

  /**
   * Envia uma imagem para o CDN do Mercado Livre e retorna os dados dela
   * (id e variações de tamanho). Use o `id` retornado em `picture_ids`
   * ao criar/anunciar itens com variações.
   */
  upload(file: Blob | Buffer, options: ImageUploadOptions = {}): Promise<ImageUploadResponse> {
    const blob = toBlob(file)
    const form = new FormData()
    form.append('file', blob, options.filename ?? 'imagem')
    return this.transport.post('/pictures/items/upload', form)
  }
}

/** Converte Buffer (Node) para Blob (fetch). */
function toBlob(file: Blob | Buffer): Blob {
  if (isNodeBuffer(file)) {
    return new Blob([file])
  }
  return file
}

function isNodeBuffer(file: Blob | Buffer): file is Buffer {
  return typeof Buffer !== 'undefined' && file instanceof Buffer
}
