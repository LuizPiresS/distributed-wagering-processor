import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { Client } from "pg";
import { v4 as uuidv4 } from "uuid";

describe("Task 03: PostgreSQL Schema Constraints & Immutability (Integration)", () => {
  let client: Client;

  beforeAll(async () => {
    client = new Client({
      connectionString:
        process.env.DATABASE_URL ||
        "postgresql://postgres:postgres@localhost:5432/wagering_db",
    });
    await client.connect();
  });

  afterAll(async () => {
    await client.end();
  });

  describe("Wallets Schema Constraints", () => {
    it("should prevent inserting a wallet with negative balance (chk_wallets_balance_non_negative)", async () => {
      const walletId = uuidv4();
      const playerId = uuidv4();

      let error: any;
      try {
        await client.query(
          `INSERT INTO wallets (id, player_id, currency, balance, version)
           VALUES ($1, $2, 'BRL', -10.00, 1)`,
          [walletId, playerId],
        );
      } catch (err) {
        error = err;
      }

      expect(error).toBeDefined();
      expect(error.code).toBe("23514"); // PostgreSQL check_violation
      expect(error.constraint).toBe("chk_wallets_balance_non_negative");
    });

    it("should prevent updating a wallet balance to a negative value", async () => {
      const walletId = uuidv4();
      const playerId = uuidv4();

      // Insert valid wallet first
      await client.query(
        `INSERT INTO wallets (id, player_id, currency, balance, version)
         VALUES ($1, $2, 'BRL', 50.00, 1)`,
        [walletId, playerId],
      );

      let error: any;
      try {
        await client.query(
          `UPDATE wallets SET balance = -0.01 WHERE id = $1`,
          [walletId],
        );
      } catch (err) {
        error = err;
      }

      expect(error).toBeDefined();
      expect(error.code).toBe("23514"); // PostgreSQL check_violation
      expect(error.constraint).toBe("chk_wallets_balance_non_negative");
    });

    it("should enforce at most one wallet per player and currency (uq_wallets_player_currency)", async () => {
      const wallet1Id = uuidv4();
      const wallet2Id = uuidv4();
      const playerId = uuidv4();

      // First wallet: success
      await client.query(
        `INSERT INTO wallets (id, player_id, currency, balance, version)
         VALUES ($1, $2, 'BRL', 100.00, 1)`,
        [wallet1Id, playerId],
      );

      // Second wallet for SAME player and currency: must fail
      let error: any;
      try {
        await client.query(
          `INSERT INTO wallets (id, player_id, currency, balance, version)
           VALUES ($1, $2, 'BRL', 200.00, 1)`,
          [wallet2Id, playerId],
        );
      } catch (err) {
        error = err;
      }

      expect(error).toBeDefined();
      expect(error.code).toBe("23505"); // PostgreSQL unique_violation
      expect(error.constraint).toBe("uq_wallets_player_currency");
    });
  });

  describe("Ledger Entries Immutability & Append-Only Rules", () => {
    it("should block UPDATE operations on wallet_ledger_entries (no_update_ledger rule)", async () => {
      const walletId = uuidv4();
      const playerId = uuidv4();
      const entryId = uuidv4();
      const txId = uuidv4();

      await client.query(
        `INSERT INTO wallets (id, player_id, currency, balance, version)
         VALUES ($1, $2, 'BRL', 100.00, 1)`,
        [walletId, playerId],
      );

      await client.query(
        `INSERT INTO wallet_ledger_entries (id, wallet_id, transaction_id, direction, amount, currency, balance_before, balance_after)
         VALUES ($1, $2, $3, 'CREDIT', 100.00, 'BRL', 0.00, 100.00)`,
        [entryId, walletId, txId],
      );

      // Attempt to tamper with the ledger amount
      await client.query(
        `UPDATE wallet_ledger_entries SET amount = 9999.00 WHERE id = $1`,
        [entryId],
      );

      // Verify the record was NOT modified
      const res = await client.query(
        `SELECT amount FROM wallet_ledger_entries WHERE id = $1`,
        [entryId],
      );
      expect(parseFloat(res.rows[0].amount)).toBe(100.0);
    });

    it("should block DELETE operations on wallet_ledger_entries (no_delete_ledger rule)", async () => {
      const walletId = uuidv4();
      const playerId = uuidv4();
      const entryId = uuidv4();
      const txId = uuidv4();

      await client.query(
        `INSERT INTO wallets (id, player_id, currency, balance, version)
         VALUES ($1, $2, 'BRL', 50.00, 1)`,
        [walletId, playerId],
      );

      await client.query(
        `INSERT INTO wallet_ledger_entries (id, wallet_id, transaction_id, direction, amount, currency, balance_before, balance_after)
         VALUES ($1, $2, $3, 'CREDIT', 50.00, 'BRL', 0.00, 50.00)`,
        [entryId, walletId, txId],
      );

      // Attempt to delete the ledger entry
      await client.query(
        `DELETE FROM wallet_ledger_entries WHERE id = $1`,
        [entryId],
      );

      // Verify the record still exists
      const res = await client.query(
        `SELECT COUNT(*) FROM wallet_ledger_entries WHERE id = $1`,
        [entryId],
      );
      expect(parseInt(res.rows[0].count, 10)).toBe(1);
    });

    it("should reject non-positive amounts in ledger entries (chk_ledger_amount_positive)", async () => {
      const walletId = uuidv4();
      const playerId = uuidv4();
      const entryId = uuidv4();
      const txId = uuidv4();

      await client.query(
        `INSERT INTO wallets (id, player_id, currency, balance, version)
         VALUES ($1, $2, 'BRL', 50.00, 1)`,
        [walletId, playerId],
      );

      let error: any;
      try {
        await client.query(
          `INSERT INTO wallet_ledger_entries (id, wallet_id, transaction_id, direction, amount, currency, balance_before, balance_after)
           VALUES ($1, $2, $3, 'CREDIT', 0.00, 'BRL', 50.00, 50.00)`,
          [entryId, walletId, txId],
        );
      } catch (err) {
        error = err;
      }

      expect(error).toBeDefined();
      expect(error.code).toBe("23514"); // PostgreSQL check_violation
      expect(error.constraint).toBe("chk_ledger_amount_positive");
    });
  });

  describe("Wager Transactions Constraints", () => {
    it("should enforce unique idempotency_key globally (uq_wager_idempotency_key)", async () => {
      const walletId = uuidv4();
      const playerId = uuidv4();
      const tx1Id = uuidv4();
      const tx2Id = uuidv4();
      const idempotencyKey = `provider-test:${uuidv4()}`;
      const extId1 = `ext-${uuidv4()}`;
      const extId2 = `ext-${uuidv4()}`;

      await client.query(
        `INSERT INTO wallets (id, player_id, currency, balance, version)
         VALUES ($1, $2, 'BRL', 50.00, 1)`,
        [walletId, playerId],
      );

      // Insert first transaction
      await client.query(
        `INSERT INTO wager_transactions (id, provider_id, external_transaction_id, idempotency_key, payload_hash, wallet_id, player_id, round_id, game_id, kind, amount, currency, status)
         VALUES ($1, 'provider-test', $2, $3, 'hash1', $4, $5, 'round-1', 'game-1', 'BET', 10.00, 'BRL', 'PROCESSED')`,
        [tx1Id, extId1, idempotencyKey, walletId, playerId],
      );

      // Attempt to insert duplicate idempotency key
      let error: any;
      try {
        await client.query(
          `INSERT INTO wager_transactions (id, provider_id, external_transaction_id, idempotency_key, payload_hash, wallet_id, player_id, round_id, game_id, kind, amount, currency, status)
           VALUES ($1, 'provider-test', $2, $3, 'hash2', $4, $5, 'round-2', 'game-1', 'BET', 10.00, 'BRL', 'PROCESSED')`,
          [tx2Id, extId2, idempotencyKey, walletId, playerId],
        );
      } catch (err) {
        error = err;
      }

      expect(error).toBeDefined();
      expect(error.code).toBe("23505"); // unique_violation
      expect(error.constraint).toBe("uq_wager_idempotency_key");
    });
  });
});
