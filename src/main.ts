import "reflect-metadata";
import { INestApplicationContext } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { OutboxPublisherWorker } from "./infrastructure/messaging/outbox/outbox-publisher.worker";
import { SqsConsumerService } from "./infrastructure/messaging/sqs/sqs-consumer.service";
import { PendingReferenceWorker } from "./infrastructure/messaging/workers/pending-reference.worker";
import { setupSwagger } from "./setup-swagger";

function startWorkers(app: INestApplicationContext) {
  console.log("Background workers enabled (Outbox, SQS Consumer, Pending References).");
  const outboxWorker = app.get(OutboxPublisherWorker);
  const sqsConsumer = app.get(SqsConsumerService);
  const pendingRefWorker = app.get(PendingReferenceWorker);

  let isShuttingDown = false;

  // Continuous outbox publisher loop
  const outboxInterval = setInterval(async () => {
    if (isShuttingDown) return;
    try {
      await outboxWorker.processBatch(50);
    } catch {
      // logged by worker
    }
  }, 1000);

  // Continuous pending references resolution loop
  const pendingRefInterval = setInterval(async () => {
    if (isShuttingDown) return;
    try {
      await pendingRefWorker.processBatch(20);
    } catch {
      // logged by worker
    }
  }, 5000);

  // SQS consumer continuous polling loop
  (async () => {
    while (!isShuttingDown && process.env.NODE_ENV !== "test") {
      try {
        await sqsConsumer.pollBatch(10, 5);
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }
  })();

  const cleanup = () => {
    isShuttingDown = true;
    clearInterval(outboxInterval);
    clearInterval(pendingRefInterval);
  };

  process.on("SIGTERM", cleanup);
  process.on("SIGINT", cleanup);
}

async function bootstrap() {
  const enableHttp = process.env.ENABLE_HTTP !== "false";
  const enableWorkers = process.env.ENABLE_WORKERS === "true";

  if (enableHttp) {
    const app = await NestFactory.create(AppModule);
    app.enableShutdownHooks();

    setupSwagger(app);

    const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
    await app.listen(port);
    console.log(`Wagering Processor HTTP application is running on port: ${port}`);
    console.log(`Interactive OpenAPI Swagger UI available at: http://localhost:${port}/docs`);

    if (enableWorkers) {
      startWorkers(app);
    }
  } else {
    const app = await NestFactory.createApplicationContext(AppModule);
    app.enableShutdownHooks();
    console.log("Wagering Processor Worker application is running in background context.");

    if (enableWorkers) {
      startWorkers(app);
    }
  }
}

if (process.env.NODE_ENV !== "test") {
  bootstrap();
}


