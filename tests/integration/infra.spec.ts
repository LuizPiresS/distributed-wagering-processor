import {
  GetQueueAttributesCommand,
  GetQueueUrlCommand,
  SQSClient,
} from "@aws-sdk/client-sqs";
import { describe, expect, it } from "bun:test";
import { Client } from "pg";

describe("Task 01: Infrastructure Connectivity (Integration)", () => {
  it("should connect to PostgreSQL 16 on localhost:5432 and run a query", async () => {
    const client = new Client({
      connectionString:
        process.env.DATABASE_URL ||
        "postgresql://postgres:postgres@localhost:5432/wagering_db",
    });

    await client.connect();
    const res = await client.query("SELECT 1 + 1 AS sum");
    await client.end();

    expect(res.rows[0]?.sum).toBe(2);
  });

  it("should connect to MiniStack SQS and verify FIFO and DLQ queues exist", async () => {
    const sqs = new SQSClient({
      endpoint: process.env.AWS_ENDPOINT || "http://localhost:4566",
      region: process.env.AWS_REGION || "us-east-1",
      credentials: {
        accessKeyId: "test",
        secretAccessKey: "test",
      },
    });

    // 1. Verify Main Queue
    const mainQueue = await sqs.send(
      new GetQueueUrlCommand({ QueueName: "wager-transactions.fifo" }),
    );
    expect(mainQueue.QueueUrl).toBeDefined();

    const mainAttrs = await sqs.send(
      new GetQueueAttributesCommand({
        QueueUrl: mainQueue.QueueUrl,
        AttributeNames: ["FifoQueue", "RedrivePolicy"],
      }),
    );
    expect(mainAttrs.Attributes?.FifoQueue).toBe("true");
    expect(mainAttrs.Attributes?.RedrivePolicy).toContain(
      "wager-transactions-dlq.fifo",
    );

    // 2. Verify DLQ Queue
    const dlqQueue = await sqs.send(
      new GetQueueUrlCommand({ QueueName: "wager-transactions-dlq.fifo" }),
    );
    expect(dlqQueue.QueueUrl).toBeDefined();
  });
});

