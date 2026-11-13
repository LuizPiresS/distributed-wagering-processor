export const EVENT_PUBLISHER = Symbol("EVENT_PUBLISHER");

export interface IntegrationEventPayload {
  readonly eventId: string;
  readonly eventType: string;
  readonly aggregateId: string;
  readonly correlationId: string;
  readonly occurredAt: string;
  readonly data: unknown;
}

export abstract class IEventPublisher {
  public abstract publish(event: IntegrationEventPayload): Promise<void>;
}
