#!/usr/bin/env bash
# setup-github-packages.sh
# Configura npm para instalar @nodemelivre/* do npmjs público.
# Desde o v1.0.0, os packages são PÚBLICOS no npmjs — nenhuma configuração
# é necessária para consumir. Este script só valida o acesso e, opcionalmente,
# mostra como o consumo via GitHub Packages funcionava antes da publicação
# pública (mantido para histórico/fallback).
# Uso: bash ./setup-github-packages.sh [GH_TOKEN_OPCIONAL]

set -euo pipefail

TOKEN="${1:-}"

# Sempre remove o registry do GitHub Packages se existir (npm público não usa)
npm config delete @nodemelivre:registry 2>/dev/null || true
npm config delete //npm.pkg.github.com/:_authToken 2>/dev/null || true

echo "✅ Registry npmjs público configurado (padrão do npm):"
echo "  @nodemelivre/sdk → https://registry.npmjs.org/"

# Testa se funciona
if npm view @nodemelivre/sdk version >/dev/null 2>&1; then
  VERSION=$(npm view @nodemelivre/sdk version 2>/dev/null)
  echo "✅ Acesso OK — @nodemelivre/sdk@$VERSION disponível publicamente"
else
  echo "⚠️  Não conseguiu acessar @nodemelivre/sdk no npmjs"
  echo "   Verifique se o workflow 'Publish to npm' já rodou para a tag v1.0.0"
  if [[ -n "$TOKEN" ]]; then
    echo
    echo "Fallback GitHub Packages (apenas se necessário):"
    echo "  npm config set @nodemelivre:registry https://npm.pkg.github.com/"
    echo "  npm config set //npm.pkg.github.com/:_authToken $TOKEN"
  fi
fi
