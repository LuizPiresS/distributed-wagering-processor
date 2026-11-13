import { MikroORM } from "@mikro-orm/postgresql";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { v4 as uuidv4 } from "uuid";
import { CreateWalletUseCase } from "../../src/application/use-cases/create-wallet.use-case";
import { ProcessWagerTransactionUseCase } from "../../src/application/use-cases/process-wager-transaction.use-case";
import {
  Currency,
  FailureCode,
  LedgerDirection,
  WagerTransactionKind,
  WagerTransactionStatus,
} from "../../src/domain";
import {
  WalletLedgerEntryOrmEntity,
  WalletOrmEntity,
} from "../../src/infrastructure/database/entities";
import mikroOrmConfig from "../../src/infrastructure/database/mikro-orm.config";

describe("ProcessWagerTransactionUseCase & Concurrency (Integration)", () => {
  let orm: MikroORM;
  let createWalletUseCase: CreateWalletUseCase;
  let processWagerUseCase: ProcessWagerTransactionUseCase;

  beforeAll(async () => {
    orm = await MikroORM.init(mikroOrmConfig);
    createWalletUseCase = new CreateWalletUseCase(orm.em);
    processWagerUseCase = new ProcessWagerTransactionUseCase(orm.em);
  });

  afterAll(async () => {
    await orm.close();
  });

  describe("CreateWalletUseCase", () => {
    it("should open a wallet with initial balance, generating internal OPENING transaction and CREDIT ledger", async () => {
      const playerId = uuidv4();
      const result = await createWalletUseCase.execute({
        playerId,
        initialBalance: { amount: "1000.00", currency: Currency.BRL },
      });

      expect(result.id).toBeDefined();
      expect(result.playerId).toBe(playerId);
      expect(result.balance.amount).toBe("1000.00");
      expect(result.version).toBe(1);

      // Verify database state
      const fork = orm.em.fork();
      const walletOrm = await fork.findOne(WalletOrmEntity, { id: result.id });
      expect(walletOrm?.balance.toString()).toBe("1000.00");

      const ledgerEntries = await fork.find(WalletLedgerEntryOrmEntity, {
        walletId: result.id,
      });
      expect(ledgerEntries).toHaveLength(1);
      expect(ledgerEntries[0]!.direction).toBe(LedgerDirection.Credit);
      expect(ledgerEntries[0]!.amount.toString()).toBe("1000.00");
    });
  });

  describe("Standard Wager Operations (BET, WIN, LOSS)", () => {
    it("should execute BET successfully when funds are sufficient", async () => {
      const playerId = uuidv4();
      const wallet = await createWalletUseCase.execute({
        playerId,
        initialBalance: { amount: "100.00", currency: Currency.BRL },
      });

      const result = await processWagerUseCase.execute({
        idempotencyKey: `bet-test-${uuidv4()}`,
        providerId: "provider-a",
        externalTransactionId: `tx-${uuidv4()}`,
        playerId,
        walletId: wallet.id,
        roundId: "round-1",
        gameId: "game-1",
        kind: WagerTransactionKind.Bet,
        money: { amount: "25.00", currency: Currency.BRL },
      });

      expect(result.status).toBe(WagerTransactionStatus.Processed);
      expect(result.balance.amount).toBe("75.00");
      expect(result.idempotentReplay).toBe(false);

      // Verify ledger
      const fork = orm.em.fork();
      const ledgerEntries = await fork.find(WalletLedgerEntryOrmEntity, {
        walletId: wallet.id,
      });
      // 1 opening + 1 bet debit = 2 entries
      expect(ledgerEntries).toHaveLength(2);
      const betEntry = ledgerEntries.find(
        (e) => e.transactionId === result.transactionId,
      );
      expect(betEntry?.direction).toBe(LedgerDirection.Debit);
      expect(betEntry?.amount.toString()).toBe("25.00");
    });

    it("should reject BET when funds are insufficient without generating ledger entry", async () => {
      const playerId = uuidv4();
      const wallet = await createWalletUseCase.execute({
        playerId,
        initialBalance: { amount: "20.00", currency: Currency.BRL },
      });

      const result = await processWagerUseCase.execute({
        idempotencyKey: `bet-insufficient-${uuidv4()}`,
        providerId: "provider-a",
        externalTransactionId: `tx-${uuidv4()}`,
        playerId,
        walletId: wallet.id,
        roundId: "round-1",
        gameId: "game-1",
        kind: WagerTransactionKind.Bet,
        money: { amount: "25.00", currency: Currency.BRL },
      });

      expect(result.status).toBe(WagerTransactionStatus.Rejected);
      expect(result.failureCode).toBe(FailureCode.INSUFFICIENT_FUNDS);
      expect(result.balance.amount).toBe("20.00"); // Unaltered

      // Verify ledger has NO debit entry
      const fork = orm.em.fork();
      const ledgerEntries = await fork.find(WalletLedgerEntryOrmEntity, {
        walletId: wallet.id,
      });
      expect(ledgerEntries).toHaveLength(1); // Only opening credit
    });

    it("should credit balance and create ledger on WIN", async () => {
      const playerId = uuidv4();
      const wallet = await createWalletUseCase.execute({
        playerId,
        initialBalance: { amount: "50.00", currency: Currency.BRL },
      });

      const result = await processWagerUseCase.execute({
        idempotencyKey: `win-test-${uuidv4()}`,
        providerId: "provider-a",
        externalTransactionId: `tx-${uuidv4()}`,
        playerId,
        walletId: wallet.id,
        roundId: "round-1",
        gameId: "game-1",
        kind: WagerTransactionKind.Win,
        money: { amount: "100.00", currency: Currency.BRL },
      });

      expect(result.status).toBe(WagerTransactionStatus.Processed);
      expect(result.balance.amount).toBe("150.00");
    });

    it("should process LOSS without altering balance or creating ledger entry", async () => {
      const playerId = uuidv4();
      const wallet = await createWalletUseCase.execute({
        playerId,
        initialBalance: { amount: "50.00", currency: Currency.BRL },
      });

      const result = await processWagerUseCase.execute({
        idempotencyKey: `loss-test-${uuidv4()}`,
        providerId: "provider-a",
        externalTransactionId: `tx-${uuidv4()}`,
        playerId,
        walletId: wallet.id,
        roundId: "round-1",
        gameId: "game-1",
        kind: WagerTransactionKind.Loss,
        money: { amount: "10.00", currency: Currency.BRL },
      });

      expect(result.status).toBe(WagerTransactionStatus.Processed);
      expect(result.balance.amount).toBe("50.00"); // Unaltered

      const fork = orm.em.fork();
      const ledgerEntries = await fork.find(WalletLedgerEntryOrmEntity, {
        walletId: wallet.id,
      });
      expect(ledgerEntries).toHaveLength(1); // Only opening credit
    });
  });

  describe("Idempotency Engine", () => {
    it("should return identical response and idempotentReplay true for exact replay", async () => {
      const playerId = uuidv4();
      const wallet = await createWalletUseCase.execute({
        playerId,
        initialBalance: { amount: "100.00", currency: Currency.BRL },
      });

      const idempotencyKey = `idemp-key-${uuidv4()}`;
      const payload = {
        idempotencyKey,
        providerId: "provider-a",
        externalTransactionId: `tx-${uuidv4()}`,
        playerId,
        walletId: wallet.id,
        roundId: "round-1",
        gameId: "game-1",
        kind: WagerTransactionKind.Bet,
        money: { amount: "30.00", currency: Currency.BRL },
      };

      const firstCall = await processWagerUseCase.execute(payload);
      expect(firstCall.status).toBe(WagerTransactionStatus.Processed);
      expect(firstCall.balance.amount).toBe("70.00");
      expect(firstCall.idempotentReplay).toBe(false);

      // Second call: exact same idempotencyKey and business payload
      const secondCall = await processWagerUseCase.execute(payload);
      expect(secondCall.transactionId).toBe(firstCall.transactionId);
      expect(secondCall.status).toBe(WagerTransactionStatus.Processed);
      expect(secondCall.balance.amount).toBe("70.00");
      expect(secondCall.idempotentReplay).toBe(true);

      // Verify ledger has only 1 bet debit
      const fork = orm.em.fork();
      const ledgerEntries = await fork.find(WalletLedgerEntryOrmEntity, {
        walletId: wallet.id,
      });
      expect(ledgerEntries).toHaveLength(2); // 1 opening + 1 bet debit
    });

    it("should throw IdempotencyPayloadConflictError when same key has divergent payload", async () => {
      const playerId = uuidv4();
      const wallet = await createWalletUseCase.execute({
        playerId,
        initialBalance: { amount: "100.00", currency: Currency.BRL },
      });

      const idempotencyKey = `conflict-key-${uuidv4()}`;

      await processWagerUseCase.execute({
        idempotencyKey,
        providerId: "provider-a",
        externalTransactionId: `tx-${uuidv4()}`,
        playerId,
        walletId: wallet.id,
        roundId: "round-1",
        gameId: "game-1",
        kind: WagerTransactionKind.Bet,
        money: { amount: "30.00", currency: Currency.BRL },
      });

      // Second call: same idempotencyKey, DIFFERENT amount
      let error: any;
      try {
        await processWagerUseCase.execute({
          idempotencyKey,
          providerId: "provider-a",
          externalTransactionId: `tx-${uuidv4()}`,
          playerId,
          walletId: wallet.id,
          roundId: "round-1",
          gameId: "game-1",
          kind: WagerTransactionKind.Bet,
          money: { amount: "40.00", currency: Currency.BRL },
        });
      } catch (err) {
        error = err;
      }

      expect(error).toBeDefined();
      expect(error.name).toBe("IdempotencyPayloadConflictError");
    });
  });

  describe("Reversals: REFUND and ROLLBACK", () => {
    it("should execute REFUND for an existing BET, restoring balance", async () => {
      const playerId = uuidv4();
      const wallet = await createWalletUseCase.execute({
        playerId,
        initialBalance: { amount: "100.00", currency: Currency.BRL },
      });

      const extBetId = `bet-ext-${uuidv4()}`;
      await processWagerUseCase.execute({
        idempotencyKey: `bet-refund-test-${uuidv4()}`,
        providerId: "provider-a",
        externalTransactionId: extBetId,
        playerId,
        walletId: wallet.id,
        roundId: "round-1",
        gameId: "game-1",
        kind: WagerTransactionKind.Bet,
        money: { amount: "50.00", currency: Currency.BRL },
      });

      // Refund the BET
      const refundResult = await processWagerUseCase.execute({
        idempotencyKey: `refund-test-${uuidv4()}`,
        providerId: "provider-a",
        externalTransactionId: `refund-ext-${uuidv4()}`,
        playerId,
        walletId: wallet.id,
        roundId: "round-1",
        gameId: "game-1",
        kind: WagerTransactionKind.Refund,
        money: { amount: "50.00", currency: Currency.BRL },
        referenceExternalTransactionId: extBetId,
      });

      expect(refundResult.status).toBe(WagerTransactionStatus.Processed);
      expect(refundResult.balance.amount).toBe("100.00"); // Restored back to 100.00!

      // Second refund attempt on SAME bet must be rejected
      const secondRefund = await processWagerUseCase.execute({
        idempotencyKey: `second-refund-${uuidv4()}`,
        providerId: "provider-a",
        externalTransactionId: `second-refund-ext-${uuidv4()}`,
        playerId,
        walletId: wallet.id,
        roundId: "round-1",
        gameId: "game-1",
        kind: WagerTransactionKind.Refund,
        money: { amount: "50.00", currency: Currency.BRL },
        referenceExternalTransactionId: extBetId,
      });

      expect(secondRefund.status).toBe(WagerTransactionStatus.Rejected);
      expect(secondRefund.failureCode).toBe(
        FailureCode.REFERENCE_ALREADY_REVERSED,
      );
    });

    it("should reject ROLLBACK if debit would cause negative balance (ROLLBACK_WOULD_CAUSE_NEGATIVE_BALANCE)", async () => {
      const playerId = uuidv4();
      const wallet = await createWalletUseCase.execute({
        playerId,
        initialBalance: { amount: "0.00", currency: Currency.BRL },
      });

      // Player wins 100
      const extWinId = `win-ext-${uuidv4()}`;
      await processWagerUseCase.execute({
        idempotencyKey: `win-tx-${uuidv4()}`,
        providerId: "provider-a",
        externalTransactionId: extWinId,
        playerId,
        walletId: wallet.id,
        roundId: "round-1",
        gameId: "game-1",
        kind: WagerTransactionKind.Win,
        money: { amount: "100.00", currency: Currency.BRL },
      });

      // Player bets and spends 80 (balance becomes 20)
      await processWagerUseCase.execute({
        idempotencyKey: `bet-spend-${uuidv4()}`,
        providerId: "provider-a",
        externalTransactionId: `bet-spend-${uuidv4()}`,
        playerId,
        walletId: wallet.id,
        roundId: "round-2",
        gameId: "game-1",
        kind: WagerTransactionKind.Bet,
        money: { amount: "80.00", currency: Currency.BRL },
      });

      // Now attempt to ROLLBACK the 100.00 WIN!
      // Since current balance is 20.00, subtracting 100.00 would result in -80.00!
      // Section 7, rule 9: MUST reject with ROLLBACK_WOULD_CAUSE_NEGATIVE_BALANCE
      const rollbackResult = await processWagerUseCase.execute({
        idempotencyKey: `rollback-attempt-${uuidv4()}`,
        providerId: "provider-a",
        externalTransactionId: `rollback-ext-${uuidv4()}`,
        playerId,
        walletId: wallet.id,
        roundId: "round-1",
        gameId: "game-1",
        kind: WagerTransactionKind.Rollback,
        money: { amount: "100.00", currency: Currency.BRL },
        referenceExternalTransactionId: extWinId,
      });

      expect(rollbackResult.status).toBe(WagerTransactionStatus.Rejected);
      expect(rollbackResult.failureCode).toBe(
        FailureCode.ROLLBACK_WOULD_CAUSE_NEGATIVE_BALANCE,
      );
      expect(rollbackResult.balance.amount).toBe("20.00"); // Balance strictly protected!
    });

    it("should set PENDING_REFERENCE when referenced transaction is not yet in database", async () => {
      const playerId = uuidv4();
      const wallet = await createWalletUseCase.execute({
        playerId,
        initialBalance: { amount: "100.00", currency: Currency.BRL },
      });

      const result = await processWagerUseCase.execute({
        idempotencyKey: `pending-ref-key-${uuidv4()}`,
        providerId: "provider-a",
        externalTransactionId: `refund-early-${uuidv4()}`,
        playerId,
        walletId: wallet.id,
        roundId: "round-1",
        gameId: "game-1",
        kind: WagerTransactionKind.Refund,
        money: { amount: "50.00", currency: Currency.BRL },
        referenceExternalTransactionId: "missing-bet-123",
      });

      expect(result.status).toBe(WagerTransactionStatus.PendingReference);
      expect(result.balance.amount).toBe("100.00");
    });
  });

  describe("Section 8 Mandatory Concurrency Scenario", () => {
    it("should correctly handle 2 simultaneous bets of 80.00 on a 100.00 balance: exactly 1 PROCESSED and 1 REJECTED", async () => {
      const playerId = uuidv4();
      const wallet = await createWalletUseCase.execute({
        playerId,
        initialBalance: { amount: "100.00", currency: Currency.BRL },
      });

      const betPayloadA = {
        idempotencyKey: `concurrent-bet-a-${uuidv4()}`,
        providerId: "provider-concurrent",
        externalTransactionId: `tx-a-${uuidv4()}`,
        playerId,
        walletId: wallet.id,
        roundId: "round-conc",
        gameId: "fortune-chimp",
        kind: WagerTransactionKind.Bet,
        money: { amount: "80.00", currency: Currency.BRL },
      };

      const betPayloadB = {
        idempotencyKey: `concurrent-bet-b-${uuidv4()}`,
        providerId: "provider-concurrent",
        externalTransactionId: `tx-b-${uuidv4()}`,
        playerId,
        walletId: wallet.id,
        roundId: "round-conc",
        gameId: "fortune-chimp",
        kind: WagerTransactionKind.Bet,
        money: { amount: "80.00", currency: Currency.BRL },
      };

      // Disparar ambas as apostas simultaneamente em paralelo real
      const [resA, resB] = await Promise.all([
        processWagerUseCase.execute(betPayloadA),
        processWagerUseCase.execute(betPayloadB),
      ]);

      const statuses = [resA.status, resB.status];
      expect(statuses).toContain(WagerTransactionStatus.Processed);
      expect(statuses).toContain(WagerTransactionStatus.Rejected);

      const rejected = resA.status === WagerTransactionStatus.Rejected ? resA : resB;
      expect(rejected.failureCode).toBe(FailureCode.INSUFFICIENT_FUNDS);

      // Verificar saldo final no banco: exatamente 20.00 BRL
      const fork = orm.em.fork();
      const finalWallet = await fork.findOne(WalletOrmEntity, { id: wallet.id });
      expect(finalWallet?.balance.toString()).toBe("20.00");
      expect(finalWallet?.version).toBe(2); // 1 from creation + 1 from single processed bet

      // Invariante Global: wallet.balance == soma dos lançamentos do ledger
      const ledgerEntries = await fork.find(WalletLedgerEntryOrmEntity, {
        walletId: wallet.id,
      });
      // 1 opening (100) + 1 bet debit (80) = 2 entries
      expect(ledgerEntries).toHaveLength(2);

      let reconstructedBalance = 0;
      for (const entry of ledgerEntries) {
        if (entry.direction === LedgerDirection.Credit) {
          reconstructedBalance += parseFloat(entry.amount.toString());
        } else {
          reconstructedBalance -= parseFloat(entry.amount.toString());
        }
      }
      expect(reconstructedBalance.toFixed(2)).toBe("20.00");
      expect(finalWallet?.balance.toString()).toBe(reconstructedBalance.toFixed(2));
    });
  });
});

