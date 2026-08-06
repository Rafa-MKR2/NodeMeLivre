#!/usr/bin/env bash
# setup-github-packages.sh
# Configura npm para instalar @nodemelivre/* do GitHub Packages
# Uso: source ./setup-github-packages.sh <SEU_GH_TOKEN>

set -euo pipefail

TOKEN="${1:-}"

if [[ -z "$TOKEN" ]]; then
  echo "Uso: source ./setup-github-packages.sh <GH_TOKEN>"
  echo "Gere token em: https://github.com/settings/tokens (scopes: read:packages, repo)"
  exit 1
fi

# Configura registry para o scope @nodemelivre
npm config set @nodemelivre:registry https://npm.pkg.github.com/

# Configura autenticação
npm config set //npm.pkg.github.com/:_authToken "$TOKEN"

echo "✅ Configurado:"
echo "  @nodemelivre:registry = https://npm.pkg.github.com/"
echo "  //npm.pkg.github.com/:_authToken = ***"

# Testa se funciona
echo ""
echo "Testando acesso..."
if npm view @nodemelivre/sdk@beta version --json >/dev/null 2>&1; then
  VERSION=$(npm view @nodemelivre/sdk@beta version --json 2>/dev/null)
  echo "✅ Acesso OK — versão beta disponível: $VERSION"
else
  echo "⚠️  Não conseguiu acessar @nodemelivre/sdk@beta"
  echo "   Verifique se:"
  echo "   - Token tem escopo 'read:packages'"
  echo "   - Repo é público OU token tem escopo 'repo'"
  echo "   - Workflow de publish rodou (tag v1.0.0-beta.*)"
fi