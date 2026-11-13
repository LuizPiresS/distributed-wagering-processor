import { v4 as uuidv4 } from "uuid";
import { IntegrationEvent } from "../events/integration-event.base";

export interface OutboxMessageState {
  readonly id: string;
  readonly aggregateId: string;
  readonly eventType: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly occurredAt: Date;
  readonly attempts: number;
  readonly nextAttemptAt?: Date;
  readonly publishedAt?: Date;
}

export class OutboxMessage {
  private constructor(
    public readonly id: string,
    public readonly aggregateId: string,
    public readonly eventType: string,
    public readonly payload: Readonly<Record<string, unknown>>,
    public readonly occurredAt: Date,
    private _attempts: number,
    private _nextAttemptAt?: Date,
    private _publishedAt?: Date,
  ) {}

  public static enqueue(
    event: IntegrationEvent<unknown>,
    customId?: string,
  ): OutboxMessage {
    const payload = event.toJSON() as unknown as Record<string, unknown>;
    return new OutboxMessage(
      customId || uuidv4(),
      event.aggregateId,
      event.eventType,
      Object.freeze(payload),
      event.occurredAt,
      0,
      new Date(), // Initially immediately due
    );
  }

  public static rehydrate(state: OutboxMessageState): OutboxMessage {
    return new OutboxMessage(
      state.id,
      state.aggregateId,
      state.eventType,
      state.payload,
      state.occurredAt,
      state.attempts,
      state.nextAttemptAt,
      state.publishedAt,
    );
  }

  public get attempts(): number {
    return this._attempts;
  }

  public get nextAttemptAt(): Date | undefined {
    return this._nextAttemptAt;
  }

  public get publishedAt(): Date | undefined {
    return this._publishedAt;
  }

  public isPending(): boolean {
    return this._publishedAt === undefined;
  }

  public isDue(now: Date = new Date()): boolean {
    if (!this.isPending()) return false;
    if (!this._nextAttemptAt) return true;
    return this._nextAttemptAt.getTime() <= now.getTime();
  }

  public markPublished(at: Date = new Date()): void {
    this._publishedAt = at;
  }

  /**
   * Increments attempts and calculates the next retry timestamp with exponential backoff and jitter.
   */
  public scheduleRetry(now: Date = new Date()): void {
    this._attempts++;
    // Exponential backoff: min(60s, 2^(attempts-1) * 1000ms) + jitter (0..500ms)
    const baseDelay = Math.min(60000, Math.pow(2, this._attempts - 1) * 1000);
    const jitter = Math.floor(Math.random() * 500);
    const totalDelay = baseDelay + jitter;

    this._nextAttemptAt = new Date(now.getTime() + totalDelay);
  }
}

