import {
  assertValid,
  httpUrlSchema,
  nonEmptyFileSchema,
  type ResourceTransport,
} from '@nodemelivre/core'
import type { ImageUploadOptions, ImageUploadResponse, UploadSource } from '@nodemelivre/types'

/** Recursos de imagens. */
export class Images {
  constructor(private readonly transport: ResourceTransport) {}

  /**
   * Envia uma imagem para o CDN do Mercado Livre e retorna os dados dela
   * (id e variações de tamanho). Use o `id` retornado em `picture_ids`
   * ao criar/anunciar itens com variações.
   */
  async upload(file: UploadSource, options: ImageUploadOptions = {}): Promise<ImageUploadResponse> {
    const blob = toBlob(file)
    assertValid(nonEmptyFileSchema, blob)
    const form = new FormData()
    form.append('file', blob, options.filename ?? 'image.bin')
    return this.transport.post('/pictures/items/upload', form)
  }

  /**
   * Registra uma imagem a partir de uma URL pública (`POST /pictures`).
   * O Mercado Livre baixa a imagem no próprio CDN.
   */
  async uploadFromUrl(url: string): Promise<ImageUploadResponse> {
    assertValid(httpUrlSchema, url)
    return this.transport.post('/pictures', { source: url })
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
