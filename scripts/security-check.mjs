#!/usr/bin/env node
/**
 * security:check — verificação automatizada dos vetores-chave das 6 rodadas
 * da auditoria de segurança (docs/auditoria-seguranca.md).
 *
 * Zero dependências: roda com Node puro + vitest (já devDependency).
 * Dois estágios:
 *   1. ESTÁTICO  — varre o código-fonte por padrões proibidos (regressão):
 *      segredos hardcoded, APIs removidas, Math.random em auth, chaves
 *      perigosas, headers de segurança em requests.
 *   2. DINÂMICO  — executa os arquivos de teste que cobrem cada vetor.
 *
 * Exit code 0 = tudo verde; 1 = alguma violação. Pronto para CI.
 *
 * Uso:
 *   npm run security:check   # estático + dinâmico (CI)
 *   npm run security:static  # apenas estático (dev, mais rápido)
 */
import { spawnSync } from 'node:child_process'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = join(ROOT, 'packages')
const IGNORED_DIRS = new Set(['dist', 'node_modules'])
const isTestFile = (name) => name.endsWith('.test.ts') || name.endsWith('.spec.ts')
const isSourceFile = (name) => name.endsWith('.ts') && !isTestFile(name) && !name.endsWith('.d.ts')

let failures = 0
let checks = 0

/** Lista recursivamente arquivos .ts de um package (src/). */
function listSourceFiles(pkg) {
  const base = join(SRC, pkg, 'src')
  const out = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry)
      if (IGNORED_DIRS.has(entry)) continue
      const st = statSync(full)
      if (st.isDirectory()) walk(full)
      else if (isSourceFile(entry)) out.push(full)
    }
  }
  if (statSync(base, { throwIfNoEntry: false })) walk(base)
  return out
}

/** Registra o resultado de uma checagem. */
function report(name, ok, detail = '') {
  checks++
  if (ok) {
    console.log(`  ✓ ${name}`)
  } else {
    failures++
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

/** Lê todos os arquivos de um conjunto como { path, content }. */
function readAll(files) {
  return files.map((path) => ({ path, content: readFileSync(path, 'utf8') }))
}

/** Remove linhas de comentário — menções em JSDoc não contam como código. */
function stripComments(content) {
  return content
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\/\*|\*|\*\/)/.test(line))
    .join('\n')
}

console.log('🔒 security:check — vetores das 6 rodadas da auditoria\n')

// ────────────────────────────────────────────────────────────────────────────
// ESTÁTICO — regressões que um teste unitário não pega (grep/scan)
// ────────────────────────────────────────────────────────────────────────────

console.log('Estágio 1 — varredura estática (padrões proibidos)\n')

// 1. Segredos hardcoded (client_secret, tokens, api keys) fora de testes
{
  const files = []
  for (const pkg of readdirSync(SRC)) {
    if (IGNORED_DIRS.has(pkg) || pkg.startsWith('.')) continue
    if (statSync(join(SRC, pkg)).isDirectory()) files.push(...listSourceFiles(pkg))
  }
  const secretPattern =
    /(client_secret|clientSecret|api_key|apikey|access_token|refresh_token|refreshToken)\s*[:=]\s*['"][^'"]{8,}['"]/i
  const hits = readAll(files).filter(({ content }) => secretPattern.test(stripComments(content)))
  report(
    'sem segredos hardcoded em packages/*/src',
    hits.length === 0,
    hits.map((h) => relative(ROOT, h.path)).join(', '),
  )
}

// 2. APIs removidas pelas auditorias não podem voltar
{
  const banned = [
    'assertValidItemInput', // Fase 2 — substituído por schemas
    'getGlobalOAuthStateStore', // P1-3 — singleton removido
    'resetGlobalOAuthStateStore', // P1-3 — singleton removido
    'securityHeaders', // P1-4 — headers de resposta em requests
    'SECURITY_HEADERS', // P1-4 — idem
  ]
  for (const symbol of banned) {
    const files = []
    for (const pkg of readdirSync(SRC)) {
      if (IGNORED_DIRS.has(pkg) || pkg.startsWith('.')) continue
      if (statSync(join(SRC, pkg)).isDirectory()) files.push(...listSourceFiles(pkg))
    }
    const hits = readAll(files)
      .filter(({ content }) => stripComments(content).includes(symbol))
      .map((h) => relative(ROOT, h.path))
    // Menções em comentários JSDoc (documentando a migração) são permitidas;
    // o símbolo não pode aparecer em código executável.
    report(`API removida não ressurgiu: ${symbol}`, hits.length === 0, hits.join(', '))
  }
}

// 3. Math.random em auth (instanceId/lease devem usar CSPRNG — Rodada 4)
{
  const files = listSourceFiles('auth')
  const hits = readAll(files)
    .filter(({ content }) => stripComments(content).includes('Math.random'))
    .map((h) => relative(ROOT, h.path))
  report(
    'auth não usa Math.random em código (CSPRNG — Rodada 4)',
    hits.length === 0,
    hits.join(', '),
  )
}

// 4. Chaves perigosas (__proto__/constructor/prototype) fora do UNSAFE_KEYS
//    — prototype pollution (Rodada 2). Só podem aparecer no Set de bloqueio.
{
  const files = [...listSourceFiles('core'), ...listSourceFiles('http')]
  const hits = readAll(files).flatMap(({ path, content }) => {
    const lines = content.split('\n')
    return lines
      .map((line, i) => ({ line: i + 1, text: line }))
      .filter(
        ({ text }) =>
          /['"]__proto__['"]|['"]constructor['"]|['"]prototype['"]/.test(text) &&
          !text.includes('UNSAFE_KEYS'),
      )
      .map(({ line }) => `${relative(ROOT, path)}:${line}`)
  })
  report(
    'chaves perigosas restritas ao UNSAFE_KEYS (Rodada 2)',
    hits.length === 0,
    hits.slice(0, 5).join(', '),
  )
}

// 5. httpUrlSchema bloqueia trailing dot (Rodada 3) — presença do fix
{
  const schemas = join(SRC, 'core', 'src', 'schemas.ts')
  const content = readFileSync(schemas, 'utf8')
  report(
    'httpUrlSchema normaliza trailing dot (Rodada 3)',
    content.includes("replace(/\\.+$/, '')"),
  )
}

// 6. sanitizeLog cobre control chars completos (Rodadas 2-3)
{
  const webhooks = join(SRC, 'webhooks', 'src', 'webhooks.ts')
  const content = readFileSync(webhooks, 'utf8')
  report(
    'sanitizeLog cobre CR/LF + NEL + DEL + control chars',
    content.includes('\\u2028') && content.includes('\\u0085') && content.includes('\\x7f'),
  )
}

// 7. TokenManager usa CSPRNG no instanceId (Rodada 4)
{
  const refresh = join(SRC, 'auth', 'src', 'refresh.ts')
  const content = readFileSync(refresh, 'utf8')
  report('TokenManager instanceId via randomBytes (Rodada 4)', content.includes('randomBytes(8)'))
}

// 8. fallback code_verifier tem limite (Rodada 4)
{
  const oauth = join(SRC, 'auth', 'src', 'oauth.ts')
  const content = readFileSync(oauth, 'utf8')
  report(
    'fallback code_verifier limitado (Rodada 4)',
    content.includes('CODE_VERIFIER_MAX_ENTRIES'),
  )
}

// 9. ApiError.message sanitizado (Rodada 3)
{
  const errors = join(SRC, 'errors', 'src', 'index.ts')
  const content = readFileSync(errors, 'utf8')
  report('ApiError.message sanitizado (Rodada 3)', content.includes('\\u0085'))
}

// 10. deepOmitEmpty iterativo — sem recursão (Rodada 5, DoS: stack overflow)
{
  const utils = join(SRC, 'core', 'src', 'utils.ts')
  const content = readFileSync(utils, 'utf8')
  report(
    'deepOmitEmpty iterativo (sem recursão — Rodada 5)',
    content.includes('function cleanDeep') && content.includes('const stack: CleanFrame[] = []'),
  )
}

// 11. paginate() guard contra página que não avança (Rodada 5, DoS: loop inf.)
{
  const pagination = join(SRC, 'core', 'src', 'pagination.ts')
  const content = readFileSync(pagination, 'utf8')
  report(
    'paginate() guard de página repetida (Rodada 5)',
    content.includes('previousFirstKey'),
  )
}

// 12. RateLimiter com teto de espera (Rodada 5, DoS: sleep gigante)
{
  const rateLimit = join(SRC, 'http', 'src', 'rate-limit.ts')
  const content = readFileSync(rateLimit, 'utf8')
  report(
    'RateLimiter com MAX_WAIT_MS (Rodada 5)',
    content.includes('MAX_WAIT_MS') && content.includes('delayMs > MAX_WAIT_MS'),
  )
}

// 13. Origin guard no buildUrl (Rodada 6, confused deputy via path absoluto)
{
  const client = join(SRC, 'http', 'src', 'client.ts')
  const content = readFileSync(client, 'utf8')
  report(
    'buildUrl rejeita path absoluto/protocol-relative (Rodada 6)',
    content.includes("path.startsWith('//')") &&
      content.includes('InputValidationError') &&
      content.includes('relativo ao baseUrl'),
  )
}

// 14. Redirect cross-origin dropa Authorization (Rodada 6)
{
  const client = join(SRC, 'http', 'src', 'client.ts')
  const content = readFileSync(client, 'utf8')
  report(
    'redirect cross-origin remove Authorization (Rodada 6)',
    content.includes("next.origin !== url.origin") &&
      content.includes("fresh.delete('authorization')"),
  )
}

// 15. Retry-After capped (Rodada 6, DoS de espera no retry)
{
  const client = join(SRC, 'http', 'src', 'client.ts')
  const content = readFileSync(client, 'utf8')
  report(
    'backoffDelay capped no Retry-After (Rodada 6)',
    content.includes('Math.min(error.retryAfterSeconds * 1000, MAX_WAIT_MS)'),
  )
}

// 16. httpUrlSchema bloqueia DNS wildcard + IPv6 transition (Rodada 6)
{
  const schemas = join(SRC, 'core', 'src', 'schemas.ts')
  const content = readFileSync(schemas, 'utf8')
  report(
    'httpUrlSchema bloqueia DNS wildcard (nip.io/sslip.io/...) (Rodada 6)',
    content.includes('WILDCARD_DNS_SUFFIXES'),
  )
  report(
    'httpUrlSchema bloqueia IPv6 transition (NAT64/6to4/compat) (Rodada 6)',
    content.includes('64:ff9b') && content.includes('2002:') && content.includes('isBlockedTransitionIPv6'),
  )
}

// 17. parallel() sem pollution por __proto__ (Rodada 6)
{
  const resilience = join(SRC, 'core', 'src', 'resilience.ts')
  const content = readFileSync(resilience, 'utf8')
  report(
    'parallel() pula UNSAFE_KEYS na atribuição (Rodada 6)',
    content.includes('UNSAFE_KEYS.has(resource)'),
  )
}

// 18. FileTokenStore lease/lock com 0o600 (Rodada 6)
{
  const token = join(SRC, 'auth', 'src', 'token.ts')
  const content = readFileSync(token, 'utf8')
  // 0o600 aparece na escrita do token (temp+backup+restore), no lease
  // (acquire+renew) e no open() do lock — contagem robusta a formatação.
  const occurrences = (content.match(/0o600/g) ?? []).length
  report('FileTokenStore com 0o600 no lease/lock (Rodada 6)', occurrences >= 5)
}

// ────────────────────────────────────────────────────────────────────────────
// DINÂMICO — executa os testes que cobrem cada vetor
// ────────────────────────────────────────────────────────────────────────────

const staticOnly = process.argv.includes('--static-only')

console.log('\nEstágio 2 — execução dos testes de segurança\n')

const securityTestFiles = [
  // Rodada 1: assertValidId, httpUrlSchema, redirects, reply numérico
  join('packages', 'core', 'src', 'schemas.test.ts'),
  join('packages', 'http', 'src', 'client.test.ts'),
  join('packages', 'http', 'src', 'integration.test.ts'),
  // Rodada 1: reply numérico (questions) + assertValidId em resources (items)
  join('packages', 'questions', 'src', 'questions.test.ts'),
  join('packages', 'items', 'src', 'items.test.ts'),
  // Rodada 2: prototype pollution, log injection webhooks, resolveSellerItems
  join('packages', 'core', 'src', 'utils.test.ts'),
  join('packages', 'webhooks', 'src', 'webhooks.test.ts'),
  // Rodada 3: trailing dot, ApiError.message sanitizado
  join('packages', 'errors', 'src', 'index.test.ts'),
  // Rodada 4: re-auth, CSPRNG instanceId, limite do fallback
  join('packages', 'auth', 'src', 'refresh.test.ts'),
  join('packages', 'auth', 'src', 'oauth.test.ts'),
  // Rodada 5: paginate sem loop infinito, RateLimiter com teto, deepOmitEmpty
  join('packages', 'core', 'src', 'pagination.test.ts'),
  join('packages', 'http', 'src', 'rate-limit.test.ts'),
  // Rodada 6: origin guard + redirect cross-origin + Retry-After cap (client),
  // DNS wildcard + IPv6 transition (schemas), parallel sem __proto__,
  // FileTokenStore 0o600
  join('packages', 'core', 'src', 'resilience.test.ts'),
  join('packages', 'auth', 'src', 'token.test.ts'),
]

const missing = securityTestFiles.filter((f) => !statSync(join(ROOT, f), { throwIfNoEntry: false }))
if (missing.length > 0) {
  report('todos os arquivos de teste de segurança existem', false, missing.join(', '))
} else if (staticOnly) {
  report('todos os arquivos de teste de segurança existem', true)
} else {
  report('todos os arquivos de teste de segurança existem', true)
  const result = spawnSync('npx', ['vitest', 'run', '--silent=true', ...securityTestFiles], {
    cwd: ROOT,
    encoding: 'utf8',
  })
  const ok = result.status === 0
  report(
    `suíte de segurança passou (${securityTestFiles.length} arquivos)`,
    ok,
    ok ? '' : 'vitest retornou falha — veja acima',
  )
  if (!ok) {
    process.stdout.write(result.stdout)
    process.stderr.write(result.stderr)
  }
}

// ────────────────────────────────────────────────────────────────────────────

console.log(`\n📊 ${checks - failures}/${checks} checagens passaram\n`)
if (failures > 0) {
  console.error(`❌ security:check FALHOU (${failures} violação(ões))`)
  process.exit(1)
}
console.log('✅ security:check — todos os vetores das 6 rodadas verificados')
