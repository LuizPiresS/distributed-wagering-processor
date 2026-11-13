# Task 08: Documentação Arquitetural e Finalização

## 1. Objetivo
Produzir a documentação técnica exigida na Seção 14 (`ARCHITECTURE.md` e `README.md` atualizado com setup reproduzível), formalizando todas as decisões arquiteturais, justificativas de trade-offs, modelo de concorrência, taxonomia de erros e limites do sistema.

---

## 2. Requisitos Cobertos
- **Seção 2:** Justificativa da estratégia de autenticação e descrição do ponto de extensão para IdP externo.
- **Seção 4:** Justificativa da escolha do MikroORM e do mapeamento exato de `Money`.
- **Seção 8:** Justificativa da estratégia de concorrência (Pessimistic Lock por `walletId`).
- **Seção 9:** Documentação do algoritmo de hash canônico e taxonomia de status HTTP.
- **Seção 14:** Garantia dos 5 pontos de documentação e checklist final contra falhas eliminatórias.

---

## 3. Detalhamento Técnico

### 3.1 Estrutura do `ARCHITECTURE.md`
O documento deve conter:
1. **Visão Geral e Princípios Arquiteturais:**
   - Adoção de Clean Architecture + DDD + EDA.
   - Separação entre Domínio (puro), Aplicação (casos de uso) e Infraestrutura (adaptadores MikroORM/SQS).
2. **Modelo de Concorrência & Decisão de Locking:**
   - Justificativa do porquê **Pessimistic Locking (`SELECT FOR UPDATE` por `walletId`)** foi escolhido em detrimento de Optimistic Locking puro:
     - Em carteiras altamente disputadas (*hot wallets*), o locking otimista puro gera alta taxa de *rollback* e *retry storm*, degradando a CPU e aumentando latência.
     - O lock pessimista delimita a contenção estritamente à wallet envolvida sem travar o restante do banco de dados, permitindo paralelismo massivo entre jogadores distintos.
     - A coluna `version` permanece como garantia complementar e marcador de evolução de estado.
3. **Padrões de Mensageria Distribuída:**
   - **Transactional Inbox:** Como a tabela `inbox_messages` evita efeitos colaterais duplicados em reentregas SQS.
   - **Transactional Outbox:** Detalhamento da estratégia de polling não-bloqueante com `SELECT ... FOR UPDATE SKIP LOCKED`, viabilizando múltiplos workers publicadores concorrentes.
4. **Idempotência e Hash Canônico:**
   - Explicação da normalização de JSON e hashing SHA-256 para isolar variações de transporte.
5. **Máquina de Estados e Resolução de Referências:**
   - Diagrama de transições de `WagerTransaction`.
   - Tratamento de dependências fora de ordem via status `PENDING_REFERENCE` e worker assíncrono.
6. **Estratégia de Autenticação:**
   - Justificativa de foco no core financeiro conforme Seção 2.
   - Explicação do `AuthGuard` e da interface `ProviderIdentityPort`, demonstrando como plugar Zitadel/Keycloak com validação de JWT/JWKS.
7. **Taxonomia de Falhas (`FailureCode`):**
   - Tabela descritiva de todos os códigos de erro legíveis por máquina.
8. **Trade-offs e Limitações Conhecidas:**
   - Suposição de moeda única principal (BRL), embora o modelo suporte multi-moeda.
   - Janela de reconciliação e possíveis gargalos em volumes extremos de escrita.

---

### 3.2 Atualização do `README.md`
O `README.md` raiz será refinado para incluir a seção de execução rápida do projeto:
- **Pré-requisitos:** Bun 1.x e Docker / Docker Compose.
- **Como subir a infraestrutura:**
  ```bash
  docker compose up -d
  ```
- **Como rodar as migrations:**
  ```bash
  bun run migration:up
  ```
- **Como rodar a aplicação:**
  ```bash
  bun run start
  ```
- **Como rodar os testes:**
  ```bash
  bun test
  bun run test:concurrency
  bun run test:load
  ```

---

### 3.3 Checklist Final contra Falhas Eliminatórias (Seção 14)

Antes da entrega, validar minuciosamente:
- [ ] Nenhum uso de `number`, `float` ou `double` para manipulação de dinheiro no domínio ou persistência.
- [ ] Nenhuma possibilidade de saldo negativo (protegido por código e por constraint `CHECK` no PostgreSQL).
- [ ] Débito ou crédito duplicado comprovadamente impossível (testado com 50 chamadas paralelas).
- [ ] Idempotência 100% persistida no PostgreSQL (sem depender de cache volátil).
- [ ] Sistema funcional com $\ge 3$ instâncias ativas simultaneamente.
- [ ] Eventos de integração gerados **apenas** após o commit transacional (via Outbox).
- [ ] Ledger é estritamente auditável e append-only.
- [ ] Testes de integração e concorrência utilizam PostgreSQL e LocalStack reais em contêineres.

---

## 4. Checklist de Implementação
- [ ] Redigir `ARCHITECTURE.md` completo com diagramas textuais/mermaid e justificativas aprofundadas.
- [ ] Atualizar `README.md` com instruções operacionais claras de execução e verificação.
- [ ] Executar o checklist final de conformidade contra todos os itens eliminatórios da Seção 14.

---

## 5. Critérios de Aceite
- [ ] O arquivo `ARCHITECTURE.md` responde com clareza a todas as perguntas e decisões exigidas no enunciado do desafio.
- [ ] Um desenvolvedor externo consegue clonar o repositório e rodar o projeto e os testes seguindo apenas os passos do `README.md`.

