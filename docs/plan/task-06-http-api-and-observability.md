# Task 06: API HTTP REST, Reconciliação e Observabilidade

## 1. Objetivo
Disponibilizar os endpoints da API HTTP REST conforme o contrato da Seção 9, implementar o endpoint de reconciliação de saldo contra o extrato do ledger, configurar os health checks desprotegidos e estruturar a observabilidade (logs JSON estruturados com correlation IDs e métricas operacionais).

---

## 2. Requisitos Cobertos
- **Seção 2 (Autenticação):** Ponto de extensão explícito (`AuthGuard` / `ProviderIdentityPort`) pronto para IdP externo (Keycloak/Zitadel), sem comprometer tempo com autenticação artesanal.
- **Seção 9 (API HTTP):**
  - Criação de Wallet com transação interna `OPENING` e lançamento de crédito atômico.
  - Consultas de Wallet, Transação e Extrato do Ledger com cursor opaco estável.
  - Submissão de Transação via HTTP com header `Idempotency-Key`.
  - Reconciliação de saldo (`POST /wallets/:walletId/reconciliation`).
  - Health checks: `/health/live` e `/health/ready`.
- **Seção 12 (Observabilidade):** Logs JSON com correlação ponta a ponta e métricas de desempenho/falhas.

---

## 3. Detalhamento Técnico

### 3.1 Endpoints HTTP REST

#### 1. Criação de Carteira (`POST /wallets`)
- **Body:** `{ "playerId": "uuid", "initialBalance": { "amount": "1000.00", "currency": "BRL" } }`
- **Comportamento Transacional:**
  - Se `initialBalance.amount > 0`:
    - Cria a Wallet com `version = 1`.
    - Insere uma `WagerTransaction` interna com `kind: 'OPENING'`, `status: 'PROCESSED'`.
    - Insere um `WalletLedgerEntry` com `direction: 'CREDIT'`, `balanceBefore: 0.00`, `balanceAfter: 1000.00`.
    - Cria evento de outbox `WalletBalanceChanged`.
  - Em caso de carteira já existente para o mesmo `playerId` + `currency`, retorna `409 Conflict`.

#### 2. Submissão de Apostas (`POST /wagering/transactions`)
- **Headers Obrigatórios:** `Idempotency-Key: {providerId}:{externalTransactionId}`
- **Códigos HTTP de Retorno Padronizados:**
  - `200 OK` / `201 Created`: Processado com sucesso (`status: 'PROCESSED'`) ou Replay Idempotente idêntico (`idempotentReplay: true`).
  - `202 Accepted`: Referência ainda não disponível (`status: 'PENDING_REFERENCE'`).
  - `422 Unprocessable Entity`: Rejeição legítima por regra de negócio (`status: 'REJECTED'`, ex: saldo insuficiente, rollback inválido).
  - `409 Conflict`: Chave de idempotência reutilizada com payload divergente.
  - `400 Bad Request`: Payload malformado, número com mais de 2 casas, moeda inválida.
  - `500 / 503`: Erro de infraestrutura transitório.

#### 3. Consulta de Extrato com Cursor Opaco (`GET /wallets/:walletId/ledger`)
- Parâmetros: `cursor` (string opaca codificada em Base64 contendo `createdAt` e `id`) e `limit` (default: 50).
- Garante paginação determinística e imune a *page drift* mesmo durante inserções concorrentes.

#### 4. Reconciliação Financeira (`POST /wallets/:walletId/reconciliation`)
- Executa consulta agregadora no banco de dados:
  ```sql
  SELECT 
    w.balance AS stored_balance,
    COALESCE(SUM(
      CASE 
        WHEN l.direction = 'CREDIT' THEN l.amount 
        WHEN l.direction = 'DEBIT' THEN -l.amount 
        ELSE 0 
      END
    ), 0.00) AS calculated_balance,
    COUNT(l.id) AS checked_entries
  FROM wallets w
  LEFT JOIN wallet_ledger_entries l ON l.wallet_id = w.id
  WHERE w.id = :walletId
  GROUP BY w.id;
  ```
- Retorna JSON com `storedBalance`, `calculatedBalance`, `difference`, `consistent: boolean` e `checkedEntries`.
- Em caso de divergência: **não corrige silenciosamente**. Emite log `WARN`/`ERROR` estruturado e incrementa métrica de anomalia contábil.

#### 5. Health Checks
- `GET /health/live`: Retorna `200 OK` `{ "status": "alive" }` indicando que o processo Node/Bun está executando.
- `GET /health/ready`: Executa `SELECT 1` no PostgreSQL e `GetQueueAttributes` no SQS. Se ambos responderem, retorna `200 OK`, caso contrário `503 Service Unavailable`.
- Totalmente abertos e sem autenticação.

---

### 3.2 Observabilidade e Auditoria

1. **Logs Estruturados (JSON via Pino ou Winston):**
   - Campos padrão em todos os logs de requisição/mensagem:
     - `correlationId` (extraído do header `X-Correlation-ID` ou gerado via UUID v7).
     - `transactionId`.
     - `walletId`.
     - `providerId`.
     - `messageId` (quando aplicável).
   - Sanitização: Não logar senhas, tokens de autenticação ou payloads completos com dados sensíveis.

2. **Métricas Operacionais:**
   - Contador de transações por status (`transactions_total{status, kind, provider}`).
   - Contador de duplicatas detectadas (`idempotency_replay_total`).
   - Contador de mensagens em DLQ (`sqs_dlq_messages_total`).
   - Histograma de tempo de espera por lock na wallet (`wallet_lock_duration_seconds`).
   - Gauge de atraso no outbox (`outbox_lag_count`).

---

## 4. Checklist de Implementação
- [ ] Implementar `WalletsController` com rotas de criação, extrato paginado e detalhes.
- [ ] Implementar `WageringTransactionsController` com validação de header de idempotência.
- [ ] Implementar `ReconciliationService` e endpoint de auditoria contábil.
- [ ] Implementar `HealthController` com checagens ativas do Postgres e SQS LocalStack.
- [ ] Implementar Middleware de Correlation ID e interceptor de log estruturado.
- [ ] Criar `AuthGuard` desacoplado documentando a integração com IdP OIDC.

---

## 5. Critérios de Aceite
- [ ] Todos os endpoints HTTP respondem estritamente no formato e schemas descritos na Seção 9.
- [ ] O endpoint de reconciliação confirma `consistent: true` e `difference: 0.00` em carteiras movimentadas.
- [ ] Os endpoints `/health/live` e `/health/ready` funcionam sem exigência de token ou credencial.
- [ ] Cada log emitido pelo sistema contém formato JSON com `correlationId`.

