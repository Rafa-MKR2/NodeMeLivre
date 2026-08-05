import type { ResourceTransport } from '@nodemelivre/core'
import type { ImageUploadOptions, ImageUploadResponse, UploadSource } from '@nodemelivre/types'

/** Recursos de imagens. */
export class Images {
  constructor(private readonly transport: ResourceTransport) {}

  /**
   * Envia uma imagem para o CDN do Mercado Livre e retorna os dados dela
   * (id e variações de tamanho). Use o `id` retornado em `picture_ids`
   * ao criar/anunciar itens com variações.
   */
  upload(file: UploadSource, options: ImageUploadOptions = {}): Promise<ImageUploadResponse> {
    const blob = toBlob(file)
    const form = new FormData()
    form.append('file', blob, options.filename ?? 'image.bin')
    return this.transport.post('/pictures/items/upload', form)
  }
}

/** Normaliza as diferentes fontes de upload para Blob. */
function toBlob(file: UploadSource): Blob {
  if (isNodeBuffer(file)) {
    return new Blob([file])
  }
  if (file instanceof Uint8Array) {
    return new Blob([file])
  }
  if (file instanceof ArrayBuffer) {
    return new Blob([file])
  }
  return file
}

function isNodeBuffer(file: UploadSource): file is Buffer {
  return typeof Buffer !== 'undefined' && file instanceof Buffer
}
