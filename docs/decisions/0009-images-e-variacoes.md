# ADR-0009: Resource images (upload) e variações de item

- **Status:** Aceita
- **Data:** 2026-08-05
- **Autor:** Rafael

## Contexto

O v0.1 só cria anúncios "quebrados": `ItemInput.pictures` aceita apenas URLs externas (`{ source }`), sem upload para o CDN do Mercado Livre, e não há suporte a variações (SKU, cor/tamanho). Para destravar a operação real do vendedor (v0.2), precisamos: (1) enviar imagem para `POST /pictures/items/upload` e usar o `id` retornado no anúncio; (2) modelar `variations` no payload do item.

## Problema

Como adicionar upload de arquivos e variações sem quebrar a arquitetura modular (ADR-0005) e a disciplina de tipos (ADR-0007)?

## Solução

### Resource `@nodemelivre/images`

Novo pacote por domínio seguindo ADR-0004/0005, com `Images.upload(file: Blob | Buffer)` que monta um `FormData` e posta em `/pictures/items/upload` via multipart. Retorna `ImageUploadResponse` (id + variações de tamanho no CDN).

### Suporte a multipart no `HttpClient`

O `HttpClient` serializava todo body como JSON. Foi adicionada detecção de `BodyInit` (string, `Blob`, `FormData`, `URLSearchParams`, `ArrayBuffer`, `ArrayBufferView`): quando o body é um desses, é passado direto ao fetch sem `JSON.stringify` e sem forçar `content-type` (o `FormData` define o boundary automaticamente).

### Variações em itens

Novos tipos em `@nodemelivre/types`:
- `VariationAttribute` — combinação nome/valor (ex.: `{ name: 'Color', value_name: 'Red' }`).
- `ItemVariation` — variação existente (com `id`, preço, quantidade, `picture_ids`).
- `ItemVariationInput` — payload de criação/atualização.
- `Item.variations?: ItemVariation[]` e `ItemInput.variations?: ItemVariationInput[]`.

O `Items.create`/`update` já repassam o body integral, então as variações fluem sem mudar o resource `Items`.

- **Alternativa A:** upload via `Buffer` cru com header `content-type` manual — frágil, sem boundary, quebrado no undici.
- **Alternativa B:** dependência externa de multipart (`form-data`) — peso extra sem necessidade; `FormData` é global no Node 18+.
- **Escolhida:** `FormData` nativo + detecção de `BodyInit` no `HttpClient`, porque reusa o transport único (auth/retry/rate-limit) e o fetch nativo (ADR-0002).

## Consequências

- (+) Vendedor cria anúncio com foto: `ml.images.upload(file)` → usa `id` em `pictures`/`picture_ids`.
- (+) Variações de SKU/cor/tamanho fluem pelo `Items.create/update` sem mudança no resource.
- (+) Novo pacote `@nodemelivre/images` isolado, publicado de forma independente (ADR-0005).
- (-) `FormData` exige Node 18.17+ (já é o engine mínimo do monorepo) — sem problema.
- (-) Upload só cobre o endpoint `items/upload` (imagem para anúncio); outros endpoints de imagem (múltiplos por request, edição) ficam para evolução posterior.
