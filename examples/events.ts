import { FileTokenStore } from '@nodemelivre/auth'
import { createMercadoLivre } from '@nodemelivre/sdk'

// Exemplo: Observabilidade com Events
// -----------------------------------
// O HttpClient e TokenManager emitem eventos para debug, métricas, logging, etc.

const ml = createMercadoLivre({
  clientId: process.env.ML_CLIENT_ID ?? '',
  clientSecret: process.env.ML_CLIENT_SECRET ?? '',
  siteId: 'MLB',
  tokenStore: new FileTokenStore(),
})

// 1. Log de todas as requisições HTTP
ml.http.on('request', (req) => {
  console.log(`→ ${req.method} ${req.path}`, req.query ?? '')
})

// 2. Log de respostas (sucesso ou erro)
ml.http.on('response', (res, req) => {
  const status = res.ok ? '✓' : '✗'
  console.log(`${status} ${res.status} ${req.method} ${req.path}`)
})

// 3. Log de retries (rede instável, 429, 5xx)
ml.http.on('retry', (attempt, error, req) => {
  console.warn(
    `🔁 Retry ${attempt + 1} para ${req.method} ${req.path}:`,
    error instanceof Error ? error.message : error,
  )
})

// 4. Log de erros HTTP (rede ou API)
ml.http.on('httpError', (error, req) => {
  console.error(
    `✗ Erro em ${req.method} ${req.path}:`,
    error instanceof Error ? error.message : error,
  )
})

// 5. Rate limit atingido
ml.http.on('rateLimit', (resetAt, req) => {
  const waitMs = resetAt - Date.now()
  console.warn(
    `⏳ Rate limit em ${req.path}, aguardando ${Math.ceil(waitMs / 1000)}s até ${new Date(resetAt).toISOString()}`,
  )
})

// 6. Token renovado automaticamente
ml.tokens.on('tokenRefreshed', (token) => {
  console.log(
    `🔄 Token renovado para user ${token.userId}, expira em ${new Date(token.expiresAt).toISOString()}`,
  )
})

// Uso normal — eventos disparam automaticamente
async function main() {
  const url = ml.authorizationUrl('http://localhost:3000/callback', 'estado-anti-csrf')
  console.log('Autorize em:', url)

  // const token = await ml.authenticate('http://localhost:3000/callback', code)
  // const me = await ml.users.me()
  // console.log('Me:', me.nickname)
}

main().catch(console.error)
