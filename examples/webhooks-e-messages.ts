import { createMercadoLivre } from '../packages/sdk/src/index.js'

/**
 * Webhooks + messages:
 * 1. Recebe a notificação (aqui simulada) no callback e autentica pelo
 *    `application_id` (o Mercado Livre não assina o payload com HMAC).
 * 2. Para tópicos de mensagem, busca os detalhes da conversa no chat
 *    pós-venda e responde o comprador.
 */
async function main(): Promise<void> {
  const clientId = process.env.ML_CLIENT_ID
  const clientSecret = process.env.ML_CLIENT_SECRET
  const siteId = process.env.ML_SITE_ID ?? 'MLB'

  if (clientId === undefined || clientSecret === undefined) {
    throw new Error('Defina ML_CLIENT_ID e ML_CLIENT_SECRET')
  }

  const ml = createMercadoLivre({ clientId, clientSecret, siteId })
  const applicationId = Number(clientId)

  // Corpo que o Mercado Livre posta no seu callback (ex.: Express).
  const rawBody = JSON.stringify({
    _id: 'f9f08571',
    resource: 'hash-da-mensagem',
    user_id: 468424240,
    topic: 'messages',
    application_id: applicationId,
    actions: ['created'],
  })

  // 1. Autentica e tipa a notificação.
  const notification = ml.webhooks.verify(rawBody, applicationId)
  console.log(`Notificação ${notification.topic} do user ${notification.user_id}`)

  // 2. Se for mensagem, lê a conversa e responde.
  if (notification.topic === 'messages' && notification.actions?.includes('created')) {
    const message = await ml.messages.get(notification.resource)
    console.log(`${message.from.user_id}: ${message.text}`)

    const response = await ml.messages.send({
      from: { user_id: notification.user_id },
      to: { user_id: message.from.user_id, resource: message.to.resource, site_id: siteId },
      text: 'Olá! Seu pedido já está com o código de rastreio.',
    })
    console.log(`Mensagem enviada: ${response.id}`)
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
