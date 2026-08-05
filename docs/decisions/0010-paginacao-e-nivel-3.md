# ADR-0010: Paginação assíncrona e operações nível 3

- **Status:** Aceita
- **Data:** 2026-08-05
- **Autor:** Rafael

## Contexto

As buscas da API retornam páginas limitadas (`paging.offset`/`limit`). O consumidor precisa montar loops manuais de `offset` para percorrer catálogos inteiros — código repetitivo, sujeito a edge cases (página vazia, última página parcial). Além disso, operações comuns do vendedor (publicar/pausar anúncio, aguardar pagamento) exigem sequências manuais de chamadas.

## Problema

Como expor paginação e operações de negócio de forma ergonômica, sem duplicar lógica entre resources e sem inflar o `HttpClient`?

## Solução

### Paginação assíncrona — helper `paginate()` no `@nodemelivre/core`

Novo helper genérico que recebe um **fetcher de página** (`(offset, limit) => Promise<PaginatedResponse<T>>`) e devolve um **async generator** que itera item a item:

- Avança o `offset` automaticamente (`offset += results.length`) e encerra quando a página vem vazia ou atinge `paging.total`.
- O consumidor controla a parada com `break` (não busca a próxima página).
- `@nodemelivre/items` expõe `Items.list(siteId, params)` sobre ele — mesmo padrão pode ser reutilizado por `orders`, `questions`, `shipments`.

- **Alternativa A:** async generator duplicado em cada resource — mais código, quebra o princípio de reuso do ADR-0005.
- **Alternativa B:** retornar todas as páginas num array — perde streaming/memória baixa para catálogos grandes.
- **Escolhida:** helper no core, porque centraliza a lógica de paginação num lugar testado e reutilizável, mantendo `search()` intacto (compatibilidade).

### Operações nível 3 — aliases de negócio

- `Items.publish(id)` / `Items.pause(id)` — aliases tipados de `updateStatus` (`active`/`paused`), sem fluxo composto nesta entrega.
- `Orders.waitUntilPaid(orderId, { timeoutMs?, intervalMs? })` — polling com intervalo fixo até o pedido ficar `paid`, lançando `PollingTimeoutError` (novo, em `@nodemelivre/errors`) se estourar o timeout (padrão 60s).
- `PollingTimeoutError extends MercadoLivreError` — erro tipado para aguardar estados, extensível a outros fluxos futuros.

## Consequências

- (+) `for await (const item of ml.items.list('MLB', { q }))` substitui o loop manual de offset.
- (+) `break` dá controle de parada antecipada (ex.: pegar só os 10 primeiros) sem busca desnecessária.
- (+) `publish`/`pause` expressam intenção de negócio no lugar de `updateStatus('active')`.
- (+) `waitUntilPaid` remove o polling manual do integrador e sinaliza timeout com erro tipado.
- (-) `waitUntilPaid` não cobre status `approved` do pagamento (usa `order.status === 'paid'`); pode ser refinado quando `payments` for exposto.
- (-) `list()` ainda não lida com rate-limit específico além do que o `HttpClient` já aplica.

### Quando revisitar

Se paginação aparecer em muitos resources, considerar expor `paginate` na API pública do `@nodemelivre/sdk`. Se `waitUntilPaid` precisar de backoff progressivo, adicionar opção de `strategy` (fixo/exponecial).
