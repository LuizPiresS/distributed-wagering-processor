import { LockMode } from "@mikro-orm/core";
import { EntityManager } from "@mikro-orm/postgresql";
import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import { OutboxMessage } from "../../../domain";
import { OutboxMessageOrmEntity } from "../../database/entities";
import { MetricsService } from "../../observability/metrics.service";
import {
  EVENT_PUBLISHER,
  IEventPublisher,
} from "./event-publisher.interface";

@Injectable()
export class OutboxPublisherWorker {
  private readonly logger = new Logger(OutboxPublisherWorker.name);

  constructor(
    private readonly em: EntityManager,
    @Inject(EVENT_PUBLISHER)
    private readonly eventPublisher: IEventPublisher,
    @Optional()
    private readonly metricsService?: MetricsService
  ) {}

  /**
   * Processes a single batch of unpublished outbox messages using FOR UPDATE SKIP LOCKED.
   * Multiple instances can execute this concurrently without deadlock or message duplication.
   */
  public async processBatch(batchSize = 50): Promise<number> {
    return await this.em.transactional(async (em) => {
      // 1. Fetch unpublished messages whose retry time has arrived, locking with SKIP LOCKED
      const messages = await em.find(
        OutboxMessageOrmEntity,
        {
          publishedAt: null,
          nextAttemptAt: { $lte: new Date() },
        },
        {
          orderBy: { occurredAt: "ASC" },
          limit: batchSize,
          lockMode: LockMode.PESSIMISTIC_PARTIAL_WRITE,
        },
      );

      if (messages.length === 0) {
        this.metricsService?.setOutboxLagSeconds(0);
        return 0;
      }

      // Update outbox lag from the oldest pending message
      const oldestOccurred = messages[0]?.occurredAt.getTime() ?? Date.now();
      const lagSeconds = (Date.now() - oldestOccurred) / 1000;
      this.metricsService?.setOutboxLagSeconds(lagSeconds);

      let publishedCount = 0;

      for (const msgOrm of messages) {
        try {
          const correlationId =
            (msgOrm.payload as Record<string, unknown>)?.correlationId?.toString() ||
            msgOrm.id;

          // 2. Publish to external event bus/queue
          await this.eventPublisher.publish({
            eventId: msgOrm.id,
            eventType: msgOrm.eventType,
            aggregateId: msgOrm.aggregateId,
            correlationId,
            occurredAt: msgOrm.occurredAt.toISOString(),
            data: msgOrm.payload,
          });

          // 3. Mark published
          msgOrm.publishedAt = new Date();
          publishedCount++;
        } catch (publishError) {
          // 4. On failure, calculate backoff with exponential retry
          const domain = OutboxMessage.rehydrate({
            id: msgOrm.id,
            aggregateId: msgOrm.aggregateId,
            eventType: msgOrm.eventType,
            payload: msgOrm.payload,
            occurredAt: msgOrm.occurredAt,
            attempts: msgOrm.attempts,
            nextAttemptAt: msgOrm.nextAttemptAt,
            publishedAt: msgOrm.publishedAt,
          });

          domain.scheduleRetry(new Date());

          msgOrm.attempts = domain.attempts;
          msgOrm.nextAttemptAt = domain.nextAttemptAt || new Date();
          this.metricsService?.incrementRetry("outbox");

          this.logger.warn(
            JSON.stringify({
              event: "outbox_message_publish_retry_scheduled",
              messageId: msgOrm.id,
              eventType: msgOrm.eventType,
              attempts: msgOrm.attempts,
              nextAttemptAt: msgOrm.nextAttemptAt.toISOString(),
              error: (publishError as Error).message,
            }),
          );
        }
      }

      // Unit of Work flushes updates on commit
      return publishedCount;
    });
  }
}
