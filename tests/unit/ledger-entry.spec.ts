import { describe, expect, it } from "bun:test";
import {
  CurrencyMismatchError,
  InvalidMoneyValueError,
  LedgerDirection,
  Money,
  UnbalancedLedgerEntryError,
  WalletLedgerEntry,
} from "../../src/domain";

describe("WalletLedgerEntry Entity (Immutable)", () => {
  const walletId = "0192f291-27dd-7d3f-8071-5f8685deef37";
  const transactionId = "0192f298-345e-7e38-af88-e43f851a819d";

  it("should create a balanced CREDIT ledger entry successfully", () => {
    const entry = WalletLedgerEntry.create({
      id: "ledger-entry-1",
      walletId,
      transactionId,
      direction: LedgerDirection.Credit,
      money: Money.from({ amount: "50.00", currency: "BRL" }),
      balanceBefore: Money.from({ amount: "100.00", currency: "BRL" }),
      balanceAfter: Money.from({ amount: "150.00", currency: "BRL" }),
    });

    expect(entry.isBalanced()).toBe(true);
    expect(entry.direction).toBe(LedgerDirection.Credit);
    expect(entry.money.toString()).toBe("50.00");
    expect(entry.balanceBefore.toString()).toBe("100.00");
    expect(entry.balanceAfter.toString()).toBe("150.00");
  });

  it("should create a balanced DEBIT ledger entry successfully", () => {
    const entry = WalletLedgerEntry.create({
      id: "ledger-entry-2",
      walletId,
      transactionId,
      direction: LedgerDirection.Debit,
      money: Money.from({ amount: "80.00", currency: "BRL" }),
      balanceBefore: Money.from({ amount: "100.00", currency: "BRL" }),
      balanceAfter: Money.from({ amount: "20.00", currency: "BRL" }),
    });

    expect(entry.isBalanced()).toBe(true);
    expect(entry.direction).toBe(LedgerDirection.Debit);
    expect(entry.balanceAfter.toString()).toBe("20.00");
  });

  it("should throw UnbalancedLedgerEntryError if balanceBefore ± money !== balanceAfter", () => {
    expect(() =>
      WalletLedgerEntry.create({
        id: "ledger-entry-3",
        walletId,
        transactionId,
        direction: LedgerDirection.Debit,
        money: Money.from({ amount: "80.00", currency: "BRL" }),
        balanceBefore: Money.from({ amount: "100.00", currency: "BRL" }),
        balanceAfter: Money.from({ amount: "30.00", currency: "BRL" }), // Should be 20.00!
      }),
    ).toThrow(UnbalancedLedgerEntryError);

    expect(() =>
      WalletLedgerEntry.create({
        id: "ledger-entry-4",
        walletId,
        transactionId,
        direction: LedgerDirection.Credit,
        money: Money.from({ amount: "50.00", currency: "BRL" }),
        balanceBefore: Money.from({ amount: "100.00", currency: "BRL" }),
        balanceAfter: Money.from({ amount: "140.00", currency: "BRL" }), // Should be 150.00!
      }),
    ).toThrow(UnbalancedLedgerEntryError);
  });

  it("should reject non-positive amounts for ledger entries", () => {
    expect(() =>
      WalletLedgerEntry.create({
        id: "ledger-entry-5",
        walletId,
        transactionId,
        direction: LedgerDirection.Credit,
        money: Money.zero("BRL"),
        balanceBefore: Money.from({ amount: "100.00", currency: "BRL" }),
        balanceAfter: Money.from({ amount: "100.00", currency: "BRL" }),
      }),
    ).toThrow(InvalidMoneyValueError);
  });

  it("should reject ledger entries with mismatched currencies", () => {
    expect(() =>
      WalletLedgerEntry.create({
        id: "ledger-entry-6",
        walletId,
        transactionId,
        direction: LedgerDirection.Credit,
        money: Money.from({ amount: "50.00", currency: "USD" }),
        balanceBefore: Money.from({ amount: "100.00", currency: "BRL" }),
        balanceAfter: Money.from({ amount: "150.00", currency: "BRL" }),
      }),
    ).toThrow(CurrencyMismatchError);
  });
});

