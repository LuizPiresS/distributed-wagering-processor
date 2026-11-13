import * as crypto from "crypto";

/**
 * Recursively serializes any value into a deterministic, canonically ordered JSON string.
 */
export function canonicalStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map(canonicalStringify).join(",")}]`;
  }

  const record = value as Record<string, unknown>;
  const sortedKeys = Object.keys(record).sort();
  const entries = sortedKeys.map(
    (key) => `${JSON.stringify(key)}:${canonicalStringify(record[key])}`,
  );
  return `{${entries.join(",")}}`;
}

export interface BusinessPayloadProps {
  readonly providerId: string;
  readonly externalTransactionId: string;
  readonly playerId: string;
  readonly walletId: string;
  readonly roundId: string;
  readonly gameId: string;
  readonly kind: string;
  readonly money: {
    readonly amount: string;
    readonly currency: string;
  };
  readonly referenceExternalTransactionId?: string | null;
}

/**
 * Computes a deterministic SHA-256 hash from business payload attributes,
 * ignoring transport headers and non-business metadata.
 */
export function computeCanonicalPayloadHash(payload: BusinessPayloadProps): string {
  const normalized = {
    amount: payload.money.amount,
    currency: payload.money.currency.toUpperCase().trim(),
    externalTransactionId: payload.externalTransactionId,
    gameId: payload.gameId,
    kind: payload.kind.toUpperCase().trim(),
    playerId: payload.playerId,
    providerId: payload.providerId,
    referenceExternalTransactionId: payload.referenceExternalTransactionId || null,
    roundId: payload.roundId,
    walletId: payload.walletId,
  };

  const canonicalJson = canonicalStringify(normalized);
  return crypto.createHash("sha256").update(canonicalJson).digest("hex");
}

