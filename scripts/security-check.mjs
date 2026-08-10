#!/usr/bin/env node
/**
 * security:check — verificação automatizada dos vetores-chave das 9 rodadas
 * da auditoria de segurança (docs/auditoria-seguranca.md).
 *
 * Zero dependências: roda com Node puro + vitest (já devDependency).
 * Cinco estágios:
 *   1. ESTÁTICO  — varre o código-fonte por padrões proibidos (regressão):
 *      segredos hardcoded, APIs removidas, Math.random em auth, chaves
 *      perigosas, headers de segurança em requests.
 *   2. DINÂMICO  — executa os arquivos de teste que cobrem cada vetor.
 *   3. FUZZING   — fuzzer determinístico do deepOmitEmpty (ciclos, DAGs,
 *      chaves perigosas, profundidade extrema) como estágio próprio.
 *   4. FUZZING   — fuzzer determinístico do DeduplicatingLogger (ciclos,
 *      getters que lançam, símbolos, BigInt, toJSON, proxies) como estágio
 *      próprio — logar nunca pode derrubar o processo.
 *   5. FUZZING   — fuzzer determinístico do buildUrl (URLs malformadas,
 *      host com CRLF/controle, protocolos exóticos, whitespace/C0, userinfo,
 *      backslash) como estágio próprio — o origin nunca pode vazar.
 *   6. FUZZING   — fuzzer determinístico do paginate (páginas que não
 *      avançam = loop infinito, entrega exata, total null) como estágio
 *      próprio — o anti-DoS da Rodada 5 não pode regredir.
 *   7. FUZZING   — fuzzer determinístico do RateLimiter (headers aleatórios,
 *      espera nunca > MAX_WAIT_MS, single-flight) como estágio próprio — o
 *      sleep gigante da Rodada 5 não pode voltar.
 *
 * Exit code 0 = tudo verde; 1 = alguma violação. Pronto para CI.
 *
 * Contrato de contagem (CI): `--expect-checks N` faz o script falhar se o
 * total final de checagens não for EXATAMENTE N — uma checagem removida
 * (regressão silenciosa de cobertura) ou adicionada (contrato desatualizado)
 * quebra o CI. Os workflows ci.yml/publish-beta.yml passam o valor atual;
 * a checagem estática 39 impede que o contrato seja removido dos workflows.
 *
 * NOTAS: (1) o contrato aplica-se à EXECUÇÃO COMPLETA — o `--static-only`
 * tem contagem própria (menor, por design) e não deve receber o flag; (2) o
 * contrato protege o NÚMERO de checagens, não o conteúdo de cada uma — a
 * lista de arquivos do estágio dinâmico e os itens individuais continuam
 * sob disciplina de revisão (os fuzzers têm presença garantida via 36-38 e
 * 41-42; o modo FUZZ_SEEDS via 40).
 *
 * Uso:
 *   npm run security:check                              # estático + dinâmico + fuzzing
 *   npm run security:check -- --expect-checks 76        # + contrato de contagem (CI)
 *   npm run security:static                             # apenas estático (dev, mais rápido)
 *
 * FUZZ_SEEDS (fora do CI) — roda os fuzzers com seeds ROTATIVAS para
 * rodadas mais amplas: `FUZZ_SEEDS="0x1111,0x2222,0x3333" npm run
 * security:check` (hex `0x…` ou decimal, separados por vírgula/espaço; cada
 * teste roda uma vez por seed). Sem a env, a seed fixa determinística é
 * usada — o CI nunca rotaciona e segue 100% reproduzível.
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

/**
 * Extrai "Tests N passed" do resumo do vitest — tolerante a ANSI escape
 * codes. O runner do GitHub Actions força cores (FORCE_COLOR/CI), e os
 * códigos entre 'Tests' e o número quebravam o regex → os 6 estágios de
 * fuzzing falhavam no CI (falso negativo) embora o vitest passasse.
 */
function countPassedTests(stdout) {
  // ESC via String.fromCharCode(27): o Biome proíbe control chars em regex
  // literal (noControlCharactersInRegex) — \x1b literal quebrava o lint.
  const esc = String.fromCharCode(27)
  const plain = stdout.replace(new RegExp(`${esc}\\[[0-9;]*m`, 'g'), '')
  return Number(/Tests\s+(\d+) passed/i.exec(plain)?.[1] ?? 0)
}

console.log('🔒 security:check — vetores das 9 rodadas da auditoria\n')

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
  report('paginate() guard de página repetida (Rodada 5)', content.includes('previousFirstKey'))
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

// 13. Origin guard no buildUrl (Rodadas 6 + 8): o fix antigo (regex/
//     startsWith no INPUT) era contornável por backslash e whitespace/C0
//     leading — o guard agora valida o origin RESOLVIDO (`url.origin !==
//     new URL(baseUrl).origin`), cobrindo qualquer forma de escape. A
//     confirmação por execução real dos payloads está no dinâmico
//     (client.test.ts — Rodada 8).
{
  const urlModule = join(SRC, 'http', 'src', 'url.ts')
  const content = readFileSync(urlModule, 'utf8')
  report(
    'buildUrl valida origin por resultado (Rodadas 6+8)',
    content.includes('url.origin !== new URL(baseUrl).origin') &&
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
    content.includes('next.origin !== url.origin') &&
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
    content.includes('64:ff9b') &&
      content.includes('2002:') &&
      content.includes('isBlockedTransitionIPv6'),
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

// 19. Dependências internas com versão real (Rodada 7, supply chain):
//    `"@nodemelivre/*": "*"` é anti-padrão ao publicar — o `*` não fixa
//    compatibilidade e pode resolver qualquer versão publicada.
{
  const hits = []
  for (const pkg of readdirSync(SRC)) {
    if (IGNORED_DIRS.has(pkg) || pkg.startsWith('.')) continue
    const manifestPath = join(SRC, pkg, 'package.json')
    if (!statSync(manifestPath, { throwIfNoEntry: false })) continue
    const manifest = readFileSync(manifestPath, 'utf8')
    const matches = manifest.matchAll(/"(@nodemelivre\/[a-z-]+)"\s*:\s*"\*"/g)
    for (const m of matches) hits.push(`${pkg}: ${m[1]}`)
  }
  report(
    'dependências @nodemelivre/* com versão real (sem "*") (Rodada 7)',
    hits.length === 0,
    hits.slice(0, 5).join(', '),
  )
}

// 20. CI com permissions mínimas (Rodada 7, hardening): GITHUB_TOKEN
//    ilimitado por default — o workflow deve declarar `permissions: read`.
{
  const ci = join(ROOT, '.github', 'workflows', 'ci.yml')
  const publish = join(ROOT, '.github', 'workflows', 'publish-beta.yml')
  const ciContent = readFileSync(ci, 'utf8')
  const publishContent = readFileSync(publish, 'utf8')
  report(
    'ci.yml com permissions mínimas (Rodada 7)',
    ciContent.includes('permissions:') && ciContent.includes('contents: read'),
  )
  report(
    'publish-beta.yml com permissions mínimas + NPM_TOKEN (Rodada 7, npm)',
    publishContent.includes('permissions:') &&
      publishContent.includes('contents: read') &&
      !publishContent.includes('packages: write') &&
      publishContent.includes('secrets.NPM_TOKEN'),
  )
}

// 21. CI roda npm audit e security:check (Rodada 7, supply chain)
{
  const ci = join(ROOT, '.github', 'workflows', 'ci.yml')
  const content = readFileSync(ci, 'utf8')
  report('ci.yml roda npm audit (Rodada 7)', content.includes('npm audit --omit=dev'))
  report('ci.yml roda security:check (Rodada 7)', content.includes('npm run security:check'))
}

// 22. CI com timeout (Rodada 7, hardening): job sem timeout pode rodar
//    indefinidamente (custos/DoS em runners compartilhados).
{
  const ci = join(ROOT, '.github', 'workflows', 'ci.yml')
  const content = readFileSync(ci, 'utf8')
  report('ci.yml com timeout-minutes (Rodada 7)', content.includes('timeout-minutes:'))
}

// 23. Actions pinadas por SHA (Rodada 7, hardening): tag móvel (@vN) pode ser
//    sobrescrita pelo dono do repo — o CI deve apontar para um commit imutável
//    (40 hex chars) com comentário da versão.
{
  const workflows = join(ROOT, '.github', 'workflows')
  const hits = []
  for (const file of readdirSync(workflows)) {
    if (!file.endsWith('.yml') && !file.endsWith('.yaml')) continue
    const content = readFileSync(join(workflows, file), 'utf8')
    const matches = content.matchAll(/uses:\s*([^\s#]+)/g)
    for (const m of matches) {
      const version = m[1].split('@')[1]
      if (version && !/^[0-9a-f]{40}$/i.test(version)) hits.push(`${file}: ${m[1]}`)
    }
  }
  report(
    'actions pinadas por SHA (sem tag móvel @vN) (Rodada 7)',
    hits.length === 0,
    hits.slice(0, 5).join(', '),
  )
}

// 24. Dependabot configurado (Rodada 7, hardening): o pinning por SHA (item 23)
//    só é sustentável a longo prazo com atualização automática — o Dependabot
//    do ecossistema github-actions atualiza o digest preservando o comentário
//    de versão (`# v4`). Sem o arquivo, o pin estagna.
{
  const dependabot = join(ROOT, '.github', 'dependabot.yml')
  let content = ''
  try {
    content = readFileSync(dependabot, 'utf8')
  } catch {
    /* arquivo ausente → checagem falha */
  }
  report(
    'dependabot.yml com github-actions + npm (Rodada 7)',
    content.includes('package-ecosystem: github-actions') &&
      content.includes('package-ecosystem: npm'),
  )
}

// 25. PKCE: consumeState preserva o code_verifier para a troca do code
//     (ACHADO 31, Rodada 8) — o consume estaciona o verifier no fallback
//     in-memory; coberto por execução real em oauth.test.ts.
{
  const oauth = join(SRC, 'auth', 'src', 'oauth.ts')
  const content = readFileSync(oauth, 'utf8')
  report(
    'consumeState estaciona o code_verifier (ACHADO 31, Rodada 8)',
    content.includes('consumeState(state: string)') &&
      content.includes('Promise<OAuthStateEntry | null>') &&
      content.includes('this.setCodeVerifier(state, verifier)'),
  )
}

// 26. FileTokenStore: lock órfão é assumido + timeout na aquisição
//     (ACHADO 32, Rodada 8) — sem isso, um .lock stale é deadlock
//     permanente de todas as operações de token.
{
  const token = join(SRC, 'auth', 'src', 'token.ts')
  const content = readFileSync(token, 'utf8')
  report(
    'acquireLock com stale + timeout (ACHADO 32, Rodada 8)',
    content.includes('isLockStale()') &&
      content.includes('LOCK_ACQUIRE_TIMEOUT_MS') &&
      content.includes('lock_acquire_timeout'),
  )
}

// 27. DeduplicatingLogger não lança com contexto circular (ACHADO 33,
//     Rodada 8) — safe-stringify com WeakSet em makeKey; coberto por
//     execução real em logger.test.ts.
{
  const logger = join(SRC, 'core', 'src', 'logger.ts')
  const content = readFileSync(logger, 'utf8')
  report(
    'makeKey com safeStringify (ACHADO 33, Rodada 8)',
    content.includes('function safeStringify') && content.includes('WeakSet'),
  )
}

// 28. Rodada 9 — deepOmitEmpty detecta CICLOS (anti-OOM): a pilha explícita
//     do ACHADO 16 evita stack overflow, mas objeto circular entrava em loop
//     infinito até OOM do processo (confirmado por execução). O rastreio é
//     por caminho atual (WeakSet in-path), preservando DAGs legítimos.
{
  const utils = join(SRC, 'core', 'src', 'utils.ts')
  const content = readFileSync(utils, 'utf8')
  report(
    'deepOmitEmpty detecta ciclos com WeakSet in-path (A1, Rodada 9)',
    content.includes('const inPath = new WeakSet<object>()') &&
      content.includes('inPath.has(node)') &&
      content.includes('inPath.delete(frame.owner)'),
  )
}

// 29. Rodada 9 — parseBody preserva JSON literal `null` (não vira string
//     "null"): tryParseJson agora usa sentinel em vez de `parsed ?? text`.
{
  const client = join(SRC, 'http', 'src', 'client.ts')
  const content = readFileSync(client, 'utf8')
  report(
    'parseBody preserva JSON null via sentinel (A2, Rodada 9)',
    content.includes('parsed.failed ? text : parsed.value'),
  )
}

// 30. Rodada 9 — PKCE: verifier estacionado no STATE STORE compartilhado
//     (multi-instância), não só no fallback in-memory da instância.
{
  const state = join(SRC, 'auth', 'src', 'state.ts')
  const oauth = join(SRC, 'auth', 'src', 'oauth.ts')
  const stateContent = readFileSync(state, 'utf8')
  const oauthContent = readFileSync(oauth, 'utf8')
  report(
    'PKCE verifier estacionado no stateStore compartilhado (A3, Rodada 9)',
    stateContent.includes('parkCodeVerifier') &&
      stateContent.includes('getParkedCodeVerifier') &&
      oauthContent.includes('this.stateStore.parkCodeVerifier(state, verifier)') &&
      oauthContent.includes('this.stateStore.getParkedCodeVerifier(state)'),
  )
}

// 31. Contrato do OAuthStateStore ASSÍNCRONO (multi-processo real): os 9
//     métodos da interface OAuthStateStoreContract retornam Promise e o
//     OAuthClient/ facade usam await — uma regressão para síncrono quebraria
//     adaptadores com backing store remoto (Redis/banco) no callback.
{
  const state = join(SRC, 'auth', 'src', 'state.ts')
  const oauth = join(SRC, 'auth', 'src', 'oauth.ts')
  const stateContent = readFileSync(state, 'utf8')
  const oauthContent = readFileSync(oauth, 'utf8')
  report(
    'OAuthStateStoreContract assíncrono + awaits no OAuthClient (async store)',
    stateContent.includes('interface OAuthStateStoreContract') &&
      stateContent.includes('Promise<string>') &&
      stateContent.includes('Promise<OAuthStateEntry | null>') &&
      stateContent.includes('Promise<void>') &&
      oauthContent.includes('await this.stateStore') &&
      oauthContent.includes('async consumeState') &&
      oauthContent.includes('async authorizationUrl'),
  )
}

// 32. Rodada 9 — link-local IPv6 completo: fe80::/10 (fe80–febf) via
//     mascaramento de 10 bits, não startsWith('fe80') (que deixava
//     fe90/fea0/feb0/febf passarem).
{
  const schemas = join(SRC, 'core', 'src', 'schemas.ts')
  const content = readFileSync(schemas, 'utf8')
  report(
    'httpUrlSchema bloqueia fe80::/10 completo (bitmask) (A4, Rodada 9)',
    content.includes('firstHextet & 0xffc0') && content.includes('=== 0xfe80'),
  )
}

// 32. Rodada 9 — generateStateToken usa randomBytes de node:crypto (o global
//     `crypto` só existe sem flag no Node 19+; no Node 18.17 — mínimo do
//     engines — era undefined → ReferenceError no fluxo OAuth).
{
  const utils = join(SRC, 'core', 'src', 'utils.ts')
  const content = readFileSync(utils, 'utf8')
  report(
    'generateStateToken via randomBytes (Node 18 compat) (A5, Rodada 9)',
    content.includes("import { randomBytes } from 'node:crypto'") &&
      content.includes("return randomBytes(32).toString('hex')"),
  )
}

// 33. Rodada 9 — InMemoryTokenStore.set() incrementa a versão (monotônica),
//     mesmo contrato do FileTokenStore — antes RESETAVA para 1.
{
  const token = join(SRC, 'auth', 'src', 'token.ts')
  const content = readFileSync(token, 'utf8')
  report(
    'InMemoryTokenStore.set() incrementa versão (A6, Rodada 9)',
    content.includes('(this.token?.version ?? 0) + 1'),
  )
}

// 34. Rodada 9 — Webhooks.verify compara application_id NUMERICAMENTE nos
//     dois lados (payload com string "123" era falso negativo).
{
  const webhooks = join(SRC, 'webhooks', 'src', 'webhooks.ts')
  const content = readFileSync(webhooks, 'utf8')
  report(
    'Webhooks.verify compara application_id numérico (A7, Rodada 9)',
    content.includes('Number(notification.application_id) !== Number(applicationId)'),
  )
}

// 35. Rodada 9 — Questions.answer valida o payload (questionId numérico
//     positivo + text não vazio) antes de chamar a API — o ACHADO 4 só
//     cobria o reply() (mesmo vetor por outro caminho).
{
  const questions = join(SRC, 'questions', 'src', 'questions.ts')
  const content = readFileSync(questions, 'utf8')
  report(
    'Questions.answer valida payload (questionAnswerSchema) (A8, Rodada 9)',
    content.includes('questionAnswerSchema') &&
      content.includes('assertValid(questionAnswerSchema, input)'),
  )
}

// 35a. Pente fino pós-Rodada 9 — OAuthError.message SANITIZADO: o
//      `error_description` do /oauth/token (que pode ecoar dados enviados)
//      ia CRU para o message (log injection na serialização) — mesma classe
//      do ApiError.message (Rodada 3), que este caminho não cobria.
{
  const errors = join(SRC, 'errors', 'src', 'index.ts')
  const content = readFileSync(errors, 'utf8')
  report(
    'OAuthError.message sanitizado via sanitizeMessage (pente fino)',
    content.includes('function sanitizeMessage') &&
      content.includes('super(sanitizeMessage(errorDescription ?? oauthError), options)'),
  )
}

// 35b. Pente fino pós-Rodada 9 — Webhooks.parse aceita `user_id` como string
//      numérica (coerce) — o A7 cobriu o application_id, mas o parse exigia
//      `number` estrito e rejeitava notificações legítimas com user_id string.
{
  const webhooks = join(SRC, 'webhooks', 'src', 'webhooks.ts')
  const content = readFileSync(webhooks, 'utf8')
  report(
    'Webhooks.parse coage user_id string numérica (extensão do A7)',
    content.includes('Number.isSafeInteger(Number(data.user_id))') &&
      content.includes('data.user_id = Number(data.user_id)'),
  )
}

// 35c. Pente fino pós-Rodada 9 — paginate: chave do guard com `?? null` —
//      um primeiro item `undefined` (fetcher customizado) produzia chave
//      `undefined` e o guard de página repetida nunca disparava (loop
//      infinito, mesma classe do ACHADO 17).
{
  const pagination = join(SRC, 'core', 'src', 'pagination.ts')
  const content = readFileSync(pagination, 'utf8')
  report(
    'paginate: guard cobre primeiro item undefined (?? null) (pente fino)',
    content.includes('JSON.stringify(results[0] ?? null)'),
  )
}

// ============================================================================
// PENTE FINO DE CONTINUIDADE (Rodada 10) — achados C1–C10.
// Caçada ampla (agentes independentes + experimentos) sobre os pacotes que as
// Rodadas 1–9 cobriram por amostragem. Todos confirmados por execução e
// corrigidos com testes. Contrato de contagem: 60 → 70.
// ============================================================================

// 35d. C1 — HttpClient: o slot de refresh NÃO infla o orçamento de retry.
//      `retry: false` e `maxRetries: N` eram violados para TODA requisição
//      autenticada (um POST não-idempotente ganhava reenvio extra em 5xx/429).
//      A tentativa pós-refresh é gratuita e adicionada só quando ocorre.
{
  const client = join(SRC, 'http', 'src', 'client.ts')
  const content = readFileSync(client, 'utf8')
  report(
    'HttpClient: slot de refresh não infla o orçamento de retry (C1)',
    content.includes('let maxAttempts = request.retry === false ? 1 : this.retry.maxRetries + 1') &&
      content.includes('maxAttempts += 1'),
  )
}

// 35e. C2 — HttpClient: abort do usuário vira AbortError e não é retentado.
//      Antes, cancelamento era tratado como falha de rede (NetworkError) e
//      ainda retentado quando o fetch rejeitava com Error simples.
{
  const client = join(SRC, 'http', 'src', 'client.ts')
  const content = readFileSync(client, 'utf8')
  report(
    'HttpClient: abort vira AbortError sem retry (C2)',
    content.includes('request.signal?.aborted === true') &&
      content.includes('function toAbortError('),
  )
}

// 35f. C3 — HttpClient: `auth: false` não dispara refresh em 401 (nem retry).
{
  const client = join(SRC, 'http', 'src', 'client.ts')
  const content = readFileSync(client, 'utf8')
  report(
    'HttpClient: auth:false não dispara refresh em 401 (C3)',
    content.includes('request.auth !== false') && content.includes('apiError.status === 401'),
  )
}

// 35g. C4 — HttpClient: refresh que falha propaga o erro TIPADO do 401
//      original (não o erro cru do refresh) — contrato de erro da Rodada 3.
{
  const client = join(SRC, 'http', 'src', 'client.ts')
  const content = readFileSync(client, 'utf8')
  report(
    'HttpClient: falha do refresh propaga o 401 tipado (C4)',
    content.includes('throw lastError ?? apiError'),
  )
}

// 35h. C5 — RateLimiter: parse estrito dos headers (inteiro decimal) e
//      remaining ausente/vazio não bloqueia — um gateway que omitisse o
//      header fazia o SDK dormir até o reset (DoS auto-infligido).
{
  const rateLimit = join(SRC, 'http', 'src', 'rate-limit.ts')
  const content = readFileSync(rateLimit, 'utf8')
  report(
    'RateLimiter: remaining ausente/vazio não bloqueia (C5)',
    content.includes('/^\\d+$/.test(raw.trim())') &&
      content.includes('if (state.remaining === undefined) return'),
  )
}

// 35i. C6 — paginate: `paging.total` como STRING (gateway) não encolhe a
//      paginação nem encerra cedo (perda de dados) nem entra em loop (NaN).
{
  const pagination = join(SRC, 'core', 'src', 'pagination.ts')
  const content = readFileSync(pagination, 'utf8')
  report(
    'paginate: total string coercio com Number.isFinite (C6)',
    content.includes('const total = rawTotal === null ? null : Number(rawTotal)') &&
      content.includes('Number.isFinite(total)'),
  )
}

// 35j. C7 — FileTokenStore: arquivo legacy v1 (AccessToken direto) é migrado
//      para versionado — o fallback legacy só rodava quando o JSON.parse
//      LANÇAVA; um JSON válido que não batia a shape era descartado (perda
//      silenciosa de token na migração).
{
  const token = join(SRC, 'auth', 'src', 'token.ts')
  const content = readFileSync(token, 'utf8')
  report(
    'FileTokenStore: migra token legacy v1 (M1/C7)',
    content.includes('function isVersionedToken(') &&
      content.includes('if (isVersionedToken(parsed)) return parsed'),
  )
}

// 35k. C8 — TokenManager.getToken: sem refresh_token, devolve o token AINDA
//      VÁLIDO (janela de leeway) em vez de lançar missing_refresh_token e
//      derrubar requisições que ainda funcionariam.
{
  const refresh = join(SRC, 'auth', 'src', 'refresh.ts')
  const content = readFileSync(refresh, 'utf8')
  report(
    'TokenManager: token sem refresh ainda válido é usado (M2/C8)',
    content.includes('token.refreshToken === undefined && this.clock() < token.expiresAt'),
  )
}

// 35l. C9 — parseRetryAfter estrito: retry-after vazio/só-espaço não vira
//      retry imediato sem backoff (`Number('')` = 0).
{
  const errors = join(SRC, 'errors', 'src', 'index.ts')
  const content = readFileSync(errors, 'utf8')
  report(
    'retry-after vazio não vira backoff zero (F11/C9)',
    content.includes('/^\\d+(\\.\\d+)?$/.test(raw.trim())'),
  )
}

// 35m. C10 — Items.listBySeller: paginação sobre os RESULTADOS CRUS (IDs);
//      a resolução/filtragem de itens acontece numa transformação separada —
//      filtragem reduzia o length da página e o offset seguinte sobrepunha a
//      anterior (itens DUPLICADOS).
{
  const items = join(SRC, 'items', 'src', 'items.ts')
  const content = readFileSync(items, 'utf8')
  report(
    'listBySeller pagina slots crus e resolve em stream (C10)',
    content.includes('resolveSellerItemsStream(') &&
      content.includes('return resolveSellerItemsStream('),
  )
}

// 36. Fuzzer do deepOmitEmpty PRESENTE em utils.test.ts (Rodada 9+) — o
//     Estágio 3 executa o fuzzer via vitest com filtro; se o describe for
//     removido/renomeado, esta checagem falha inclusive no --static-only.
{
  const utilsTest = join(SRC, 'core', 'src', 'utils.test.ts')
  const content = readFileSync(utilsTest, 'utf8')
  report(
    'fuzzer deepOmitEmpty presente em utils.test.ts (Rodada 9+)',
    content.includes("describe('deepOmitEmpty — fuzzing"),
  )
}

// 37. Fuzzer do logger PRESENTE em logger.test.ts (Rodada 9+) — mesmo
//     papel do item 36 para o Estágio 4: logar nunca pode derrubar o
//     processo (getters que lançam, BigInt, ciclos, toJSON hostil).
{
  const loggerTest = join(SRC, 'core', 'src', 'logger.test.ts')
  const content = readFileSync(loggerTest, 'utf8')
  report(
    'fuzzer do logger presente em logger.test.ts (Rodada 9+)',
    content.includes("describe('DeduplicatingLogger — fuzzing"),
  )
}

// 38. Fuzzer do buildUrl PRESENTE em url.test.ts (Rodada 9+) — mesmo papel
//     dos itens 36-37 para o Estágio 5: o origin do buildUrl nunca pode
//     vazar (CRLF/controle no host, protocolos exóticos, whitespace/C0,
//     userinfo, backslash).
{
  const urlTest = join(SRC, 'http', 'src', 'url.test.ts')
  const content = readFileSync(urlTest, 'utf8')
  report(
    'fuzzer do buildUrl presente em url.test.ts (Rodada 9+)',
    content.includes("describe('buildUrl — fuzzing"),
  )
}

// 39. CI com CONTRATO de contagem do security:check (Rodada 9+) — o
//     `--expect-checks N` impede regressão silenciosa de cobertura: remover
//     uma checagem (ou o próprio contrato dos workflows) derruba o CI.
{
  const ci = join(ROOT, '.github', 'workflows', 'ci.yml')
  const publish = join(ROOT, '.github', 'workflows', 'publish-beta.yml')
  const ciContent = readFileSync(ci, 'utf8')
  const publishContent = readFileSync(publish, 'utf8')
  report(
    'ci.yml e publish-beta.yml com contrato --expect-checks (Rodada 9+)',
    ciContent.includes('security:check -- --expect-checks') &&
      publishContent.includes('security:check -- --expect-checks'),
  )
}

// 40. Modo de fuzzing com SEEDS ROTATIVAS (FUZZ_SEEDS) presente nos 5
//     fuzzers (Rodada 9+) — no CI (sem a env) a seed fixa determinística é
//     mantida; fora do CI, `FUZZ_SEEDS="0x…,0x…"` roda rodadas mais amplas
//     com seeds rotativas (N seeds × grafos/casos). Presença garantida no
//     --static-only, como nos itens 36-38. O regex usa lookahead negativo
//     (`(?!\w)`) para rejeitar renomeações-irmãs (ex.: `FUZZ_SEEDS_DISABLED`
//     ainda contém o substring `FUZZ_SEEDS`); exigir `forEachFuzzSeed`
//     definido E chamado (`forEachFuzzSeed(0x…` ou `forEachFuzzSeedAsync(0x…`
//     — o paginate/rate-limiter iteram via `for await`) prova que a env
//     lida é de fato usada para ROTACIONAR (não leitura inerte nem helper
//     morto).
{
  const fuzzers = [
    join(SRC, 'core', 'src', 'utils.test.ts'),
    join(SRC, 'core', 'src', 'logger.test.ts'),
    join(SRC, 'http', 'src', 'url.test.ts'),
    join(SRC, 'core', 'src', 'pagination.test.ts'),
    join(SRC, 'http', 'src', 'rate-limit.test.ts'),
  ]
  const fuzzSeedRead = /process\.env\.FUZZ_SEEDS(?![\w$])/
  const fuzzLoopCall = /forEachFuzzSeed(?:Async)?\(0x/
  const missing = fuzzers.filter((f) => {
    const content = readFileSync(f, 'utf8')
    return !(
      fuzzSeedRead.test(content) &&
      content.includes('forEachFuzzSeed') &&
      fuzzLoopCall.test(content)
    )
  })
  report(
    'fuzzers com modo FUZZ_SEEDS (seeds rotativas fora do CI)',
    missing.length === 0,
    missing.map((f) => relative(ROOT, f)).join(', '),
  )
}

// 41. Fuzzer do paginate PRESENTE em pagination.test.ts (Rodada 9+) — mesmo
//     papel dos itens 36-38 para o Estágio 6: páginas que não avançam não
//     podem voltar a causar loop infinito de requisições (ACHADO 17, Rodada 5).
{
  const paginationTest = join(SRC, 'core', 'src', 'pagination.test.ts')
  const content = readFileSync(paginationTest, 'utf8')
  report(
    'fuzzer do paginate presente em pagination.test.ts (Rodada 9+)',
    content.includes("describe('paginate — fuzzing"),
  )
}

// 42. Fuzzer do RateLimiter PRESENTE em rate-limit.test.ts (Rodada 9+) —
//     mesmo papel dos itens 36-38 para o Estágio 7: o sleep gigante do
//     ACHADO 18 (reset corrompido/gateway no futuro distante) não pode voltar.
{
  const rateLimitTest = join(SRC, 'http', 'src', 'rate-limit.test.ts')
  const content = readFileSync(rateLimitTest, 'utf8')
  report(
    'fuzzer do RateLimiter presente em rate-limit.test.ts (Rodada 9+)',
    content.includes("describe('RateLimiter — fuzzing"),
  )
}

// 43. Lockfile presente, versionado e íntegro (supply chain) — `npm ci` só é
//     reproduzível com um package-lock.json em lockfileVersion 3 (não o
//     antigo v1 sem integrity hashes). Remover o lockfile = builds
//     não-reproduzíveis (supply chain flutuante).
//     Contexto pnpm (SDK vendorizado em workspace): o artefato equivalente é
//     o pnpm-lock.yaml na raiz do workspace (ROOT ou um ancestral) — o rsync
//     do vendoring exclui o package-lock.json de propósito (o install do
//     workspace é governado pelo pnpm-lock.yaml).
{
  const lock = join(ROOT, 'package-lock.json')
  let ok = false
  let detail = 'package-lock.json ausente e pnpm-lock.yaml não encontrado'
  try {
    const lockContent = readFileSync(lock, 'utf8')
    const parsed = JSON.parse(lockContent)
    ok = parsed.lockfileVersion === 3
    detail = ok
      ? 'package-lock.json (lockfileVersion 3)'
      : 'lockfileVersion ≠ 3 (migre com npm install)'
  } catch (error) {
    // Sem package-lock.json válido (contexto npm) — procura o lock do
    // workspace pnpm em ROOT e ancestrais (cobre o SDK vendorizado). Exige
    // package.json no mesmo diretório (limite real de workspace) e lock
    // não-vazio — um pnpm-lock.yaml órfão num ancestral distante não conta.
    let dir = ROOT
    while (!ok) {
      const lockPath = join(dir, 'pnpm-lock.yaml')
      const hasLock = Boolean(statSync(lockPath, { throwIfNoEntry: false }))
      const hasManifest = Boolean(statSync(join(dir, 'package.json'), { throwIfNoEntry: false }))
      if (hasLock && hasManifest) {
        const content = readFileSync(lockPath, 'utf8')
        ok = content.trim().length > 0
        detail = ok
          ? `pnpm-lock.yaml em ${dir === ROOT ? 'ROOT' : relative(ROOT, dir)} (workspace pnpm)`
          : `pnpm-lock.yaml em ${dir === ROOT ? 'ROOT' : relative(ROOT, dir)} está vazio`
        if (ok) break
      }
      const parent = dirname(dir)
      if (parent === dir) break
      dir = parent
    }
    if (!ok) {
      detail = `package-lock.json inválido: ${error instanceof Error ? error.message : String(error)}`
    }
  }
  report('lockfile presente e íntegro (package-lock v3 ou pnpm-lock) (supply chain)', ok, detail)
}

// 44. CI usa `npm ci` (não `npm install`) — reproduzibilidade exata do
//     lockfile. `npm install` pode resolver/atualizar dependências de forma
//     silenciosa (ou escrever o lockfile) → build não-reproduzível.
{
  const ci = join(ROOT, '.github', 'workflows', 'ci.yml')
  const publish = join(ROOT, '.github', 'workflows', 'publish-beta.yml')
  const ciContent = readFileSync(ci, 'utf8')
  const publishContent = readFileSync(publish, 'utf8')
  report(
    'ci.yml/publish-beta.yml usam npm ci (não npm install) (supply chain)',
    ciContent.includes('run: npm ci') &&
      publishContent.includes('run: npm ci') &&
      !ciContent.includes('run: npm install') &&
      !publishContent.includes('run: npm install'),
  )
}

// 45. SBOM gerado no CI (supply chain) — o CycloneDX BOM é artefato
//     verificável de composição de dependências (entrada para scanners de
//     vulnerabilidade e correlação de CVEs). Remover o passo = supply chain
//     sem transparência.
{
  const ci = join(ROOT, '.github', 'workflows', 'ci.yml')
  const publish = join(ROOT, '.github', 'workflows', 'publish-beta.yml')
  const ciContent = readFileSync(ci, 'utf8')
  const publishContent = readFileSync(publish, 'utf8')
  report(
    'ci.yml/publish-beta.yml geram SBOM CycloneDX (supply chain)',
    ciContent.includes('npm sbom') && publishContent.includes('npm sbom'),
  )
}

// 46. npm audit no CI com limite explícito (supply chain) — `--audit-level`
//     define o piso de severidade que bloqueia o build; sem o nível, um
//     upgrade da CLI muda o default silenciosamente.
{
  const ci = join(ROOT, '.github', 'workflows', 'ci.yml')
  const publish = join(ROOT, '.github', 'workflows', 'publish-beta.yml')
  const ciContent = readFileSync(ci, 'utf8')
  const publishContent = readFileSync(publish, 'utf8')
  report(
    'npm audit com --audit-level explícito no CI (supply chain)',
    ciContent.includes('npm audit --omit=dev --audit-level=high') &&
      publishContent.includes('npm audit --omit=dev --audit-level=high'),
  )
}

// 47. Fuzzer do HttpClient PRESENTE em client-fuzz.test.ts (Rodada 10+) —
//     mesmo papel dos itens 36-38/41-42 para o Estágio 8: o caminho HTTP
//     REAL (redirect hostil, orçamento de retry, retry-after corrompido,
//     bodies hostis, clone O4) não pode perder o fuzzer próprio — a presença
//     no --static-only garante que a remoção/renomeação derruba o CI.
{
  const httpFuzzTest = join(SRC, 'http', 'src', 'client-fuzz.test.ts')
  const content = readFileSync(httpFuzzTest, 'utf8')
  report(
    'fuzzer do HttpClient presente em client-fuzz.test.ts (Rodada 10+)',
    content.includes("describe('HttpClient — fuzzing") &&
      content.includes('forEachFuzzSeed') &&
      content.includes('MAX_REDIRECTS'),
  )
}

// ────────────────────────────────────────────────────────────────────────────
// DINÂMICO — executa os testes que cobrem cada vetor
// ────────────────────────────────────────────────────────────────────────────

const staticOnly = process.argv.includes('--static-only')

// Contrato de contagem (CI): `--expect-checks N` (aceita `--expect-checks=N`)
// faz o script falhar se o total final não for EXATAMENTE N. O valor correto
// é o número total de `report()` — os workflows ci.yml/publish-beta.yml
// carregam o valor atual (checagem estática 39 impede a remoção do contrato).
let expectChecks
{
  const eqArg = process.argv.find((a) => a.startsWith('--expect-checks='))
  if (eqArg !== undefined) {
    expectChecks = Number(eqArg.slice('--expect-checks='.length))
  } else {
    const flagIdx = process.argv.indexOf('--expect-checks')
    if (flagIdx !== -1) expectChecks = Number(process.argv[flagIdx + 1])
  }
}
if (expectChecks !== undefined && (!Number.isInteger(expectChecks) || expectChecks <= 0)) {
  console.error(
    '❌ security:check — --expect-checks exige um inteiro positivo (ex.: --expect-checks 57)',
  )
  process.exit(1)
}

console.log('\nEstágio 2 — execução dos testes de segurança\n')

const securityTestFiles = [
  // Rodada 1: assertValidId, httpUrlSchema, redirects, reply numérico
  join('packages', 'core', 'src', 'schemas.test.ts'),
  join('packages', 'http', 'src', 'client.test.ts'),
  join('packages', 'http', 'src', 'integration.test.ts'),
  // Rodadas 6+8: origin guard do buildUrl por RESULTADO (fuzzer dedicado)
  join('packages', 'http', 'src', 'url.test.ts'),
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
  // Rodada 9: PKCE multi-instância com consumeState (A3) e verifier estacionado
  join('packages', 'auth', 'src', 'state.test.ts'),
  join('packages', 'auth', 'src', 'integration.test.ts'),
  // Rodada 5: paginate sem loop infinito, RateLimiter com teto, deepOmitEmpty
  join('packages', 'core', 'src', 'pagination.test.ts'),
  join('packages', 'http', 'src', 'rate-limit.test.ts'),
  // Rodada 6: origin guard + redirect cross-origin + Retry-After cap (client),
  // DNS wildcard + IPv6 transition (schemas), parallel sem __proto__,
  // FileTokenStore 0o600
  join('packages', 'core', 'src', 'resilience.test.ts'),
  join('packages', 'auth', 'src', 'token.test.ts'),
  // Rodada 8: origin guard por resultado (bypass whitespace/C0), PKCE
  // consumeState preserva verifier, lock stale/timeout, logger circular
  join('packages', 'core', 'src', 'logger.test.ts'),
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
// ESTÁGIO 3 — FUZZING determinístico do deepOmitEmpty (Rodada 9+)
// ────────────────────────────────────────────────────────────────────────────

if (!staticOnly) {
  console.log('\nEstágio 3 — fuzzing determinístico do deepOmitEmpty\n')

  // O fuzzer vive no describe 'deepOmitEmpty — fuzzing' de utils.test.ts
  // (PRNG mulberry32 com seed fixa; ~500 grafos combinando ciclos, DAGs,
  // chaves __proto__/constructor/prototype e cadeias de 5k–15k de
  // profundidade). Roda como ESTÁGIO PRÓPRIO — além do vitest do Estágio 2 —
  // para garantir presença no CI de segurança, independente da lista de
  // arquivos do Estágio 2.
  //
  // O exit code do vitest NÃO basta: com -t sem correspondência ele sai 0 com
  // tudo skipped (silencioso). Por isso a checagem também parseia o resumo
  // "Tests  N passed" e exige N >= 1 — se o fuzzer deixar de rodar (renomeado,
  // removido ou com os testes pulados), o estágio FALHA.
  const fuzzFile = join('packages', 'core', 'src', 'utils.test.ts')
  const fuzzResult = spawnSync(
    'npx',
    ['vitest', 'run', '--silent=true', fuzzFile, '-t', 'fuzzing'],
    { cwd: ROOT, encoding: 'utf8' },
  )
  const fuzzPassed = countPassedTests(fuzzResult.stdout)
  const fuzzOk = fuzzResult.status === 0 && fuzzPassed >= 1
  report(
    'fuzzer deepOmitEmpty rodou (ciclos, DAGs, __proto__, profundidade)',
    fuzzOk,
    fuzzOk
      ? `${fuzzPassed} testes determinísticos passaram`
      : 'vitest falhou ou não executou o fuzzer — veja acima',
  )
  if (!fuzzOk) {
    process.stdout.write(fuzzResult.stdout)
    process.stderr.write(fuzzResult.stderr)
  }
}

// ────────────────────────────────────────────────────────────────────────────
// ESTÁGIO 4 — FUZZING determinístico do DeduplicatingLogger (Rodada 9+)
// ────────────────────────────────────────────────────────────────────────────

if (!staticOnly) {
  console.log('\nEstágio 4 — fuzzing determinístico do DeduplicatingLogger\n')

  // O fuzzer vive no describe 'DeduplicatingLogger — fuzzing' de
  // logger.test.ts (PRNG mulberry32 com seed fixa; ~900 casos hostis:
  // ciclos, cadeias de cause circulares, getters que lançam, símbolos,
  // BigInt, toJSON hostil, proxies com traps que lançam e profundidade
  // 10k–20k). Invariantes: logar NUNCA lança (o safeStringify do ACHADO 33
  // absorve TypeError/RangeError), chave de dedup estável, resumo/
  // expiração e eviction não lançam. Estágio PRÓPRIO — além do vitest do
  // Estágio 2 — para garantir presença no CI de segurança. Mesmo cuidado do
  // Estágio 3: o exit code do vitest NÃO basta (filtro sem correspondência
  // sai 0 com tudo skipped) — a checagem parseia "Tests N passed" e exige
  // N >= 1.
  const loggerFuzzFile = join('packages', 'core', 'src', 'logger.test.ts')
  const loggerFuzzResult = spawnSync(
    'npx',
    ['vitest', 'run', '--silent=true', loggerFuzzFile, '-t', 'fuzzing'],
    { cwd: ROOT, encoding: 'utf8' },
  )
  const loggerFuzzPassed = countPassedTests(loggerFuzzResult.stdout)
  const loggerFuzzOk = loggerFuzzResult.status === 0 && loggerFuzzPassed >= 1
  report(
    'fuzzer do logger rodou (ciclos, getters que lançam, símbolos, BigInt)',
    loggerFuzzOk,
    loggerFuzzOk
      ? `${loggerFuzzPassed} testes determinísticos passaram`
      : 'vitest falhou ou não executou o fuzzer — veja acima',
  )
  if (!loggerFuzzOk) {
    process.stdout.write(loggerFuzzResult.stdout)
    process.stderr.write(loggerFuzzResult.stderr)
  }
}

// ────────────────────────────────────────────────────────────────────────────
// ESTÁGIO 5 — FUZZING determinístico do buildUrl (Rodada 9+)
// ────────────────────────────────────────────────────────────────────────────

if (!staticOnly) {
  console.log('\nEstágio 5 — fuzzing determinístico do buildUrl\n')

  // O fuzzer vive no describe 'buildUrl — fuzzing' de url.test.ts (PRNG
  // mulberry32 com seed fixa; 500 casos combinando URLs malformadas, host
  // com CRLF/controle, protocolos exóticos, whitespace/C0 leading, userinfo,
  // backslash e mutação aleatória). Invariantes: se buildUrl retorna, o
  // origin É o do baseUrl (o guard por RESULTADO das Rodadas 6+8 não pode
  // regredir — nenhuma forma de escape desvia o Authorization); erros são
  // sempre InputValidationError (nunca erro nativo do parser); sem CR/LF no
  // href; query round-trip. Estágio PRÓPRIO — além do vitest do Estágio 2 —
  // com o mesmo cuidado dos Estágios 3-4: o exit code do vitest NÃO basta
  // (filtro sem correspondência sai 0 com tudo skipped) — a checagem
  // parseia "Tests N passed" e exige N >= 1.
  const urlFuzzFile = join('packages', 'http', 'src', 'url.test.ts')
  const urlFuzzResult = spawnSync(
    'npx',
    ['vitest', 'run', '--silent=true', urlFuzzFile, '-t', 'fuzzing'],
    { cwd: ROOT, encoding: 'utf8' },
  )
  const urlFuzzPassed = countPassedTests(urlFuzzResult.stdout)
  const urlFuzzOk = urlFuzzResult.status === 0 && urlFuzzPassed >= 1
  report(
    'fuzzer do buildUrl rodou (URLs malformadas, CRLF, protocolos exóticos, controle)',
    urlFuzzOk,
    urlFuzzOk
      ? `${urlFuzzPassed} testes determinísticos passaram`
      : 'vitest falhou ou não executou o fuzzer — veja acima',
  )
  if (!urlFuzzOk) {
    process.stdout.write(urlFuzzResult.stdout)
    process.stderr.write(urlFuzzResult.stderr)
  }
}

// ────────────────────────────────────────────────────────────────────────────
// ESTÁGIO 6 — FUZZING determinístico do paginate (Rodada 9+)
// ────────────────────────────────────────────────────────────────────────────

if (!staticOnly) {
  console.log('\nEstágio 6 — fuzzing determinístico do paginate\n')

  // O fuzzer vive no describe 'paginate — fuzzing' de pagination.test.ts
  // (PRNG mulberry32 com seed fixa; streams aleatórios de páginas: páginas
  // que não avançam — o cenário exato do ACHADO 17 — nunca podem entrar em
  // loop infinito de requisições, entrega exata em ordem quando a API
  // avança, total null terminando na página vazia e o tradeoff do mesmo
  // primeiro item). Estágio PRÓPRIO com o mesmo cuidado dos Estágios 3-5:
  // o exit code do vitest NÃO basta (filtro sem correspondência sai 0 com
  // tudo skipped) — a checagem parseia "Tests N passed" e exige N >= 1.
  const pagFuzzFile = join('packages', 'core', 'src', 'pagination.test.ts')
  const pagFuzzResult = spawnSync(
    'npx',
    ['vitest', 'run', '--silent=true', pagFuzzFile, '-t', 'fuzzing'],
    { cwd: ROOT, encoding: 'utf8' },
  )
  const pagFuzzPassed = countPassedTests(pagFuzzResult.stdout)
  const pagFuzzOk = pagFuzzResult.status === 0 && pagFuzzPassed >= 1
  report(
    'fuzzer do paginate rodou (loop infinito, páginas que não avançam, entrega exata)',
    pagFuzzOk,
    pagFuzzOk
      ? `${pagFuzzPassed} testes determinísticos passaram`
      : 'vitest falhou ou não executou o fuzzer — veja acima',
  )
  if (!pagFuzzOk) {
    process.stdout.write(pagFuzzResult.stdout)
    process.stderr.write(pagFuzzResult.stderr)
  }
}

// ────────────────────────────────────────────────────────────────────────────
// ESTÁGIO 7 — FUZZING determinístico do RateLimiter (Rodada 9+)
// ────────────────────────────────────────────────────────────────────────────

if (!staticOnly) {
  console.log('\nEstágio 7 — fuzzing determinístico do RateLimiter\n')

  // O fuzzer vive no describe 'RateLimiter — fuzzing' de rate-limit.test.ts
  // (PRNG mulberry32 com seed fixa; 1000 combinações aleatórias de headers
  // limit/remaining/reset — epochs ms/s, relativos, futuros distantes,
  // negativos, lixo — com delay injetado que captura a espera: NUNCA acima
  // de MAX_WAIT_MS nem abaixo de 1ms, single-flight sob concorrência e
  // rateLimitKey com paths aleatórios). Estágio PRÓPRIO com o mesmo cuidado
  // dos Estágios 3-6: parse de "Tests N passed" com N >= 1.
  const rlFuzzFile = join('packages', 'http', 'src', 'rate-limit.test.ts')
  const rlFuzzResult = spawnSync(
    'npx',
    ['vitest', 'run', '--silent=true', rlFuzzFile, '-t', 'fuzzing'],
    { cwd: ROOT, encoding: 'utf8' },
  )
  const rlFuzzPassed = countPassedTests(rlFuzzResult.stdout)
  const rlFuzzOk = rlFuzzResult.status === 0 && rlFuzzPassed >= 1
  report(
    'fuzzer do RateLimiter rodou (espera nunca > MAX_WAIT_MS, single-flight)',
    rlFuzzOk,
    rlFuzzOk
      ? `${rlFuzzPassed} testes determinísticos passaram`
      : 'vitest falhou ou não executou o fuzzer — veja acima',
  )
  if (!rlFuzzOk) {
    process.stdout.write(rlFuzzResult.stdout)
    process.stderr.write(rlFuzzResult.stderr)
  }
}

// ────────────────────────────────────────────────────────────────────────────
// ESTÁGIO 8 — FUZZING determinístico do caminho HTTP REAL (Rodada 10+)
// ────────────────────────────────────────────────────────────────────────────

if (!staticOnly) {
  console.log('\nEstágio 8 — fuzzing determinístico do HttpClient\n')

  // O fuzzer vive no describe 'HttpClient — fuzzing' de client-fuzz.test.ts
  // (PRNG mulberry32 com seed fixa). Exercita o `HttpClient.request` por
  // inteiro com um fetch HOSTIL: cadeias aleatórias de redirects (Location
  // oficiais/maliciosos/downgrade/lixo), status de retry, retry-after
  // corrompido e bodies malformados. Invariantes: o Authorization NUNCA
  // chega a um origin ≠ do baseUrl (nem via redirect cross-origin); nunca
  // mais que MAX_REDIRECTS+1 fetches (anti-loop); sem downgrade https→http;
  // orçamento de retry exato (nunca mais que maxRetries+1 tentativas);
  // retry-after corrompido nunca dorme além de MAX_WAIT_MS; corpos hostis
  // nunca lançam erro nativo de parse. Estágio PRÓPRIO — com o mesmo cuidado
  // dos Estágios 3-7: o exit code do vitest NÃO basta (filtro sem
  // correspondência sai 0 com tudo skipped) — a checagem parseia "Tests N
  // passed" e exige N >= 1.
  const httpFuzzFile = join('packages', 'http', 'src', 'client-fuzz.test.ts')
  const httpFuzzResult = spawnSync(
    'npx',
    ['vitest', 'run', '--silent=true', httpFuzzFile, '-t', 'fuzzing'],
    { cwd: ROOT, encoding: 'utf8' },
  )
  const httpFuzzPassed = countPassedTests(httpFuzzResult.stdout)
  const httpFuzzOk = httpFuzzResult.status === 0 && httpFuzzPassed >= 1
  report(
    'fuzzer do HttpClient rodou (redirect hostil, retry exato, retry-after, bodies hostis, clone O4)',
    httpFuzzOk,
    httpFuzzOk
      ? `${httpFuzzPassed} testes determinísticos passaram`
      : 'vitest falhou ou não executou o fuzzer — veja acima',
  )
  if (!httpFuzzOk) {
    process.stdout.write(httpFuzzResult.stdout)
    process.stderr.write(httpFuzzResult.stderr)
  }
}

// ────────────────────────────────────────────────────────────────────────────

console.log(`\n📊 ${checks - failures}/${checks} checagens passaram\n`)
if (failures > 0) {
  console.error(`❌ security:check FALHOU (${failures} violação(ões))`)
  process.exit(1)
}
// Contrato de contagem (CI): `--expect-checks N` exige EXATAMENTE N. Abaixo
// = regressão (checagem removida/desativada silenciosamente); acima =
// contrato desatualizado (atualizar ci.yml/publish-beta.yml e os docs).
if (expectChecks !== undefined && expectChecks !== checks) {
  console.error(
    `❌ security:check — contrato de checagens violado: esperado ${expectChecks}, encontrado ${checks}` +
      (checks < expectChecks
        ? ' (ABAIXO — regressão: alguma checagem foi removida/desativada?)'
        : ' (ACIMA — atualize o contrato no ci.yml/publish-beta.yml e nos docs)'),
  )
  process.exit(1)
}
console.log('✅ security:check — todos os vetores das 10 rodadas verificados')
