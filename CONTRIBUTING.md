# Contribuindo

Obrigado por contribuir com o **NodeMeLivre**! Este projeto segue o [Manual das Boas Práticas](https://github.com/rafaeldc/MANUAL-DAS-BOAS-PRATICAS) — leia o guia de fluxo em `docs/workflows/development-flow.md` antes de começar.

## Fluxo de trabalho

1. Crie uma issue descrevendo o problema ou melhoria.
2. Crie uma branch a partir de `develop` seguindo a nomenclatura do manual (`feature/*`, `fix/*`, `docs/*`, ...).
3. Faça commits **pequenos e focados** usando Conventional Commits:

```text
feat(auth): adiciona suporte a PKCE
fix(http): corrige timeout em requisições lentas
docs(readme): atualiza instruções de instalação
```

4. Abra um PR usando o template em [.github/PULL_REQUEST_TEMPLATE.md](.github/PULL_REQUEST_TEMPLATE.md).
5. O PR deve responder: **o que mudou**, **por que** e **como foi validado**.

## Regras do projeto

- **Sem `any`** — tudo tipado (`strict: true`).
- **Toda feature nova exige documentação** em `docs/` e entrada no CHANGELOG.
- **Mudança de arquitetura exige ADR** nova em `docs/decisions/`.
- **Roadmap atualizado** quando o status de uma tarefa mudar.
- **Nada entra na `main`** sem passar por PR + review.
- Não commitar segredos, chaves ou arquivos de ambiente.

## Verificações antes do PR

```bash
npm run lint       # Biome
npm run typecheck  # tsc strict
npm run test       # Vitest
npm run build      # tsc build
```

## Definition of Done

Uma tarefa só é considerada concluída quando: código implementado, testado, revisado, documentado, mergeado na `main` (via release) e com roadmap/CHANGELOG atualizados.

## Licença

Ao contribuir, você concorda que suas contribuições estão sob a [Licença MIT](LICENSE).
