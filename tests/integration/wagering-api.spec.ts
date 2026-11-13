import { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { v4 as uuidv4 } from "uuid";
import { AppModule } from "../../src/app.module";
import { Currency, FailureCode, WagerTransactionStatus } from "../../src/domain";

describe("Wagering Transactions API (Integration)", () => {
  let app: INestApplication;
  let baseUrl: string;

  beforeAll(async () => {
    app = await NestFactory.create(AppModule, { logger: false });
    await app.listen(0);
    baseUrl = await app.getUrl();
  });

  afterAll(async () => {
    await app.close();
  });

  async function createWallet(initialAmount = "100.00") {
    const playerId = uuidv4();
    const res = await fetch(`${baseUrl}/wallets`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        playerId,
        initialBalance: { amount: initialAmount, currency: Currency.BRL },
      }),
    });
    return { ...(await res.json()), playerId };
  }

  describe("POST /wagering/transactions", () => {
    it("should return 400 Bad Request when Idempotency-Key header is missing", async () => {
      const wallet = await createWallet();
      const res = await fetch(`${baseUrl}/wagering/transactions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // No Idempotency-Key header
        body: JSON.stringify({
          providerId: "pragmatic",
          externalTransactionId: `tx-${uuidv4()}`,
          playerId: wallet.playerId,
          walletId: wallet.id,
          roundId: "r-1",
          gameId: "g-1",
          kind: "BET",
          money: { amount: "10.00", currency: Currency.BRL },
        }),
      });

      expect(res.status).toBe(400);
      const data: any = await res.json();
      expect(data.message).toContain("Idempotency-Key");
    });

    it("should return 400 Bad Request when attempting to submit OPENING externally", async () => {
      const wallet = await createWallet();
      const res = await fetch(`${baseUrl}/wagering/transactions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": `key-opening-${uuidv4()}`,
        },
        body: JSON.stringify({
          providerId: "pragmatic",
          externalTransactionId: `tx-${uuidv4()}`,
          playerId: wallet.playerId,
          walletId: wallet.id,
          roundId: "r-1",
          gameId: "g-1",
          kind: "OPENING",
          money: { amount: "100.00", currency: Currency.BRL },
        }),
      });

      expect(res.status).toBe(400);
      const data: any = await res.json();
      expect(data.message).toContain("OPENING");
    });

    it("should return 400 Bad Request on currency mismatch", async () => {
      const wallet = await createWallet();
      const res = await fetch(`${baseUrl}/wagering/transactions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": `key-curr-${uuidv4()}`,
        },
        body: JSON.stringify({
          providerId: "pragmatic",
          externalTransactionId: `tx-${uuidv4()}`,
          playerId: wallet.playerId,
          walletId: wallet.id,
          roundId: "r-1",
          gameId: "g-1",
          kind: "BET",
          money: { amount: "10.00", currency: Currency.USD },
        }),
      });

      expect(res.status).toBe(400);
      const data: any = await res.json();
      expect(data.message).toContain("Currency mismatch");
    });

    it("should process BET successfully returning 201 Created on first attempt", async () => {
      const wallet = await createWallet("100.00");
      const key = `key-bet-${uuidv4()}`;
      const extId = `ext-${uuidv4()}`;

      const res = await fetch(`${baseUrl}/wagering/transactions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": key,
        },
        body: JSON.stringify({
          providerId: "pragmatic",
          externalTransactionId: extId,
          playerId: wallet.playerId,
          walletId: wallet.id,
          roundId: "r-1",
          gameId: "g-1",
          kind: "BET",
          money: { amount: "30.00", currency: Currency.BRL },
        }),
      });

      expect(res.status).toBe(201);
      const data: any = await res.json();
      expect(data.status).toBe(WagerTransactionStatus.Processed);
      expect(data.balance.amount).toBe("70.00");
      expect(data.idempotentReplay).toBe(false);
    });

    it("should return 200 OK with idempotentReplay: true on exact replay", async () => {
      const wallet = await createWallet("100.00");
      const key = `key-replay-${uuidv4()}`;
      const payload = {
        providerId: "evolution",
        externalTransactionId: `ext-${uuidv4()}`,
        playerId: wallet.playerId,
        walletId: wallet.id,
        roundId: "r-replay",
        gameId: "g-replay",
        kind: "BET",
        money: { amount: "20.00", currency: Currency.BRL },
      };

      // Attempt 1: 201 Created
      const res1 = await fetch(`${baseUrl}/wagering/transactions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": key },
        body: JSON.stringify(payload),
      });
      expect(res1.status).toBe(201);

      // Attempt 2: 200 OK (Replay)
      const res2 = await fetch(`${baseUrl}/wagering/transactions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": key },
        body: JSON.stringify(payload),
      });
      expect(res2.status).toBe(200);
      const data2: any = await res2.json();
      expect(data2.status).toBe(WagerTransactionStatus.Processed);
      expect(data2.balance.amount).toBe("80.00");
      expect(data2.idempotentReplay).toBe(true);
    });

    it("should return 409 Conflict when same Idempotency-Key has differing payload", async () => {
      const wallet = await createWallet("100.00");
      const key = `key-conflict-${uuidv4()}`;

      // First call
      await fetch(`${baseUrl}/wagering/transactions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": key },
        body: JSON.stringify({
          providerId: "pragmatic",
          externalTransactionId: `tx-${uuidv4()}`,
          playerId: wallet.playerId,
          walletId: wallet.id,
          roundId: "r-1",
          gameId: "g-1",
          kind: "BET",
          money: { amount: "20.00", currency: Currency.BRL },
        }),
      });

      // Second call with same key but different amount (conflict!)
      const conflictRes = await fetch(`${baseUrl}/wagering/transactions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": key },
        body: JSON.stringify({
          providerId: "pragmatic",
          externalTransactionId: `tx-${uuidv4()}`,
          playerId: wallet.playerId,
          walletId: wallet.id,
          roundId: "r-1",
          gameId: "g-1",
          kind: "BET",
          money: { amount: "50.00", currency: Currency.BRL }, // Divergent!
        }),
      });

      expect(conflictRes.status).toBe(409);
    });

    it("should return 422 Unprocessable Entity when funds are insufficient", async () => {
      const wallet = await createWallet("50.00");
      const res = await fetch(`${baseUrl}/wagering/transactions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": `insufficient-${uuidv4()}`,
        },
        body: JSON.stringify({
          providerId: "pragmatic",
          externalTransactionId: `tx-${uuidv4()}`,
          playerId: wallet.playerId,
          walletId: wallet.id,
          roundId: "r-1",
          gameId: "g-1",
          kind: "BET",
          money: { amount: "150.00", currency: Currency.BRL },
        }),
      });

      expect(res.status).toBe(422);
      const data: any = await res.json();
      expect(data.status).toBe(WagerTransactionStatus.Rejected);
      expect(data.failureCode).toBe(FailureCode.INSUFFICIENT_FUNDS);
      expect(data.balance.amount).toBe("50.00"); // Unaltered
    });

    it("should return 422 Unprocessable Entity on ROLLBACK causing negative balance", async () => {
      const wallet = await createWallet("10.00");
      const winTxExtId = `win-${uuidv4()}`;

      // 1. Process a WIN of 50.00 (Balance becomes 60.00)
      const winRes = await fetch(`${baseUrl}/wagering/transactions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": `idemp-win-${uuidv4()}`,
        },
        body: JSON.stringify({
          providerId: "pragmatic",
          externalTransactionId: winTxExtId,
          playerId: wallet.playerId,
          walletId: wallet.id,
          roundId: "r-1",
          gameId: "g-1",
          kind: "WIN",
          money: { amount: "50.00", currency: Currency.BRL },
        }),
      });
      expect(winRes.status).toBe(201);

      // 2. Player bets 55.00 (Balance becomes 5.00)
      const betRes = await fetch(`${baseUrl}/wagering/transactions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": `idemp-bet-${uuidv4()}`,
        },
        body: JSON.stringify({
          providerId: "pragmatic",
          externalTransactionId: `bet-${uuidv4()}`,
          playerId: wallet.playerId,
          walletId: wallet.id,
          roundId: "r-2",
          gameId: "g-1",
          kind: "BET",
          money: { amount: "55.00", currency: Currency.BRL },
        }),
      });
      expect(betRes.status).toBe(201);

      // 3. Provider sends ROLLBACK for the WIN of 50.00!
      // But balance is only 5.00! Debiting 50.00 would cause negative balance (-45.00).
      const rollbackRes = await fetch(`${baseUrl}/wagering/transactions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": `idemp-rollback-${uuidv4()}`,
        },
        body: JSON.stringify({
          providerId: "pragmatic",
          externalTransactionId: `rollback-${uuidv4()}`,
          playerId: wallet.playerId,
          walletId: wallet.id,
          roundId: "r-1",
          gameId: "g-1",
          kind: "ROLLBACK",
          money: { amount: "50.00", currency: Currency.BRL },
          referenceExternalTransactionId: winTxExtId,
        }),
      });

      expect(rollbackRes.status).toBe(422);
      const rollbackData: any = await rollbackRes.json();
      expect(rollbackData.status).toBe(WagerTransactionStatus.Rejected);
      expect(rollbackData.failureCode).toBe(
        FailureCode.ROLLBACK_WOULD_CAUSE_NEGATIVE_BALANCE,
      );
      expect(rollbackData.balance.amount).toBe("5.00"); // Remains untouched
    });

    it("should return 202 Accepted when transaction enters PENDING_REFERENCE", async () => {
      const wallet = await createWallet("100.00");
      const res = await fetch(`${baseUrl}/wagering/transactions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": `pending-ref-${uuidv4()}`,
        },
        body: JSON.stringify({
          providerId: "pragmatic",
          externalTransactionId: `refund-${uuidv4()}`,
          playerId: wallet.playerId,
          walletId: wallet.id,
          roundId: "r-1",
          gameId: "g-1",
          kind: "REFUND",
          money: { amount: "20.00", currency: Currency.BRL },
          referenceExternalTransactionId: `non-existent-${uuidv4()}`,
        }),
      });

      expect(res.status).toBe(202);
      const data: any = await res.json();
      expect(data.status).toBe(WagerTransactionStatus.PendingReference);
      expect(data.balance.amount).toBe("100.00");
    });
  });

  describe("GET /wagering/transactions/:transactionId", () => {
    it("should return transaction details with 200 OK", async () => {
      const wallet = await createWallet("100.00");
      const key = `query-tx-${uuidv4()}`;
      const extId = `ext-${uuidv4()}`;

      const createRes = await fetch(`${baseUrl}/wagering/transactions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": key },
        body: JSON.stringify({
          providerId: "pragmatic",
          externalTransactionId: extId,
          playerId: wallet.playerId,
          walletId: wallet.id,
          roundId: "r-1",
          gameId: "g-1",
          kind: "BET",
          money: { amount: "15.00", currency: Currency.BRL },
        }),
      });
      const createdTx: any = await createRes.json();

      const getRes = await fetch(
        `${baseUrl}/wagering/transactions/${createdTx.transactionId}`,
      );
      expect(getRes.status).toBe(200);
      const txData: any = await getRes.json();
      expect(txData.id).toBe(createdTx.transactionId);
      expect(txData.providerId).toBe("pragmatic");
      expect(txData.externalTransactionId).toBe(extId);
      expect(txData.status).toBe(WagerTransactionStatus.Processed);
      expect(txData.money.amount).toBe("15.00");
    });

    it("should return 404 Not Found for non-existent transaction", async () => {
      const res = await fetch(`${baseUrl}/wagering/transactions/${uuidv4()}`);
      expect(res.status).toBe(404);
    });

    it("should return transaction by providerId and externalTransactionId", async () => {
      const wallet = await createWallet("50.00");
      const key = `key-by-ext-${uuidv4()}`;
      const extId = `ext-by-ext-${uuidv4()}`;

      await fetch(`${baseUrl}/wagering/transactions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": key },
        body: JSON.stringify({
          providerId: "spribe",
          externalTransactionId: extId,
          playerId: wallet.playerId,
          walletId: wallet.id,
          roundId: "r-aviator",
          gameId: "aviator",
          kind: "BET",
          money: { amount: "10.00", currency: Currency.BRL },
        }),
      });

      const getRes = await fetch(
        `${baseUrl}/providers/spribe/wagering/transactions/${extId}`
      );
      expect(getRes.status).toBe(200);
      const txData: any = await getRes.json();
      expect(txData.providerId).toBe("spribe");
      expect(txData.externalTransactionId).toBe(extId);
      expect(txData.status).toBe(WagerTransactionStatus.Processed);
    });

    it("should return 404 Not Found for non-existent provider external transaction", async () => {
      const res = await fetch(
        `${baseUrl}/providers/non-existent/wagering/transactions/ext-unknown`
      );
      expect(res.status).toBe(404);
    });
  });
});

