import { describe, expect, it, mock } from "bun:test";
import { SqsConsumerService } from "../../src/infrastructure/messaging/sqs/sqs-consumer.service";

describe("SqsConsumerService (Unit)", () => {
  it("should reject message missing messageId or receiptHandle with FAILED status", async () => {
    const mockSqs: any = {};
    const mockEm: any = {};
    const mockUseCase: any = {};

    const service = new SqsConsumerService(mockSqs, mockEm, mockUseCase);

    const result = await service.processSingleMessage({
      Body: JSON.stringify({ providerId: "p1" }),
      // Missing MessageId and ReceiptHandle
    });

    expect(result.status).toBe("FAILED");
    expect(result.reason).toBe("MISSING_MESSAGE_ATTRIBUTES");
  });

  it("should throw error and trigger visibility change on malformed JSON (poison pill candidate)", async () => {
    let visibilityChanged = false;
    const mockSqs: any = {
      send: mock(async (command: any) => {
        if (command.constructor.name === "ChangeMessageVisibilityCommand") {
          visibilityChanged = true;
        }
        return {};
      }),
    };
    const mockEm: any = {};
    const mockUseCase: any = {};

    const service = new SqsConsumerService(mockSqs, mockEm, mockUseCase);

    const result = await service.processSingleMessage({
      MessageId: "msg-poison",
      ReceiptHandle: "receipt-poison",
      Body: "invalid-non-json-string{",
    });

    expect(result.status).toBe("FAILED");
    expect(visibilityChanged).toBe(true);
  });

  it("should track graceful shutdown and stop polling when shutdown is initiated", async () => {
    let receiveCalled = false;
    const mockSqs: any = {
      send: mock(async () => {
        receiveCalled = true;
        return { Messages: [] };
      }),
    };
    const mockEm: any = {};
    const mockUseCase: any = {};

    const service = new SqsConsumerService(mockSqs, mockEm, mockUseCase);

    // Initial state: not shutting down
    const beforeShutdown = await service.pollBatch();
    expect(beforeShutdown).toEqual([]);
    expect(receiveCalled).toBe(true);

    // Trigger shutdown
    await service.onApplicationShutdown("SIGTERM");

    receiveCalled = false;
    const afterShutdown = await service.pollBatch();
    expect(afterShutdown).toEqual([]);
    expect(receiveCalled).toBe(false);
  });
});

