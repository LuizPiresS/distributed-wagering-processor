import { Entity, Enum, PrimaryKey, Property } from "@mikro-orm/core";
import {
  CurrencyCode,
  LedgerDirection,
  Money,
  WalletLedgerEntry,
} from "../../../domain";
import { MoneyType } from "../types/money.type";

@Entity({ tableName: "wallet_ledger_entries" })
export class WalletLedgerEntryOrmEntity {
  @PrimaryKey({ type: "uuid" })
  public id!: string;

  @Property({ type: "uuid" })
  public walletId!: string;

  @Property({ type: "uuid" })
  public transactionId!: string;

  @Enum({ items: () => LedgerDirection })
  public direction!: LedgerDirection;

  @Property({ type: MoneyType })
  public amount!: Money;

  @Property({ length: 3 })
  public currency!: string;

  @Property({ type: MoneyType })
  public balanceBefore!: Money;

  @Property({ type: MoneyType })
  public balanceAfter!: Money;

  @Property({ type: "timestamptz", defaultRaw: "now()" })
  public createdAt: Date = new Date();

  public toDomain(): WalletLedgerEntry {
    return WalletLedgerEntry.rehydrate({
      id: this.id,
      walletId: this.walletId,
      transactionId: this.transactionId,
      direction: this.direction,
      amount: this.amount.toString(),
      currency: this.currency as CurrencyCode,
      balanceBeforeAmount: this.balanceBefore.toString(),
      balanceAfterAmount: this.balanceAfter.toString(),
      createdAt: this.createdAt,
    });
  }

  public static fromDomain(entry: WalletLedgerEntry): WalletLedgerEntryOrmEntity {
    const entity = new WalletLedgerEntryOrmEntity();
    entity.id = entry.id;
    entity.walletId = entry.walletId;
    entity.transactionId = entry.transactionId;
    entity.direction = entry.direction;
    entity.amount = entry.money;
    entity.currency = entry.money.currency;
    entity.balanceBefore = entry.balanceBefore;
    entity.balanceAfter = entry.balanceAfter;
    entity.createdAt = entry.createdAt;
    return entity;
  }
}
