import { Entity, PrimaryKey, Property } from "@mikro-orm/core";
import { CurrencyCode, Money, Wallet } from "../../../domain";
import { MoneyType } from "../types/money.type";

@Entity({ tableName: "wallets" })
export class WalletOrmEntity {
  @PrimaryKey({ type: "uuid" })
  public id!: string;

  @Property({ type: "uuid" })
  public playerId!: string;

  @Property({ length: 3 })
  public currency!: string;

  @Property({ type: MoneyType })
  public balance!: Money;

  @Property({ type: "integer", default: 1 })
  public version!: number;

  @Property({ type: "timestamptz", defaultRaw: "now()" })
  public createdAt: Date = new Date();

  @Property({ type: "timestamptz", defaultRaw: "now()", onUpdate: () => new Date() })
  public updatedAt: Date = new Date();

  public toDomain(): Wallet {
    return Wallet.rehydrate({
      id: this.id,
      playerId: this.playerId,
      currency: this.currency as CurrencyCode,
      balanceAmount: this.balance.toString(),
      version: this.version,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    });
  }

  public static fromDomain(wallet: Wallet): WalletOrmEntity {
    const entity = new WalletOrmEntity();
    entity.id = wallet.id;
    entity.playerId = wallet.playerId;
    entity.currency = wallet.currency;
    entity.balance = wallet.balance;
    entity.version = wallet.version;
    entity.createdAt = wallet.createdAt;
    entity.updatedAt = wallet.updatedAt;
    return entity;
  }
}

