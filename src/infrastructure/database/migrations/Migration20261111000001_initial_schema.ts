import { Migration } from "@mikro-orm/migrations";

export class Migration20261111000001_initial_schema extends Migration {
  public async up(): Promise<void> {
    // 1. Wallets table with non-negative balance and unique (player_id, currency)
    this.addSql(`
      CREATE TABLE IF NOT EXISTS wallets (
        id UUID PRIMARY KEY,
        player_id UUID NOT NULL,
        currency VARCHAR(3) NOT NULL,
        balance NUMERIC(18, 2) NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT chk_wallets_balance_non_negative CHECK (balance >= 0),
        CONSTRAINT uq_wallets_player_currency UNIQUE (player_id, currency)
      );
      CREATE INDEX IF NOT EXISTS idx_wallets_player ON wallets (player_id);
    `);

    // 2. Wager Transactions table with idempotency uniqueness and reference indices
    this.addSql(`
      CREATE TABLE IF NOT EXISTS wager_transactions (
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
        CONSTRAINT uq_wager_idempotency_key UNIQUE (idempotency_key),
        CONSTRAINT uq_wager_provider_external_id UNIQUE (provider_id, external_transaction_id)
      );
      CREATE INDEX IF NOT EXISTS idx_wager_reference ON wager_transactions (provider_id, reference_external_transaction_id) 
      WHERE reference_external_transaction_id IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_wager_pending_ref ON wager_transactions (status) 
      WHERE status = 'PENDING_REFERENCE';
    `);

    // 3. Wallet Ledger Entries table (Immutable, Append-Only)
    this.addSql(`
      CREATE TABLE IF NOT EXISTS wallet_ledger_entries (
        id UUID PRIMARY KEY,
        wallet_id UUID NOT NULL REFERENCES wallets(id) ON DELETE RESTRICT,
        transaction_id UUID NOT NULL,
        direction VARCHAR(10) NOT NULL,
        amount NUMERIC(18, 2) NOT NULL,
        currency VARCHAR(3) NOT NULL,
        balance_before NUMERIC(18, 2) NOT NULL,
        balance_after NUMERIC(18, 2) NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT chk_ledger_amount_positive CHECK (amount > 0),
        CONSTRAINT chk_ledger_direction CHECK (direction IN ('DEBIT', 'CREDIT'))
      );
      CREATE INDEX IF NOT EXISTS idx_ledger_wallet_created ON wallet_ledger_entries (wallet_id, created_at DESC);

      -- PostgreSQL Rules for Ledger Immutability (Restrição Inviolável 5)
      CREATE OR REPLACE RULE no_update_ledger AS ON UPDATE TO wallet_ledger_entries DO INSTEAD NOTHING;
      CREATE OR REPLACE RULE no_delete_ledger AS ON DELETE TO wallet_ledger_entries DO INSTEAD NOTHING;
    `);

    // 4. Inbox Messages table (Messaging Deduplication)
    this.addSql(`
      CREATE TABLE IF NOT EXISTS inbox_messages (
        message_id VARCHAR(255) NOT NULL,
        consumer_name VARCHAR(100) NOT NULL,
        payload_hash CHAR(64) NOT NULL,
        received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        processed_at TIMESTAMPTZ,
        PRIMARY KEY (consumer_name, message_id)
      );
    `);

    // 5. Outbox Messages table (Transactional Outbox Pattern)
    this.addSql(`
      CREATE TABLE IF NOT EXISTS outbox_messages (
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
      CREATE INDEX IF NOT EXISTS idx_outbox_pending_dispatch ON outbox_messages (next_attempt_at, attempts) 
      WHERE published_at IS NULL;
    `);
  }

  public async down(): Promise<void> {
    this.addSql(`DROP TABLE IF EXISTS outbox_messages CASCADE;`);
    this.addSql(`DROP TABLE IF EXISTS inbox_messages CASCADE;`);
    this.addSql(`DROP RULE IF EXISTS no_delete_ledger ON wallet_ledger_entries;`);
    this.addSql(`DROP RULE IF EXISTS no_update_ledger ON wallet_ledger_entries;`);
    this.addSql(`DROP TABLE IF EXISTS wallet_ledger_entries CASCADE;`);
    this.addSql(`DROP TABLE IF EXISTS wager_transactions CASCADE;`);
    this.addSql(`DROP TABLE IF EXISTS wallets CASCADE;`);
  }
}

