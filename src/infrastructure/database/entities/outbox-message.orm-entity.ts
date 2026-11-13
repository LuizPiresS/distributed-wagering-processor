import { Entity, PrimaryKey, Property } from "@mikro-orm/core";
import { OutboxMessage } from "../../../domain";

@Entity({ tableName: "outbox_messages" })
export class OutboxMessageOrmEntity {
  @PrimaryKey({ type: "uuid" })
  public id!: string;

  @Property({ length: 255 })
  public aggregateId!: string;

  @Property({ length: 100 })
  public eventType!: string;

  @Property({ type: "jsonb" })
  public payload!: Record<string, unknown>;

  @Property({ type: "timestamptz" })
  public occurredAt!: Date;

  @Property({ type: "integer", default: 0 })
  public attempts: number = 0;

  @Property({ type: "timestamptz", defaultRaw: "now()" })
  public nextAttemptAt: Date = new Date();

  @Property({ type: "timestamptz", nullable: true })
  public publishedAt?: Date;

  public toDomain(): OutboxMessage {
    return OutboxMessage.rehydrate({
      id: this.id,
      aggregateId: this.aggregateId,
      eventType: this.eventType,
      payload: this.payload,
      occurredAt: this.occurredAt,
      attempts: this.attempts,
      nextAttemptAt: this.nextAttemptAt,
      publishedAt: this.publishedAt,
    });
  }

  public static fromDomain(outbox: OutboxMessage): OutboxMessageOrmEntity {
    const entity = new OutboxMessageOrmEntity();
    entity.id = outbox.id;
    entity.aggregateId = outbox.aggregateId;
    entity.eventType = outbox.eventType;
    entity.payload = outbox.payload;
    entity.occurredAt = outbox.occurredAt;
    entity.attempts = outbox.attempts;
    entity.nextAttemptAt = outbox.nextAttemptAt || new Date();
    entity.publishedAt = outbox.publishedAt;
    return entity;
  }
}

