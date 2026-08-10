# Publicação no npm

## Visão Geral

Os pacotes `@nodemelivre/*` são publicados no **npm público** (`registry.npmjs.org`)
desde o release **v1.0.0** (2026-08-10) — **sem necessidade de token para instalar**.
Publicação automática via GitHub Actions: tag `v1.0.0-beta.*` → dist-tag `beta`;
tag `v1.0.*` → dist-tag `latest` (release estável).

> **Histórico:** o v1.0.0-beta.* foi publicado no GitHub Packages (`npm.pkg.github.com`,
> restricted) até o release estável. A partir do v1.0.0 o registry canônico é o **npmjs público**.
> O consumo via GitHub Packages continua como fallback para quem já configurou (ver final).

---

## Como Instalar em Outro Projeto

### 1. Instalar pacotes (nenhuma configuração necessária)

```bash
# Última versão estável (dist-tag latest — v1.0.0)
npm install @nodemelivre/sdk

# Última beta
npm install @nodemelivre/sdk@beta

# Versões específicas
npm install @nodemelivre/sdk@1.0.0
npm install @nodemelivre/sdk@1.0.0-beta.3

# Pacotes individuais
npm install @nodemelivre/core @nodemelivre/http @nodemelivre/items
```

> Nenhum `.npmrc`, token ou registry customizado é necessário — os packages são **públicos**.

### 2. Validar o acesso (opcional)

```bash
# Baixar script helper
curl -O https://raw.githubusercontent.com/Rafa-MKR2/NodeMeLivre/main/setup-github-packages.sh
chmod +x setup-github-packages.sh
bash ./setup-github-packages.sh        # sem token: valida o acesso público
```

---

## Publicação Automática (CI)

### Trigger
- Push de tag `v1.0.0-beta.*` → publica com dist-tag `beta`
- Push de tag `v1.0.*` → publica com dist-tag `latest` (release estável)
- Workflow: `.github/workflows/publish-beta.yml` ("Publish to npm")

### Pipeline
1. Checkout + Setup Node 22 (actions v5)
2. `npm ci` + `npm run build`
3. `npm test` + `npm run typecheck`
4. `npm audit` + SBOM CycloneDX + `security:check` (76/76)
5. Publica os 14 pacotes `@nodemelivre/*` (dist-tag `beta` ou `latest` conforme a tag;
   `publishConfig.access: public`)
6. Pula versões já existentes (não falha)

> **Requisito de credencial:** o workflow usa `NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}`
> (token de publicação do npmjs, escopo da org `nodemelivre`).

### Verificar status
https://github.com/Rafa-MKR2/NodeMeLivre/actions

---

## Pacotes Disponíveis

| Pacote | Descrição |
|--------|-----------|
| `@nodemelivre/sdk` | Entry point principal (reexporta todos) |
| `@nodemelivre/auth` | OAuth2, TokenManager, OAuthStateStore |
| `@nodemelivre/core` | Logger, paginação, transport, utils, resilience |
| `@nodemelivre/http` | HttpClient com retry, rate-limit, events |
| `@nodemelivre/errors` | Erros tipados (ApiError, ConfigurationError, etc) |
| `@nodemelivre/types` | Tipos TypeScript compartilhados |
| `@nodemelivre/items` | Anúncios (CRUD, variações, publish, search) |
| `@nodemelivre/orders` | Vendas, waitUntilPaid |
| `@nodemelivre/users` | Usuários (me, get) |
| `@nodemelivre/shipments` | Envios, printLabel (PDF/ZPL) |
| `@nodemelivre/questions` | Perguntas/respostas |
| `@nodemelivre/images` | Upload de imagens |
| `@nodemelivre/messages` | Chat pós-venda |
| `@nodemelivre/webhooks` | Parse/verify de webhooks |

---

## Versionamento

| Tag | Registry Tag | Uso |
|-----|--------------|-----|
| `v1.0.0-beta.*` | `beta` | Testes, desenvolvimento |
| `v1.0.0` | `latest` | **Produção — publicado no npm em 2026-08-10** (14 packages, 417 testes, security 76/76) |

---

## Troubleshooting

### "404 Not Found" no `npm view @nodemelivre/sdk version`
- O workflow `Publish to npm` ainda não rodou para a tag `v1.0.0`
- Verifique Actions: https://github.com/Rafa-MKR2/NodeMeLivre/actions

### Publicação falha com 401/403
- `NPM_TOKEN` expirado ou sem permissão de publicação na org `nodemelivre` do npmjs
- Token granular: permissão **Read and write** em **Packages** da org

### Fallback GitHub Packages (consumidores antigos)
```bash
npm config set @nodemelivre:registry https://npm.pkg.github.com/
npm config set //npm.pkg.github.com/:_authToken $GH_TOKEN   # escopo read:packages
```

---

## Scripts Úteis

```bash
# Ver versões publicadas
npm view @nodemelivre/sdk versions --json

# Ver dist-tags
npm view @nodemelivre/sdk dist-tags --json

# Validar acesso público
npm view @nodemelivre/sdk version       # 1.0.0 (latest)
npm view @nodemelivre/sdk@beta version
```
