# ADR-0002: HTTP via fetch nativo (undici)

- **Status:** Aceita
- **Data:** 2026-08-04
- **Autor:** Rafael

## Contexto

O SDK precisa chamar a API do Mercado Livre (`https://api.mercadolibre.com`) com suporte a OAuth2, retry em falhas transitórias, rate-limit e timeout. Dependências HTTP tradicionais (axios, got, node-fetch) adicionam peso e superfície de vulnerabilidade.

## Problema

Escolher como o SDK faz requisições HTTP sem introduzir dependência pesada e mantendo compatibilidade com runtime Node moderno e ambientes edge.

## Solução

Usar **fetch nativo** (global do Node ≥ 18 e do Deno/Bun; undici no Node), sem dependência HTTP de terceiros.

- **Alternativa A:** axios — rico em recursos, mas grande e com API própria que vaza para o consumidor do SDK.
- **Alternativa B:** undici direto — mesmo motor do fetch global, mas exige dependência explícita.
- **Escolhida:** fetch nativo, porque já está disponível no Node ≥ 18, é o padrão da plataforma e permite trocar a implementação (`fetchImpl`) em testes e em runtimes edge.

## Consequências

- (+) Zero dependência HTTP; menor superfície de ataque e de atualização.
- (+) `fetchImpl` injetável capturado na construção do cliente — testes usam stub sem mock global.
- (+) AbortController com `AbortSignal.any` para timeout sem pendurar a requisição.
- (-) Streams e leitura de corpo são mais manuais do que em libs como axios.
- (-) Erros de rede chegam como `TypeError`; precisamos normalizá-los em `NetworkError` tipado.

Esta decisão pode ser revisitada se surgir necessidade de HTTP/2 multiplexado ou long polling que o fetch não atenda bem.
