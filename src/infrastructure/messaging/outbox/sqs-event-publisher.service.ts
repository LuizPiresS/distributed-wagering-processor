import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { SQS_CLIENT } from "../sqs/sqs-client.provider";
import {
  IEventPublisher,
  IntegrationEventPayload,
} from "./event-publisher.interface";

@Injectable()
export class SqsEventPublisher implements IEventPublisher {
  private readonly logger = new Logger(SqsEventPublisher.name);
  private queueUrl?: string;

  constructor(
    @Inject(SQS_CLIENT)
    private readonly sqsClient: SQSClient,
  ) {
    this.queueUrl = process.env.SQS_INTEGRATION_QUEUE_URL;
  }

  public setQueueUrl(url: string): void {
    this.queueUrl = url;
  }

  public async publish(event: IntegrationEventPayload): Promise<void> {
    if (this.queueUrl) {
      await this.sqsClient.send(
        new SendMessageCommand({
          QueueUrl: this.queueUrl,
          MessageBody: JSON.stringify(event),
          MessageGroupId: event.aggregateId || "integration-events",
          MessageDeduplicationId: event.eventId,
        }),
      );
    }

    this.logger.log(
      JSON.stringify({
        event: "integration_event_published",
        eventId: event.eventId,
        eventType: event.eventType,
        aggregateId: event.aggregateId,
        correlationId: event.correlationId,
      }),
    );
  }
}

