# Publicação no GitHub Packages

## Visão Geral

O projeto usa **GitHub Packages** (`npm.pkg.github.com`) como registry privado para os pacotes `@nodemelivre/*`. Publicação automática via GitHub Actions ao dar tag `v1.0.0-beta.*`.

---

## Como Instalar em Outro Projeto

### 1. Configurar autenticação (uma vez)

```bash
# Baixar script helper
curl -O https://raw.githubusercontent.com/Rafa-MKR2/NodeMeLivre/beta/setup-github-packages.sh
chmod +x setup-github-packages.sh

# Executar com seu Personal Access Token
source ./setup-github-packages.sh ghp_seu_token_aqui
```

> **Token necessário:** Personal Access Token (classic) com escopo `read:packages` (e `repo` se o repositório for privado).
> Crie em: https://github.com/settings/tokens

### 2. Instalar pacotes

```bash
# Última beta
npm install @nodemelivre/sdk@beta

# Versão específica
npm install @nodemelivre/sdk@1.0.0-beta.3

# Pacotes individuais
npm install @nodemelivre/core @nodemelivre/http @nodemelivre/items
```

### 3. Configuração permanente (opcional)

**No projeto consumidor, crie `.npmrc`:**
```ini
@nodemelivre:registry=https://npm.pkg.github.com/
```

**No CI / local, exporte o token:**
```bash
export GH_TOKEN=ghp_xxx
npm install
```

---

## Publicação Automática (CI)

### Trigger
- Push de tag `v1.0.0-beta.*` → publica com tag `beta` no GitHub Packages
- Workflow: `.github/workflows/publish-beta.yml`

### Pipeline
1. Checkout + Setup Node 22
2. `npm ci` + `npm run build`
3. `npm test` + `npm run typecheck`
4. Publica todos os 14 pacotes `@nodemelivre/*` com `--tag beta`
5. Pula versões já existentes (não falha)

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
| `v1.0.0` | `latest` | Produção (futuro) |

---

## Troubleshooting

### "401 Unauthorized" ou "404 Not Found"
- Token expirado ou sem escopo `read:packages`
- Repo privado requer escopo `repo` adicional
- Verifique: `npm view @nodemelivre/sdk@beta version`

### "Scope not found"
- Registry não configurado: `npm config set @nodemelivre:registry https://npm.pkg.github.com/`
- Token não configurado: `npm config set //npm.pkg.github.com/:_authToken $GH_TOKEN`

### Pacote não aparece após publish
- Workflow pode levar alguns minutos para propagar
- Verifique Actions: https://github.com/Rafa-MKR2/NodeMeLivre/actions

---

## Scripts Úteis

```bash
# Ver versões publicadas
npm view @nodemelivre/sdk versions --json

# Ver dist-tags
npm view @nodemelivre/sdk dist-tags --json

# Testar acesso
source ./setup-github-packages.sh $GH_TOKEN
npm view @nodemelivre/sdk@beta version
```