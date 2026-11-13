import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "../../src/app.module";
import { setupSwagger } from "../../src/setup-swagger";

describe("OpenAPI & Swagger UI Integration Tests", () => {
  let app: INestApplication;
  let baseUrl: string;

  beforeAll(async () => {
    app = await NestFactory.create(AppModule, { logger: false });
    setupSwagger(app);
    await app.listen(0);
    baseUrl = await app.getUrl();
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  it("should serve Swagger UI html at /docs", async () => {
    const res = await fetch(`${baseUrl}/docs`, { redirect: "follow" });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("swagger-ui");
  });

  it("should serve valid OpenAPI JSON document at /docs-json", async () => {
    const res = await fetch(`${baseUrl}/docs-json`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");

    const spec: any = await res.json();
    expect(spec.openapi).toMatch(/^3\./);
    expect(spec.info.title).toBe("Distributed Wagering Processor API");
    expect(spec.info.version).toBe("1.0.0");

    // Verify all primary paths are documented
    expect(spec.paths["/wallets"]).toBeDefined();
    expect(spec.paths["/wallets"].post).toBeDefined();

    expect(spec.paths["/wallets/{walletId}"]).toBeDefined();
    expect(spec.paths["/wallets/{walletId}"].get).toBeDefined();

    expect(spec.paths["/wallets/{walletId}/ledger"]).toBeDefined();
    expect(spec.paths["/wallets/{walletId}/ledger"].get).toBeDefined();

    expect(spec.paths["/wallets/{walletId}/reconciliation"]).toBeDefined();
    expect(spec.paths["/wallets/{walletId}/reconciliation"].post).toBeDefined();

    expect(spec.paths["/wagering/transactions"]).toBeDefined();
    expect(spec.paths["/wagering/transactions"].post).toBeDefined();

    expect(spec.paths["/wagering/transactions/{transactionId}"]).toBeDefined();
    expect(spec.paths["/wagering/transactions/{transactionId}"].get).toBeDefined();

    expect(spec.paths["/health/live"]).toBeDefined();
    expect(spec.paths["/health/ready"]).toBeDefined();
    expect(spec.paths["/metrics"]).toBeDefined();

    // Verify mandatory Idempotency-Key header is declared in submitTransaction
    const postTransactionOp = spec.paths["/wagering/transactions"].post;
    const headerParam = postTransactionOp.parameters?.find(
      (p: any) => p.name?.toLowerCase() === "idempotency-key" && p.in === "header",
    );
    expect(headerParam).toBeDefined();
    expect(headerParam.required).toBe(true);
  });
});

