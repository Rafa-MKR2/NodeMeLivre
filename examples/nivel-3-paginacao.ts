import { createMercadoLivre } from '../packages/sdk/src/index.js'

/**
 * Operações nível 3:
 * 1. Percorre todas as buscas com paginação assíncrona (`for await`).
 * 2. Publica/pausa um anúncio com aliases de negócio.
 * 3. Aguarda um pedido ser pago (com timeout).
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

  // 1. Paginação assíncrona: todos os anúncios 'active', item a item.
  let total = 0
  for await (const item of ml.items.list(siteId, { status: 'active', limit: 50 })) {
    total++
  }
  console.log(`Encontrados ${total} anúncios ativos`)

  // 2. Pausa o primeiro anúncio encontrado e depois publica de novo.
  for await (const item of ml.items.list(siteId, { status: 'active', limit: 50 })) {
    await ml.items.pause(item.id)
    console.log(`Anúncio ${item.id} pausado`)
    await ml.items.publish(item.id)
    console.log(`Anúncio ${item.id} republicado`)
    break // só demonstra no primeiro
  }

  // 3. Aguarda o pedido ser pago (timeout de 2 minutos).
  const orderId = Number(process.env.ML_ORDER_ID ?? '0')
  if (orderId > 0) {
    const paid = await ml.orders.waitUntilPaid(orderId, { timeoutMs: 120_000 })
    console.log(`Pedido ${paid.id} pago: ${paid.total_amount} ${paid.currency_id}`)
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
