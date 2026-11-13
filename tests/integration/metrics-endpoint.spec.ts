import { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { AppModule } from "../../src/app.module";

describe("Metrics API (Integration - README Seção 12)", () => {
  let app: INestApplication;
  let baseUrl: string;

  beforeAll(async () => {
    app = await NestFactory.create(AppModule, { logger: false });
    await app.listen(0);
    baseUrl = await app.getUrl();
  });

  afterAll(async () => {
    await app.close();
  });

  describe("GET /metrics", () => {
    it("deve retornar 200 OK com métricas no formato padrão texto do Prometheus", async () => {
      const res = await fetch(`${baseUrl}/metrics`);
      expect(res.status).toBe(200);

      const contentType = res.headers.get("content-type");
      expect(contentType).toContain("text/plain");

      const body = await res.text();
      // Verifica presença de todas as 7 métricas obrigatórias
      expect(body).toContain("wagering_transactions_total");
      expect(body).toContain("wagering_duplicates_detected_total");
      expect(body).toContain("wagering_retries_total");
      expect(body).toContain("wagering_dlq_messages_total");
      expect(body).toContain("wagering_lock_conflicts_total");
      expect(body).toContain("wagering_outbox_lag_seconds");
      expect(body).toContain("wagering_processing_latency_ms");
    });

    it("deve retornar 200 OK com JSON estruturado quando Accept: application/json", async () => {
      const res = await fetch(`${baseUrl}/metrics`, {
        headers: {
          Accept: "application/json",
        },
      });
      expect(res.status).toBe(200);

      const contentType = res.headers.get("content-type");
      expect(contentType).toContain("application/json");

      const data: any = await res.json();
      expect(data.transactionsByStatus).toBeDefined();
      expect(data.duplicatesDetected).toBeDefined();
      expect(data.retries).toBeDefined();
      expect(data.dlqMessages).toBeDefined();
      expect(data.lockConflicts).toBeDefined();
      expect(data.outboxLagSeconds).toBeDefined();
      expect(data.latency).toBeDefined();
      expect(data.latency.p50Ms).toBeDefined();
    });
  });
});
