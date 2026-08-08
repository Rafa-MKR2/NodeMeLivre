/** Tipos de imagens do Mercado Livre. */

/**
 * Fonte de upload aceita pelo resource de imagens.
 *
 * Um alias dedicado permite estender os formatos suportados (ex.: `File`,
 * `ReadableStream`) sem quebrar a API pública — basta ampliar a união aqui.
 */
export type UploadSource = Blob | Buffer | Uint8Array | ArrayBuffer

/** Resposta de upload de imagem para um item. */
export interface ImageUploadResponse {
  id: string
  /** Variações de tamanho da imagem no CDN. */
  variations: ImageVariation[]
}

/** Uma versão/tamanho da imagem no CDN. */
export interface ImageVariation {
  size: string
  url: string
  secure_url: string
}

/** Opções de upload de imagem. */
export interface ImageUploadOptions {
  /** Nome do arquivo enviado no multipart. Padrão: `image.bin`. */
  filename?: string
}
