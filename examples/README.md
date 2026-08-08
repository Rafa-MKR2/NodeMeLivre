# Exemplos

Exemplos de uso do `@nodemelivre/sdk`. Eles ilustram o fluxo OAuth2 completo e a configuração de transporte.

## Pré-requisitos

- Node ≥ 18.17.
- App criado no painel do Mercado Livre (client_id/client_secret).
- Variáveis de ambiente: `ML_CLIENT_ID`, `ML_CLIENT_SECRET`, `ML_SITE_ID` (padrão `MLB`).

## Rodando

```bash
ML_CLIENT_ID=... ML_CLIENT_SECRET=... npx tsx examples/quickstart.ts
```

## Arquivos

| Arquivo | O que mostra |
|---|---|
| [quickstart.ts](quickstart.ts) | Fluxo OAuth2 de ponta a ponta e uso dos resources |
| [file-token-store.ts](file-token-store.ts) | Persistência de token em arquivo (`FileTokenStore`) |
| [retry-and-rate-limit.ts](retry-and-rate-limit.ts) | Configuração de retry, timeout e observação de rate-limit |
| [events.ts](events.ts) | Observabilidade: logs de request/response/retry/error/rateLimit e tokenRefreshed |
| [upload-e-variacoes.ts](upload-e-variacoes.ts) | Upload de imagem e criação de anúncio com variações |
| [nivel-3-paginacao.ts](nivel-3-paginacao.ts) | Paginação assíncrona, publish/pause e waitUntilPaid |
