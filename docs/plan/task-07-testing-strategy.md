# Task 07: Bateria de Testes Automatizados (Unidade, Integração, Concorrência)

## 1. Objetivo
Estruturar e implementar a suíte completa de testes automatizados exigida na Seção 13 do `README.md`, garantindo a validação da integridade financeira, da concorrência sob carga pesada e da resiliência distribuída com contêineres reais (sem mocks de banco ou mensageria).

---

## 2. Requisitos Cobertos
- **Seção 8:** Teste de concorrência com duas apostas de R$ 80 disputando saldo de R$ 100.
- **Seção 13 (Testes Obrigatórios):**
  - Testes Unitários de `Money`, `Wallet`, regras de `BET`/`WIN`/`LOSS`/`REFUND`/`ROLLBACK` e conflitos de idempotência.
  - Testes de Integração com PostgreSQL e LocalStack SQS em contêineres reais.
  - 8 Cenários de Concorrência e Paralelismo Real (50 requisições simultâneas, $\ge 3$ instâncias, falha pós-commit, etc.).
- **Invariante Global:** `wallet.balance == saldo reconstruído pelo ledger` validado ao fim de cada teste.
- **Diferencial Opcional:** Script de teste de carga (`bun run test:load`).

---

## 3. Detalhamento dos Cenários de Teste

### 3.1 Testes Unitários (`tests/unit/`)
1. **`money.spec.ts`:**
   - Criação e parsing de strings decimais válidas (`"25.00"`, `"0.00"`).
   - Rejeição de strings inválidas: `"25"`, `"25.5"`, `"25.555"`, `"abc"`, `NaN`, `Infinity`, `1e3`.
   - Rejeição de valores negativos em contratos de entrada.
   - Operações aritméticas exatas sem erro de precisão IEEE 754:
     - Exemplo clássico: `0.10 + 0.20 === 0.30` (em float seria `0.30000000000000004`).
   - Bloqueio de soma/subtração entre moedas diferentes (`BRL` vs `USD`).
2. **`wallet.spec.ts`:**
   - Abertura com saldo inicial positivo gera versão 1.
   - Débito com saldo insuficiente lança erro de domínio e não altera versão nem saldo.
   - Crédito e débito bem-sucedidos incrementam `version` em exatamente 1 unidade.
3. **`wager-transaction.spec.ts`:**
   - Validações de transição de estado na máquina de estados.
   - Tentativa de transicionar transação terminal (`PROCESSED`, `REJECTED`, `FAILED`) lança exceção.
   - `REFUND` e `ROLLBACK` rejeitados se não possuírem referência.
4. **`idempotency.spec.ts`:**
   - Hash canônico invariante à ordenação de atributos JSON.
   - Detecção de payload divergente para a mesma chave.

---

### 3.2 Testes de Integração (`tests/integration/`)
Executados com PostgreSQL e LocalStack reais rodando em contêineres:
1. **`migrations-and-constraints.spec.ts`:**
   - Execução das migrations `up` e `down`.
   - Tentativa forçada de update direto via SQL com saldo negativo: deve falhar na constraint `chk_wallets_balance_non_negative`.
   - Tentativa de update ou delete na tabela de ledger: deve ser bloqueada pela regra de imutabilidade.
2. **`transactional-atomicity.spec.ts`:**
   - Simulação de erro no meio da transação: confirma que rollback reverte simultaneamente wallet, ledger, transação e outbox.
3. **`sqs-inbox-deduplication.spec.ts`:**
   - Envio de mensagem SQS repetida: confirma que o Inbox impede reexecução financeira e descarta a mensagem após ack.
4. **`outbox-publishing.spec.ts`:**
   - Inserção de eventos na outbox e validação de entrega nas filas do LocalStack pelo worker.

---

### 3.3 Testes de Concorrência Real (`tests/concurrency/`)
Estes testes utilizam paralelismo real com `Promise.all` e múltiplos processos clientes:

| # | Cenário de Concorrência | Configuração Inicial | Ação Simultânea | Resultado Esperado |
|---|---|---|---|---|
| **C1** | **50 Replays Simultâneos** | Wallet com 1000.00 BRL | 50 chamadas paralelas com a **mesma** `Idempotency-Key` e mesmo payload | Exatamente **1 débito**; 49 respostas com `idempotentReplay: true`; ledger com apenas 1 registro. |
| **C2** | **Disputa de Saldo (Seção 8)** | Wallet com 100.00 BRL | 2 apostas simultâneas de 80.00 BRL | Exatamente **1 PROCESSED**, **1 REJECTED** por saldo insuficiente; saldo final = 20.00 BRL; 1 débito no ledger. |
| **C3** | **Wallets Distintas em Paralelo** | 10 Wallets com 100.00 BRL cada | 10 apostas de 50.00 BRL (uma por wallet) disparadas ao mesmo tempo | Todas as 10 processam com sucesso sem bloquear umas às outras. |
| **C4** | **$\ge 3$ Instâncias Simultâneas** | Cluster simulado de 3 workers/nós | Carga massiva mista de apostas e ganhos | Sem deadlocks no PostgreSQL; todas as transações finalizadas em estado terminal. |
| **C5** | **Crash pós-commit / pré-ack** | Mensagem na fila SQS | Worker processa e commita no banco, mas simula crash antes do `deleteMessage` | SQS reentrega a mensagem; o Inbox detecta duplicata pelo ID e faz ack imediato sem reprocessar saldo. |
| **C6** | **Publishers Concorrentes na Outbox** | 100 mensagens pendentes na outbox | 2 workers de Outbox executando simultaneamente com `SKIP LOCKED` | Todas as 100 mensagens são publicadas exatamente uma vez, sem duplicação de envios. |
| **C7** | **Reversão Fora de Ordem** | Wallet com 100.00 BRL | Envio de `REFUND` **antes** da respectiva `BET` | `REFUND` é gravado como `PENDING_REFERENCE`; em seguida a `BET` é enviada; o worker agendado processa o `REFUND` com sucesso. |
| **C8** | **Crash e Reinício com Consistência** | Carga em andamento | Simulação de reinício abrupto do serviço | Ao subir novamente, o sistema conclui mensagens pendentes e valida que `wallet.balance == sum(ledger)`. |

---

### 3.4 Script de Teste de Carga (`bun run test:load`)
- Implementado utilizando script nativo em TypeScript/Bun ou ferramenta de benchmark (Autocannon / k6).
- Medição e relatório de:
  - Throughput (RPS).
  - Latências percentis: p50, p90, p95 e p99.
  - Taxa de erro (esperada 0% para 2xx/422 controlados).
  - Conflitos de concorrência detectados e tempo de drenagem da outbox (*outbox lag*).

---

## 4. Checklist de Implementação
- [ ] Configurar helpers de teste para limpar o banco e provisionar filas no LocalStack antes dos testes.
- [ ] Implementar suíte unitária completa com Bun test runner.
- [ ] Implementar cenários de integração C1 a C8 com asserção estrita do invariante `wallet.balance == sum(ledger)`.
- [ ] Implementar o script `bun run test:concurrency` executando os 8 cenários.
- [ ] Implementar o script `bun run test:load` com métricas detalhadas.

---

## 5. Critérios de Aceite
- [ ] 100% dos testes unitários e de integração passam via `bun test`.
- [ ] O teste de concorrência das duas apostas de R$ 80 sobre R$ 100 passa de forma determinística em 10 de 10 execuções consecutivas.
- [ ] Em nenhuma circunstância o saldo final da wallet diverge da soma aritmética do extrato de ledger correspondente.

