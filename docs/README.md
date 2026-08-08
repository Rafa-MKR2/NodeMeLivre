# Documentação

Índice de toda a documentação do SDK do Mercado Livre.

| Pasta | Conteúdo |
|---|---|
| [decisions/](decisions/) | ADRs — decisões de arquitetura com contexto e consequências |
| [roadmap/](roadmap/README.md) | Roadmap, prioridades e Definition of Done |
| [releases/](releases/README.md) | Processo de release e CHANGELOG |
| [github-packages.md](github-packages.md) | Publicação e instalação via GitHub Packages |
| [auditoria-seguranca.md](auditoria-seguranca.md) | Auditoria de segurança — 7 rodadas, 29 achados / 27 corrigidos (path traversal, SSRF + trailing dot + DNS wildcard + IPv6 transition, redirects + origin guard, log injection, prototype pollution, OAuth/re-auth, DoS: stack overflow, loop de paginação, espera de rate limit/retry, supply chain: CI permissions, npm audit, deps com versão real, actions por SHA) |
| [ANALISE_QUALIDADE_TECNICA.md](../ANALISE_QUALIDADE_TECNICA.md) | Análise arquitetural, duplicação e plano de refatoração (fases) |
| [DOCUMENTO_CORRECOES.md](../DOCUMENTO_CORRECOES.md) | Correções críticas P0/P1/P2 (estado, PKCE, atomicidade) |

## Regra de ouro

> **Toda funcionalidade nova exige documentação correspondente.**

Nenhuma feature é considerada "pronta" sem o registro em `docs/` e no [CHANGELOG](../CHANGELOG.md). Veja a [Definition of Done](roadmap/README.md#definition-of-done).
