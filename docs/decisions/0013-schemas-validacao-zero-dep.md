# ADR-0013: Validação centralizada por schemas (zero dependências)

- **Status:** Aceita
- **Data:** 2026-08-08
- **Autor:** Rafael (com suporte de revisão por IA)

## Contexto

A validação de entrada estava **dispersa**: `assertValidItemInput` (com 15+ checks
inline) em `packages/items/src/items.ts`, validação de texto em
`packages/messages/src/messages.ts` e validação de arquivo/URL em
`packages/images/src/images.ts`. Cada resource validava "do seu jeito", as
regras de negócio ficavam escondidas em `private function` e era impossível
testar a validação isoladamente sem instanciar resource + transport mock
(ANALISE_QUALIDADE_TECNICA, Fase 2).

## Problema

Escolher **onde e como** centralizar a validação sem quebrar a disciplina do
monorepo: zero dependências de runtime (ADR-0002), tipos de domínio em
`@nodemelivre/types` e separação de camadas core → recursos.

## Solução

Criar um **mini-DSL de validação tipado e zero-dependência** em
`@nodemelivre/core` (`schemas.ts`), com a mesma intenção de Zod/Valibot mas
sem runtime externo, e os **schemas de domínio** (`domain-schemas.ts`) no
mesmo pacote:

```ts
// packages/core/src/schemas.ts (primitivas)
string(), number({ integer: true, positive: true }), enumOf([...]),
optional(schema), arrayOf(schema), object(shape, { refinements }),
makeSchema(check), assertValid(schema, value)
httpUrlSchema, nonEmptyFileSchema

// packages/core/src/domain-schemas.ts (fonte única da verdade)
itemInputCreateSchema, itemInputPartialSchema, orderSearchParamsSchema
```

- **Resources** trocam a validação inline por `assertValid(schema, value)`:
  `items.create/update`, `orders.search/list`, `messages.send`,
  `images.upload/uploadFromUrl`.
- **Mensagens de erro preservadas** (as regras reproduzem as validações
  históricas) — consumidores não quebram; os testes de resource existentes
  continuam verdes sem edição.
- **Testável em isolamento**: `schemas.test.ts` valida DSL e schemas de
  domínio sem instanciar resources.

### Decisões de arquitetura

- **`object<T extends object>`** (não `Record<string, unknown>`): interfaces
  TS não têm index signature implícita; a constraint precisa aceitar
  `ItemInput`/`OrderSearchParams`.
- **`core` passa a depender de `@nodemelivre/types`** (edge novo, sem ciclo:
  `types` é folha). O build do root foi reordenado para construir `types`
  antes de `core`; builds standalone de `core` exigem `types/dist` presente
  (o `tsconfig.build.json` usa `paths: {}` e resolve via node_modules).
- **Semântica de `optional()`:** `undefined` = campo ausente (válido);
  `null` = valor inválido (rejeitado pelo schema interno) — mesma semântica
  histórica de `assertValidItemInput` e coerente com o `deepOmitEmpty`, que
  preserva `null` intencional apenas no payload enviado.
- **Schemas de domínio no core** (não em cada resource): habilitam a futura
  Fase 2.2 — validator middleware no `ResourceTransport` (validar request
  antes de sair e response ao chegar) — sem espalhar regras pelos pacotes.
- **Regras entre campos** via `refinements` (ex.: `title` XOR `family_name`,
  obrigatórios na criação), mantendo a mesma semântica de `assertValidItemInput`
  com `partial`.

### O que foi eliminado

- `assertValidItemInput` + validadores inline em `items.ts`
- Check inline de texto em `messages.ts`
- Check inline de arquivo/URL em `images.ts` (incluindo `isHttpUrl` local)
- Duplicação de regras de validação entre recursos

## Alternativas consideradas

- **Zod**: robusto e popular, mas adiciona a 1ª dependência de runtime do
  monorepo e pesa no bundle do SDK.
- **Valibot**: leve e tree-shakeable, porém ainda assim uma dependência externa
  — contraria o ADR-0002 (menor superfície de ataque e de atualização).
- **Escolhida:** DSL própria (~150 LOC) com o subconjunto necessário
  (`string/number/enumOf/optional/arrayOf/object` + refinements). Zero
  dependências, tipada e com mensagens controladas por nós.

## Consequências

- (+) Validação centralizada, declarativa e testável em isolamento.
- (+) Zero dependências de runtime mantido (segurança/superfície de ataque).
- (+) Base pronta para o validator middleware no `ResourceTransport`.
- (-) DSL própria exige manutenção própria (sem ecossistema de schemas);
  se no futuro houver necessidade de validação muito mais rica, a migração é
  localizada em `schemas.ts`.

## Referências

- ADR-0002 (HTTP via fetch nativo — filosofia zero dependência)
- ADR-0007 (disciplina de tipos: unions para enums fechados)
- ANALISE_QUALIDADE_TECNICA.md (Fase 2 — Validação Centralizada)
