import { Module } from "@nestjs/common";
import { ApplicationModule } from "../../application/application.module";
import { DatabaseModule } from "../database/database.module";
import { EVENT_PUBLISHER } from "./outbox/event-publisher.interface";
import { OutboxPublisherWorker } from "./outbox/outbox-publisher.worker";
import { SqsEventPublisher } from "./outbox/sqs-event-publisher.service";
import { SQS_CLIENT, sqsClientProvider } from "./sqs/sqs-client.provider";
import { SqsConsumerService } from "./sqs/sqs-consumer.service";
import { PendingReferenceWorker } from "./workers/pending-reference.worker";

@Module({
  imports: [DatabaseModule, ApplicationModule],
  providers: [
    sqsClientProvider,
    {
      provide: EVENT_PUBLISHER,
      useClass: SqsEventPublisher,
    },
    SqsEventPublisher,
    SqsConsumerService,
    OutboxPublisherWorker,
    PendingReferenceWorker,
  ],
  exports: [
    SQS_CLIENT,
    EVENT_PUBLISHER,
    SqsEventPublisher,
    SqsConsumerService,
    OutboxPublisherWorker,
    PendingReferenceWorker,
  ],
})
export class MessagingModule {}

