import {
  ChangeMessageVisibilityCommand,
  DeleteMessageCommand,
  Message,
  ReceiveMessageCommand,
  SQSClient,
} from "@aws-sdk/client-sqs";
import { EntityManager } from "@mikro-orm/postgresql";
import {
  Inject,
  Injectable,
  Logger,
  OnApplicationShutdown,
  Optional,
} from "@nestjs/common";
import * as crypto from "crypto";
import {
  ProcessWagerTransactionDto,
  ProcessWagerTransactionResult,
} from "../../../application/dto/process-wager.dto";
import { ProcessWagerTransactionUseCase } from "../../../application/use-cases/process-wager-transaction.use-case";
import { InboxMessage } from "../../../domain";
import { InboxMessageOrmEntity } from "../../database/entities";
import { MetricsService } from "../../observability/metrics.service";
import { SQS_CLIENT } from "./sqs-client.provider";

export interface SqsConsumerProcessResult {
  readonly messageId: string;
  readonly status: "PROCESSED" | "SKIPPED" | "FAILED";
  readonly reason?: string;
  readonly useCaseResult?: ProcessWagerTransactionResult;
}

@Injectable()
export class SqsConsumerService implements OnApplicationShutdown {
  private readonly logger = new Logger(SqsConsumerService.name);
  private readonly consumerName = "wager-sqs-consumer";
  private queueUrl: string;
  private isShuttingDown = false;
  private inFlightMessages = new Set<string>();
  private activePolling = false;

  constructor(
    @Inject(SQS_CLIENT)
    private readonly sqsClient: SQSClient,
    private readonly em: EntityManager,
    private readonly processWagerUseCase: ProcessWagerTransactionUseCase,
    @Optional()
    private readonly metricsService?: MetricsService
  ) {
    this.queueUrl =
      process.env.SQS_WAGER_QUEUE_URL ||
      "http://localhost:4566/000000000000/wager-transactions.fifo";
  }

  public setQueueUrl(url: string): void {
    this.queueUrl = url;
  }

  public isPolling(): boolean {
    return this.activePolling;
  }

  public async onApplicationShutdown(signal?: string): Promise<void> {
    this.logger.log(
      JSON.stringify({
        event: "sqs_consumer_shutdown_initiated",
        signal,
        inFlightCount: this.inFlightMessages.size,
      }),
    );
    this.isShuttingDown = true;
    this.activePolling = false;

    // Graceful period: wait up to 10 seconds for in-flight messages to drain
    const start = Date.now();
    while (this.inFlightMessages.size > 0 && Date.now() - start < 10000) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    if (this.inFlightMessages.size > 0) {
      this.logger.warn(
        JSON.stringify({
          event: "sqs_consumer_shutdown_timeout",
          remainingInFlight: this.inFlightMessages.size,
        }),
      );
    }
  }

  /**
   * Single poll cycle: receives a batch of messages from SQS FIFO and processes them.
   */
  public async pollBatch(maxMessages = 10, waitTimeSeconds = 0): Promise<SqsConsumerProcessResult[]> {
    if (this.isShuttingDown) {
      return [];
    }

    try {
      const response = await this.sqsClient.send(
        new ReceiveMessageCommand({
          QueueUrl: this.queueUrl,
          MaxNumberOfMessages: maxMessages,
          WaitTimeSeconds: waitTimeSeconds,
          AttributeNames: ["All"],
          MessageAttributeNames: ["All"],
        }),
      );

      const messages = response.Messages || [];
      if (messages.length === 0) {
        return [];
      }

      const results: SqsConsumerProcessResult[] = [];
      for (const message of messages) {
        const result = await this.processSingleMessage(message);
        results.push(result);
      }
      return results;
    } catch (error) {
      this.logger.error(
        JSON.stringify({
          event: "sqs_poll_batch_error",
          error: (error as Error).message,
        }),
      );
      throw error;
    }
  }

  /**
   * Processes a single SQS message with transactional Inbox deduplication.
   */
  public async processSingleMessage(
    message: Message,
  ): Promise<SqsConsumerProcessResult> {
    const messageId = message.MessageId;
    const receiptHandle = message.ReceiptHandle;

    if (!messageId || !receiptHandle) {
      return {
        messageId: messageId || "unknown",
        status: "FAILED",
        reason: "MISSING_MESSAGE_ATTRIBUTES",
      };
    }

    this.inFlightMessages.add(messageId);

    try {
      let body: any;
      try {
        body = JSON.parse(message.Body || "{}");
      } catch (parseError) {
        this.logger.error(
          JSON.stringify({
            event: "sqs_malformed_json_poison_pill",
            messageId,
            error: (parseError as Error).message,
          }),
        );
        // Do not ack corrupt JSON directly; let SQS DLQ redrive handle after max attempts
        throw parseError;
      }

      const rawBody = message.Body || "";
      const payloadHash = crypto
        .createHash("sha256")
        .update(rawBody)
        .digest("hex");

      // Transactional Inbox Execution
      const txResult = await this.em.transactional(async (em) => {
        // 1. Deduplication Check in inbox_messages table
        const existingInbox = await em.findOne(InboxMessageOrmEntity, {
          consumerName: this.consumerName,
          messageId,
        });

        if (existingInbox && existingInbox.processedAt) {
          // Already successfully processed previously (redelivery after commit)
          return {
            skipped: true,
            reason: "ALREADY_PROCESSED",
          };
        }

        let inboxOrm = existingInbox;
        if (!inboxOrm) {
          const domainInbox = InboxMessage.receive({
            messageId,
            consumerName: this.consumerName,
            payloadHash,
          });
          inboxOrm = InboxMessageOrmEntity.fromDomain(domainInbox);
          em.persist(inboxOrm);
        }

        // 2. Map payload to ProcessWagerTransactionDto
        const dto: ProcessWagerTransactionDto = {
          idempotencyKey:
            body.idempotencyKey ||
            message.Attributes?.MessageDeduplicationId ||
            messageId,
          providerId: body.providerId,
          externalTransactionId: body.externalTransactionId,
          playerId: body.playerId,
          walletId: body.walletId,
          roundId: body.roundId,
          gameId: body.gameId,
          kind: body.kind,
          money: body.money,
          referenceExternalTransactionId: body.referenceExternalTransactionId,
          correlationId: body.correlationId || messageId,
        };

        // 3. Execute business use case in the exact same database transaction
        const useCaseResult = await this.processWagerUseCase.execute(dto, em);

        // 4. Mark inbox message as processed
        inboxOrm.processedAt = new Date();

        return {
          skipped: false,
          useCaseResult,
        };
      });

      // 5. Commit succeeded! Now acknowledge (deleteMessage) from SQS
      await this.sqsClient.send(
        new DeleteMessageCommand({
          QueueUrl: this.queueUrl,
          ReceiptHandle: receiptHandle,
        }),
      );

      this.logger.log(
        JSON.stringify({
          event: "sqs_message_acknowledged",
          messageId,
          status: txResult.skipped ? "SKIPPED" : "PROCESSED",
          reason: txResult.reason,
        }),
      );

      return {
        messageId,
        status: txResult.skipped ? "SKIPPED" : "PROCESSED",
        reason: txResult.reason,
        useCaseResult: txResult.useCaseResult,
      };
    } catch (error) {
      this.logger.error(
        JSON.stringify({
          event: "sqs_message_processing_failed",
          messageId,
          error: (error as Error).message,
        }),
      );

      this.metricsService?.incrementRetry("sqs");

      // Return visibility to SQS immediately on transient failures if still active
      if (!this.isShuttingDown) {
        try {
          await this.sqsClient.send(
            new ChangeMessageVisibilityCommand({
              QueueUrl: this.queueUrl,
              ReceiptHandle: receiptHandle,
              VisibilityTimeout: 0,
            }),
          );
        } catch (visError) {
          // Ignore visibility reset error
        }
      }

      return {
        messageId,
        status: "FAILED",
        reason: (error as Error).message,
      };
    } finally {
      this.inFlightMessages.delete(messageId);
    }
  }
}
