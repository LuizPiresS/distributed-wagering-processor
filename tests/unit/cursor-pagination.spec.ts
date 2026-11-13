import { describe, expect, it } from "bun:test";
import { InvalidPayloadError } from "../../src/application/errors/application.error";
import {
  decodeCursor,
  encodeCursor,
} from "../../src/application/use-cases/get-wallet-ledger.use-case";

describe("Opaque Cursor Pagination (Unit)", () => {
  it("should encode and decode cursor deterministically", () => {
    const original = {
      createdAt: new Date("2026-11-13T10:00:00.000Z"),
      id: "entry-uuid-12345",
    };

    const encoded = encodeCursor(original);
    expect(typeof encoded).toBe("string");
    expect(encoded.length).toBeGreaterThan(10);

    const decoded = decodeCursor(encoded);
    expect(decoded.createdAt).toBe("2026-11-13T10:00:00.000Z");
    expect(decoded.id).toBe("entry-uuid-12345");
  });

  it("should throw InvalidPayloadError on corrupted or invalid Base64 cursor", () => {
    expect(() => decodeCursor("invalid-non-base64-cursor")).toThrow(
      InvalidPayloadError,
    );
    expect(() =>
      decodeCursor(Buffer.from("not-a-json").toString("base64url")),
    ).toThrow(InvalidPayloadError);
    expect(() =>
      decodeCursor(Buffer.from(JSON.stringify({ missingId: true })).toString("base64url")),
    ).toThrow(InvalidPayloadError);
  });
});

