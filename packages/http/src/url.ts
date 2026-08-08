import { InputValidationError } from '@nodemelivre/errors'

/**
 * Single source of truth para montagem e validação de URLs do transporte.
 *
 * Centraliza a disciplina de origem/host aplicada em TODOS os pontos que
 * resolvem URLs (Rodada 8/9 — classe "validação de URL/origin"): a checagem
 * é feita sobre o RESULTADO do parse, não sobre o input. Isso elimina a
 * caçada por formas de escape (backslash, whitespace/C0 leading, trailing
 * dot, protocol-relative) — cada fix anterior vivia em um ponto diferente e
 * era contornado por uma variante nova.
 */

/** Query params aceitos pelo transporte. */
export type UrlQuery = Record<string, string | number | boolean | undefined>

/** Hosts para os quais redirecionamentos são autorizados (além do próprio baseUrl). */
export const ALLOWED_REDIRECT_HOSTS = new Set(['api.mercadolibre.com', 'api.mercadolivre.com.br'])

/** Máximo de redirecionamentos seguidos manualmente (anti-loop). */
export const MAX_REDIRECTS = 5

/**
 * Monta a URL da requisição garantindo que o path seja RELATIVO ao baseUrl.
 *
 * A validação é por RESULTADO: após o parse, o origin resolvido precisa ser o
 * mesmo do `baseUrl`. Isso cobre qualquer forma de escape — backslash (`\`
 * vira `/` na posição de autoridade do WHATWG URL), whitespace/C0 leading
 * (ignorados pelo parser), path absoluto (`https://evil.com/x`) e
 * protocol-relative (`//evil.com/x`) — sem depender de regex de input.
 *
 * Um path que resolva para outro origin lança `InputValidationError` antes de
 * qualquer fetch: o `Authorization` nunca sai do processo.
 */
export function buildUrl(baseUrl: string, path: string, query?: UrlQuery): URL {
  let url: URL
  try {
    url = new URL(path, baseUrl)
  } catch {
    throw new InputValidationError(
      'path inválido — deve ser relativo ao baseUrl (ex.: /items/MLB1)',
    )
  }
  // Checagem de origem sobre o resultado: `\\evil.com/x`, `  //evil.com/x`,
  // `\thttps://evil.com/y` resolvem para outro origin e são rejeitados aqui.
  if (url.origin !== new URL(baseUrl).origin) {
    throw new InputValidationError(
      'path deve ser relativo ao baseUrl (sem protocolo nem host) — use ex.: /items/MLB1',
    )
  }
  for (const [name, value] of Object.entries(query ?? {})) {
    if (value !== undefined) {
      url.searchParams.set(name, String(value))
    }
  }
  return url
}

/**
 * Valida e resolve um destino de redirecionamento.
 *
 * Autoriza apenas: mesmo host do origin atual (ou subdomínio), ou os hosts
 * oficiais do Mercado Livre. Rejeita downgrade https→http e qualquer outro
 * protocolo/host — um `Location` malicioso (ex.: endpoint de metadata da
 * nuvem) nunca recebe o `Authorization` do SDK.
 */
export function resolveRedirectTarget(current: URL, location: string): URL | null {
  let next: URL
  try {
    next = new URL(location, current)
  } catch {
    return null
  }

  // Nunca rebaixar https→http nem aceitar protocolos não-HTTP.
  if (next.protocol !== 'https:' && next.protocol !== 'http:') return null
  if (current.protocol === 'https:' && next.protocol !== 'https:') return null

  const host = next.hostname.toLowerCase()
  const currentHost = current.hostname.toLowerCase()
  const sameHost = host === currentHost
  const subdomain = host.endsWith(`.${currentHost}`)
  const official = [...ALLOWED_REDIRECT_HOSTS].some((h) => host === h || host.endsWith(`.${h}`))
  if (!sameHost && !subdomain && !official) return null
  return next
}
