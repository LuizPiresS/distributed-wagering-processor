import { describe, expect, it } from "bun:test";
import {
  CurrencyMismatchError,
  InsufficientFundsError,
  InvalidMoneyValueError,
  Money,
  Wallet,
  WalletRuleViolationError,
} from "../../src/domain";

describe("Wallet Aggregate Root", () => {
  const walletId = "0192f291-27dd-7d3f-8071-5f8685deef37";
  const playerId = "0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1";

  describe("Opening & Invariants", () => {
    it("should open a wallet with initial balance, currency and version 1", () => {
      const initialBalance = Money.from({ amount: "100.00", currency: "BRL" });
      const wallet = Wallet.open({
        id: walletId,
        playerId,
        initialBalance,
      });

      expect(wallet.id).toBe(walletId);
      expect(wallet.playerId).toBe(playerId);
      expect(wallet.currency).toBe("BRL");
      expect(wallet.balance.toString()).toBe("100.00");
      expect(wallet.version).toBe(1);
      expect(wallet.createdAt).toBeDefined();
      expect(wallet.updatedAt).toBeDefined();
    });

    it("should reject opening with negative initial balance", () => {
      const negativeBalance = Money.from({ amount: "-10.00", currency: "BRL" });
      expect(() =>
        Wallet.open({
          id: walletId,
          playerId,
          initialBalance: negativeBalance,
        }),
      ).toThrow(InvalidMoneyValueError);
    });

    it("should reject opening without id or playerId", () => {
      const balance = Money.from({ amount: "100.00", currency: "BRL" });
      expect(() =>
        Wallet.open({ id: "", playerId, initialBalance: balance }),
      ).toThrow(WalletRuleViolationError);
      expect(() =>
        Wallet.open({ id: walletId, playerId: "", initialBalance: balance }),
      ).toThrow(WalletRuleViolationError);
    });

    it("should rehydrate a wallet from persistent state correctly", () => {
      const now = new Date();
      const wallet = Wallet.rehydrate({
        id: walletId,
        playerId,
        currency: "BRL",
        balanceAmount: "250.75",
        version: 5,
        createdAt: now,
        updatedAt: now,
      });

      expect(wallet.balance.toString()).toBe("250.75");
      expect(wallet.version).toBe(5);
    });
  });

  describe("Debit operations", () => {
    it("should debit successfully, reducing balance and incrementing version by 1", () => {
      const wallet = Wallet.open({
        id: walletId,
        playerId,
        initialBalance: Money.from({ amount: "100.00", currency: "BRL" }),
      });

      const debitMoney = Money.from({ amount: "25.00", currency: "BRL" });
      const result = wallet.debit(debitMoney);

      expect(result.balanceBefore.toString()).toBe("100.00");
      expect(result.balanceAfter.toString()).toBe("75.00");
      expect(result.versionBefore).toBe(1);
      expect(result.versionAfter).toBe(2);

      expect(wallet.balance.toString()).toBe("75.00");
      expect(wallet.version).toBe(2);
    });

    it("should throw InsufficientFundsError when debit exceeds balance and leave wallet untouched", () => {
      const wallet = Wallet.open({
        id: walletId,
        playerId,
        initialBalance: Money.from({ amount: "100.00", currency: "BRL" }),
      });

      const excessiveDebit = Money.from({ amount: "100.01", currency: "BRL" });

      expect(() => wallet.debit(excessiveDebit)).toThrow(
        InsufficientFundsError,
      );

      // Invariant: Balance and version MUST NOT change on failure
      expect(wallet.balance.toString()).toBe("100.00");
      expect(wallet.version).toBe(1);
    });

    it("should reject debit with currency mismatch", () => {
      const wallet = Wallet.open({
        id: walletId,
        playerId,
        initialBalance: Money.from({ amount: "100.00", currency: "BRL" }),
      });

      const usdDebit = Money.from({ amount: "10.00", currency: "USD" });
      expect(() => wallet.debit(usdDebit)).toThrow(CurrencyMismatchError);
      expect(wallet.version).toBe(1);
    });

    it("should reject non-positive debit amounts", () => {
      const wallet = Wallet.open({
        id: walletId,
        playerId,
        initialBalance: Money.from({ amount: "100.00", currency: "BRL" }),
      });

      expect(() => wallet.debit(Money.zero("BRL"))).toThrow(
        InvalidMoneyValueError,
      );
      expect(() =>
        wallet.debit(Money.from({ amount: "-10.00", currency: "BRL" })),
      ).toThrow(InvalidMoneyValueError);
    });
  });

  describe("Credit operations", () => {
    it("should credit successfully, increasing balance and incrementing version by 1", () => {
      const wallet = Wallet.open({
        id: walletId,
        playerId,
        initialBalance: Money.from({ amount: "100.00", currency: "BRL" }),
      });

      const creditMoney = Money.from({ amount: "50.50", currency: "BRL" });
      const result = wallet.credit(creditMoney);

      expect(result.balanceBefore.toString()).toBe("100.00");
      expect(result.balanceAfter.toString()).toBe("150.50");
      expect(result.versionBefore).toBe(1);
      expect(result.versionAfter).toBe(2);

      expect(wallet.balance.toString()).toBe("150.50");
      expect(wallet.version).toBe(2);
    });

    it("should reject credit with currency mismatch", () => {
      const wallet = Wallet.open({
        id: walletId,
        playerId,
        initialBalance: Money.from({ amount: "100.00", currency: "BRL" }),
      });

      const usdCredit = Money.from({ amount: "50.00", currency: "USD" });
      expect(() => wallet.credit(usdCredit)).toThrow(CurrencyMismatchError);
      expect(wallet.version).toBe(1);
    });

    it("should reject non-positive credit amounts", () => {
      const wallet = Wallet.open({
        id: walletId,
        playerId,
        initialBalance: Money.from({ amount: "100.00", currency: "BRL" }),
      });

      expect(() => wallet.credit(Money.zero("BRL"))).toThrow(
        InvalidMoneyValueError,
      );
    });
  });
});

