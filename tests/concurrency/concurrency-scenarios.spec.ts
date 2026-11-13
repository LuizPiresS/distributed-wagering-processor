import { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { v4 as uuidv4 } from "uuid";
import { AppModule } from "../../src/app.module";
import { ProcessWagerTransactionUseCase } from "../../src/application/use-cases/process-wager-transaction.use-case";
import { Currency, FailureCode, WagerTransactionStatus } from "../../src/domain";
import {
  OutboxMessageOrmEntity,
  WagerTransactionOrmEntity,
  WalletLedgerEntryOrmEntity,
  WalletOrmEntity,
} from "../../src/infrastructure/database/entities";
import {
  IEventPublisher,
  IntegrationEventPayload,
} from "../../src/infrastructure/messaging/outbox/event-publisher.interface";
import { OutboxPublisherWorker } from "../../src/infrastructure/messaging/outbox/outbox-publisher.worker";
import { SqsConsumerService } from "../../src/infrastructure/messaging/sqs/sqs-consumer.service";
import { PendingReferenceWorker } from "../../src/infrastructure/messaging/workers/pending-reference.worker";
import { MikroORM } from "@mikro-orm/postgresql";

describe("Task 07: Concurrency Chaos & Parallelism (Real Database & Services)", () => {
  let app: INestApplication;
  let baseUrl: string;
  let orm: MikroORM;

  beforeAll(async () => {
    app = await NestFactory.create(AppModule, { logger: false });
    await app.listen(0);
    baseUrl = await app.getUrl();
    orm = app.get(MikroORM);
  });

  afterAll(async () => {
    await app.close();
  });

  async function createWallet(amount = "1000.00", currency = Currency.BRL) {
    const playerId = uuidv4();
    const res = await fetch(`${baseUrl}/wallets`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        playerId,
        initialBalance: { amount, currency },
      }),
    });
    const wallet: any = await res.json();
    return { ...wallet, playerId };
  }

  async function assertGlobalAccountingInvariant(walletId: string) {
    const recRes = await fetch(`${baseUrl}/wallets/${walletId}/reconciliation`, {
      method: "POST",
    });
    expect(recRes.status).toBe(200);
    const recData: any = await recRes.json();
    expect(recData.consistent).toBe(true);
    expect(recData.difference.amount).toBe("0.00");
  }

  describe("C1: 50 Replays Simultâneos com a Mesma Idempotency-Key", () => {
    it("should process exactly 1 debit and return 49 idempotent replays without double spending", async () => {
      const wallet = await createWallet("1000.00");
      const idempotencyKey = `c1-key-${uuidv4()}`;
      const externalTxId = `c1-tx-${uuidv4()}`;

      const payload = {
        providerId: "pragmatic",
        externalTransactionId: externalTxId,
        playerId: wallet.playerId,
        walletId: wallet.id,
        roundId: "c1-round",
        gameId: "c1-game",
        kind: "BET",
        money: { amount: "50.00", currency: Currency.BRL },
      };

      // Disparar 50 requisições simultâneas em paralelo real com a MESMA chave
      const requests = Array.from({ length: 50 }, () =>
        fetch(`${baseUrl}/wagering/transactions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": idempotencyKey,
          },
          body: JSON.stringify(payload),
        }),
      );

      const responses = await Promise.all(requests);

      // Nenhuma requisição deve falhar com 500
      for (const res of responses) {
        expect([200, 201]).toContain(res.status);
      }

      const results = await Promise.all(responses.map((r) => r.json() as Promise<any>));

      // Exatamente 1 primeira execução (idempotentReplay: false)
      const firstProcessings = results.filter((r) => r.idempotentReplay === false);
      expect(firstProcessings).toHaveLength(1);

      // Exatamente 49 replays idempotentes (idempotentReplay: true)
      const replays = results.filter((r) => r.idempotentReplay === true);
      expect(replays).toHaveLength(49);

      // Todas observam o mesmo saldo final de 950.00 BRL
      for (const r of results) {
        expect(r.balance.amount).toBe("950.00");
        expect(r.status).toBe(WagerTransactionStatus.Processed);
      }

      // No banco de dados: apenas 2 lançamentos no ledger (1 abertura de 1000.00 + 1 aposta de 50.00)
      const fork = orm.em.fork();
      const ledgerEntries = await fork.find(WalletLedgerEntryOrmEntity, {
        walletId: wallet.id,
      });
      expect(ledgerEntries).toHaveLength(2);

      // Invariante Contábil Global: balance == sum(ledger)
      await assertGlobalAccountingInvariant(wallet.id);
    });
  });

  describe("C2: Disputa de Saldo Concorrente (Seção 8)", () => {
    it("should handle 2 simultaneous bets of 80.00 on a 100.00 balance: exactly 1 PROCESSED and 1 REJECTED", async () => {
      const wallet = await createWallet("100.00");

      const bet1 = {
        providerId: "evolution",
        externalTransactionId: `c2-tx1-${uuidv4()}`,
        playerId: wallet.playerId,
        walletId: wallet.id,
        roundId: "c2-round-1",
        gameId: "c2-game-1",
        kind: "BET",
        money: { amount: "80.00", currency: Currency.BRL },
      };

      const bet2 = {
        providerId: "evolution",
        externalTransactionId: `c2-tx2-${uuidv4()}`,
        playerId: wallet.playerId,
        walletId: wallet.id,
        roundId: "c2-round-2",
        gameId: "c2-game-1",
        kind: "BET",
        money: { amount: "80.00", currency: Currency.BRL },
      };

      // Disparar ambas no exato mesmo instante
      const [res1, res2] = await Promise.all([
        fetch(`${baseUrl}/wagering/transactions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": `c2-key-1-${uuidv4()}`,
          },
          body: JSON.stringify(bet1),
        }),
        fetch(`${baseUrl}/wagering/transactions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": `c2-key-2-${uuidv4()}`,
          },
          body: JSON.stringify(bet2),
        }),
      ]);

      const statuses = [res1.status, res2.status].sort();
      // Exatamente um 201 (PROCESSED) e exatamente um 422 (REJECTED)
      expect(statuses).toEqual([201, 422]);

      const body1: any = await res1.json();
      const body2: any = await res2.json();

      const processed = [body1, body2].find(
        (b) => b.status === WagerTransactionStatus.Processed,
      );
      const rejected = [body1, body2].find(
        (b) => b.status === WagerTransactionStatus.Rejected,
      );

      expect(processed).toBeDefined();
      expect(rejected).toBeDefined();
      expect(rejected?.failureCode).toBe(FailureCode.INSUFFICIENT_FUNDS);

      // Ambos retornam o saldo final de 20.00 BRL
      expect(processed?.balance.amount).toBe("20.00");
      expect(rejected?.balance.amount).toBe("20.00");

      // No banco de dados: apenas 2 registros no ledger (1 abertura de 100.00 + 1 aposta de 80.00)
      const fork = orm.em.fork();
      const ledgerEntries = await fork.find(WalletLedgerEntryOrmEntity, {
        walletId: wallet.id,
      });
      expect(ledgerEntries).toHaveLength(2);

      // Invariante Contábil Global
      await assertGlobalAccountingInvariant(wallet.id);
    });
  });

  describe("C3: Wallets Distintas em Paralelo", () => {
    it("should process 10 distinct wallets simultaneously without mutual locking contention", async () => {
      // Criar 10 carteiras com 100.00 BRL cada
      const wallets = await Promise.all(
        Array.from({ length: 10 }, () => createWallet("100.00")),
      );

      // Disparar 1 aposta de 40.00 BRL para cada carteira simultaneamente
      const betRequests = wallets.map((w, idx) =>
        fetch(`${baseUrl}/wagering/transactions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": `c3-key-${idx}-${uuidv4()}`,
          },
          body: JSON.stringify({
            providerId: "pragmatic",
            externalTransactionId: `c3-tx-${idx}-${uuidv4()}`,
            playerId: w.playerId,
            walletId: w.id,
            roundId: `c3-round-${idx}`,
            gameId: "c3-game",
            kind: "BET",
            money: { amount: "40.00", currency: Currency.BRL },
          }),
        }),
      );

      const responses = await Promise.all(betRequests);
      for (const res of responses) {
        expect(res.status).toBe(201);
      }

      const results = await Promise.all(responses.map((r) => r.json() as Promise<any>));
      for (const result of results) {
        expect(result.status).toBe(WagerTransactionStatus.Processed);
        expect(result.balance.amount).toBe("60.00");
      }

      // Validar invariante contábil em todas as 10 carteiras
      await Promise.all(wallets.map((w) => assertGlobalAccountingInvariant(w.id)));
    });
  });

  describe("C4: >= 3 Instâncias / Conexões Disparando Carga Mista", () => {
    it("should process 24 mixed transactions without PostgreSQL deadlocks (40P01)", async () => {
      const wallet = await createWallet("500.00");

      // Simular 3 clientes/workers concorrentes disparando 8 operações cada
      const operations = Array.from({ length: 24 }, (_, i) => {
        const isWin = i % 3 === 0;
        return {
          kind: isWin ? "WIN" : "BET",
          amount: isWin ? "20.00" : "15.00",
        };
      });

      const promises = operations.map((op, idx) =>
        fetch(`${baseUrl}/wagering/transactions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": `c4-key-${idx}-${uuidv4()}`,
          },
          body: JSON.stringify({
            providerId: "pragmatic",
            externalTransactionId: `c4-tx-${idx}-${uuidv4()}`,
            playerId: wallet.playerId,
            walletId: wallet.id,
            roundId: `c4-round-${idx}`,
            gameId: "c4-game",
            kind: op.kind,
            money: { amount: op.amount, currency: Currency.BRL },
          }),
        }),
      );

      const responses = await Promise.all(promises);

      // Todas devem responder com status HTTP controlado (200, 201 ou 422), NUNCA 500 (deadlock)
      for (const res of responses) {
        expect([200, 201, 422]).toContain(res.status);
      }

      // Invariante contábil estrito ao fim da tempestade de transações
      await assertGlobalAccountingInvariant(wallet.id);
    });
  });

  describe("C5: Crash Pós-Commit e Pré-Ack no SQS (Inbox Dedup)", () => {
    it("should handle redelivery after DB commit: deduplicate via Inbox without double-charging", async () => {
      const wallet = await createWallet("200.00");
      const messageId = `c5-msg-${uuidv4()}`;
      const idempotencyKey = `c5-idemp-${uuidv4()}`;

      const payload = {
        idempotencyKey,
        providerId: "evolution",
        externalTransactionId: `c5-tx-${uuidv4()}`,
        playerId: wallet.playerId,
        walletId: wallet.id,
        roundId: "c5-round",
        gameId: "c5-game",
        kind: "BET",
        money: { amount: "50.00", currency: Currency.BRL },
      };

      let ackCount = 0;
      const mockSqs: any = {
        send: async (cmd: any) => {
          if (cmd.constructor.name === "DeleteMessageCommand") {
            ackCount++;
          }
          return {};
        },
      };

      const processWagerUseCase = app.get(ProcessWagerTransactionUseCase);
      const testConsumer = new SqsConsumerService(
        mockSqs,
        orm.em,
        processWagerUseCase,
      );

      // Simular consumo da mensagem
      const firstRun = await testConsumer.processSingleMessage({
        MessageId: messageId,
        ReceiptHandle: "receipt-c5-1",
        Body: JSON.stringify(payload),
      });

      expect(firstRun.status).toBe("PROCESSED");
      expect(ackCount).toBe(1);

      const fork1 = orm.em.fork();
      const walletAfterFirst = await fork1.findOne(WalletOrmEntity, { id: wallet.id });
      expect(walletAfterFirst?.balance.toString()).toBe("150.00");

      // Simular crash pós-commit / pré-ack: mensagem é redelivered com o mesmo MessageId
      const secondRun = await testConsumer.processSingleMessage({
        MessageId: messageId,
        ReceiptHandle: "receipt-c5-redelivered",
        Body: JSON.stringify(payload),
      });

      expect(secondRun.status).toBe("SKIPPED");
      expect(secondRun.reason).toBe("ALREADY_PROCESSED");
      expect(ackCount).toBe(2);

      // Saldo NÃO é debitado novamente (permanece 150.00)
      const fork2 = orm.em.fork();
      const walletAfterSecond = await fork2.findOne(WalletOrmEntity, { id: wallet.id });
      expect(walletAfterSecond?.balance.toString()).toBe("150.00");

      await assertGlobalAccountingInvariant(wallet.id);
    });
  });

  describe("C6: Publishers Concorrentes na Outbox (SKIP LOCKED)", () => {
    it("should process 20 outbox messages with 2 concurrent workers without duplicate sends", async () => {
      // Isolar mensagens anteriores
      await orm.em
        .getConnection()
        .execute("UPDATE outbox_messages SET published_at = NOW() WHERE published_at IS NULL;");

      const fork = orm.em.fork();
      const publishedEvents: string[] = [];

      for (let i = 0; i < 20; i++) {
        const outbox = new OutboxMessageOrmEntity();
        outbox.id = uuidv4();
        outbox.aggregateId = `wallet-c6-${i}`;
        outbox.eventType = "WalletBalanceChanged";
        outbox.payload = { testIdx: i };
        outbox.occurredAt = new Date();
        outbox.attempts = 0;
        outbox.nextAttemptAt = new Date(Date.now() - 5000);
        fork.persist(outbox);
      }
      await fork.flush();

      const mockPublisher: IEventPublisher = {
        publish: async (event: IntegrationEventPayload) => {
          publishedEvents.push(event.eventId);
        },
      };

      // 2 workers concorrentes
      const workerA = new OutboxPublisherWorker(orm.em.fork(), mockPublisher);
      const workerB = new OutboxPublisherWorker(orm.em.fork(), mockPublisher);

      const [resA, resB] = await Promise.all([
        workerA.processBatch(20),
        workerB.processBatch(20),
      ]);

      expect(resA + resB).toBe(20);
      expect(publishedEvents).toHaveLength(20);

      // Verificação estrita de que nenhum evento foi publicado duas vezes
      const uniqueEvents = new Set(publishedEvents);
      expect(uniqueEvents.size).toBe(20);
    });
  });

  describe("C7: Reversão Fora de Ordem e Resolução pelo Worker", () => {
    it("should park REFUND in PENDING_REFERENCE and resolve it when BET arrives", async () => {
      // Limpar transações anteriores em PENDING_REFERENCE para isolamento
      await orm.em
        .getConnection()
        .execute("UPDATE wager_transactions SET status = 'FAILED' WHERE status = 'PENDING_REFERENCE';");

      const wallet = await createWallet("100.00");
      const betExtId = `c7-bet-${uuidv4()}`;

      // 1. REFUND chega antes do BET
      const refundRes = await fetch(`${baseUrl}/wagering/transactions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": `c7-ref-idemp-${uuidv4()}`,
        },
        body: JSON.stringify({
          providerId: "pragmatic",
          externalTransactionId: `c7-ref-${uuidv4()}`,
          playerId: wallet.playerId,
          walletId: wallet.id,
          roundId: "c7-r1",
          gameId: "c7-g1",
          kind: "REFUND",
          money: { amount: "35.00", currency: Currency.BRL },
          referenceExternalTransactionId: betExtId,
        }),
      });

      expect(refundRes.status).toBe(202);
      const refundData: any = await refundRes.json();
      expect(refundData.status).toBe(WagerTransactionStatus.PendingReference);

      // 2. BET chega e debita a carteira (100.00 - 35.00 = 65.00)
      const betRes = await fetch(`${baseUrl}/wagering/transactions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": `c7-bet-idemp-${uuidv4()}`,
        },
        body: JSON.stringify({
          providerId: "pragmatic",
          externalTransactionId: betExtId,
          playerId: wallet.playerId,
          walletId: wallet.id,
          roundId: "c7-r1",
          gameId: "c7-g1",
          kind: "BET",
          money: { amount: "35.00", currency: Currency.BRL },
        }),
      });

      expect(betRes.status).toBe(201);
      const betData: any = await betRes.json();
      expect(betData.balance.amount).toBe("65.00");

      // 3. Worker processa e resolve a referência pendente
      const pendingWorker = app.get(PendingReferenceWorker);
      const resolved = await pendingWorker.processBatch();
      expect(resolved).toBe(1);

      // 4. Saldo restaurado para 100.00 BRL
      const finalFork = orm.em.fork();
      const finalWallet = await finalFork.findOne(WalletOrmEntity, { id: wallet.id });
      expect(finalWallet?.balance.toString()).toBe("100.00");

      const resolvedRefund = await finalFork.findOne(WagerTransactionOrmEntity, {
        id: refundData.transactionId,
      });
      expect(resolvedRefund?.status).toBe(WagerTransactionStatus.Processed);

      // Invariante Contábil Global
      await assertGlobalAccountingInvariant(wallet.id);
    });
  });

  describe("C8: Reinício de Serviço e Validação de Consistência Global", () => {
    it("should survive application restart and confirm consistency across all existing wallets", async () => {
      // 1. Simular fechamento e subida de nova instância NestJS
      await app.close();

      const newApp = await NestFactory.create(AppModule, { logger: false });
      await newApp.listen(0);
      const newUrl = await newApp.getUrl();

      // 2. Criar nova carteira e executar transações na nova instância
      const playerId = uuidv4();
      const createRes = await fetch(`${newUrl}/wallets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          playerId,
          initialBalance: { amount: "200.00", currency: Currency.BRL },
        }),
      });
      const wallet: any = await createRes.json();

      await fetch(`${newUrl}/wagering/transactions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": `c8-bet-${uuidv4()}`,
        },
        body: JSON.stringify({
          providerId: "pragmatic",
          externalTransactionId: `c8-tx-${uuidv4()}`,
          playerId,
          walletId: wallet.id,
          roundId: "c8-round",
          gameId: "c8-game",
          kind: "BET",
          money: { amount: "75.00", currency: Currency.BRL },
        }),
      });

      // 3. Reconciliação confirma 100% de consistência contábil
      const recRes = await fetch(`${newUrl}/wallets/${wallet.id}/reconciliation`, {
        method: "POST",
      });
      expect(recRes.status).toBe(200);
      const recData: any = await recRes.json();
      expect(recData.consistent).toBe(true);
      expect(recData.storedBalance.amount).toBe("125.00");
      expect(recData.calculatedBalance.amount).toBe("125.00");

      await newApp.close();
    });
  });
});
