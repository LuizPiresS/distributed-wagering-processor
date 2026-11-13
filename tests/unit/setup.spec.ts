import { describe, expect, it } from "bun:test";
import Decimal from "decimal.js";

describe("Task 01: Setup and Tooling Sanity Tests", () => {
  it("should run tests within Bun test runner natively", () => {
    expect(typeof Bun).toBe("object");
    expect(typeof Bun.version).toBe("string");
  });

  it("should demonstrate IEEE 754 floating point flaw with native numbers", () => {
    // Proves why native float/number is forbidden in the challenge (Eliminatory Rule 1)
    const floatSum = 0.1 + 0.2;
    expect(floatSum).not.toBe(0.3);
    expect(floatSum.toString()).toBe("0.30000000000000004");
  });

  it("should perform exact monetary arithmetic using Decimal.js without floating-point error", () => {
    // Proves that Decimal solves the exact financial precision requirement
    const decimalA = new Decimal("0.10");
    const decimalB = new Decimal("0.20");
    const sum = decimalA.plus(decimalB);

    expect(sum.toString()).toBe("0.3");
    expect(sum.toFixed(2)).toBe("0.30");
  });

  it("should format financial amounts strictly to 2 decimal places", () => {
    const amount = new Decimal("25");
    expect(amount.toFixed(2)).toBe("25.00");

    const sum = new Decimal("25.00").plus(new Decimal("10.50"));
    expect(sum.toFixed(2)).toBe("35.50");

    const diff = new Decimal("100.00").minus(new Decimal("80.00"));
    expect(diff.toFixed(2)).toBe("20.00");
  });
});

