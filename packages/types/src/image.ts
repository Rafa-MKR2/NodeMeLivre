/** Tipos de imagens do Mercado Livre. */

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
  /** Nome do arquivo enviado no multipart. */
  filename?: string
}
