# ADR-0001: Monorepo com npm workspaces

- **Status:** Aceita
- **Data:** 2026-08-04
- **Autor:** Rafael

## Contexto

O projeto abriga um SDK TypeScript para a API do Mercado Livre e deve crescer mantendo padrões comuns: lint (Biome), tipos (TS strict) e testes (Vitest). Precisamos de um lugar para o pacote publicado (`@nodemelivre/sdk`) e futuros pacotes auxiliares sem duplicar configuração.

## Problema

Escolher a estrutura de repositório que permita publicar o SDK de forma independente, reaproveitar configuração entre pacotes e manter um único fluxo de CI/testes.

## Solução

Usar **monorepo com npm workspaces**.

- **Alternativa A:** repositório único com um único pacote — simples, mas acopla ferramentas auxiliares ao ciclo de release do SDK.
- **Alternativa B:** pnpm workspaces — melhor performance, mas pnpm não está instalado no ambiente.
- **Alternativa C:** turborepo/nx — overkill para o tamanho atual do projeto.
- **Escolhida:** npm workspaces (raiz `package.json` com `workspaces: ["packages/*"]`), porque não exige ferramenta nova, aproveita o npm já presente e isola o pacote publicável em `packages/sdk`.

## Consequências

- (+) Configuração compartilhada na raiz: `tsconfig.base.json` (strict, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`), `biome.json`, scripts `build`/`test`/`lint`/`typecheck`.
- (+) O pacote `@nodemelivre/sdk` declara `exports`, `main` e `types` próprios; é o único candidato a publicação.
- (+) Zero dependência de ferramenta extra de monorepo.
- (-) O gerenciador é o npm, com install mais lento que pnpm em escala grande.
- (-) Workspaces do npm são mais simples e menos rígidos em hoisting; exigir disciplina para não acoplar pacotes indevidamente.

Esta decisão pode ser revisitada se o número de pacotes e o tamanho do monorepo exigirem ferramenta dedicada — registrar nova ADR.
