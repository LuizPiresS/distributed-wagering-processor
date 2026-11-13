import { Entity, Enum, PrimaryKey, Property } from "@mikro-orm/core";
import {
  CurrencyCode,
  FailureCode,
  Money,
  WagerTransaction,
  WagerTransactionKind,
  WagerTransactionStatus,
} from "../../../domain";
import { MoneyType } from "../types/money.type";

@Entity({ tableName: "wager_transactions" })
export class WagerTransactionOrmEntity {
  @PrimaryKey({ type: "uuid" })
  public id!: string;

  @Property({ length: 100 })
  public providerId!: string;

  @Property({ length: 255 })
  public externalTransactionId!: string;

  @Property({ length: 255 })
  public idempotencyKey!: string;

  @Property({ length: 64 })
  public payloadHash!: string;

  @Property({ type: "uuid" })
  public walletId!: string;

  @Property({ type: "uuid" })
  public playerId!: string;

  @Property({ length: 255 })
  public roundId!: string;

  @Property({ length: 255 })
  public gameId!: string;

  @Enum({ items: () => WagerTransactionKind })
  public kind!: WagerTransactionKind;

  @Property({ type: MoneyType })
  public amount!: Money;

  @Property({ length: 3 })
  public currency!: string;

  @Property({ length: 255, nullable: true })
  public referenceExternalTransactionId?: string;

  @Property({ type: "uuid", nullable: true })
  public referenceTransactionId?: string;

  @Enum({ items: () => WagerTransactionStatus })
  public status!: WagerTransactionStatus;

  @Enum({ items: () => FailureCode, nullable: true })
  public failureCode?: FailureCode;

  @Property({ type: "timestamptz", defaultRaw: "now()" })
  public createdAt: Date = new Date();

  @Property({ type: "timestamptz", nullable: true })
  public processedAt?: Date;

  public toDomain(): WagerTransaction {
    return WagerTransaction.rehydrate({
      id: this.id,
      providerId: this.providerId,
      externalTransactionId: this.externalTransactionId,
      idempotencyKey: this.idempotencyKey,
      payloadHash: this.payloadHash,
      walletId: this.walletId,
      playerId: this.playerId,
      roundId: this.roundId,
      gameId: this.gameId,
      kind: this.kind,
      amount: this.amount.toString(),
      currency: this.currency as CurrencyCode,
      referenceExternalTransactionId: this.referenceExternalTransactionId,
      referenceTransactionId: this.referenceTransactionId,
      status: this.status,
      failureCode: this.failureCode,
      createdAt: this.createdAt,
      processedAt: this.processedAt,
    });
  }

  public static fromDomain(tx: WagerTransaction): WagerTransactionOrmEntity {
    const entity = new WagerTransactionOrmEntity();
    entity.id = tx.id;
    entity.providerId = tx.providerId;
    entity.externalTransactionId = tx.externalTransactionId;
    entity.idempotencyKey = tx.idempotencyKey;
    entity.payloadHash = tx.payloadHash;
    entity.walletId = tx.walletId;
    entity.playerId = tx.playerId;
    entity.roundId = tx.roundId;
    entity.gameId = tx.gameId;
    entity.kind = tx.kind;
    entity.amount = tx.money;
    entity.currency = tx.money.currency;
    entity.referenceExternalTransactionId = tx.referenceExternalTransactionId;
    entity.referenceTransactionId = tx.referenceTransactionId;
    entity.status = tx.status;
    entity.failureCode = tx.failureCode;
    entity.createdAt = tx.createdAt;
    entity.processedAt = tx.processedAt;
    return entity;
  }
}
