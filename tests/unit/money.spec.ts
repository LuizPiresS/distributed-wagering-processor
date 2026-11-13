import { describe, expect, it } from "bun:test";
import {
  CurrencyMismatchError,
  InvalidMoneyValueError,
  Money,
} from "../../src/domain";

describe("Money Value Object", () => {
  describe("Creation and Validation", () => {
    it("should create a valid Money instance with exactly 2 decimal places", () => {
      const money = Money.from({ amount: "25.00", currency: "BRL" });
      expect(money.toString()).toBe("25.00");
      expect(money.currency).toBe("BRL");
      expect(money.toJSON()).toEqual({ amount: "25.00", currency: "BRL" });
    });

    it("should create zero money for a given currency", () => {
      const zero = Money.zero("BRL");
      expect(zero.toString()).toBe("0.00");
      expect(zero.isZero()).toBe(true);
      expect(zero.isPositive()).toBe(false);
      expect(zero.isNegative()).toBe(false);
    });

    it("should accept negative decimal strings in general factory", () => {
      const negative = Money.from({ amount: "-50.00", currency: "BRL" });
      expect(negative.toString()).toBe("-50.00");
      expect(negative.isNegative()).toBe(true);
    });

    it("should reject negative amounts in fromInput (external contract enforcement)", () => {
      expect(() =>
        Money.fromInput({ amount: "-25.00", currency: "BRL" }),
      ).toThrow(InvalidMoneyValueError);
    });

    it("should reject invalid amount string formats (less or more than 2 decimal places)", () => {
      expect(() => Money.from({ amount: "25", currency: "BRL" })).toThrow(
        InvalidMoneyValueError,
      );
      expect(() => Money.from({ amount: "25.5", currency: "BRL" })).toThrow(
        InvalidMoneyValueError,
      );
      expect(() => Money.from({ amount: "25.555", currency: "BRL" })).toThrow(
        InvalidMoneyValueError,
      );
      expect(() => Money.from({ amount: "", currency: "BRL" })).toThrow(
        InvalidMoneyValueError,
      );
      expect(() => Money.from({ amount: "   ", currency: "BRL" })).toThrow(
        InvalidMoneyValueError,
      );
    });

    it("should reject non-numeric inputs like NaN, Infinity, scientific notation and letters", () => {
      expect(() => Money.from({ amount: "NaN", currency: "BRL" })).toThrow(
        InvalidMoneyValueError,
      );
      expect(() => Money.from({ amount: "Infinity", currency: "BRL" })).toThrow(
        InvalidMoneyValueError,
      );
      expect(() => Money.from({ amount: "1e5", currency: "BRL" })).toThrow(
        InvalidMoneyValueError,
      );
      expect(() => Money.from({ amount: "abc", currency: "BRL" })).toThrow(
        InvalidMoneyValueError,
      );
    });

    it("should reject invalid currency codes", () => {
      expect(() => Money.from({ amount: "25.00", currency: "BR" })).toThrow(
        InvalidMoneyValueError,
      );
      expect(() => Money.from({ amount: "25.00", currency: "BRL1" })).toThrow(
        InvalidMoneyValueError,
      );
      expect(() => Money.from({ amount: "25.00", currency: "" })).toThrow(
        InvalidMoneyValueError,
      );
    });
  });

  describe("Arithmetic & Immutability", () => {
    it("should perform exact addition without floating-point errors (0.10 + 0.20 === 0.30)", () => {
      const a = Money.from({ amount: "0.10", currency: "BRL" });
      const b = Money.from({ amount: "0.20", currency: "BRL" });
      const result = a.add(b);

      expect(result.toString()).toBe("0.30");
      // Immutability check: original instances are not modified
      expect(a.toString()).toBe("0.10");
      expect(b.toString()).toBe("0.20");
    });

    it("should perform exact subtraction", () => {
      const a = Money.from({ amount: "100.00", currency: "BRL" });
      const b = Money.from({ amount: "80.00", currency: "BRL" });
      const result = a.subtract(b);

      expect(result.toString()).toBe("20.00");
    });

    it("should negate money amount", () => {
      const a = Money.from({ amount: "25.00", currency: "BRL" });
      const negated = a.negate();
      expect(negated.toString()).toBe("-25.00");
      expect(negated.isNegative()).toBe(true);
    });

    it("should throw CurrencyMismatchError on arithmetic operations between different currencies", () => {
      const brl = Money.from({ amount: "25.00", currency: "BRL" });
      const usd = Money.from({ amount: "25.00", currency: "USD" });

      expect(() => brl.add(usd)).toThrow(CurrencyMismatchError);
      expect(() => brl.subtract(usd)).toThrow(CurrencyMismatchError);
      expect(() => brl.isLessThan(usd)).toThrow(CurrencyMismatchError);
    });
  });

  describe("Comparisons", () => {
    it("should correctly compare amounts", () => {
      const ten = Money.from({ amount: "10.00", currency: "BRL" });
      const twenty = Money.from({ amount: "20.00", currency: "BRL" });
      const tenCopy = Money.from({ amount: "10.00", currency: "BRL" });

      expect(ten.equals(tenCopy)).toBe(true);
      expect(ten.equals(twenty)).toBe(false);
      expect(ten.isLessThan(twenty)).toBe(true);
      expect(twenty.isGreaterThan(ten)).toBe(true);
      expect(ten.isLessThanOrEqualTo(tenCopy)).toBe(true);
      expect(ten.isGreaterThanOrEqualTo(tenCopy)).toBe(true);
    });

    it("should return false for equals if currency differs", () => {
      const brl = Money.from({ amount: "10.00", currency: "BRL" });
      const usd = Money.from({ amount: "10.00", currency: "USD" });
      expect(brl.equals(usd)).toBe(false);
    });

    it("should correctly determine positivity and zero", () => {
      const positive = Money.from({ amount: "0.01", currency: "BRL" });
      const zero = Money.from({ amount: "0.00", currency: "BRL" });
      const negative = Money.from({ amount: "-0.01", currency: "BRL" });

      expect(positive.isPositive()).toBe(true);
      expect(positive.isZero()).toBe(false);

      expect(zero.isZero()).toBe(true);
      expect(zero.isPositive()).toBe(false);
      expect(zero.isNegative()).toBe(false);

      expect(negative.isNegative()).toBe(true);
      expect(negative.isPositive()).toBe(false);
    });
  });
});

