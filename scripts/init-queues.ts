import {
  CreateQueueCommand,
  GetQueueAttributesCommand,
  SQSClient,
} from "@aws-sdk/client-sqs";

const endpoint = process.env.AWS_ENDPOINT || "http://localhost:4566";
const region = process.env.AWS_REGION || "us-east-1";

const client = new SQSClient({
  endpoint,
  region,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || "test",
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "test",
  },
});

async function initQueues() {
  console.log(`Connecting to SQS at ${endpoint} (${region})...`);

  // 1. Create DLQ FIFO
  console.log("Creating wager-transactions-dlq.fifo...");
  const createDlqCmd = new CreateQueueCommand({
    QueueName: "wager-transactions-dlq.fifo",
    Attributes: {
      FifoQueue: "true",
      ContentBasedDeduplication: "false",
    },
  });

  const dlqRes = await client.send(createDlqCmd);
  console.log(`DLQ created: ${dlqRes.QueueUrl}`);

  // 2. Get DLQ ARN for RedrivePolicy
  const getAttrsCmd = new GetQueueAttributesCommand({
    QueueUrl: dlqRes.QueueUrl,
    AttributeNames: ["QueueArn"],
  });

  const attrsRes = await client.send(getAttrsCmd);
  const dlqArn = attrsRes.Attributes?.QueueArn;
  console.log(`DLQ ARN: ${dlqArn}`);

  // 3. Create Main FIFO Queue with RedrivePolicy
  console.log("Creating wager-transactions.fifo with redrive policy...");
  const redrivePolicy = JSON.stringify({
    deadLetterTargetArn: dlqArn,
    maxReceiveCount: "3",
  });

  const createMainCmd = new CreateQueueCommand({
    QueueName: "wager-transactions.fifo",
    Attributes: {
      FifoQueue: "true",
      ContentBasedDeduplication: "false",
      RedrivePolicy: redrivePolicy,
    },
  });

  const mainRes = await client.send(createMainCmd);
  console.log(`Main queue created: ${mainRes.QueueUrl}`);
  console.log("SQS FIFO queues initialized successfully.");
}

initQueues().catch((err) => {
  console.error("Failed to initialize SQS queues:", err);
  process.exit(1);
});

