import { createHash, randomBytes } from 'node:crypto'

/** Métodos de derivação do `code_challenge` suportados pelo Mercado Livre. */
export type PkceMethod = 'S256' | 'plain'

const CODE_VERIFIER_BYTES = 32

/**
 * Gera um `code_verifier` aleatório (RFC 7636 §4.1).
 *
 * São 32 bytes aleatórios codificados em base64url (43 caracteres), dentro do
 * alfabeto `[A-Za-z0-9-._~]` e do tamanho exigido (43–128 caracteres).
 */
export function generateCodeVerifier(bytes: number = CODE_VERIFIER_BYTES): string {
  if (!Number.isInteger(bytes) || bytes < 32 || bytes > 96) {
    throw new RangeError('code_verifier deve ter entre 32 e 96 bytes aleatórios')
  }
  return randomBytes(bytes).toString('base64url')
}

/**
 * Deriva o `code_challenge` a partir do `code_verifier` (RFC 7636 §4.2).
 *
 * - `S256`: `base64url(SHA-256(verifier))` — recomendado.
 * - `plain`: o próprio verifier (apenas para compatibilidade, menos seguro).
 */
export function generateCodeChallenge(verifier: string, method: PkceMethod = 'S256'): string {
  if (verifier.length < 43 || verifier.length > 128) {
    throw new RangeError('code_verifier deve ter entre 43 e 128 caracteres')
  }
  if (method === 'plain') return verifier
  return createHash('sha256').update(verifier, 'utf8').digest('base64url')
}
