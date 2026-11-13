import { Injectable } from "@nestjs/common";

@Injectable()
export class MetricsService {
  private readonly transactionStatusCounts = new Map<string, number>();
  private duplicatesDetectedCount = 0;
  private readonly retriesCount = new Map<string, number>();
  private dlqMessagesCount = 0;
  private lockConflictsCount = 0;
  private outboxLagSeconds = 0;

  private readonly processingLatenciesMs: number[] = [];
  private totalProcessingTimeMs = 0;
  private totalProcessedTransactions = 0;

  public incrementTransaction(status: string): void {
    const current = this.transactionStatusCounts.get(status) || 0;
    this.transactionStatusCounts.set(status, current + 1);
  }

  public incrementDuplicateDetected(): void {
    this.duplicatesDetectedCount++;
  }

  public incrementRetry(component: "outbox" | "sqs"): void {
    const current = this.retriesCount.get(component) || 0;
    this.retriesCount.set(component, current + 1);
  }

  public incrementDlqMessage(): void {
    this.dlqMessagesCount++;
  }

  public incrementLockConflict(): void {
    this.lockConflictsCount++;
  }

  public setOutboxLagSeconds(seconds: number): void {
    this.outboxLagSeconds = Math.max(0, Math.round(seconds * 100) / 100);
  }

  public recordProcessingLatency(durationMs: number): void {
    this.totalProcessingTimeMs += durationMs;
    this.totalProcessedTransactions++;
    if (this.processingLatenciesMs.length >= 1000) {
      this.processingLatenciesMs.shift();
    }
    this.processingLatenciesMs.push(durationMs);
  }

  public getSnapshot(): {
    transactionsByStatus: Record<string, number>;
    duplicatesDetected: number;
    retries: Record<string, number>;
    dlqMessages: number;
    lockConflicts: number;
    outboxLagSeconds: number;
    latency: {
      count: number;
      avgMs: number;
      p50Ms: number;
      p95Ms: number;
      p99Ms: number;
    };
  } {
    const sorted = [...this.processingLatenciesMs].sort((a, b) => a - b);
    const count = this.processingLatenciesMs.length;
    const p50 = count ? (sorted[Math.floor(count * 0.5)] ?? 0) : 0;
    const p95 = count ? (sorted[Math.floor(count * 0.95)] ?? 0) : 0;
    const p99 = count ? (sorted[Math.floor(count * 0.99)] ?? 0) : 0;
    const avg =
      this.totalProcessedTransactions > 0
        ? Math.round(
            (this.totalProcessingTimeMs / this.totalProcessedTransactions) * 100
          ) / 100
        : 0;

    return {
      transactionsByStatus: Object.fromEntries(
        this.transactionStatusCounts.entries()
      ),
      duplicatesDetected: this.duplicatesDetectedCount,
      retries: Object.fromEntries(this.retriesCount.entries()),
      dlqMessages: this.dlqMessagesCount,
      lockConflicts: this.lockConflictsCount,
      outboxLagSeconds: this.outboxLagSeconds,
      latency: {
        count: this.totalProcessedTransactions,
        avgMs: avg,
        p50Ms: p50,
        p95Ms: p95,
        p99Ms: p99,
      },
    };
  }

  public toPrometheusText(): string {
    const lines: string[] = [];

    lines.push(
      "# HELP wagering_transactions_total Total de transações processadas por status"
    );
    lines.push("# TYPE wagering_transactions_total counter");
    if (this.transactionStatusCounts.size === 0) {
      lines.push('wagering_transactions_total{status="NONE"} 0');
    } else {
      for (const [status, val] of this.transactionStatusCounts.entries()) {
        lines.push(`wagering_transactions_total{status="${status}"} ${val}`);
      }
    }

    lines.push(
      "# HELP wagering_duplicates_detected_total Total de tentativas de execução com mesma chave de idempotência"
    );
    lines.push("# TYPE wagering_duplicates_detected_total counter");
    lines.push(
      `wagering_duplicates_detected_total ${this.duplicatesDetectedCount}`
    );

    lines.push(
      "# HELP wagering_retries_total Total de retries executados por componente"
    );
    lines.push("# TYPE wagering_retries_total counter");
    lines.push(
      `wagering_retries_total{component="outbox"} ${
        this.retriesCount.get("outbox") || 0
      }`
    );
    lines.push(
      `wagering_retries_total{component="sqs"} ${
        this.retriesCount.get("sqs") || 0
      }`
    );

    lines.push(
      "# HELP wagering_dlq_messages_total Total de mensagens enviadas para Dead Letter Queue"
    );
    lines.push("# TYPE wagering_dlq_messages_total counter");
    lines.push(`wagering_dlq_messages_total ${this.dlqMessagesCount}`);

    lines.push(
      "# HELP wagering_lock_conflicts_total Total de conflitos de concorrência ou contenção de lock observados"
    );
    lines.push("# TYPE wagering_lock_conflicts_total counter");
    lines.push(`wagering_lock_conflicts_total ${this.lockConflictsCount}`);

    lines.push(
      "# HELP wagering_outbox_lag_seconds Lag em segundos do evento mais antigo pendente na outbox"
    );
    lines.push("# TYPE wagering_outbox_lag_seconds gauge");
    lines.push(`wagering_outbox_lag_seconds ${this.outboxLagSeconds}`);

    const snapshot = this.getSnapshot();
    lines.push(
      "# HELP wagering_processing_latency_ms Latência de processamento de transações em milissegundos"
    );
    lines.push("# TYPE wagering_processing_latency_ms summary");
    lines.push(
      `wagering_processing_latency_ms{quantile="0.5"} ${snapshot.latency.p50Ms}`
    );
    lines.push(
      `wagering_processing_latency_ms{quantile="0.95"} ${snapshot.latency.p95Ms}`
    );
    lines.push(
      `wagering_processing_latency_ms{quantile="0.99"} ${snapshot.latency.p99Ms}`
    );
    lines.push(`wagering_processing_latency_ms_sum ${this.totalProcessingTimeMs}`);
    lines.push(
      `wagering_processing_latency_ms_count ${snapshot.latency.count}`
    );

    return lines.join("\n") + "\n";
  }
}
