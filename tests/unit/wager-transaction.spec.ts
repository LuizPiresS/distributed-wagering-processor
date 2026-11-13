import { describe, expect, it } from "bun:test";
import {
  FailureCode,
  InvalidOperationReferenceError,
  InvalidTransactionStateError,
  LedgerDirection,
  Money,
  WagerTransaction,
  WagerTransactionKind,
  WagerTransactionStatus,
} from "../../src/domain";

describe("WagerTransaction Entity & State Machine", () => {
  const baseProps = {
    id: "tx-100",
    providerId: "provider-a",
    externalTransactionId: "ext-100",
    idempotencyKey: "provider-a:ext-100",
    payloadHash: "abc123hash",
    walletId: "wallet-1",
    playerId: "player-1",
    roundId: "round-1",
    gameId: "fortune-chimp",
    kind: WagerTransactionKind.Bet,
    money: Money.from({ amount: "25.00", currency: "BRL" }),
  };

  describe("Creation & Reference Requirements", () => {
    it("should create a transaction born in PENDING status", () => {
      const tx = WagerTransaction.create(baseProps);
      expect(tx.status).toBe(WagerTransactionStatus.Pending);
      expect(tx.isTerminal()).toBe(false);
      expect(tx.referenceExternalTransactionId).toBeUndefined();
    });

    it("should require referenceExternalTransactionId for REFUND", () => {
      expect(() =>
        WagerTransaction.create({
          ...baseProps,
          kind: WagerTransactionKind.Refund,
        }),
      ).toThrow(InvalidOperationReferenceError);
    });

    it("should require referenceExternalTransactionId for ROLLBACK", () => {
      expect(() =>
        WagerTransaction.create({
          ...baseProps,
          kind: WagerTransactionKind.Rollback,
        }),
      ).toThrow(InvalidOperationReferenceError);
    });

    it("should create REFUND or ROLLBACK with valid reference", () => {
      const refund = WagerTransaction.create({
        ...baseProps,
        kind: WagerTransactionKind.Refund,
        referenceExternalTransactionId: "ref-ext-100",
      });
      expect(refund.requiresReference()).toBe(true);
      expect(refund.referenceExternalTransactionId).toBe("ref-ext-100");
    });
  });

  describe("State Transitions & Terminal State Protection", () => {
    it("should transition from PENDING to PROCESSED", () => {
      const tx = WagerTransaction.create(baseProps);
      const processedAt = new Date();
      tx.markProcessed("ref-internal-1", processedAt);

      expect(tx.status).toBe(WagerTransactionStatus.Processed);
      expect(tx.isTerminal()).toBe(true);
      expect(tx.referenceTransactionId).toBe("ref-internal-1");
      expect(tx.processedAt).toBe(processedAt);
    });

    it("should transition from PENDING to PENDING_REFERENCE and then to PROCESSED", () => {
      const tx = WagerTransaction.create({
        ...baseProps,
        kind: WagerTransactionKind.Refund,
        referenceExternalTransactionId: "ref-ext-100",
      });

      tx.markPendingReference();
      expect(tx.status).toBe(WagerTransactionStatus.PendingReference);
      expect(tx.isTerminal()).toBe(false);

      tx.markProcessed("ref-tx-999");
      expect(tx.status).toBe(WagerTransactionStatus.Processed);
      expect(tx.isTerminal()).toBe(true);
    });

    it("should transition to REJECTED with a FailureCode", () => {
      const tx = WagerTransaction.create(baseProps);
      tx.reject(FailureCode.INSUFFICIENT_FUNDS);

      expect(tx.status).toBe(WagerTransactionStatus.Rejected);
      expect(tx.failureCode).toBe(FailureCode.INSUFFICIENT_FUNDS);
      expect(tx.isTerminal()).toBe(true);
    });

    it("should transition to FAILED with a FailureCode", () => {
      const tx = WagerTransaction.create(baseProps);
      tx.fail(FailureCode.REFERENCE_NOT_FOUND);

      expect(tx.status).toBe(WagerTransactionStatus.Failed);
      expect(tx.failureCode).toBe(FailureCode.REFERENCE_NOT_FOUND);
      expect(tx.isTerminal()).toBe(true);
    });

    it("should throw InvalidTransactionStateError when trying to transition a terminal transaction", () => {
      const tx = WagerTransaction.create(baseProps);
      tx.markProcessed(undefined);

      expect(() => tx.markProcessed(undefined)).toThrow(
        InvalidTransactionStateError,
      );
      expect(() => tx.reject(FailureCode.INSUFFICIENT_FUNDS)).toThrow(
        InvalidTransactionStateError,
      );
      expect(() => tx.fail(FailureCode.AMOUNT_MISMATCH)).toThrow(
        InvalidTransactionStateError,
      );
      expect(() => tx.markPendingReference()).toThrow(
        InvalidTransactionStateError,
      );
    });
  });

  describe("Domain Queries & Ledger Directions", () => {
    it("affectsBalance should be false only for LOSS", () => {
      const bet = WagerTransaction.create(baseProps);
      const loss = WagerTransaction.create({
        ...baseProps,
        kind: WagerTransactionKind.Loss,
      });

      expect(bet.affectsBalance()).toBe(true);
      expect(loss.affectsBalance()).toBe(false);
    });

    it("should match payload hash correctly", () => {
      const tx = WagerTransaction.create(baseProps);
      expect(tx.matchesPayload("abc123hash")).toBe(true);
      expect(tx.matchesPayload("differenthash")).toBe(false);
    });

    it("should compute correct ledger direction for standard operations", () => {
      const bet = WagerTransaction.create({
        ...baseProps,
        kind: WagerTransactionKind.Bet,
      });
      const win = WagerTransaction.create({
        ...baseProps,
        kind: WagerTransactionKind.Win,
      });
      const opening = WagerTransaction.create({
        ...baseProps,
        kind: WagerTransactionKind.Opening,
      });
      const refund = WagerTransaction.create({
        ...baseProps,
        kind: WagerTransactionKind.Refund,
        referenceExternalTransactionId: "ext-1",
      });

      expect(bet.ledgerDirectionFor()).toBe(LedgerDirection.Debit);
      expect(win.ledgerDirectionFor()).toBe(LedgerDirection.Credit);
      expect(opening.ledgerDirectionFor()).toBe(LedgerDirection.Credit);
      expect(refund.ledgerDirectionFor()).toBe(LedgerDirection.Credit);
    });

    it("should compute inverted direction for ROLLBACK depending on referenced transaction", () => {
      const betRef = WagerTransaction.create({
        ...baseProps,
        id: "bet-ref",
        kind: WagerTransactionKind.Bet,
      });
      const winRef = WagerTransaction.create({
        ...baseProps,
        id: "win-ref",
        kind: WagerTransactionKind.Win,
      });

      const rollback = WagerTransaction.create({
        ...baseProps,
        kind: WagerTransactionKind.Rollback,
        referenceExternalTransactionId: "ref-ext",
      });

      // Rollback of BET (debit) -> CREDIT
      expect(rollback.ledgerDirectionFor(betRef)).toBe(LedgerDirection.Credit);

      // Rollback of WIN (credit) -> DEBIT
      expect(rollback.ledgerDirectionFor(winRef)).toBe(LedgerDirection.Debit);
    });
  });
});

