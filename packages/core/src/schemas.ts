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

/** URL http(s) válida — rejeita protocolos locais ou exóticos (ex.: upload por URL). */
export const httpUrlSchema: ValidationSchema<string> = makeSchema((value) => {
  if (typeof value !== 'string') return ['deve ser uma string']
  if (isHttpUrl(value)) return []
  return ['URL deve ser http(s) válida para upload por URL']
})

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

/** Arquivo (Blob) com conteúdo — rejeita upload vazio antes de enviar. */
export const nonEmptyFileSchema: ValidationSchema<Blob> = makeSchema((value) =>
  value instanceof Blob && value.size > 0 ? [] : ['Imagem vazia — envie um arquivo com conteúdo'],
)
