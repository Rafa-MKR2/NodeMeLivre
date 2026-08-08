# Documentação

Índice de toda a documentação do SDK do Mercado Livre.

| Pasta | Conteúdo |
|---|---|
| [decisions/](decisions/) | ADRs — decisões de arquitetura com contexto e consequências |
| [roadmap/](roadmap/README.md) | Roadmap, prioridades e Definition of Done |
| [releases/](releases/README.md) | Processo de release e CHANGELOG |
| [github-packages.md](github-packages.md) | Publicação e instalação via GitHub Packages |
| [auditoria-seguranca.md](auditoria-seguranca.md) | Auditoria de segurança — 4 rodadas, 15 achados / 13 corrigidos (path traversal, SSRF + trailing dot, redirects, log injection, prototype pollution, OAuth/re-auth) |

## Regra de ouro

> **Toda funcionalidade nova exige documentação correspondente.**

Nenhuma feature é considerada "pronta" sem o registro em `docs/` e no [CHANGELOG](../CHANGELOG.md). Veja a [Definition of Done](roadmap/README.md#definition-of-done).
