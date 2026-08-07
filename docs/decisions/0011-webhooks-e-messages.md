# ADR-0011: Webhooks (notificações) e messages (chat pós-venda)

- **Status:** Aceita
- **Data:** 2026-08-05
- **Autor:** Rafael

## Contexto

Para rodar em produção, o vendedor precisa saber em tempo real que algo aconteceu (nova venda, pergunta, mensagem) — em vez de varrer a API manualmente. O Mercado Livre entrega isso por webhooks: um POST no callback configurado na aplicação. Além disso, o chat pós-venda (perguntas e respostas do comprador sobre um pedido) hoje não está exposto no SDK.

## Problema

Como expor notificações e mensagens de forma ergonômica, dado que o fluxo de autenticação de webhook do Mercado Livre **não usa assinatura HMAC**?

## Solução

### `@nodemelivre/webhooks` — parse + verify por `application_id`

O roadmap original previa `verify(payload, signature)` com HMAC-SHA256 (padrão Mercado Pago). **Pesquisa da API confirmou que o Mercado Livre não assina o payload** — a `x-signature` é do fluxo do Mercado Pago. A autenticação real do ML é feita validando que o `application_id` pertence à sua aplicação (e, se quiser mais segurança, consultando o `resource`).

Assim, o novo resource é **puro (sem HTTP)** e expõe:

- `Webhooks.parse(payload: string | unknown)` — converte o corpo do callback em `WebhookNotification` tipado, validando campos obrigatórios (`resource`, `user_id`, `topic`) e o tópico conhecido. Lança `WebhookError`.
- `Webhooks.verify(payload, applicationId)` — chama `parse` e confirma que o `application_id` bate com o da aplicação. Retorna a notificação tipada ou lança `WebhookError`.

- **Alternativa A:** `verify` com HMAC — descartada porque o ML não envia assinatura; ficaria sem uso real.
- **Alternativa B:** `verify` sem HTTP, mas retornando `boolean` — perde o payload tipado já validado; retornar a notificação é mais útil.
- **Escolhida:** resource sem transport (funções puras), pois não há chamada à API; o integrador recebe o body do seu framework (Express, etc.) e chama `parse`/`verify`.

### `@nodemelivre/messages` — chat pós-venda

Novo package por domínio (ADR-0004/0005) com endpoints oficiais (`tag=post_sale` obrigatório):

- `Messages.list(packId, sellerId, { markAsRead? })` → `GET /messages/packs/{packId}/sellers/{sellerId}` (marca como lido por padrão).
- `Messages.get(messageId)` → `GET /messages/{messageId}` — o `resource` do webhook `messages` é um hash usado aqui.
- `Messages.send({ from, to, text })` → `POST /messages` (máx. 350 caracteres).

Tipos novos em `@nodemelivre/types`: `WebhookNotification`/`WebhookTopic`/`WebhookMessageAction` e `Message`/`MessageSendInput`/`MessageUser`/`MessageRecipient`/`MessageAttachment`. `WebhookError` adicionado em `@nodemelivre/errors`.

- **Alternativa A:** sem package, expor tudo no sdk — quebra a arquitetura modular (ADR-0005).
- **Alternativa B:** incluir attachments na v1 — `POST /messages/attachments` fica para uma iteração futura (não bloqueia o chat básico).
- **Escolhida:** dois packages por domínio, seguindo o padrão existente (um resource por package).

## Consequências

- (+) `ml.webhooks.verify(body, appId)` autentica o callback com o mecanismo **real** do ML, sem falsa sensação de segurança de HMAC.
- (+) `ml.messages.list/get/send` habilita o chat pós-venda de ponta a ponta, destravando "responder comprador em produção".
- (+) Resource webhooks sem transport é trivial de testar (funções puras) e fácil de embutir em qualquer framework HTTP.
- (-) `verify` não consulta o `resource` para confirmar que a notificação é real — segurança máxima exigiria chamar `ml.orders.get(...)`/`ml.messages.get(...)` no `resource` (documentado no exemplo).
- (-) Messages não cobre attachments e a migração de arquitetura de mensageria do ML (IDs de Agente) fica transparente para o SDK — o integrador envia o `to.user_id` correto.

### Quando revisitar

Quando attachments forem necessários (ex.: fotos no chat), adicionar `Messages.uploadAttachment`. Se o ML passar a assinar notificações, `verify` ganha um modo HMAC opcional sem quebrar a API atual.

#### `Webhooks.verifyForUser(payload, applicationId, expectedUserId)` (v1.0.x)

No hardening da v1.0.x, o resource ganhou `verifyForUser` — a autenticação "de verdade" para o cenário de um único vendedor (ex.: painel administrativo):

- Chama `verify(payload, applicationId)` e **confere o `user_id` da notificação contra o vendedor esperado** (`expectedUserId`).
- Lança `WebhookError` se o `application_id` não bater **ou** se a notificação vier de outro `user_id`.
- **Motivação:** o painel roda para um vendedor específico; uma notificação forjada com `application_id` correto mas `user_id` de outra conta (ou notificação vazada de outro app) não deve disparar processamento. Como o ML não usa HMAC, essa é a verificação prática — o callback responde `200` com `ignored: true` para notificações de outro vendedor, evitando retries do ML sem processar o evento.
- Segue puro (sem HTTP), como `verify`/`parse`, e é trivial de testar.
