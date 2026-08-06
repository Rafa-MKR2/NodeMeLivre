Roadmap v1.0.x — Hardening & Refinamento da Base

Objetivo: consolidar a primeira versão estável do NodeMeLivre, eliminando fragilidades descobertas durante o desenvolvimento do painel administrativo, fortalecendo segurança, ergonomia, observabilidade e confiabilidade antes da evolução para novas funcionalidades.

Visão Geral

A versão v1.0.0 cumpriu seu objetivo principal: disponibilizar um SDK moderno, modular e totalmente tipado para integração com o Mercado Livre.

Durante o processo de dogfooding, uma aplicação administrativa completa foi desenvolvida utilizando exclusivamente o NodeMeLivre.

Essa aplicação serviu como validação prática da API pública e permitiu identificar situações que dificilmente seriam percebidas apenas por testes unitários.

O resultado foi a descoberta de diversos pontos de melhoria relacionados principalmente a:

robustez
concorrência
UX
tratamento de erros
segurança
observabilidade

A série v1.0.x será dedicada exclusivamente ao refinamento dessa base.

Não haverá expansão significativa da API.

O foco é qualidade.

Status dos problemas identificados

| # | Problema | Status |
| --- | --- | --- |
| 1 | Estados presos na interface (SSE) | Pendente (aplicação de exemplo) |
| 2 | Dashboard pouco resiliente | Parcial — resiliência do SDK implementada; degradação parcial no painel pendente |
| 3 | Crescimento infinito de estados OAuth | Implementado — `OAuthStateStore` (TTL, limite, limpeza automática) integrado ao `OAuthClient` (CSRF) |
| 4 | Corridas de concorrência (logs) | Implementado — `DeduplicatingLogger` imutável + `RateLimiter` single-flight |
| 5 | Tratamento de configuração | Pendente |
| 6 | Objetos parcialmente válidos | Implementado — `deepOmitEmpty` envia somente propriedades válidas |
| 7 | Logs redundantes | Implementado — `DeduplicatingLogger` centraliza e deduplica |
| 8 | Hardening HTTP | Implementado — `securityHeaders` padrão `false` + nota de segurança no README |
| 9 | UX | Pendente (aplicação de exemplo) |

Objetivos da série v1.0.x
Estabilidade

Eliminar comportamentos inconsistentes encontrados durante uso real.

Exemplos:

estados presos na interface
objetos parcialmente válidos
falhas silenciosas
concorrência
Resiliência

Garantir que falhas parciais não interrompam toda a aplicação.

Sempre que possível:

degradar funcionalidades
manter o restante do sistema funcionando
retornar mensagens claras
Segurança

Endurecer configurações padrão.

Adicionar proteções que um ambiente de produção espera possuir.

Exemplos:

Helmet
headers HTTP
limpeza de estados temporários
validações adicionais
Ergonomia

Reduzir comportamentos inesperados para quem utiliza o SDK.

Melhorar:

mensagens
exemplos
documentação
fluxos
Observabilidade

Facilitar depuração.

Melhorar:

logs
eventos
mensagens
contexto de erro
Problemas identificados
1. Estados presos na interface
Problema

Algumas operações assíncronas podem terminar de maneira inesperada.

Exemplo:

Exportação SSE interrompida.

Resultado:

Botão permanece em

Exportando...

mesmo após encerramento da conexão.

Impacto

Experiência ruim.

Usuário acredita que a operação ainda está em andamento.

Objetivo

Garantir reset em qualquer cenário.

Inclusive:

timeout
cancelamento
erro
fechamento do stream
2. Dashboard pouco resiliente
Problema

Uma única chamada falha.

Todo dashboard retorna erro.

Exemplo
users ✓

orders ✓

questions 429

Resultado atual

500

Resultado esperado

Usuários

Pedidos

Perguntas indisponíveis
Objetivo

Trabalhar com degradação parcial.

> **Status: Parcial.** O lado SDK da resiliência foi implementado: retentativa pós-401 com refresh automático sem consumir o orçamento de retry, re-lançamento do erro real da API, tracking de rate-limit por recurso (`método:recurso`) e parsing robusto de `X-Rate-Limit-Reset`. A degradação parcial no dashboard do painel (ex.: "Perguntas indisponíveis" em vez de 500) segue pendente.

3. Crescimento infinito de estados OAuth
Problema

Estados temporários permanecem na memória quando o usuário não conclui autenticação.

Consequência

Possível consumo crescente de memória.

Objetivo

Implementar:

TTL
limpeza automática
limite máximo

> **Status: Implementado.** `OAuthStateStore` aplica TTL (padrão 10 min), limite máximo (padrão 1000, removendo o mais antigo) e limpeza automática em intervalo (padrão 1 min); `consume`/`has`/`get` expiram entradas vencidas. Integrado ao `OAuthClient` via `stateStore`: `authorizationUrl` gera e armazena o `state` automaticamente e `consumeState` valida o state recebido no callback (proteção CSRF).

4. Corridas de concorrência
Problema

Múltiplas requisições podem alterar registros incorretos.

Especialmente logs.

Objetivo

Eliminar mutações por índice.

Utilizar referências imutáveis.

> **Status: Implementado.** `DeduplicatingLogger` agora substitui a entry do cache por uma referência nova (imutável) em vez de mutar o objeto compartilhado no `Map`, e o resumo emite a mensagem original. `RateLimiter` usa espera single-flight para requisições concorrentes em recurso esgotado (sem "thundering herd" no reset) e limpa o estado esgotado ao fim da janela.

5. Tratamento de configuração
Problema

Erros de configuração aparecem como erro interno.

Exemplo:

500 Internal Error

quando deveria informar

SDK não configurado.

Configure:

ML_CLIENT_ID

ML_CLIENT_SECRET
Objetivo

Melhorar experiência do integrador.

6. Objetos parcialmente válidos
Problema

Estruturas vazias são enviadas para API.

Exemplo

shipping: {}

Embora não cause erro imediato, aumenta ambiguidades.

Objetivo

Enviar somente propriedades válidas.

> **Status: Implementado.** `deepOmitEmpty` remove estruturas vazias antes do envio e preserva `null` intencional (ex.: limpar campo via `PUT /items`).

7. Logs redundantes
Problema

Mesmo erro registrado múltiplas vezes.

Consequência

Poluição de logs.

Maior dificuldade de investigação.

Objetivo

Centralizar logging.

> **Status: Implementado.** `DeduplicatingLogger` deduplica logs repetidos por janela e emite um resumo dos suprimidos ao final (o caminho antes inalcançável foi corrigido).

8. Hardening HTTP

Adicionar cabeçalhos recomendados.

Exemplos:

X-Content-Type-Options
Referrer-Policy

Documentar limites atuais.

> **Status: Implementado (decisão de design).** O SDK não injeta headers de segurança (CSP, `X-Frame-Options`, `X-Content-Type-Options`...) em requisições — eles pertencem ao servidor do integrador. `securityHeaders` agora é `false` por padrão e o README documenta a recomendação (Helmet) e os limites do rate-limit por recurso.

9. UX

Pequenos fluxos ainda podem confundir usuários.

Exemplos:

chat aberto sem destinatário.

ações parcialmente habilitadas.

mensagens pouco claras.

Refatorações previstas
API
padronização de mensagens
respostas mais consistentes
códigos HTTP mais precisos
SDK
pequenos refinamentos internos
redução de duplicação
melhoria da observabilidade
Aplicação de exemplo

Melhorar:

estados visuais
mensagens
fluxos
feedback ao usuário
Qualidade

A série v1.0.x também terá foco em aumentar confiança.

Testes

Expandir:

integração
concorrência
cenários de erro
autenticação
webhooks
Documentação

Atualizar:

troubleshooting
FAQ
exemplos
boas práticas
Fora do escopo

Esta série não adicionará novos recursos significativos.

Itens como:

Payments
Billing
Middleware
Plugins
Cache
PKCE

permanecem planejados para versões futuras.

Critério de conclusão

A série v1.0.x será considerada concluída quando:

todos os problemas identificados durante o dogfooding estiverem resolvidos;
os principais cenários de erro estiverem cobertos por testes;
a aplicação administrativa operar de forma consistente em cenários de falha parcial;
a documentação refletir as melhorias implementadas;
o SDK apresentar uma base estável para a evolução da linha v1.1.
Filosofia da v1.0.x

A primeira versão do NodeMeLivre demonstrou que sua arquitetura suporta integrações completas com a API do Mercado Livre. O foco da série v1.0.x não é expandir funcionalidades, mas consolidar essa fundação.

Cada melhoria desta série busca aumentar a confiabilidade do ecossistema, reduzir comportamentos inesperados e oferecer uma experiência previsível para quem desenvolve aplicações utilizando o SDK. Ao final desse ciclo, a expectativa é que o NodeMeLivre disponha de uma base sólida o suficiente para sustentar novas capacidades sem comprometer a estabilidade conquistada na versão 1.0.0.