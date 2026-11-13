import { Entity, PrimaryKey, Property } from "@mikro-orm/core";
import { InboxMessage } from "../../../domain";

@Entity({ tableName: "inbox_messages" })
export class InboxMessageOrmEntity {
  @PrimaryKey({ length: 255 })
  public messageId!: string;

  @PrimaryKey({ length: 100 })
  public consumerName!: string;

  @Property({ length: 64 })
  public payloadHash!: string;

  @Property({ type: "timestamptz", defaultRaw: "now()" })
  public receivedAt: Date = new Date();

  @Property({ type: "timestamptz", nullable: true })
  public processedAt?: Date;

  public toDomain(): InboxMessage {
    return InboxMessage.rehydrate({
      messageId: this.messageId,
      consumerName: this.consumerName,
      payloadHash: this.payloadHash,
      receivedAt: this.receivedAt,
      processedAt: this.processedAt,
    });
  }

  public static fromDomain(inbox: InboxMessage): InboxMessageOrmEntity {
    const entity = new InboxMessageOrmEntity();
    entity.messageId = inbox.messageId;
    entity.consumerName = inbox.consumerName;
    entity.payloadHash = inbox.payloadHash;
    entity.receivedAt = inbox.receivedAt;
    entity.processedAt = inbox.processedAt;
    return entity;
  }
}

