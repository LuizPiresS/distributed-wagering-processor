import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { v4 as uuidv4 } from "uuid";
import { AppModule } from "../../src/app.module";
import {
  CounterpartyAccount,
  Currency,
  LedgerDirection,
} from "../../src/domain";

describe("Diferencial Opcional: Ledger de Partidas Dobradas (Double-Entry Bookkeeping)", () => {
  let app: INestApplication;
  let baseUrl: string;

  beforeAll(async () => {
    app = await NestFactory.create(AppModule, { logger: false });
    await app.listen(0);
    baseUrl = await app.getUrl();
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  it("should create opening transaction with SETTLEMENT_ESCROW counterparty", async () => {
    const playerId = uuidv4();
    const createRes = await fetch(`${baseUrl}/wallets`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        playerId,
        initialBalance: { amount: "500.00", currency: Currency.BRL },
      }),
    });
    expect(createRes.status).toBe(201);
    const wallet: any = await createRes.json();

    const ledgerRes = await fetch(`${baseUrl}/wallets/${wallet.id}/ledger`);
    expect(ledgerRes.status).toBe(200);
    const ledger: any = await ledgerRes.json();

    expect(ledger.items.length).toBe(1);
    expect(ledger.items[0]?.direction).toBe(LedgerDirection.Credit);
    expect(ledger.items[0]?.counterpartyAccount).toBe(CounterpartyAccount.SettlementEscrow);
  });

  it("should assign correct counterparties for BET (HOUSE_HOLDING) and WIN (HOUSE_EXPENSE)", async () => {
    const playerId = uuidv4();
    const createRes = await fetch(`${baseUrl}/wallets`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        playerId,
        initialBalance: { amount: "200.00", currency: Currency.BRL },
      }),
    });
    const wallet: any = await createRes.json();

    // 1. BET 50.00 -> Player DEBIT, Counterparty HOUSE_HOLDING
    const betRes = await fetch(`${baseUrl}/wagering/transactions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": uuidv4(),
      },
      body: JSON.stringify({
        providerId: "prov-de",
        externalTransactionId: `bet-${uuidv4()}`,
        playerId,
        walletId: wallet.id,
        roundId: "r1",
        gameId: "g1",
        kind: "BET",
        money: { amount: "50.00", currency: Currency.BRL },
      }),
    });
    expect(betRes.status).toBe(201);

    // 2. WIN 120.00 -> Player CREDIT, Counterparty HOUSE_EXPENSE
    const winRes = await fetch(`${baseUrl}/wagering/transactions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": uuidv4(),
      },
      body: JSON.stringify({
        providerId: "prov-de",
        externalTransactionId: `win-${uuidv4()}`,
        playerId,
        walletId: wallet.id,
        roundId: "r1",
        gameId: "g1",
        kind: "WIN",
        money: { amount: "120.00", currency: Currency.BRL },
      }),
    });
    expect(winRes.status).toBe(201);

    // 3. LOSS 30.00 -> Neutral (no ledger entry created)
    const lossRes = await fetch(`${baseUrl}/wagering/transactions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": uuidv4(),
      },
      body: JSON.stringify({
        providerId: "prov-de",
        externalTransactionId: `loss-${uuidv4()}`,
        playerId,
        walletId: wallet.id,
        roundId: "r2",
        gameId: "g1",
        kind: "LOSS",
        money: { amount: "30.00", currency: Currency.BRL },
      }),
    });
    expect(lossRes.status).toBe(201);

    const ledgerRes = await fetch(`${baseUrl}/wallets/${wallet.id}/ledger`);
    const ledger: any = await ledgerRes.json();

    // Exactly 3 entries: OPENING, BET, WIN (LOSS produces 0 entries)
    expect(ledger.items.length).toBe(3);

    const betEntry = ledger.items.find((i: any) => i.direction === LedgerDirection.Debit);
    expect(betEntry).toBeDefined();
    expect(betEntry?.counterpartyAccount).toBe(CounterpartyAccount.HouseHolding);

    const winEntry = ledger.items.find((i: any) => i.amount.amount === "120.00");
    expect(winEntry).toBeDefined();
    expect(winEntry?.counterpartyAccount).toBe(CounterpartyAccount.HouseExpense);
  });

  it("should maintain global trial balance strictly balanced with 0.00 discrepancy", async () => {
    const res = await fetch(`${baseUrl}/accounting/trial-balance?currency=BRL`);
    expect(res.status).toBe(200);

    const trialBalance: any = await res.json();
    expect(trialBalance.balanced).toBe(true);
    expect(trialBalance.currency).toBe(Currency.BRL);
    expect(trialBalance.discrepancy).toBe("0.00");
    expect(trialBalance.totalDebits).toBe(trialBalance.totalCredits);
    expect(trialBalance.totalTransactionsAudited).toBeGreaterThan(0);
    expect(trialBalance.accounts.playerWallets).toBeDefined();
    expect(trialBalance.accounts.houseHolding).toBeDefined();
    expect(trialBalance.accounts.houseExpense).toBeDefined();
    expect(trialBalance.accounts.settlementEscrow).toBeDefined();
  });
});
