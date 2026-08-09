import { createMercadoLivre, FileTokenStore, OAuthStateStore } from '../packages/sdk/src/index.js'

/**
 * Fluxo OAuth2 com PKCE em deploy MULTI-INSTÂNCIA.
 *
 * Cenário real: balanceador de carga distribuindo o tráfego entre várias
 * instâncias (cluster, serverless, replicas). O vendedor abre a URL de
 * autorização em uma instância e o callback chega em OUTRA — o `state`
 * anti-CSRF e o `code_verifier` do PKCE precisam estar num store
 * COMPARTILHADO, senão o `/oauth/token` responde `invalid_request`
 * (apps com PKCE habilitado exigem `code_verifier`).
 *
 * Este exemplo simula o fluxo com duas instâncias (`mlA` e `mlB`) no
 * mesmo processo compartilhando o MESMO `OAuthStateStore`:
 *
 *   1. mlA (GET /login)      → authorizationUrl()  — gera state + verifier,
 *                              armazena ambos no store compartilhado;
 *   2. mlB (callback)        → consumeState()      — valida o state (anti-CSRF)
 *                              e ESTACIONA o verifier no store compartilhado;
 *   3. mlB (callback)        → exchangeCode()      — recupera o verifier do
 *                              store e envia no /oauth/token (sucesso).
 *
 * Entre processos reais, implemente o contrato do `OAuthStateStore` com
 * Redis/banco (create, consume, updateMetadata, parkCodeVerifier,
 * getParkedCodeVerifier, ...) e injete o adaptador no lugar do
 * `new OAuthStateStore()`.
 */
async function main(): Promise<void> {
  const clientId = process.env.ML_CLIENT_ID
  const clientSecret = process.env.ML_CLIENT_SECRET
  if (clientId === undefined || clientSecret === undefined) {
    throw new Error('Defina ML_CLIENT_ID e ML_CLIENT_SECRET')
  }

  const redirectUri = 'https://seusite.com/callback'

  // ═══════════════════════════════════════════════════════════════════
  // 0. Store de estados COMPARTILHADO (a regra de ouro da multi-instância)
  // ═══════════════════════════════════════════════════════════════════
  const sharedStateStore = new OAuthStateStore()

  const config = {
    clientId,
    clientSecret,
    siteId: 'MLB',
    pkce: true, // obrigatório para apps novos do ML (2025/2026)
    stateStore: sharedStateStore, // ← o MESMO store em todas as instâncias
    tokenStore: new FileTokenStore({ filePath: './.nodemelivre/token.json' }),
  }

  // Duas instâncias do SDK — como se fossem dois processos do seu deploy.
  const mlA = createMercadoLivre(config)
  const mlB = createMercadoLivre(config)

  // ═══════════════════════════════════════════════════════════════════
  // 1. Instância A — gera a URL de autorização
  //    O state e o code_verifier (PKCE) são armazenados no store
  //    compartilhado: o verifier vai no metadata do state.
  // ═══════════════════════════════════════════════════════════════════
  const url = await mlA.authorizationUrl(redirectUri)
  console.log(`1. Instância A gerou a URL de autorização:\n   ${url}`)

  // Extrai o state para simular o que volta no redirect (ex.: ?code=...&state=...)
  const stateNoCallback = new URL(url).searchParams.get('state')
  if (stateNoCallback === null) {
    throw new Error('URL de autorização não contém state — confira o stateStore')
  }
  // Em produção, o `code` vem da query string do redirect (?code=...). Aqui
  // é um placeholder: o step 3 só roda de ponta a ponta com um `code` real
  // recebido após o vendedor autorizar (como nos demais exemplos).
  const codeNoCallback = 'CODIGO_RECEBIDO_NO_CALLBACK'

  // ═══════════════════════════════════════════════════════════════════
  // 2. Instância B — callback (o balanceador mandou para OUTRA instância)
  //    consumeState valida o state (single-use, anti-CSRF) e ESTACIONA o
  //    code_verifier no store compartilhado para a troca seguinte.
  // ═══════════════════════════════════════════════════════════════════
  const entry = await mlB.consumeState(stateNoCallback)
  if (entry === null) {
    throw new Error('state inválido/expirado — possível ataque CSRF')
  }
  console.log('2. Instância B validou o state no callback (consumeState OK)')

  // ═══════════════════════════════════════════════════════════════════
  // 3. Instância B — troca o code por token
  //    O SDK recupera o code_verifier (state ativo → estacionado →
  //    fallback) e envia `code_verifier` no body do /oauth/token.
  //    Sem o verifier, o ML responde invalid_request para apps PKCE.
  // ═══════════════════════════════════════════════════════════════════
  const token = await mlB.authenticate(redirectUri, codeNoCallback, stateNoCallback)
  console.log(`3. Instância B trocou o code por token (user_id ${token.userId})`)

  // Prova: o token ficou persistido no FileTokenStore compartilhado.
  const stored = await mlB.tokens.current()
  if (stored !== null) {
    console.log(
      `   Token persistido no FileTokenStore (expira ${new Date(stored.expiresAt).toISOString()})`,
    )
  }

  // Use a API autenticada a partir de QUALQUER instância.
  const me = await mlA.users.me()
  console.log(`4. Instância A usa a API com o token trocado por B: ${me.nickname}`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
