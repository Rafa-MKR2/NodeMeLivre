import { createMercadoLivre } from '../packages/sdk/src/index.js'

/**
 * Operações nível 3 (Prioridade B):
 * 1. Cria e publica um anúncio em uma única chamada.
 * 2. Responde a pergunta de um comprador.
 * 3. Baixa a etiqueta de envio (PDF) e salva em disco.
 */
async function main(): Promise<void> {
  const clientId = process.env.ML_CLIENT_ID
  const clientSecret = process.env.ML_CLIENT_SECRET
  const siteId = process.env.ML_SITE_ID ?? 'MLB'

  if (clientId === undefined || clientSecret === undefined) {
    throw new Error('Defina ML_CLIENT_ID e ML_CLIENT_SECRET')
  }

  const ml = createMercadoLivre({ clientId, clientSecret, siteId })

  const url = ml.authorizationUrl('http://localhost:3000/callback', 'estado-anti-csrf')
  console.log(`Abra: ${url}`)
  await ml.authenticate('http://localhost:3000/callback', 'CODIGO_RECEBIDO_NO_CALLBACK')

  // 1. Anúncio criado e publicado (se não nascer active, publica automaticamente).
  const item = await ml.items.createAndPublish({
    site_id: siteId,
    title: 'Mouse gamer',
    category_id: 'MLB1234',
    price: 99.9,
    currency_id: 'BRL',
    available_quantity: 5,
  })
  console.log(`Anúncio ${item.id} publicado: ${item.status}`)

  // 2. Responde a pergunta de um comprador (marca como respondida).
  await ml.questions.reply(3957150025, 'Sim, tenho o modelo em estoque!')

  // 3. Baixa a etiqueta de envio (PDF) e salva no disco.
  const label = await ml.shipments.printLabel(21527708516, { format: 'pdf' })
  const { writeFile } = await import('node:fs/promises')
  await writeFile('etiqueta.pdf', Buffer.from(label))
  console.log('Etiqueta salva em etiqueta.pdf')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
