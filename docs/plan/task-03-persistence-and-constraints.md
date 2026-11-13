# Task 03: Persistência, Migrações e Constraints de Banco

## 1. Objetivo
Estruturar a camada de persistência com **PostgreSQL**, utilizando **MikroORM** (a escolha preferencial explícita na Seção 4 do desafio), aplicando mapeamentos precisos para objetos de domínio e garantindo que as regras de integridade e não-negatividade estejam protegidas **no schema do banco de dados** por meio de constraints e índices, atendendo à Restrição Inviolável 9.

---

## 2. Requisitos Cobertos
- **Seção 4 & 5:** MikroORM com Unit of Work, Identity Map e suporte a `LockMode.PESSIMISTIC_WRITE`.
- **Restrição Inviolável 9:** Garantias de unicidade, imutabilidade e não-negatividade expressas diretamente no DDL do PostgreSQL.
- **Seção 6:** Mapeamento do Value Object `Money` para colunas relacionais exatas (`numeric(18, 2)` + `varchar(3)`).
- **Seção 9:** Migrations versionadas e 100% reversíveis (`up` e `down`).

---

## 3. Detalhamento Técnico

### 3.1 Escolha do ORM: MikroORM
- Justificativa arquitetural:
  - O MikroORM implementa os padrões clássicos de Martin Fowler: **Data Mapper**, **Unit of Work** e **Identity Map**.
  - Separação clara entre a entidade pura e o mapeamento relacional.
  - Suporte de primeira classe para transações atômicas via `em.transactional(async (em) => { ... })`.
  - Suporte explícito a `LockMode.PESSIMISTIC_WRITE` gerando `SELECT ... FOR UPDATE` no PostgreSQL.
  - Custom Types flexíveis para serialização/desserialização de `Money`.

### 3.2 DDL e Constraints do Banco de Dados

#### Tabela `wallets`
```sql
CREATE TABLE wallets (
    id UUID PRIMARY KEY,
    player_id UUID NOT NULL,
    currency VARCHAR(3) NOT NULL,
    balance NUMERIC(18, 2) NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Invariante: Saldo nunca negativo garantido no banco
    CONSTRAINT chk_wallets_balance_non_negative CHECK (balance >= 0),
    -- Invariante: No máximo uma carteira por player + moeda
    CONSTRAINT uq_wallets_player_currency UNIQUE (player_id, currency)
);

CREATE INDEX idx_wallets_player ON wallets (player_id);
```

#### Tabela `wallet_ledger_entries` (Append-Only)
```sql
CREATE TABLE wallet_ledger_entries (
    id UUID PRIMARY KEY,
    wallet_id UUID NOT NULL REFERENCES wallets(id) ON DELETE RESTRICT,
    transaction_id UUID NOT NULL,
    direction VARCHAR(10) NOT NULL, -- DEBIT, CREDIT
    amount NUMERIC(18, 2) NOT NULL,
    currency VARCHAR(3) NOT NULL,
    balance_before NUMERIC(18, 2) NOT NULL,
    balance_after NUMERIC(18, 2) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_ledger_amount_positive CHECK (amount > 0),
    CONSTRAINT chk_ledger_direction CHECK (direction IN ('DEBIT', 'CREDIT'))
);

-- Índice para cursor estável e paginação eficiente por carteira
CREATE INDEX idx_ledger_wallet_created ON wallet_ledger_entries (wallet_id, created_at DESC);

-- Trigger / Regra de Imutabilidade: bloqueia UPDATE e DELETE
CREATE OR REPLACE RULE no_update_ledger AS ON UPDATE TO wallet_ledger_entries DO INSTEAD NOTHING;
CREATE OR REPLACE RULE no_delete_ledger AS ON DELETE TO wallet_ledger_entries DO INSTEAD NOTHING;
```

#### Tabela `wager_transactions`
```sql
CREATE TABLE wager_transactions (
    id UUID PRIMARY KEY,
    provider_id VARCHAR(100) NOT NULL,
    external_transaction_id VARCHAR(255) NOT NULL,
    idempotency_key VARCHAR(255) NOT NULL,
    payload_hash CHAR(64) NOT NULL,
    wallet_id UUID NOT NULL REFERENCES wallets(id) ON DELETE RESTRICT,
    player_id UUID NOT NULL,
    round_id VARCHAR(255) NOT NULL,
    game_id VARCHAR(255) NOT NULL,
    kind VARCHAR(20) NOT NULL,
    amount NUMERIC(18, 2) NOT NULL,
    currency VARCHAR(3) NOT NULL,
    reference_external_transaction_id VARCHAR(255),
    reference_transaction_id UUID REFERENCES wager_transactions(id),
    status VARCHAR(30) NOT NULL,
    failure_code VARCHAR(100),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    processed_at TIMESTAMPTZ,

    -- Idempotência estrita: chave única global
    CONSTRAINT uq_wager_idempotency_key UNIQUE (idempotency_key),
    -- Unicidade externa por provedor
    CONSTRAINT uq_wager_provider_external_id UNIQUE (provider_id, external_transaction_id)
);

CREATE INDEX idx_wager_reference ON wager_transactions (provider_id, reference_external_transaction_id) 
WHERE reference_external_transaction_id IS NOT NULL;
CREATE INDEX idx_wager_pending_ref ON wager_transactions (status) WHERE status = 'PENDING_REFERENCE';
```

#### Tabela `inbox_messages` (Deduplicação de Mensageria)
```sql
CREATE TABLE inbox_messages (
    message_id VARCHAR(255) NOT NULL,
    consumer_name VARCHAR(100) NOT NULL,
    payload_hash CHAR(64) NOT NULL,
    received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    processed_at TIMESTAMPTZ,

    PRIMARY KEY (consumer_name, message_id)
);
```

#### Tabela `outbox_messages` (Transactional Outbox)
```sql
CREATE TABLE outbox_messages (
    id UUID PRIMARY KEY,
    aggregate_id VARCHAR(255) NOT NULL,
    event_type VARCHAR(100) NOT NULL,
    payload JSONB NOT NULL,
    occurred_at TIMESTAMPTZ NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    published_at TIMESTAMPTZ,

    CONSTRAINT chk_outbox_attempts_non_negative CHECK (attempts >= 0)
);

-- Índice parcial crucial para alto desempenho do worker de polling
CREATE INDEX idx_outbox_pending_dispatch ON outbox_messages (next_attempt_at, attempts) 
WHERE published_at IS NULL;
```

---

### 3.3 Mapeamento de Tipos e Custom Types no MikroORM
- Criar `MoneyType extends Type<Money, string>` no MikroORM:
  - `convertToDatabaseValue(value: Money): string` -> `value.amount` (ou persistir colunas separadas).
  - `convertToJSValue(value: string, platform): Money` -> reconstitui `Money.from({ amount: value, currency })`.
- Utilizar EntitySchema declarativo ou decorators para associar o domínio às tabelas sem poluir as classes centrais de negócio.

---

## 4. Checklist de Implementação
- [ ] Configurar conexão do MikroORM com pooling adequado e suporte a variáveis de ambiente.
- [ ] Criar a primeira migration reversível (`001_initial_schema.ts`) contendo todas as tabelas, índices e constraints.
- [ ] Implementar a regra ou trigger PostgreSQL que impede mutações na tabela de ledger.
- [ ] Configurar repositórios tipados para `WalletRepository`, `LedgerRepository`, `WagerTransactionRepository`, `InboxRepository` e `OutboxRepository`.
- [ ] Implementar testes de migração (`up` e `down`) para garantir reversibilidade.

---

## 5. Critérios de Aceite
- [ ] `bun run migration:up` aplica o schema sem erros.
- [ ] `bun run migration:down` reverte o banco ao estado original sem resíduos.
- [ ] Tentar inserir saldo negativo diretamente no PostgreSQL falha com violação da constraint `chk_wallets_balance_non_negative`.
- [ ] Tentar fazer `UPDATE` ou `DELETE` na tabela `wallet_ledger_entries` não surte efeito ou é rejeitado.
- [ ] Tentativas de duplicidade em `idempotency_key` disparam erro de chave única no banco.

