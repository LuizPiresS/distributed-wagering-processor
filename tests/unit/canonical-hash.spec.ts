import { describe, expect, it } from "bun:test";
import {
  canonicalStringify,
  computeCanonicalPayloadHash,
} from "../../src/infrastructure/security/canonical-hash";

describe("Canonical JSON & SHA-256 Hashing", () => {
  it("should stringify JSON with keys sorted alphabetically regardless of original order", () => {
    const objA = { z: 1, a: 2, m: { y: "test", b: true } };
    const objB = { a: 2, m: { b: true, y: "test" }, z: 1 };

    expect(canonicalStringify(objA)).toBe(canonicalStringify(objB));
    expect(canonicalStringify(objA)).toBe('{"a":2,"m":{"b":true,"y":"test"},"z":1}');
  });

  it("should generate identical hash for equivalent business payloads with different key ordering", () => {
    const payload1 = {
      providerId: "provider-a",
      externalTransactionId: "tx-123",
      playerId: "player-456",
      walletId: "wallet-789",
      roundId: "round-1",
      gameId: "fortune-chimp",
      kind: "BET",
      money: { amount: "25.00", currency: "BRL" },
      referenceExternalTransactionId: null,
    };

    const payload2 = {
      roundId: "round-1",
      gameId: "fortune-chimp",
      kind: "BET",
      money: { currency: "BRL", amount: "25.00" },
      walletId: "wallet-789",
      playerId: "player-456",
      providerId: "provider-a",
      externalTransactionId: "tx-123",
      referenceExternalTransactionId: undefined,
    };

    const hash1 = computeCanonicalPayloadHash(payload1);
    const hash2 = computeCanonicalPayloadHash(payload2);

    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(64); // SHA-256 hex length
  });

  it("should generate a different hash when any business property changes", () => {
    const base = {
      providerId: "provider-a",
      externalTransactionId: "tx-123",
      playerId: "player-456",
      walletId: "wallet-789",
      roundId: "round-1",
      gameId: "fortune-chimp",
      kind: "BET",
      money: { amount: "25.00", currency: "BRL" },
    };

    const hashBase = computeCanonicalPayloadHash(base);
    const hashDifferentAmount = computeCanonicalPayloadHash({
      ...base,
      money: { amount: "25.01", currency: "BRL" },
    });
    const hashDifferentKind = computeCanonicalPayloadHash({
      ...base,
      kind: "WIN",
    });

    expect(hashBase).not.toBe(hashDifferentAmount);
    expect(hashBase).not.toBe(hashDifferentKind);
  });
});

