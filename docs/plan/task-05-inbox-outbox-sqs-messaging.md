# Task 05: Mensageria Distribuída (Inbox, Outbox & SQS)

## 1. Objetivo
Implementar o pipeline de mensageria assíncrona tolerante a falhas, garantindo a atomicidade entre o banco de dados e as filas através dos padrões **Transactional Inbox** e **Transactional Outbox**, integrando com **AWS SQS FIFO** via LocalStack e gerenciando transações fora de ordem (`PENDING_REFERENCE`).

---

## 2. Requisitos Cobertos
- **Seção 10 (Processamento por SQS):**
  - Consumo das filas `wager-transactions.fifo` e `wager-transactions-dlq.fifo`.
  - Reutilização do **mesmo caso de uso** da entrada HTTP.
  - Deduplicação via **Inbox persistente** por `(consumerName, messageId)`.
  - `Ack` (deleteMessage) **somente após o commit** no banco.
  - Classificação de erros: negócio (ack), transitório (retry/backoff), permanente (DLQ).
  - Tratamento de `SIGTERM` (Graceful Shutdown).
- **Seção 11 (Transactional Outbox):**
  - Publicação concorrente de eventos sem duplicação contínua.
  - Suporte a múltiplas instâncias de workers utilizando `SELECT ... FOR UPDATE SKIP LOCKED`.
- **Seção 7.1 (Reprocessamento de Referências Fora de Ordem):**
  - Worker agendado com backoff exponencial para transações `PENDING_REFERENCE`.

---

## 3. Detalhamento Técnico

### 3.1 Padrão Transactional Inbox (Entrada SQS)
Ao receber uma mensagem da fila SQS:
1. Extrair `messageId`, `consumerName = "wager-sqs-consumer"` e calcular o hash do payload.
2. Iniciar a transação SQL única:
   - Verificar se `inbox_messages` já possui registro para `(consumerName, messageId)`.
   - Se já existe e `processed_at IS NOT NULL`: mensagem já foi processada anteriormente (redelivery). Faz `ack` imediato no SQS e descarta.
   - Se não existe: insere registro na tabela `inbox_messages`.
   - Executa o `ProcessWagerTransactionUseCase`.
   - Marca o registro do inbox como processado (`processed_at = NOW()`).
3. Faz o `commit` da transação no PostgreSQL.
4. Faz o `deleteMessage` no AWS SQS FIFO.

### 3.2 Padrão Transactional Outbox Worker (Saída de Eventos)
Para permitir que múltiplos workers publiquem eventos concorrentemente sem colisão nem bloqueio mútuo:

```sql
-- Query de polling com lock não-bloqueante:
SELECT id, aggregate_id, event_type, payload, attempts
FROM outbox_messages
WHERE published_at IS NULL
  AND next_attempt_at <= NOW()
ORDER BY occurred_at ASC
LIMIT 50
FOR UPDATE SKIP LOCKED;
```

- **Fluxo do Outbox Worker:**
  1. Seleciona em lote com `FOR UPDATE SKIP LOCKED`.
  2. Para cada mensagem:
     - Envia o evento serializado para a fila/tópico de integração no SQS.
     - Em caso de sucesso: marca `published_at = NOW()`.
     - Em caso de falha transitória: incrementa `attempts`, calcula `next_attempt_at` com backoff exponencial ($2^{attempts} \times 1s$, jitter) e mantém para a próxima rodada.
  3. Commita o lote.

### 3.3 Worker de Resolução de Referências Fora de Ordem (`PendingReferenceWorker`)
Lida com situações onde um `WIN`, `REFUND` ou `ROLLBACK` chega antes do `BET` correspondente:

```sql
SELECT id, provider_id, reference_external_transaction_id, wallet_id
FROM wager_transactions
WHERE status = 'PENDING_REFERENCE'
ORDER BY created_at ASC
LIMIT 20
FOR UPDATE SKIP LOCKED;
```

- **Lógica de Reprocessamento:**
  - Tenta localizar a transação referenciada no banco de dados.
  - **Se encontrada:** reexecuta a operação aplicando as regras de saldo e ledger, transicionando o status para `PROCESSED`.
  - **Se não encontrada e dentro do limite (ex: 5 retries / TTL de 15 minutos):** reagenda com backoff exponencial.
  - **Se esgotado o limite:** transiciona a transação para `REJECTED` com `failureCode: 'REFERENCE_NOT_FOUND'`, gera evento de outbox `WagerTransactionRejected` e encerra o ciclo.

### 3.4 Tratamento de Sinal `SIGTERM` e Graceful Shutdown
- O consumidor SQS intercepta `SIGTERM` e `SIGINT`.
- Para de puxar novas mensagens (`polling = false`).
- Aguarda a conclusão das mensagens em voo (com timeout de segurança de 10s).
- Se uma mensagem não puder ser concluída a tempo, altera a visibilidade dela no SQS para `0` segundos (`ChangeMessageVisibility(0)`), devolvendo-a imediatamente para que outro nó do cluster a processe.

---

## 4. Checklist de Implementação
- [ ] Configurar cliente SQS com AWS SDK v3 apontando para LocalStack em desenvolvimento.
- [ ] Implementar classe `SqsConsumerService` com polling contínuo e backoff de visibilidade.
- [ ] Integrar deduplicação via `InboxMessage` dentro da mesma transação do banco.
- [ ] Implementar `OutboxPublisherWorker` com consulta `FOR UPDATE SKIP LOCKED`.
- [ ] Implementar `PendingReferenceWorker` para resolver transações fora de ordem.
- [ ] Implementar manipulador de graceful shutdown no NestJS (`onModuleDestroy` / `beforeApplicationShutdown`).

---

## 5. Critérios de Aceite
- [ ] Se o processo sofrer crash após o commit no banco mas antes do ack no SQS, a mensagem reentregue pelo SQS é deduplicada pelo Inbox sem duplicar movimentações de saldo.
- [ ] Três instâncias do Outbox Worker rodando em paralelo processam a tabela de outbox sem duplicação de mensagens e sem deadlocks.
- [ ] Um `REFUND` que chega antes do `BET` entra em `PENDING_REFERENCE`; após a chegada do `BET`, o worker aplica o estorno com sucesso.

