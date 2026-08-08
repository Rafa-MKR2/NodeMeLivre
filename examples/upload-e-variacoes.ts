import { readFile } from 'node:fs/promises'
import { createMercadoLivre } from '../packages/sdk/src/index.js'

/**
 * Upload de imagem e criação de anúncio com variações:
 * 1. Envia a foto para o CDN do Mercado Livre e obtém o `id`.
 * 2. Cria o anúncio usando o id da imagem e variações de cor/tamanho.
 */
async function main(): Promise<void> {
  const clientId = process.env.ML_CLIENT_ID
  const clientSecret = process.env.ML_CLIENT_SECRET
  const siteId = process.env.ML_SITE_ID ?? 'MLB'
  const redirectUri = 'http://localhost:3000/callback'

  if (clientId === undefined || clientSecret === undefined) {
    throw new Error('Defina ML_CLIENT_ID e ML_CLIENT_SECRET')
  }

  const ml = createMercadoLivre({ clientId, clientSecret, siteId })

  const url = ml.authorizationUrl(redirectUri, 'estado-anti-csrf')
  console.log(`Abra: ${url}`)

  const code = 'CODIGO_RECEBIDO_NO_CALLBACK'
  await ml.authenticate(redirectUri, code)

  // 1. Upload da imagem (aceita Blob, Buffer, Uint8Array ou ArrayBuffer).
  const bytes = await readFile('/caminho/para/foto.jpg')
  const picture = await ml.images.upload(bytes, { filename: 'foto.jpg' })
  const pictureUrl = picture.variations[0]?.secure_url ?? ''
  console.log(`Imagem enviada: ${picture.id}`)

  // 2. Anúncio com a foto e variações (ex.: camiseta P/M/G).
  const item = await ml.items.create({
    site_id: siteId,
    title: 'Camiseta dry-fit (P/M/G)',
    category_id: 'MLB1234',
    price: 49.9,
    currency_id: 'BRL',
    available_quantity: 30,
    pictures: [{ source: pictureUrl }],
    variations: [
      {
        attribute_combinations: [
          { name: 'Cor', value_name: 'Preto' },
          { name: 'Tamanho', value_name: 'P' },
        ],
        price: 49.9,
        available_quantity: 10,
        picture_ids: [picture.id],
      },
    ],
  })
  console.log(`Anúncio criado: ${item.id} (${item.status})`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
