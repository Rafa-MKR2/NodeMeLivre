# Processo de release

Fluxo para publicar novas versões do `@nodemelivre/sdk`. Segue o padrão do [MANUAL-DAS-BOAS-PRATICAS](../docs/decisions/) e usa [SemVer](https://semver.org/lang/pt-BR/).

## Regras

- Commits seguem **Conventional Commits**: `feat(scope): ...`, `fix(scope): ...`, `docs(scope): ...`.
- Mudança de arquitetura exige **ADR nova** em `docs/decisions/` antes do release.
- Atualizar `CHANGELOG.md` e o [roadmap](roadmap/README.md) **no mesmo release** do código.
- `v1.0.0` é o marco de publicação pública; antes disso `v0.x` não garante estabilidade de API.

## Passos

1. Bump de versão em `packages/sdk/package.json` e na raiz do monorepo.
2. `npm run lint`, `npm run typecheck`, `npm run test`, `npm run build` — todos verdes.
3. Atualizar `CHANGELOG.md` com a seção da nova versão.
4. Marcar a versão no `docs/roadmap/README.md`.
5. Publicar (`npm publish --workspace @nodemelivre/sdk`) quando aplicável.

## CHANGELOG

O CHANGELOG vive na raiz (`CHANGELOG.md`) e agrega mudanças de todos os pacotes. Formato por versão:

- `Adicionado` — novas features.
- `Corrigido` — bugs corrigidos.
- `Alterado` — mudanças que não quebram a API.
- `Quebrado` — mudanças que quebram compatibilidade (exigem release major).
