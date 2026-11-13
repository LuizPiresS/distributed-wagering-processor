import { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { v4 as uuidv4 } from "uuid";
import { AppModule } from "../../src/app.module";
import { Currency } from "../../src/domain";

describe("Wallets API (Integration)", () => {
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

  describe("POST /wallets", () => {
    it("should create a new wallet with initial balance, returning 201 Created", async () => {
      const playerId = uuidv4();
      const response = await fetch(`${baseUrl}/wallets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          playerId,
          initialBalance: { amount: "1000.00", currency: Currency.BRL },
        }),
      });

      expect(response.status).toBe(201);
      const data: any = await response.json();
      expect(data.id).toBeDefined();
      expect(data.playerId).toBe(playerId);
      expect(data.balance.amount).toBe("1000.00");
      expect(data.version).toBe(1);

      // Verify correlation ID header is returned
      expect(response.headers.get("x-correlation-id")).toBeDefined();
    });

    it("should return 409 Conflict when creating duplicate wallet for same player and currency", async () => {
      const playerId = uuidv4();
      // First wallet
      const firstRes = await fetch(`${baseUrl}/wallets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          playerId,
          initialBalance: { amount: "50.00", currency: Currency.BRL },
        }),
      });
      expect(firstRes.status).toBe(201);

      // Duplicate attempt
      const secondRes = await fetch(`${baseUrl}/wallets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          playerId,
          initialBalance: { amount: "100.00", currency: Currency.BRL },
        }),
      });
      expect(secondRes.status).toBe(409);
    });

    it("should return 400 Bad Request on invalid amount (e.g. non-positive or wrong scale)", async () => {
      const response = await fetch(`${baseUrl}/wallets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          playerId: uuidv4(),
          initialBalance: { amount: "100.001", currency: Currency.BRL },
        }),
      });
      expect(response.status).toBe(400);
    });
  });

  describe("GET /wallets/:walletId", () => {
    it("should return wallet details with 200 OK", async () => {
      const playerId = uuidv4();
      const createRes = await fetch(`${baseUrl}/wallets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          playerId,
          initialBalance: { amount: "500.00", currency: Currency.USD },
        }),
      });
      const created: any = await createRes.json();

      const getRes = await fetch(`${baseUrl}/wallets/${created.id}`);
      expect(getRes.status).toBe(200);
      const data: any = await getRes.json();
      expect(data.id).toBe(created.id);
      expect(data.playerId).toBe(playerId);
      expect(data.currency).toBe(Currency.USD);
      expect(data.balance.amount).toBe("500.00");
      expect(data.version).toBe(1);
    });

    it("should return 404 Not Found for non-existent wallet", async () => {
      const response = await fetch(`${baseUrl}/wallets/${uuidv4()}`);
      expect(response.status).toBe(404);
    });
  });

  describe("GET /wallets/:walletId/ledger (Opaque Cursor Pagination)", () => {
    it("should paginate ledger entries with opaque cursor without duplicates or missing items", async () => {
      const playerId = uuidv4();
      const createRes = await fetch(`${baseUrl}/wallets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          playerId,
          initialBalance: { amount: "100.00", currency: Currency.BRL },
        }),
      });
      const wallet: any = await createRes.json();

      // Make 3 bets to populate ledger entries
      for (let i = 1; i <= 3; i++) {
        await fetch(`${baseUrl}/wagering/transactions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": `pagination-bet-${i}-${uuidv4()}`,
          },
          body: JSON.stringify({
            providerId: "pragmatic",
            externalTransactionId: `tx-page-${i}-${uuidv4()}`,
            playerId,
            walletId: wallet.id,
            roundId: `round-${i}`,
            gameId: `game-${i}`,
            kind: "BET",
            money: { amount: "10.00", currency: Currency.BRL },
          }),
        });
      }

      // Total entries = 1 opening + 3 bets = 4 ledger entries

      // Page 1: limit 2
      const page1Res = await fetch(`${baseUrl}/wallets/${wallet.id}/ledger?limit=2`);
      expect(page1Res.status).toBe(200);
      const page1: any = await page1Res.json();
      expect(page1.items).toHaveLength(2);
      expect(page1.hasMore).toBe(true);
      expect(page1.nextCursor).toBeDefined();

      // Page 2: with cursor from page 1, limit 2
      const page2Res = await fetch(
        `${baseUrl}/wallets/${wallet.id}/ledger?limit=2&cursor=${page1.nextCursor}`,
      );
      expect(page2Res.status).toBe(200);
      const page2: any = await page2Res.json();
      expect(page2.items).toHaveLength(2);
      expect(page2.hasMore).toBe(false);

      // Verify no overlap between page 1 and page 2
      const page1Ids = page1.items.map((it: any) => it.id);
      const page2Ids = page2.items.map((it: any) => it.id);
      for (const id of page2Ids) {
        expect(page1Ids).not.toContain(id);
      }

      // Total items across both pages is 4
      expect([...page1Ids, ...page2Ids]).toHaveLength(4);
    });
  });
});

