import { describe, expect, it } from "bun:test";
import { MetricsService } from "../../src/infrastructure/observability/metrics.service";

describe("MetricsService (README Seção 12)", () => {
  it("deve inicializar com valores zerados e snapshot consistente", () => {
    const service = new MetricsService();
    const snapshot = service.getSnapshot();

    expect(snapshot.duplicatesDetected).toBe(0);
    expect(snapshot.dlqMessages).toBe(0);
    expect(snapshot.lockConflicts).toBe(0);
    expect(snapshot.outboxLagSeconds).toBe(0);
    expect(snapshot.latency.count).toBe(0);
    expect(snapshot.latency.avgMs).toBe(0);
  });

  it("deve registrar transações por status e duplicatas detectadas", () => {
    const service = new MetricsService();

    service.incrementTransaction("PROCESSED");
    service.incrementTransaction("PROCESSED");
    service.incrementTransaction("REJECTED");
    service.incrementDuplicateDetected();
    service.incrementDuplicateDetected();

    const snapshot = service.getSnapshot();
    expect(snapshot.transactionsByStatus["PROCESSED"]).toBe(2);
    expect(snapshot.transactionsByStatus["REJECTED"]).toBe(1);
    expect(snapshot.duplicatesDetected).toBe(2);
  });

  it("deve registrar retries de outbox e sqs, mensagens em DLQ e conflitos de lock", () => {
    const service = new MetricsService();

    service.incrementRetry("outbox");
    service.incrementRetry("outbox");
    service.incrementRetry("sqs");
    service.incrementDlqMessage();
    service.incrementLockConflict();

    const snapshot = service.getSnapshot();
    expect(snapshot.retries["outbox"]).toBe(2);
    expect(snapshot.retries["sqs"]).toBe(1);
    expect(snapshot.dlqMessages).toBe(1);
    expect(snapshot.lockConflicts).toBe(1);
  });

  it("deve atualizar outbox lag em segundos e calcular latência com percentis", () => {
    const service = new MetricsService();

    service.setOutboxLagSeconds(3.456);
    expect(service.getSnapshot().outboxLagSeconds).toBe(3.46);

    service.recordProcessingLatency(10);
    service.recordProcessingLatency(20);
    service.recordProcessingLatency(30);

    const snapshot = service.getSnapshot();
    expect(snapshot.latency.count).toBe(3);
    expect(snapshot.latency.avgMs).toBe(20);
    expect(snapshot.latency.p50Ms).toBe(20);
  });

  it("deve formatar todas as 7 métricas obrigatórias no formato Prometheus / OpenMetrics", () => {
    const service = new MetricsService();

    service.incrementTransaction("PROCESSED");
    service.incrementDuplicateDetected();
    service.incrementRetry("outbox");
    service.incrementRetry("sqs");
    service.incrementDlqMessage();
    service.incrementLockConflict();
    service.setOutboxLagSeconds(1.5);
    service.recordProcessingLatency(15);

    const text = service.toPrometheusText();

    expect(text).toContain("wagering_transactions_total{status=\"PROCESSED\"} 1");
    expect(text).toContain("wagering_duplicates_detected_total 1");
    expect(text).toContain("wagering_retries_total{component=\"outbox\"} 1");
    expect(text).toContain("wagering_retries_total{component=\"sqs\"} 1");
    expect(text).toContain("wagering_dlq_messages_total 1");
    expect(text).toContain("wagering_lock_conflicts_total 1");
    expect(text).toContain("wagering_outbox_lag_seconds 1.5");
    expect(text).toContain("wagering_processing_latency_ms{quantile=\"0.5\"} 15");
    expect(text).toContain("wagering_processing_latency_ms_count 1");
  });
});
