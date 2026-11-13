import Decimal from "decimal.js";
import { Currency, CurrencyCode } from "../enums/currency.enum";
import {
  CurrencyMismatchError,
  InvalidMoneyValueError,
} from "../errors/domain.error";

export interface MoneyProps {
  readonly amount: string; // Decimal string, ex: "25.00"
  readonly currency: Currency | CurrencyCode | string; // ISO-4217, ex: "BRL"
}

export class Money {
  private static readonly DECIMAL_STRING_REGEX = /^-?\d+\.\d{2}$/;

  private constructor(
    private readonly value: Decimal,
    public readonly currency: CurrencyCode,
  ) {}

  /**
   * Factory method for creating Money from raw properties with strict validations.
   */
  public static from(props: MoneyProps): Money {
    if (!props || typeof props !== "object") {
      throw new InvalidMoneyValueError("Props must be an object");
    }

    const { amount, currency } = props;

    if (!currency || typeof currency !== "string") {
      throw new InvalidMoneyValueError("Currency must be a non-empty string");
    }

    const upperCurrency = currency.toUpperCase().trim();
    if (!Object.values(Currency).includes(upperCurrency as Currency)) {
      throw new InvalidMoneyValueError(
        `Unsupported or invalid currency code '${currency}'. Expected one of: ${Object.values(Currency).join(", ")}.`,
      );
    }

    if (typeof amount !== "string" || amount.trim() === "") {
      throw new InvalidMoneyValueError("Amount must be a non-empty string");
    }

    if (!this.DECIMAL_STRING_REGEX.test(amount)) {
      throw new InvalidMoneyValueError(
        `Amount '${amount}' is invalid. Must be a decimal string with exactly 2 decimal places (e.g. '25.00').`,
      );
    }

    let decimalVal: Decimal;
    try {
      decimalVal = new Decimal(amount);
    } catch {
      throw new InvalidMoneyValueError(`Cannot parse amount '${amount}' as decimal.`);
    }

    if (!decimalVal.isFinite()) {
      throw new InvalidMoneyValueError("Amount cannot be NaN or Infinity");
    }

    return new Money(decimalVal, upperCurrency as CurrencyCode);
  }

  /**
   * Factory for external input contracts: validates that the amount is strictly non-negative.
   */
  public static fromInput(props: MoneyProps): Money {
    const money = this.from(props);
    if (money.isNegative()) {
      throw new InvalidMoneyValueError(
        `Amount '${props.amount}' cannot be negative in request payloads.`,
      );
    }
    return money;
  }

  /**
   * Factory creating zero Money for the given currency.
   */
  public static zero(currency: Currency | CurrencyCode | string): Money {
    return this.from({ amount: "0.00", currency });
  }

  /**
   * Internal factory from an existing Decimal instance.
   */
  public static fromDecimal(
    decimal: Decimal,
    currency: Currency | CurrencyCode | string,
  ): Money {
    const upperCurrency = String(currency).toUpperCase().trim();
    return new Money(decimal, upperCurrency as CurrencyCode);
  }

  public add(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.value.plus(other.value), this.currency);
  }

  public subtract(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.value.minus(other.value), this.currency);
  }

  public negate(): Money {
    return new Money(this.value.negated(), this.currency);
  }

  public isZero(): boolean {
    return this.value.isZero();
  }

  public isPositive(): boolean {
    return this.value.isPositive() && !this.value.isZero();
  }

  public isNegative(): boolean {
    return this.value.isNegative() && !this.value.isZero();
  }

  public isLessThan(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.value.lessThan(other.value);
  }

  public isLessThanOrEqualTo(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.value.lessThanOrEqualTo(other.value);
  }

  public isGreaterThan(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.value.greaterThan(other.value);
  }

  public isGreaterThanOrEqualTo(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.value.greaterThanOrEqualTo(other.value);
  }

  public equals(other: Money): boolean {
    if (!other || this.currency !== other.currency) {
      return false;
    }
    return this.value.equals(other.value);
  }

  public toJSON(): { amount: string; currency: CurrencyCode } {
    return {
      amount: this.toString(),
      currency: this.currency,
    };
  }

  public toString(): string {
    return this.value.toFixed(2);
  }

  public toDecimal(): Decimal {
    return this.value;
  }

  private assertSameCurrency(other: Money): void {
    if (this.currency !== other.currency) {
      throw new CurrencyMismatchError(this.currency, other.currency);
    }
  }
}
