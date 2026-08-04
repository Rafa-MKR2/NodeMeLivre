# ADR-0004: Resources v1 — items, orders, users, shipments, questions

- **Status:** Aceita
- **Data:** 2026-08-04
- **Autor:** Rafael

## Contexto

O SDK precisa expor operações da API do Mercado Livre de forma tipada: itens (`/items`, `/sites/{site}/search`), pedidos (`/orders`), usuários (`/users/me`), envios (`/shipments`) e perguntas (`/questions`).

## Problema

Decidir como modelar os endpoints para o consumidor sem gerar classes gigantes nem vazar detalhes de HTTP, mantendo os dados tipados em TypeScript.

## Solução

Criar **resources v1**: uma classe por domínio (`Items`, `Orders`, `Users`, `Shipments`, `Questions`) recebendo um `ResourceTransport` comum, com tipos de domínio em `types/` e helper `toQuery` para query params.

- **Alternativa A:** uma classe `MercadoLivre` com dezenas de métodos — vira god class e confunde autocomplete.
- **Alternativa B:** client por endpoint (um arquivo por rota) — fragmenta demais o domínio.
- **Alternativa C:** gerar SDK a partir do schema OpenAPI — poderoso, mas exige infra de geração e o schema oficial é instável.
- **Escolhida:** resources por domínio sobre um transport comum, porque dá organização por área de negócio, tipos reutilizáveis e uma superfície de teste pequena (transport falso).

## Consequências

- (+) Consumidor navega por domínio: `client.items.search(...)`, `client.orders.get(...)`.
- (+) `ResourceTransport` (`get`/`post`/`put`/`patch`/`delete`) centraliza auth, retry e rate-limit; resources ficam puros.
- (+) Tipos em `types/` refletem os payloads reais; campos sensíveis ficam opcionais (`exactOptionalPropertyTypes`).
- (-) Número de arquivos cresce com novos resources — mitigado por convenção `kebab-case` e re-export em `index.ts`.
- (-) Nem todo endpoint do ML está coberto na v1; novos endpoints entram por ADR se mudarem a arquitetura de resources.

Esta decisão pode ser revisitada quando o escopo de endpoints crescer a ponto de exigir geração a partir de schema.
