# NodeMeLivre

<p align="center">
  <img src="assets/banner.png" alt="NodeMeLivre" width="100%" />
</p>



**SDK TypeScript oficial para a API do Mercado Livre** — simples, tipado e pronto para produção.

Autentica, cria anúncios com foto e variações, pagina buscas, recebe notificações em tempo real e conversa com compradores. Tudo em uma API limpa, sem gambiarras.

---

## Instalação

```bash
npm install @nodemelivre/sdk
```

> Requer **Node 18.17+** (usa `fetch` nativo).

---

## O que você precisa

1. **Uma aplicação no Mercado Livre** — crie em [developers.mercadolivre.com](https://developers.mercadolivre.com.br) e anote:
   - `Client ID` (App ID)
   - `Client Secret`
   - `Redirect URI` (ex.: `https://seusite.com/callback`)

2. **Credenciais no `.env`**:
   ```env
   ML_CLIENT_ID=seu_client_id
   ML_CLIENT_SECRET=seu_client_secret
   ML_SITE_ID=MLB          # ou MLA, MLC, etc.
   ```

---

## Fluxo em 3 passos

### 1. Configure e autorize
```ts
import { createMercadoLivre } from '@nodemelivre/sdk'

const ml = createMercadoLivre({
  clientId: process.env.ML_CLIENT_ID!,
  clientSecret: process.env.ML_CLIENT_SECRET!,
  siteId: 'MLB'
})

// URL para o vendedor clicar e autorizar seu app
const url = await ml.authorizationUrl('https://seusite.com/callback')
// → redirecione o usuário para essa URL
```

### 2. Troque o código por token (uma vez)
```ts
// No seu endpoint de callback (ex.: /callback?code=XYZ)
const token = await ml.authenticate('https://seusite.com/callback', codeRecebido)
// Token salvo automaticamente (em memória ou arquivo). Próximas chamadas usam ele sozinho.
```

### 3. Use a API
```ts
// Meus dados
const eu = await ml.users.me()

// Cria anúncio com foto + variações (tamanho/cor)
const foto = await ml.images.upload(bufferDaFoto, { filename: 'camiseta.jpg' })
const item = await ml.items.createAndPublish({
  site_id: 'MLB',
  title: 'Camiseta dry-fit P/M/G',
  category_id: 'MLB1234',
  price: 49.9,
  currency_id: 'BRL',
  available_quantity: 30,
  pictures: [{ source: foto.variations[0].secure_url }],
  variations: [{
    attribute_combinations: [{ name: 'Tamanho', value_name: 'M' }],
    price: 49.9,
    available_quantity: 10,
    picture_ids: [foto.id]
  }]
})

// Busca paginada — sem loop manual de offset
for await (const produto of ml.items.list('MLB', { q: 'fone bluetooth' })) {
  console.log(produto.title)
}

// Cancelamento antecipado: o for await rejeita com AbortError
const controller = new AbortController()
const task = (async () => {
  for await (const item of ml.items.listBySeller(sellerId, {}, controller.signal)) {
    console.log(item.title)
  }
})()
controller.abort() // cancela a iteração e a requisição em voo

// Webhooks: notificação em tempo real (nova venda, pergunta, mensagem)
app.post('/webhook', (req, res) => {
  const notif = ml.webhooks.verifyForUser(req.body, process.env.ML_CLIENT_ID!, sellerId)
  // valida application_id E o user_id do vendedor conectado — ignora payloads forjados
  if (notif.topic === 'orders_v2') {
    // nova venda chegou
  }
  res.sendStatus(200) // deve responder em < 500ms
})

// Imagem a partir de URL pública (sem upload de arquivo)
const foto = await ml.images.uploadFromUrl('https://exemplo.com/camiseta.jpg')

// Chat com comprador
const msgs = await ml.messages.list(packId, sellerId)
await ml.messages.send({
  from: { user_id: sellerId },
  to: { user_id: buyerId, resource: packId, site_id: 'MLB' },
  text: 'Seu pedido já foi enviado!'
})

// Etiqueta de envio (PDF)
const pdf = await ml.shipments.printLabel(shipmentId, { format: 'pdf' })
await writeFile('etiqueta.pdf', Buffer.from(pdf))
```

---

## Deploy multi-instância: PKCE + stateStore compartilhado

Se seu app roda em **várias instâncias/processos** (cluster, serverless, replicas), o fluxo de autorização precisa de um `OAuthStateStore` **compartilhado** entre elas. Sem isso, o `code_verifier` do PKCE (e o `state` anti-CSRF) fica preso na memória da instância que gerou a URL de autorização — e a instância que recebe o callback não consegue completar a troca do code (`/oauth/token` responde `invalid_request` para apps com PKCE habilitado).

### A regra de ouro

> **O `OAuthStateStore` deve ser a MESMA instância (ou o mesmo backing store) para todos os `createMercadoLivre`/`OAuthClient` do seu deploy.** O SDK estaciona o `code_verifier` no store após o `consumeState` (Rodada 9 da auditoria) — mas isso só funciona se o store for compartilhado.

### Passo a passo (instância A gera, instância B troca)

```ts
// store-compartilhado.ts — instancie UMA VEZ e injete em todas as instâncias
import { createMercadoLivre, OAuthStateStore } from '@nodemelivre/sdk'

// Em memória (cluster/single process): compartilhe o MESMO objeto.
// Entre processos (deploy distribuído): use um adaptador do contrato
// OAuthStateStoreContract com Redis/banco — exemplo completo e executável
// em examples/redis-state-store.ts (instale ioredis e injete o client).
const sharedStateStore = new OAuthStateStore()

const config = {
  clientId: process.env.ML_CLIENT_ID!,
  clientSecret: process.env.ML_CLIENT_SECRET!,
  siteId: 'MLB',
  pkce: true, // obrigatório para apps novos do ML (2025/2026)
  stateStore: sharedStateStore, // ← compartilhado
  tokenStore: new FileTokenStore({ filePath: './.nodemelivre/token.json' }),
}

// Instâncias A e B — mesmo config, MESMO stateStore (compartilhado).
const mlA = createMercadoLivre(config)
const mlB = createMercadoLivre(config)

// Instância A — atende o GET /login e monta a URL de autorização.
// O SDK gera o state e o code_verifier, e armazena ambos no store
// compartilhado (o verifier vai no metadata do state).
const url = await mlA.authorizationUrl('https://seusite.com/callback')
// → redirecione o vendedor para url (contém code_challenge=S256&state=...)

// Callback — chega em QUALQUER instância (balanceador não é sticky).
// 1. Valida o state (anti-CSRF) e consome: o verifier é ESTACIONADO no
//    store compartilhado para que qualquer instância possa trocar o code.
const entry = await mlB.consumeState(stateRecebidoNoCallback)
if (entry === null) {
  throw new Error('state inválido/expirado — possível ataque CSRF')
}

// 2. Troca o code por token. O SDK recupera o code_verifier do state
//    (store ativo → estacionado → fallback) e o envia no /oauth/token.
//    Instância B, C, D... qualquer uma completa o fluxo.
const token = await mlB.authenticate('https://seusite.com/callback', codeRecebido, stateRecebidoNoCallback)
console.log(`Autenticado: ${token.userId}`)
```

### O que acontece por baixo dos panos

| Momento | Estado do store | Quem lê |
|---|---|---|
| `authorizationUrl()` (instância A) | `state` + `code_verifier` no `metadata` do state | — |
| `consumeState(state)` (qualquer instância) | state **consumido** (single-use); `code_verifier` **estacionado** no store (`parkCodeVerifier`, TTL 10 min) | — |
| `authenticate(...)` / `exchangeCode(code, { state })` (qualquer instância) | verifier recuperado (`getParkedCodeVerifier`) e enviado no body do `/oauth/token` | instância B |

> `ml.authenticate(...)` **persiste** o token no `tokenStore` e é o caminho recomendado; `ml.auth.exchangeCode(code, { state })` (baixo nível) retorna o `AccessToken` **sem persistir** — escolha conforme o seu fluxo.

O `consumeState` é **single-use** (proteção CSRF) mas **não destrói o verifier**: o ACHADO 31 (Rodada 8) e o A3 (Rodada 9) da auditoria garantiram que o fluxo "validar no callback e depois trocar o code" — a ordem documentada — funciona em multi-instância. A ordem alternativa (`exchangeCode` direto, sem `consumeState`) também funciona: o verifier é lido do metadata do state ainda ativo.

### Sem store compartilhado (armadilha)

```ts
// O tokenStore continua compartilhado (não é o problema); o que quebra é
// só o stateStore: cada instância tem o SEU, e elas não se enxergam.
const mlA = createMercadoLivre({ ...config, stateStore: new OAuthStateStore() })
const mlB = createMercadoLivre({ ...config, stateStore: new OAuthStateStore() }) // ← outro store!

const url = await mlA.authorizationUrl('https://seusite.com/callback')
// mlB.consumeState / mlB.authenticate(...) NÃO encontram o state nem o
// code_verifier gerados por mlA → invalid_request (apps PKCE).
```

> **Se não usar PKCE** (apps antigos), o `state` ainda precisa ser compartilhado para a validação CSRF no callback — use o mesmo store por igual. Para CLIs e apps single-instance, o `InMemoryTokenStore`/`OAuthStateStore` padrão bastam. Exemplos executáveis: `examples/pkce-multi-instancia.ts` (store in-memory compartilhado) e `examples/redis-state-store.ts` (adaptador Redis para multi-processo real).

---

## O que vem na caixa

| Recurso | O que faz |
|---------|-----------|
| **Auth** | OAuth2 completo — `authorization_code`, `refresh_token`, `credentials`. Refresh automático, dedupe, token store pluggável (memória ou arquivo). |
| **Items** | CRUD, busca, **paginação automática** (`for await` com `AbortSignal`), **createAndPublish** (cria + garante ativo), `publish`/`pause`, `list`/`listBySeller`. |
| **Orders** | Busca, detalhes, **waitUntilPaid** (polling com timeout e `AbortSignal`). |
| **Shipments** | Rastreio, **printLabel** (PDF/ZPL → `ArrayBuffer`). |
| **Questions** | Busca, `answer`, `reply` (responde + marca respondida). |
| **Images** | `upload(Blob | Buffer | Uint8Array)` → multipart, retorna `id` + variações de tamanho no CDN; `uploadFromUrl(url)` registra por URL pública. |
| **Messages** | Chat pós-venda: `list`, `get`, `send` (comprador ↔ vendedor). |
| **Webhooks** | `parse` + `verify(payload, applicationId)` + `verifyForUser(payload, applicationId, userId)` — validação real do ML (não usa HMAC). |
| **Erros tipados** | `ApiError` (por status), `RateLimitError`, `NetworkError`, `OAuthError`, `PollingTimeoutError`, `WebhookError`, `InputValidationError`. |
| **HTTP robusto** | Retry com backoff, timeout, rate-limit automático (`X-Rate-Limit-*`), eventos para observabilidade. |
| **Resiliência** | `parallel()` e `ResilientTransport` — degradação parcial: o dashboard continua com o que conseguiu carregar. `mapWithConcurrency` — limite de execuções paralelas preservando a ordem. |

> **Nota de segurança:** o SDK não injeta headers de resposta (CSP, `X-Frame-Options`, etc.) nas requisições — esses headers pertencem ao seu servidor. Use Helmet (ou equivalente) no seu app. Para CSRF no fluxo OAuth, configure um `OAuthStateStore` — o `state` é gerado e armazenado automaticamente na URL de autorização e validado no callback via `ml.consumeState()`.
>
> **Controles de entrada:** IDs de recursos são validados antes de irem ao path (`assertValidId` — bloqueia path traversal como `../../users/me`), `Images.uploadFromUrl` rejeita URLs para endereços locais/privados/metadata de nuvem, e o `HttpClient` só segue redirecionamentos para hosts autorizados (mesmo host ou `*.mercadolibre.com`), sem downgrade https→http — um `Location` malicioso nunca recebe o token do SDK. Ao usar os **eventos** (`request`, `httpError`, `response`...), evite logar o objeto `headers`/`body` completo sem redação — o header `Authorization` e dados do body podem conter informações sensíveis.

---

## Exemplos prontos

```bash
# Primeiro passo — OAuth2 ponta a ponta + resources
npx tsx examples/quickstart.ts

# Autenticação + token em arquivo
npx tsx examples/file-token-store.ts

# PKCE em deploy multi-instância (stateStore compartilhado)
npx tsx examples/pkce-multi-instancia.ts

# OAuthStateStore plugável com Redis (multi-processo real)
npx tsx examples/redis-state-store.ts

# Retry, timeout e rate-limit
npx tsx examples/retry-and-rate-limit.ts

# Upload de imagem + anúncio com variações
npx tsx examples/upload-e-variacoes.ts

# Paginação + operações nível 3
npx tsx examples/nivel-3-paginacao.ts
npx tsx examples/nivel-3-completo.ts

# Webhooks + messages
npx tsx examples/webhooks-e-messages.ts

# Eventos (request/retry/rateLimit/tokenRefreshed)
npx tsx examples/events.ts
```

---

## Pacotes individuais (leveza)

```bash
npm install @nodemelivre/items @nodemelivre/orders @nodemelivre/webhooks
# instale só o que usa — cada pacote é independente
```

---

## Requisitos

- **Node 18.17+** (fetch, Blob, FormData nativos)
- **Conta Mercado Livre** com aplicação criada

---

## Links

- 📖 [Documentação completa](https://github.com/Rafa-MKR2/NodeMeLivre/tree/main/docs) — ADRs, roadmap, releases
- 🐛 [Issues](https://github.com/Rafa-MKR2/NodeMeLivre/issues)
- 📦 [npm](https://www.npmjs.com/package/@nodemelivre/sdk)

---

## Licença

MIT — uso livre, inclusive comercial.
