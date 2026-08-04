import { createMercadoLivre, FileTokenStore } from '../packages/sdk/src/index.js'

/**
 * Persistência de token em arquivo (0600), ideal para CLIs e servidores
 * single-instance: o refresh acontece uma única vez por processo e o token
 * sobrevive a restarts.
 */
async function main(): Promise<void> {
  const clientId = process.env.ML_CLIENT_ID
  const clientSecret = process.env.ML_CLIENT_SECRET

  if (clientId === undefined || clientSecret === undefined) {
    throw new Error('Defina ML_CLIENT_ID e ML_CLIENT_SECRET')
  }

  const ml = createMercadoLivre({
    clientId,
    clientSecret,
    siteId: 'MLB',
    tokenStore: new FileTokenStore({ filePath: './.nodemelivre/token.json' }),
  })

  // Se ainda não houver token, o fluxo de autorização roda uma vez.
  const existing = await ml.tokens.current()
  if (existing === null) {
    const url = ml.authorizationUrl('http://localhost:3000/callback')
    console.log(`Autorize em: ${url}`)
    // Após o callback, use ml.authenticate(redirectUri, code).
    return
  }

  const me = await ml.users.me()
  console.log(`Bem-vindo de volta, ${me.nickname}!`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
