import { createMercadoLivre } from '../packages/sdk/src/index.js'

/**
 * Fluxo OAuth2 de ponta a ponta:
 * 1. Monta a URL de autorização e envia o vendedor para o navegador.
 * 2. Recebe o `code` no redirect URI e troca por token (persistido em memória).
 * 3. Usa os resources tipados.
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

  // 1. URL para o vendedor autorizar a aplicação.
  const url = ml.authorizationUrl(redirectUri, 'estado-anti-csrf')
  console.log(`Abra: ${url}`)

  // 2. Após o redirect, o servidor recebe `?code=...&state=estado-anti-csrf`.
  const code = 'CODIGO_RECEBIDO_NO_CALLBACK'
  const token = await ml.authenticate(redirectUri, code)
  console.log(`Autenticado como ${token.userId}`)

  // 3. Resources.
  const me = await ml.users.me()
  console.log(`Vendedor: ${me.nickname}`)

  const search = await ml.items.search('MLB', { q: 'fone bluetooth' })
  for (const item of search.results.slice(0, 3)) {
    console.log(`- ${item.title} (${item.currency_id} ${item.price})`)
  }

  const answered = await ml.questions.answer({ questionId: 123, text: 'Sim, temos!' })
  console.log(`Resposta enviada: ${answered.text} (${answered.status})`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
