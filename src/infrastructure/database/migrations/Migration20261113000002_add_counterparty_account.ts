import { Migration } from "@mikro-orm/migrations";

export class Migration20261113000002_add_counterparty_account extends Migration {
  public async up(): Promise<void> {
    this.addSql(`
      ALTER TABLE wallet_ledger_entries 
      ADD COLUMN IF NOT EXISTS counterparty_account VARCHAR(50) NOT NULL DEFAULT 'HOUSE_HOLDING';
      
      CREATE INDEX IF NOT EXISTS idx_ledger_counterparty ON wallet_ledger_entries (counterparty_account);
    `);
  }

  public async down(): Promise<void> {
    this.addSql(`
      DROP INDEX IF EXISTS idx_ledger_counterparty;
      ALTER TABLE wallet_ledger_entries DROP COLUMN IF EXISTS counterparty_account;
    `);
  }
}
