import { createMercadoLivre, RateLimiter } from '../packages/sdk/src/index.js'

/**
 * Configuração avançada de transporte: retry em falhas transitórias,
 * timeout por requisição e observação do rate-limit da API.
 */
async function main(): Promise<void> {
  const clientId = process.env.ML_CLIENT_ID
  const clientSecret = process.env.ML_CLIENT_SECRET

  if (clientId === undefined || clientSecret === undefined) {
    throw new Error('Defina ML_CLIENT_ID e ML_CLIENT_SECRET')
  }

  // RateLimiter compartilhado: o client atualiza o estado pelos headers
  // X-Rate-Limit-* e nós consultamos depois de cada requisição.
  const rateLimiter = new RateLimiter()

  const ml = createMercadoLivre({
    clientId,
    clientSecret,
    siteId: 'MLB',
    // Até 3 tentativas em 5xx/timeout, com backoff.
    retry: { maxRetries: 3, backoffMs: 500, maxBackoffMs: 5_000 },
    // 30s por requisição; a requisição é abortada acima disso.
    defaultTimeoutMs: 30_000,
    rateLimiter,
  })

  const search = await ml.items.search('MLB', { q: 'notebook' })
  console.log(`${search.results.length} resultados`)

  const state = rateLimiter.stateOf('/sites/MLB/search')
  if (state !== undefined) {
    console.log(
      `rate-limit: ${state.remaining}/${state.limit} restantes, reset ${new Date(state.resetAt ?? 0).toISOString()}`,
    )
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
