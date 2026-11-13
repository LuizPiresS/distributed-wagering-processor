import { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { v4 as uuidv4 } from "uuid";
import { AppModule } from "../../src/app.module";
import { Currency } from "../../src/domain";
import { WalletOrmEntity } from "../../src/infrastructure/database/entities";
import { MikroORM } from "@mikro-orm/postgresql";

describe("Reconciliation API (Integration)", () => {
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

  it("should return consistent: true when stored balance matches the ledger sum", async () => {
    const playerId = uuidv4();
    // 1. Create wallet with 100.00 BRL (1 opening ledger)
    const createRes = await fetch(`${baseUrl}/wallets`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        playerId,
        initialBalance: { amount: "100.00", currency: Currency.BRL },
      }),
    });
    const wallet: any = await createRes.json();

    // 2. Make a 25.00 BET (1 debit ledger) -> 75.00
    await fetch(`${baseUrl}/wagering/transactions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": `rec-bet-${uuidv4()}`,
      },
      body: JSON.stringify({
        providerId: "pragmatic",
        externalTransactionId: `tx-rec-${uuidv4()}`,
        playerId,
        walletId: wallet.id,
        roundId: "r-rec-1",
        gameId: "g-rec-1",
        kind: "BET",
        money: { amount: "25.00", currency: Currency.BRL },
      }),
    });

    // 3. Make a 10.00 WIN (1 credit ledger) -> 85.00
    await fetch(`${baseUrl}/wagering/transactions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": `rec-win-${uuidv4()}`,
      },
      body: JSON.stringify({
        providerId: "pragmatic",
        externalTransactionId: `tx-rec-${uuidv4()}`,
        playerId,
        walletId: wallet.id,
        roundId: "r-rec-2",
        gameId: "g-rec-1",
        kind: "WIN",
        money: { amount: "10.00", currency: Currency.BRL },
      }),
    });

    // 4. Run reconciliation endpoint
    const recRes = await fetch(
      `${baseUrl}/wallets/${wallet.id}/reconciliation`,
      { method: "POST" },
    );

    expect(recRes.status).toBe(200);
    const result: any = await recRes.json();
    expect(result.walletId).toBe(wallet.id);
    expect(result.currency).toBe(Currency.BRL);
    expect(result.storedBalance.amount).toBe("85.00");
    expect(result.calculatedBalance.amount).toBe("85.00");
    expect(result.difference.amount).toBe("0.00");
    expect(result.consistent).toBe(true);
    expect(result.checkedEntries).toBe(3);
  });

  it("should detect balance anomaly (consistent: false) and NOT alter the stored balance silently", async () => {
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

    // Tamper the stored balance directly in database without ledger entries
    await orm.em
      .getConnection()
      .execute("UPDATE wallets SET balance = 500.00 WHERE id = ?", [wallet.id]);

    // Run reconciliation
    const recRes = await fetch(
      `${baseUrl}/wallets/${wallet.id}/reconciliation`,
      { method: "POST" },
    );

    expect(recRes.status).toBe(200);
    const result: any = await recRes.json();
    expect(result.consistent).toBe(false);
    expect(result.storedBalance.amount).toBe("500.00");
    expect(result.calculatedBalance.amount).toBe("100.00");
    expect(result.difference.amount).toBe("400.00");

    // Invariant: Balance must NOT be silently auto-corrected!
    const fork = orm.em.fork();
    const walletInDb = await fork.findOne(WalletOrmEntity, { id: wallet.id });
    expect(walletInDb?.balance.toString()).toBe("500.00");
  });

  it("should return 404 Not Found when reconciling non-existent wallet", async () => {
    const res = await fetch(`${baseUrl}/wallets/${uuidv4()}/reconciliation`, {
      method: "POST",
    });
    expect(res.status).toBe(404);
  });
});

