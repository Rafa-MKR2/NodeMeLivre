# ADR-0007: Disciplina de tipos — unions para enums fechados

- **Status:** Aceita
- **Data:** 2026-08-04
- **Autor:** Rafael

## Contexto

A API do Mercado Livre usa strings para campos com valores fixos (ex.: `Item.listing_type_id = "gold_pro"`, `Order.status = "paid"`). Tipar tudo como `string` perde validação em compile-time e autocomplete.

## Problema

- `string` aceita qualquer valor — erros de digitação só aparecem em runtime
- Autocomplete não sugere valores válidos da API
- Refatoração de endpoints que mudam enums vira caça a strings

## Solução

Modelar **todo campo com conjunto fechado de valores** como **union de string literals** no `@nodemelivre/types`:

| Domínio | Tipos union criados |
|---|---|
| Item | `ListingTypeId`, `ShippingMode` |
| Order | `OrderStatus`, `PaymentStatus`, `ShipmentType` |
| Question | `QuestionStatus`, `AnswerStatus` |
| Shipment | `ShipmentStatus`, `ShippingType` |
| User | `UserType`, `SiteStatus`, `ReputationLevelId` |

Campos abertos (ex.: `tags: string[]`, `description: string`) permanecem `string`.

## Alternativas

- **A:** Usar `string` em tudo — simples, mas perde type-safety.
- **B:** Enums TypeScript (`enum Status { Paid = 'paid' }`) — compila para objeto, não para string literal; não reflete JSON da API.
- **C:** `type Status = 'paid' | 'cancelled'` — **escolhida**. É string literal, some no runtime, autocomplete funciona.

## Consequências

- (+) Erro de digitação em `status: 'padi'` falha no `npm run typecheck`
- (+) IDE sugere valores válidos ao digitar `order.status =`
- (+) Refatoração segura: mudar union atualiza todos os call sites
- (-) Precisa manter unions sincronizados com API ML — mitigado: documentar no tipo a fonte (ex.: `// ML API: /orders`)

## Quando revisitar

Se a API adicionar valores novos sem versionamento, unions podem ficar desatualizados. Monitorar changelog do ML.