# ADR-0003: TokenStore pluggável

- **Status:** Aceita
- **Data:** 2026-08-04
- **Autor:** Rafael

## Contexto

O fluxo OAuth2 do Mercado Livre exige guardar `access_token` e `refresh_token` entre execuções. Onde o token vive depende de onde o app roda: memória (CLI), arquivo (desenvolvimento local), banco, secret manager.

## Problema

Decidir como o SDK persiste tokens sem impor uma escolha de storage ao consumidor e sem vazar a implementação interna do OAuth.

## Solução

Definir uma interface **`TokenStore`** pluggável com implementações `InMemoryTokenStore` e `FileTokenStore` incluídas.

- **Alternativa A:** token sempre em memória — simples, mas perde o token a cada restart do processo.
- **Alternativa B:** SDK gerencia arquivo em local fixo — funciona para CLI, mas quebra em serverless e não é testável.
- **Alternativa C:** abstração interna sem interface pública — o consumidor não conseguiria injetar storage próprio.
- **Escolhida:** interface `TokenStore` pública e pluggável, porque isola o OAuth (via `TokenManager`) da persistência e deixa o consumidor prover storage próprio sem tocar no fluxo de refresh.

## Consequências

- (+) `TokenManager` só conhece `get`/`set` — a lógica de refresh com leeway de 60s e dedupe é independente do storage.
- (+) `FileTokenStore` cobre o caso de desenvolvimento; produção injeta banco/secret manager.
- (+) Testes trocam storage por stub sem IO.
- (-) Interface mínima (`get`/`set`) não cobre atomiciade distribuída; apps multi-instância precisam de storage com garantias próprias.
- (-) `FileTokenStore` deve cuidar de permissões do arquivo (0600) e de concorrência de escrita.

Esta decisão pode ser revisitada se surgir necessidade de rotacionar storage em runtime sem recrear o SDK.
