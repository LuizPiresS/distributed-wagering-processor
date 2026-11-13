import { describe, expect, it, mock } from "bun:test";
import { OutboxMessage } from "../../src/domain";
import { OutboxPublisherWorker } from "../../src/infrastructure/messaging/outbox/outbox-publisher.worker";

describe("OutboxPublisherWorker (Unit)", () => {
  it("should publish batch of messages and mark them published", async () => {
    const publishedEvents: any[] = [];
    const mockPublisher = {
      publish: mock(async (event: any) => {
        publishedEvents.push(event);
      }),
    };

    const mockMessages = [
      {
        id: "msg-1",
        aggregateId: "agg-1",
        eventType: "TestEvent",
        payload: { test: true },
        occurredAt: new Date(),
        attempts: 0,
        nextAttemptAt: new Date(),
        publishedAt: undefined,
      },
      {
        id: "msg-2",
        aggregateId: "agg-2",
        eventType: "TestEvent2",
        payload: { test: 2 },
        occurredAt: new Date(),
        attempts: 0,
        nextAttemptAt: new Date(),
        publishedAt: undefined,
      },
    ];

    const mockEm: any = {
      transactional: async (cb: any) => cb(mockEm),
      find: mock(async () => mockMessages),
    };

    const worker = new OutboxPublisherWorker(mockEm, mockPublisher);
    const count = await worker.processBatch(10);

    expect(count).toBe(2);
    expect(publishedEvents).toHaveLength(2);
    expect(mockMessages[0]?.publishedAt).toBeDefined();
    expect(mockMessages[1]?.publishedAt).toBeDefined();
  });

  it("should calculate exponential backoff on publisher failure and not mark published", async () => {
    const mockPublisher = {
      publish: mock(async () => {
        throw new Error("Network timeout to event broker");
      }),
    };

    const mockMessage: any = {
      id: "msg-fail",
      aggregateId: "agg-fail",
      eventType: "FailEvent",
      payload: {},
      occurredAt: new Date(),
      attempts: 0,
      nextAttemptAt: new Date(),
      publishedAt: undefined,
    };

    const mockEm: any = {
      transactional: async (cb: any) => cb(mockEm),
      find: mock(async () => [mockMessage]),
    };

    const worker = new OutboxPublisherWorker(mockEm, mockPublisher);
    const count = await worker.processBatch(10);

    expect(count).toBe(0);
    expect(mockMessage.publishedAt).toBeUndefined();
    expect(mockMessage.attempts).toBe(1);
    expect(mockMessage.nextAttemptAt.getTime()).toBeGreaterThan(Date.now() - 100);
  });
});

