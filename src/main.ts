import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { OutboxPublisherWorker } from "./infrastructure/messaging/outbox/outbox-publisher.worker";
import { SqsConsumerService } from "./infrastructure/messaging/sqs/sqs-consumer.service";
import { PendingReferenceWorker } from "./infrastructure/messaging/workers/pending-reference.worker";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();

  const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
  await app.listen(port);
  console.log(`Wagering Processor application is running on port: ${port}`);

  if (process.env.ENABLE_WORKERS === "true") {
    console.log("Background workers enabled (Outbox, SQS Consumer, Pending References).");
    const outboxWorker = app.get(OutboxPublisherWorker);
    const sqsConsumer = app.get(SqsConsumerService);
    const pendingRefWorker = app.get(PendingReferenceWorker);

    // Continuous outbox publisher loop
    setInterval(async () => {
      try {
        await outboxWorker.processBatch(50);
      } catch {
        // logged by worker
      }
    }, 1000);

    // Continuous pending references resolution loop
    setInterval(async () => {
      try {
        await pendingRefWorker.processBatch(20);
      } catch {
        // logged by worker
      }
    }, 5000);

    // SQS consumer continuous polling loop
    (async () => {
      while (process.env.NODE_ENV !== "test") {
        try {
          await sqsConsumer.pollBatch(10, 5);
        } catch {
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
      }
    })();
  }
}

if (process.env.NODE_ENV !== "test") {
  bootstrap();
}

