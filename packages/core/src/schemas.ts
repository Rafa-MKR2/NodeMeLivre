import { InputValidationError } from '@nodemelivre/errors'

/**
 * Validação por schemas — zero dependências de runtime.
 *
 * Mini-DSL tipado com a mesma intenção de Zod/Valibot, sem runtime externo
 * (mantém a filosofia do ADR-0002: menor superfície de ataque e de
 * atualização). Um `ValidationSchema<T>` inspeciona um valor desconhecido e
 * produz problemas legíveis — o contrato único usado por qualquer resource
 * do SDK (items, orders, messages, images) e testável em isolamento.
 */

/** Problema de validação (mensagem legível ao consumidor). */
export type SchemaIssue = string

/** Schema de validação tipado: `check` coleta problemas; `parse` falha rápido. */
export interface ValidationSchema<T> {
  /** Problemas encontrados; array vazio quando o valor é válido. */
  check(value: unknown): SchemaIssue[]
  /** Valida e devolve o valor tipado; lança `InputValidationError` na primeira falha. */
  parse(value: unknown): T
}

/** Constrói um schema a partir de uma função `check` pura. */
export function makeSchema<T>(check: (value: unknown) => SchemaIssue[]): ValidationSchema<T> {
  return {
    check,
    parse(value: unknown): T {
      const issues = check(value)
      if (issues.length > 0) {
        throw new InputValidationError(issues[0] ?? 'valor inválido')
      }
      return value as T
    },
  }
}

/** Valida um valor contra o schema e devolve o valor tipado (lança na falha). */
export function assertValid<T>(schema: ValidationSchema<T>, value: unknown): T {
  return schema.parse(value)
}

export interface StringSchemaOptions {
  /** Comprimento mínimo (inclusive). */
  minLength?: number
  /** Comprimento máximo (inclusive). */
  maxLength?: number
}

export function string(options: StringSchemaOptions = {}): ValidationSchema<string> {
  return makeSchema((value) => {
    if (typeof value !== 'string') return ['deve ser uma string']
    const issues: SchemaIssue[] = []
    if (options.minLength !== undefined && value.length < options.minLength) {
      issues.push(`comprimento mínimo de ${options.minLength} caracteres`)
    }
    if (options.maxLength !== undefined && value.length > options.maxLength) {
      issues.push(`comprimento máximo de ${options.maxLength} caracteres`)
    }
    return issues
  })
}

export interface NumberSchemaOptions {
  /** Deve ser inteiro. */
  integer?: boolean
  /** Deve ser maior que zero. */
  positive?: boolean
  /** Valor mínimo (inclusive). */
  min?: number
}

export function number(options: NumberSchemaOptions = {}): ValidationSchema<number> {
  return makeSchema((value) => {
    if (typeof value !== 'number' || !Number.isFinite(value)) return ['deve ser um número']
    const issues: SchemaIssue[] = []
    if (options.integer === true && !Number.isInteger(value)) issues.push('deve ser um inteiro')
    if (options.positive === true && value <= 0) issues.push('deve ser um número positivo')
    if (options.min !== undefined && value < options.min) issues.push(`mínimo de ${options.min}`)
    return issues
  })
}

export function booleanValue(): ValidationSchema<boolean> {
  return makeSchema((value) => (typeof value === 'boolean' ? [] : ['deve ser um booleano']))
}

/** Union fechada de strings (mesma disciplina do ADR-0007 nos tipos). */
export function enumOf<T extends string>(values: readonly T[]): ValidationSchema<T> {
  return makeSchema((value) =>
    typeof value === 'string' && (values as readonly string[]).includes(value)
      ? []
      : [`deve ser um de: ${values.join(', ')}`],
  )
}

/**
 * Campo opcional: `undefined` passa (ausente); valor presente é validado
 * pelo schema interno. `null` NÃO passa — é tratado como valor inválido
 * (mesma semântica histórica de `assertValidItemInput`).
 */
export function optional<T>(schema: ValidationSchema<T>): ValidationSchema<T | undefined> {
  return makeSchema((value) => (value === undefined ? [] : schema.check(value)))
}

export function arrayOf<T>(schema: ValidationSchema<T>): ValidationSchema<T[]> {
  return makeSchema((value) => {
    if (!Array.isArray(value)) return ['deve ser um array']
    const issues: SchemaIssue[] = []
    for (const item of value) {
      issues.push(...schema.check(item))
    }
    return issues
  })
}

export interface ObjectSchemaOptions<T> {
  /** Regras entre campos (ex.: obrigatório na criação, mutuamente exclusivos). */
  refinements?: Array<(value: T) => SchemaIssue | null>
}

/**
 * Objeto com shape tipado. Chaves ausentes em `value` passam pelo schema da
 * chave (`optional(...)` decide se a ausência é válida); refinements avaliam
 * regras entre campos após a validação por campo.
 *
 * A constraint é `object` (não `Record<string, unknown>`) para aceitar
 * interfaces como `ItemInput`/`OrderSearchParams` — interfaces TS não têm
 * index signature implícita.
 */
export function object<T extends object>(
  shape: { [K in keyof T]-?: ValidationSchema<T[K]> },
  options: ObjectSchemaOptions<T> = {},
): ValidationSchema<T> {
  return makeSchema((value) => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return ['deve ser um objeto']
    }
    const issues: SchemaIssue[] = []
    const entries = Object.entries(shape) as Array<[string, ValidationSchema<unknown>]>
    for (const [key, schema] of entries) {
      issues.push(...schema.check((value as Record<string, unknown>)[key]))
    }
    if (options.refinements !== undefined) {
      for (const refine of options.refinements) {
        const issue = refine(value as T)
        if (issue !== null) issues.push(issue)
      }
    }
    return issues
  })
}

/**
 * URL http(s) válida — rejeita protocolos locais ou exóticos (ex.: upload por URL).
 *
 * Além do protocolo, bloqueia destinos que poderiam ser usados em SSRF:
 * `localhost`, IPs de loopback (127/8), ranges privados (10/8, 172.16/12,
 * 192.168/16), link-local/metadata de nuvem (169.254.0.0/16, fe80::/10) e
 * hostnames de metadata (metadata.google.internal).
 */
export const httpUrlSchema: ValidationSchema<string> = makeSchema((value) => {
  if (typeof value !== 'string') return ['deve ser uma string']
  if (!isHttpUrl(value)) return ['URL deve ser http(s) válida para upload por URL']
  if (isBlockedHttpHost(value)) {
    return ['URL bloqueada: endereços locais, privados ou de metadados não são permitidos']
  }
  return []
})

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * Detecta hosts usados em ataques SSRF (IPs privados/locais e metadata cloud).
 * A verificação é sintática sobre o hostname — `new URL` já validou o formato.
 */
function isBlockedHttpHost(value: string): boolean {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }
  // `localhost.` (trailing dot) é o mesmo host de `localhost` para a maioria
  // dos resolvers (FQDN absoluto) — normalizamos antes de comparar para que
  // um bypass por trailing dot não escape do bloqueio.
  const host = url.hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, '') // remove colchetes de IPv6
    .replace(/\.+$/, '') // remove trailing dots de hostname (FQDN absoluto)

  if (host === 'localhost' || host.endsWith('.localhost')) return true
  if (host === 'metadata' || host === 'metadata.google.internal') return true

  if (isIPv4Literal(host)) {
    return isBlockedIPv4(host)
  }

  if (host.includes(':')) {
    // IPv6: loopback, link-local e ULA
    if (host === '::1' || host === '::' || host === '0:0:0:0:0:0:0:1') return true
    if (host.startsWith('fe80') || host.startsWith('fc') || host.startsWith('fd')) return true
    // IPv4-mapeado em IPv6 (::ffff:127.0.0.1) — roteia para loopback/privado
    // em muitos sistemas; reaplica a checagem de octetos no IPv4 embutido.
    // O WHATWG URL normaliza para hex (`::ffff:7f00:1`), então tratamos as
    // duas representações (dotted e dois grupos hex de 16 bits).
    const dotted = host.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/)?.slice(1)
    if (dotted?.[0] !== undefined) {
      return isBlockedIPv4(dotted[0])
    }
    const hex = host.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i)?.slice(1)
    if (hex?.[0] !== undefined && hex[1] !== undefined) {
      const hi = Number.parseInt(hex[0], 16)
      const lo = Number.parseInt(hex[1], 16)
      const ip = `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`
      return isBlockedIPv4(ip)
    }
  }

  return false
}

/** Verifica octetos de um IPv4 literal contra ranges privados/locais. */
function isBlockedIPv4(ip: string): boolean {
  const octets = ip.split('.').map((n) => Number(n))
  const a = octets[0]
  const b = octets[1]
  if (a !== undefined && a === 0) return true // 0.0.0.0/8
  if (a === 10) return true // 10/8 privado
  if (a === 127) return true // loopback
  if (a === 169 && b === 254) return true // 169.254/16 link-local/metadata
  if (a === 172 && b !== undefined && b >= 16 && b <= 31) return true // 172.16/12 privado
  if (a === 192 && b === 168) return true // 192.168/16 privado
  if (a === 100 && b !== undefined && b >= 64 && b <= 127) return true // 100.64/10 CGNAT
  return false
}

function isIPv4Literal(host: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host)
}

/**
 * Padrão seguro para IDs de recursos do Mercado Livre interpolados em paths.
 * Aceita `MLB123`, números, `_` e `-` — rejeita `/`, `.` (traversal), espaços
 * e qualquer byte que mude a estrutura da URL.
 */
const SAFE_ID_PATTERN = /^[A-Za-z0-9_-]+$/

/**
 * Valida um ID de recurso antes de interpolá-lo no path da API.
 *
 * Bloqueia path traversal (`../../users/me`), caracteres que alteram a URL
 * (`/`, `?`, `#`, espaço) e valores que degradam o contrato (NaN, negativo,
 * vazio). Lança `InputValidationError` na falha — mesmo erro tipado do SDK.
 */
export function assertValidId(value: string | number, label = 'id'): void {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new InputValidationError(`${label} inválido: deve ser um inteiro não-negativo`)
    }
    return
  }
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 100 ||
    !SAFE_ID_PATTERN.test(value)
  ) {
    throw new InputValidationError(
      `${label} inválido: use apenas letras, números, "_" ou "-" (sem "/", "." ou espaços)`,
    )
  }
}

/** Arquivo (Blob) com conteúdo — rejeita upload vazio antes de enviar. */
export const nonEmptyFileSchema: ValidationSchema<Blob> = makeSchema((value) =>
  value instanceof Blob && value.size > 0 ? [] : ['Imagem vazia — envie um arquivo com conteúdo'],
)
