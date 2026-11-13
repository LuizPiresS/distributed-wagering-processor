import { EntityProperty, Platform, Type } from "@mikro-orm/core";
import { Currency, Money } from "../../../domain";

export class MoneyType extends Type<Money, string> {
  public convertToDatabaseValue(
    value: Money | string | null | undefined,
    _platform: Platform,
  ): string {
    if (!value) {
      return "0.00";
    }
    if (value instanceof Money) {
      return value.toString();
    }
    return value;
  }

  public convertToJSValue(
    value: string | null | undefined,
    _platform: Platform,
  ): Money {
    if (!value) {
      return Money.zero(Currency.BRL);
    }
    return Money.from({ amount: value, currency: Currency.BRL });
  }

  public getColumnType(_prop: EntityProperty, _platform: Platform): string {
    return "numeric(18, 2)";
  }
}
