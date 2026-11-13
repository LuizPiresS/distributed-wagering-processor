import {
  GetQueueUrlCommand,
  PurgeQueueCommand,
  ReceiveMessageCommand,
  SendMessageCommand,
  SQSClient,
} from "@aws-sdk/client-sqs";
import { MikroORM } from "@mikro-orm/postgresql";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { v4 as uuidv4 } from "uuid";
import { CreateWalletUseCase } from "../../src/application/use-cases/create-wallet.use-case";
import { ProcessWagerTransactionUseCase } from "../../src/application/use-cases/process-wager-transaction.use-case";
import {
  Currency,
  FailureCode,
  LedgerDirection,
  Money,
  WagerTransactionKind,
  WagerTransactionStatus,
} from "../../src/domain";
import {
  InboxMessageOrmEntity,
  OutboxMessageOrmEntity,
  WagerTransactionOrmEntity,
  WalletLedgerEntryOrmEntity,
  WalletOrmEntity,
} from "../../src/infrastructure/database/entities";
import mikroOrmConfig from "../../src/infrastructure/database/mikro-orm.config";
import type {
  IEventPublisher,
  IntegrationEventPayload,
} from "../../src/infrastructure/messaging/outbox/event-publisher.interface";
import { OutboxPublisherWorker } from "../../src/infrastructure/messaging/outbox/outbox-publisher.worker";
import { SqsConsumerService } from "../../src/infrastructure/messaging/sqs/sqs-consumer.service";
import { PendingReferenceWorker } from "../../src/infrastructure/messaging/workers/pending-reference.worker";

describe("Task 05: SQS Messaging, Inbox, Outbox & Pending Reference (Integration)", () => {
  let orm: MikroORM;
  let sqs: SQSClient;
  let queueUrl: string;
  let createWalletUseCase: CreateWalletUseCase;
  let processWagerUseCase: ProcessWagerTransactionUseCase;
  let sqsConsumer: SqsConsumerService;
  let pendingRefWorker: PendingReferenceWorker;

  beforeAll(async () => {
    orm = await MikroORM.init(mikroOrmConfig);
    createWalletUseCase = new CreateWalletUseCase(orm.em);
    processWagerUseCase = new ProcessWagerTransactionUseCase(orm.em);

    sqs = new SQSClient({
      endpoint: process.env.AWS_ENDPOINT || "http://localhost:4566",
      region: process.env.AWS_REGION || "us-east-1",
      credentials: {
        accessKeyId: "test",
        secretAccessKey: "test",
      },
    });

    const queueRes = await sqs.send(
      new GetQueueUrlCommand({ QueueName: "wager-transactions.fifo" }),
    );
    queueUrl = queueRes.QueueUrl!;

    sqsConsumer = new SqsConsumerService(sqs, orm.em, processWagerUseCase);
    sqsConsumer.setQueueUrl(queueUrl);

    pendingRefWorker = new PendingReferenceWorker(orm.em);
  });

  afterAll(async () => {
    await orm.close();
  });

  beforeEach(async () => {
    // Purge queue before each test to guarantee isolation
    try {
      await sqs.send(new PurgeQueueCommand({ QueueUrl: queueUrl }));
    } catch {
      // PurgeQueue has a 60s cooldown; ignore if in cooldown
    }
  });

  describe("Cenário 1: E2E SQS FIFO -> Inbox -> DB -> Outbox -> SQS Ack", () => {
    it("should consume wager from SQS, deduplicate via Inbox, commit DB and delete SQS message", async () => {
      const playerId = uuidv4();
      const wallet = await createWalletUseCase.execute({
        playerId,
        initialBalance: { amount: "100.00", currency: Currency.BRL },
      });

      const externalTxId = `sqs-tx-${uuidv4()}`;
      const idempotencyKey = `idemp-${uuidv4()}`;

      const payload = {
        idempotencyKey,
        providerId: "pragmatic",
        externalTransactionId: externalTxId,
        playerId,
        walletId: wallet.id,
        roundId: "round-sqs-1",
        gameId: "game-sqs-1",
        kind: WagerTransactionKind.Bet,
        money: { amount: "30.00", currency: Currency.BRL },
        correlationId: `corr-${uuidv4()}`,
      };

      // 1. Send to real SQS FIFO
      const sendRes = await sqs.send(
        new SendMessageCommand({
          QueueUrl: queueUrl,
          MessageBody: JSON.stringify(payload),
          MessageGroupId: wallet.id,
          MessageDeduplicationId: idempotencyKey,
        }),
      );

      expect(sendRes.MessageId).toBeDefined();

      // 2. Poll and process using SqsConsumerService
      const results = await sqsConsumer.pollBatch(1, 2);
      expect(results).toHaveLength(1);
      expect(results[0]?.status).toBe("PROCESSED");
      expect(results[0]?.useCaseResult?.balance.amount).toBe("70.00");

      // 3. Verify Database State
      const fork = orm.em.fork();
      const updatedWallet = await fork.findOne(WalletOrmEntity, { id: wallet.id });
      expect(updatedWallet?.balance.toString()).toBe("70.00");

      const inbox = await fork.findOne(InboxMessageOrmEntity, {
        messageId: results[0]!.messageId,
      });
      expect(inbox).toBeDefined();
      expect(inbox?.processedAt).toBeDefined();

      const ledgerEntries = await fork.find(WalletLedgerEntryOrmEntity, {
        walletId: wallet.id,
      });
      expect(ledgerEntries).toHaveLength(2); // 1 opening + 1 bet debit

      // 4. Verify SQS Queue is now empty (Ack succeeded)
      const receiveRes = await sqs.send(
        new ReceiveMessageCommand({
          QueueUrl: queueUrl,
          MaxNumberOfMessages: 1,
          WaitTimeSeconds: 1,
        }),
      );
      expect(receiveRes.Messages || []).toHaveLength(0);
    });
  });

  describe("Cenário 2: Deduplicação de Redelivery pelo Inbox", () => {
    it("should handle redelivery after commit: skip re-debiting and acknowledge message immediately", async () => {
      const playerId = uuidv4();
      const wallet = await createWalletUseCase.execute({
        playerId,
        initialBalance: { amount: "100.00", currency: Currency.BRL },
      });

      const messageId = `msg-redelivery-${uuidv4()}`;
      const receiptHandle = `receipt-${uuidv4()}`;
      const payload = {
        idempotencyKey: `idemp-redeliv-${uuidv4()}`,
        providerId: "evolution",
        externalTransactionId: `tx-redeliv-${uuidv4()}`,
        playerId,
        walletId: wallet.id,
        roundId: "round-redeliv",
        gameId: "game-redeliv",
        kind: WagerTransactionKind.Bet,
        money: { amount: "40.00", currency: Currency.BRL },
      };

      // Mock SQS client delete call
      let deleteCalledWithReceipt: string | undefined;
      const customSqs: any = {
        send: async (cmd: any) => {
          if (cmd.constructor.name === "DeleteMessageCommand") {
            deleteCalledWithReceipt = cmd.input.ReceiptHandle;
          }
          return {};
        },
      };

      const customConsumer = new SqsConsumerService(
        customSqs,
        orm.em,
        processWagerUseCase,
      );

      // First run: processes normally
      const firstResult = await customConsumer.processSingleMessage({
        MessageId: messageId,
        ReceiptHandle: receiptHandle,
        Body: JSON.stringify(payload),
      });

      expect(firstResult.status).toBe("PROCESSED");
      expect(deleteCalledWithReceipt).toBe(receiptHandle);

      const fork1 = orm.em.fork();
      const walletAfterFirst = await fork1.findOne(WalletOrmEntity, { id: wallet.id });
      expect(walletAfterFirst?.balance.toString()).toBe("60.00");

      // Second run (simulating redelivery because network failed right on delete):
      deleteCalledWithReceipt = undefined;
      const secondResult = await customConsumer.processSingleMessage({
        MessageId: messageId,
        ReceiptHandle: "receipt-redelivered",
        Body: JSON.stringify(payload),
      });

      expect(secondResult.status).toBe("SKIPPED");
      expect(secondResult.reason).toBe("ALREADY_PROCESSED");
      expect(deleteCalledWithReceipt).toBe("receipt-redelivered");

      // Balance MUST NOT be debited twice!
      const fork2 = orm.em.fork();
      const walletAfterSecond = await fork2.findOne(WalletOrmEntity, { id: wallet.id });
      expect(walletAfterSecond?.balance.toString()).toBe("60.00");

      // Ledger count must remain 2 (1 opening, 1 debit)
      const ledgerEntries = await fork2.find(WalletLedgerEntryOrmEntity, {
        walletId: wallet.id,
      });
      expect(ledgerEntries).toHaveLength(2);
    });
  });

  describe("Cenário 3: Múltiplos Outbox Workers Concorrentes (FOR UPDATE SKIP LOCKED)", () => {
    it("should process outbox messages across 3 concurrent workers without duplicates or deadlocks", async () => {
      // Clean/publish any prior messages from other tests to isolate this test
      await orm.em
        .getConnection()
        .execute("UPDATE outbox_messages SET published_at = NOW() WHERE published_at IS NULL;");

      // 1. Enqueue 9 outbox messages in database
      const fork = orm.em.fork();
      const publishedEvents: string[] = [];

      for (let i = 0; i < 9; i++) {
        const outbox = new OutboxMessageOrmEntity();
        outbox.id = uuidv4();
        outbox.aggregateId = `wallet-${i}`;
        outbox.eventType = "WalletBalanceChanged";
        outbox.payload = { idx: i };
        outbox.occurredAt = new Date();
        outbox.attempts = 0;
        outbox.nextAttemptAt = new Date(Date.now() - 1000); // Ready now
        fork.persist(outbox);
      }
      await fork.flush();

      // Shared mock publisher tracking published event IDs safely
      const mockPublisher: IEventPublisher = {
        publish: async (event: IntegrationEventPayload) => {
          publishedEvents.push(event.eventId);
        },
      };

      // 2. Create 3 worker instances sharing the same database
      const worker1 = new OutboxPublisherWorker(orm.em.fork(), mockPublisher);
      const worker2 = new OutboxPublisherWorker(orm.em.fork(), mockPublisher);
      const worker3 = new OutboxPublisherWorker(orm.em.fork(), mockPublisher);

      // 3. Run all 3 workers in parallel
      const results = await Promise.all([
        worker1.processBatch(10),
        worker2.processBatch(10),
        worker3.processBatch(10),
      ]);

      const totalPublished = results.reduce((sum, n) => sum + n, 0);
      expect(totalPublished).toBe(9);
      expect(publishedEvents).toHaveLength(9);

      // Verify no duplicates were published
      const uniqueIds = new Set(publishedEvents);
      expect(uniqueIds.size).toBe(9);

      // Verify in DB all 9 are now marked as published
      const verifyFork = orm.em.fork();
      const unpublished = await verifyFork.find(OutboxMessageOrmEntity, {
        id: { $in: publishedEvents },
        publishedAt: null,
      });
      expect(unpublished).toHaveLength(0);
    });
  });

  describe("Cenário 4: Resolução de Referências Fora de Ordem (PendingReferenceWorker)", () => {
    it("should park REFUND in PENDING_REFERENCE, then resolve and credit when BET arrives", async () => {
      // Clear any prior pending references from earlier test suites to isolate this test
      await orm.em
        .getConnection()
        .execute("UPDATE wager_transactions SET status = 'FAILED' WHERE status = 'PENDING_REFERENCE';");

      const playerId = uuidv4();
      const wallet = await createWalletUseCase.execute({
        playerId,
        initialBalance: { amount: "100.00", currency: Currency.BRL },
      });

      const providerId = "pragmatic";
      const betExternalId = `bet-ext-${uuidv4()}`;

      // 1. REFUND arrives BEFORE the BET exists
      const refundResult = await processWagerUseCase.execute({
        idempotencyKey: `refund-idemp-${uuidv4()}`,
        providerId,
        externalTransactionId: `refund-ext-${uuidv4()}`,
        playerId,
        walletId: wallet.id,
        roundId: "round-1",
        gameId: "game-1",
        kind: WagerTransactionKind.Refund,
        money: { amount: "25.00", currency: Currency.BRL },
        referenceExternalTransactionId: betExternalId,
      });

      expect(refundResult.status).toBe(WagerTransactionStatus.PendingReference);
      expect(refundResult.balance.amount).toBe("100.00"); // Unaltered

      // 2. Worker executes while BET still absent: remains unresolved
      const unresolvedCount = await pendingRefWorker.processBatch();
      expect(unresolvedCount).toBe(0);

      const checkFork = orm.em.fork();
      const refundTxBeforeBet = await checkFork.findOne(WagerTransactionOrmEntity, {
        id: refundResult.transactionId,
      });
      expect(refundTxBeforeBet?.status).toBe(WagerTransactionStatus.PendingReference);

      // 3. Now the missing BET arrives and is processed
      const betResult = await processWagerUseCase.execute({
        idempotencyKey: `bet-idemp-${uuidv4()}`,
        providerId,
        externalTransactionId: betExternalId,
        playerId,
        walletId: wallet.id,
        roundId: "round-1",
        gameId: "game-1",
        kind: WagerTransactionKind.Bet,
        money: { amount: "25.00", currency: Currency.BRL },
      });

      expect(betResult.status).toBe(WagerTransactionStatus.Processed);
      expect(betResult.balance.amount).toBe("75.00");

      // 4. Worker executes again: BET is now present!
      const resolvedCount = await pendingRefWorker.processBatch();
      expect(resolvedCount).toBe(1);

      // 5. Verify REFUND is now PROCESSED and wallet balance is restored to 100.00
      const finalFork = orm.em.fork();
      const refundTxAfter = await finalFork.findOne(WagerTransactionOrmEntity, {
        id: refundResult.transactionId,
      });
      expect(refundTxAfter?.status).toBe(WagerTransactionStatus.Processed);
      expect(refundTxAfter?.referenceTransactionId).toBe(betResult.transactionId);

      const finalWallet = await finalFork.findOne(WalletOrmEntity, { id: wallet.id });
      expect(finalWallet?.balance.toString()).toBe("100.00");

      // Ledger: 1 opening + 1 bet debit + 1 refund credit = 3 entries
      const finalLedger = await finalFork.find(WalletLedgerEntryOrmEntity, {
        walletId: wallet.id,
      });
      expect(finalLedger).toHaveLength(3);
      const refundLedger = finalLedger.find((l) => l.transactionId === refundResult.transactionId);
      expect(refundLedger?.direction).toBe(LedgerDirection.Credit);
      expect(refundLedger?.amount.toString()).toBe("25.00");
    });

    it("should reject PENDING_REFERENCE as REFERENCE_NOT_FOUND when TTL expires", async () => {
      const playerId = uuidv4();
      const wallet = await createWalletUseCase.execute({
        playerId,
        initialBalance: { amount: "100.00", currency: Currency.BRL },
      });

      // Insert transaction in PENDING_REFERENCE with createdAt 20 minutes ago
      const fork = orm.em.fork();
      const expiredTx = new WagerTransactionOrmEntity();
      expiredTx.id = uuidv4();
      expiredTx.providerId = "spribe";
      expiredTx.externalTransactionId = `expired-tx-${uuidv4()}`;
      expiredTx.idempotencyKey = `expired-idemp-${uuidv4()}`;
      expiredTx.payloadHash = "dummyhash";
      expiredTx.walletId = wallet.id;
      expiredTx.playerId = playerId;
      expiredTx.roundId = "round-expired";
      expiredTx.gameId = "game-expired";
      expiredTx.kind = WagerTransactionKind.Refund;
      expiredTx.amount = Money.fromInput(wallet.balance);
      expiredTx.currency = wallet.balance.currency;
      expiredTx.referenceExternalTransactionId = `non-existent-${uuidv4()}`;
      expiredTx.status = WagerTransactionStatus.PendingReference;
      expiredTx.createdAt = new Date(Date.now() - 20 * 60 * 1000); // 20 mins ago (exceeds 15 mins TTL)

      fork.persist(expiredTx);
      await fork.flush();

      // Run pending reference worker
      const processed = await pendingRefWorker.processBatch();
      expect(processed).toBe(1);

      // Verify expired transaction is REJECTED with REFERENCE_NOT_FOUND
      const verifyFork = orm.em.fork();
      const txAfterTtl = await verifyFork.findOne(WagerTransactionOrmEntity, {
        id: expiredTx.id,
      });
      expect(txAfterTtl?.status).toBe(WagerTransactionStatus.Rejected);
      expect(txAfterTtl?.failureCode).toBe(FailureCode.REFERENCE_NOT_FOUND);
    });
  });
});
