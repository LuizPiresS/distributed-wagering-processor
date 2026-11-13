import { describe, expect, it } from "bun:test";
import {
  FailureCode,
  InboxMessage,
  LedgerDirection,
  OutboxMessage,
  WagerTransactionKind,
  WagerTransactionPendingReference,
  WagerTransactionProcessed,
  WagerTransactionRejected,
  WalletBalanceChanged,
} from "../../src/domain";

describe("Integration Events & Messaging Entities", () => {
  const occurredAt = new Date("2026-07-29T15:00:00.000Z");

  describe("IntegrationEvent Envelope", () => {
    it("should serialize WalletBalanceChanged event to pure JSON envelope with MoneyProps", () => {
      const event = new WalletBalanceChanged({
        eventId: "event-1",
        aggregateId: "wallet-1",
        correlationId: "corr-1",
        causationId: "cause-1",
        occurredAt,
        data: {
          walletId: "wallet-1",
          transactionId: "tx-1",
          direction: LedgerDirection.Debit,
          money: { amount: "25.00", currency: "BRL" },
          balanceBefore: { amount: "100.00", currency: "BRL" },
          balanceAfter: { amount: "75.00", currency: "BRL" },
          walletVersion: 2,
        },
      });

      expect(event.eventType).toBe("WalletBalanceChanged");
      expect(event.version).toBe(1);

      const json = event.toJSON();
      expect(json.eventId).toBe("event-1");
      expect(json.eventType).toBe("WalletBalanceChanged");
      expect(json.occurredAt).toBe("2026-07-29T15:00:00.000Z");
      expect(json.data.money).toEqual({ amount: "25.00", currency: "BRL" });
    });

    it("should serialize WagerTransactionProcessed event correctly", () => {
      const event = new WagerTransactionProcessed({
        eventId: "event-2",
        aggregateId: "tx-100",
        correlationId: "corr-2",
        occurredAt,
        data: {
          transactionId: "tx-100",
          providerId: "provider-a",
          externalTransactionId: "ext-100",
          playerId: "player-1",
          walletId: "wallet-1",
          roundId: "round-1",
          gameId: "game-1",
          kind: WagerTransactionKind.Bet,
          money: { amount: "50.00", currency: "BRL" },
          processedAt: occurredAt.toISOString(),
        },
      });

      expect(event.eventType).toBe("WagerTransactionProcessed");
      expect(event.data.kind).toBe(WagerTransactionKind.Bet);
    });

    it("should serialize WagerTransactionRejected event with FailureCode", () => {
      const event = new WagerTransactionRejected({
        eventId: "event-3",
        aggregateId: "tx-101",
        correlationId: "corr-3",
        occurredAt,
        data: {
          transactionId: "tx-101",
          providerId: "provider-a",
          externalTransactionId: "ext-101",
          playerId: "player-1",
          walletId: "wallet-1",
          roundId: "round-1",
          gameId: "game-1",
          kind: WagerTransactionKind.Bet,
          money: { amount: "150.00", currency: "BRL" },
          failureCode: FailureCode.INSUFFICIENT_FUNDS,
          rejectedAt: occurredAt.toISOString(),
        },
      });

      expect(event.eventType).toBe("WagerTransactionRejected");
      expect(event.data.failureCode).toBe(FailureCode.INSUFFICIENT_FUNDS);
    });

    it("should serialize WagerTransactionPendingReference event", () => {
      const event = new WagerTransactionPendingReference({
        eventId: "event-4",
        aggregateId: "tx-102",
        correlationId: "corr-4",
        occurredAt,
        data: {
          transactionId: "tx-102",
          providerId: "provider-a",
          externalTransactionId: "ext-102",
          playerId: "player-1",
          walletId: "wallet-1",
          roundId: "round-1",
          gameId: "game-1",
          kind: WagerTransactionKind.Refund,
          money: { amount: "50.00", currency: "BRL" },
          referenceExternalTransactionId: "ext-ref-original",
          pendingSince: occurredAt.toISOString(),
        },
      });

      expect(event.eventType).toBe("WagerTransactionPendingReference");
      expect(event.data.referenceExternalTransactionId).toBe(
        "ext-ref-original",
      );
    });
  });

  describe("OutboxMessage Entity", () => {
    it("should enqueue an IntegrationEvent, starting with 0 attempts and pending state", () => {
      const event = new WalletBalanceChanged({
        eventId: "event-1",
        aggregateId: "wallet-1",
        correlationId: "corr-1",
        occurredAt,
        data: {
          walletId: "wallet-1",
          transactionId: "tx-1",
          direction: LedgerDirection.Credit,
          money: { amount: "100.00", currency: "BRL" },
          balanceBefore: { amount: "0.00", currency: "BRL" },
          balanceAfter: { amount: "100.00", currency: "BRL" },
          walletVersion: 1,
        },
      });

      const outbox = OutboxMessage.enqueue(event, "outbox-1");

      expect(outbox.id).toBe("outbox-1");
      expect(outbox.aggregateId).toBe("wallet-1");
      expect(outbox.eventType).toBe("WalletBalanceChanged");
      expect(outbox.attempts).toBe(0);
      expect(outbox.isPending()).toBe(true);
      expect(outbox.isDue()).toBe(true);
    });

    it("should schedule retry with backoff and mark published", () => {
      const event = new WalletBalanceChanged({
        eventId: "event-1",
        aggregateId: "wallet-1",
        correlationId: "corr-1",
        occurredAt,
        data: {
          walletId: "wallet-1",
          transactionId: "tx-1",
          direction: LedgerDirection.Credit,
          money: { amount: "100.00", currency: "BRL" },
          balanceBefore: { amount: "0.00", currency: "BRL" },
          balanceAfter: { amount: "100.00", currency: "BRL" },
          walletVersion: 1,
        },
      });

      const outbox = OutboxMessage.enqueue(event, "outbox-2");
      const now = new Date();

      outbox.scheduleRetry(now);
      expect(outbox.attempts).toBe(1);
      expect(outbox.nextAttemptAt).toBeDefined();
      expect(outbox.nextAttemptAt!.getTime()).toBeGreaterThan(now.getTime());

      outbox.markPublished();
      expect(outbox.isPending()).toBe(false);
      expect(outbox.publishedAt).toBeDefined();
      expect(outbox.isDue()).toBe(false);
    });
  });

  describe("InboxMessage Entity", () => {
    it("should create received inbox message and mark processed", () => {
      const inbox = InboxMessage.receive({
        messageId: "msg-123",
        consumerName: "wager-consumer",
        payloadHash: "hash-456",
      });

      expect(inbox.messageId).toBe("msg-123");
      expect(inbox.consumerName).toBe("wager-consumer");
      expect(inbox.isProcessed()).toBe(false);

      const processedAt = new Date();
      inbox.markProcessed(processedAt);
      expect(inbox.isProcessed()).toBe(true);
      expect(inbox.processedAt).toBe(processedAt);
    });
  });
});

