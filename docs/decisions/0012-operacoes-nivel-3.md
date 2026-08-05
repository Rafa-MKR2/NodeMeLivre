# ADR-0012: Operações nível 3 — createAndPublish, reply e printLabel

- **Status:** Aceita
- **Data:** 2026-08-05
- **Autor:** Rafael

## Contexto

A Prioridade B do roadmap lista operações de negócio compostas que economizam chamadas e expressam intenção (v0.4). Faltavam: publicar anúncio completo (criar + ativar), responder pergunta com ergonomia e baixar a etiqueta de envio. A etiqueta é um caso especial: o endpoint retorna **binário** (PDF/ZPL), e o transport atual só decodifica JSON/texto.

## Problema

Como expor essas operações compostas mantendo a ergonomia (ADR-0010) e como baixar a etiqueta binária sem corromper o PDF?

## Solução

### `Items.createAndPublish(input)`

Novo método em `@nodemelivre/items`: cria o item (`POST /items`) e, se ele não nascer `active` (categorias moderadas costumam nascer `under_review`), publica via `updateStatus('active')`. **Não** vira overload de `publish(itemId)` para evitar API ambígua — o alias simples continua para itens já existentes.

- **Alternativa A:** sobrecarregar `publish(string | ItemInput)` — rejeitada: mesmo nome com significados diferentes confunde o integrador.
- **Alternativa B:** expor apenas `create()` e deixar o integrador chamar `publish()` — rejeitada: é exatamente o fluxo repetitivo que a Prioridade B quer eliminar.
- **Escolhida:** método dedicado, porque nome claro + fluxo automático.

### `Questions.reply(questionId, text)`

Alias ergonômico de `answer({ questionId, text })`. Responder via `POST /answers` **já** muda o status da pergunta para `ANSWERED` — não existe endpoint separado de "marcar como lida" em questions. O alias existe porque o roadmap previu `reply(questionId, text)` e essa assinatura é a forma natural de uso no chat de perguntas.

### `Shipments.printLabel(ids, { format? })` + `responseType`

A etiqueta é obtida via `GET /shipment_labels?shipment_ids=...&response_type=pdf|zpl2` e devolve um arquivo binário. Para não corromper o PDF:

- Novo campo `responseType?: 'json' | 'text' | 'arraybuffer'` em `ResourceRequest` (`@nodemelivre/core`) e em `HttpClientRequest` (`@nodemelivre/http`).
- `HttpClient.parseBody` passa a respeitar o formato: `arraybuffer` → `response.arrayBuffer()`, `text` → `response.text()`, `json` (padrão) → JSON ou texto.
- `Shipments.printLabel(shipmentId | ids[], { format? })` aceita um ou vários envios e retorna `Promise<ArrayBuffer>`. Formato padrão `pdf`; aceita `zpl2` para impressoras Zebra.

- **Alternativa A:** retornar a label como `string` (o client já devolvia texto quando não era JSON) — rejeitada: o PDF binário é corrompido ao ser decodificado como texto.
- **Alternativa B:** dependência externa de download — rejeitada: `response.arrayBuffer()` já resolve com o fetch nativo (ADR-0002).
- **Escolhida:** `responseType` no transport, porque é uma extensão mínima e reutilizável por qualquer endpoint binário futuro.

## Consequências

- (+) `ml.items.createAndPublish(input)` entrega anúncio publicado de ponta a ponta.
- (+) `ml.questions.reply(5, 'texto')` responde e marca como respondida de forma ergonômica.
- (+) `ml.shipments.printLabel(9)` retorna o PDF como `ArrayBuffer` íntegro; o integrador monta `new Blob([buffer], { type: 'application/pdf' })`.
- (+) `responseType` é um mecanismo geral: qualquer resource futuro que retorne binário/plano usa sem mudar o client.
- (-) `createAndPublish` não cobre `questions`/`promotions` que o ML às vezes exige para publicar certas categorias — o item pode nascer `under_review` e ficar ativo após moderação.
- (-) A label exige o envio com status `ready_to_ship` (e substatus `ready_to_print`); casos de `me1`/fulfillment retornam erro da API (`invalid_shipment_ff_public`, etc.).

### Quando revisitar

Se o ML passar a exigir passos extras de publicação (ex.: questões obrigatórias), `createAndPublish` ganha opções de configuração. Se surgirem mais endpoints binários, avaliar `Shipments.printLabel` retornando `Blob` (com `type`) em vez de `ArrayBuffer`.
