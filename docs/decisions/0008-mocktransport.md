# ADR-0008: MockTransport para testes sem rede

- **Status:** Aceita
- **Data:** 2026-08-04
- **Autor:** Rafael

## Contexto

Os resources (`Items`, `Orders`, etc.) dependem de `ResourceTransport` (interface). Em testes, não queremos chamar a API real do Mercado Livre — rede flaky, rate-limit, necessidade de tokens válidos.

## Problema

O `fakeTransport` existente (função factory) era limitado:
- Só aceita um handler único para todos os métodos/paths
- Sem simulação de latência, erros, ou estado
- API não fluente, difícil de ler em testes complexos

## Solução

Nova classe **`MockTransport`** em `@nodemelivre/core/test-utils.ts` com API fluente:

```ts
const transport = new MockTransport()
  .onGet('/items/MLB1', { id: 'MLB1', title: 'Produto' })
  .onPost('/items', { id: 'MLB2' })
  .withDelay(10)           // simula latência
  .withError(new NetworkError('offline', err)) // força erro

const items = new Items(transport)
await items.get('MLB1')
expect(transport.calledWith('GET', '/items/MLB1')).toBe(true)
```

**Recursos:**
- `.onGet/onPost/onPut/onPatch/onDelete(path, response)` — handlers por método+path
- `.onCall(method, path, fn)` — handler dinâmico recebendo `RecordedCall`
- `.withDelay(ms)` — latência simulada
- `.withError(Error)` — próxima chamada lança erro
- `.reset()`, `.calledWith()`, `.lastCall()` — inspeção
- `fakeTransport()` legado mantido para compatibilidade

## Alternativas

- **A:** MSW (Mock Service Worker) — poderoso, mas adiciona dependência pesada; overkill para unit tests.
- **B:** `nock` — só Node, não Web; API imperativa.
- **C:** Classe própria fluente — **escolhida**. Zero deps, API declarativa, tipada.

## Consequências

- (+) Testes 100% offline, determinísticos, rápidos
- (+) Fácil simular edge cases (latência, 429, 5xx, rede off)
- (+) Legado `fakeTransport()` não quebra testes existentes
- (-) Mais código de manutenção; mitigado: coberto por testes próprios