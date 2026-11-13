import { LedgerDirection } from "../enums/ledger-direction.enum";
import {
  CurrencyMismatchError,
  InvalidMoneyValueError,
  UnbalancedLedgerEntryError,
} from "../errors/domain.error";
import { Money, MoneyProps } from "../value-objects/money.vo";

export interface CreateLedgerEntryProps {
  readonly id: string;
  readonly walletId: string;
  readonly transactionId: string;
  readonly direction: LedgerDirection;
  readonly money: Money;
  readonly balanceBefore: Money;
  readonly balanceAfter: Money;
  readonly createdAt?: Date;
}

export interface LedgerEntryState {
  readonly id: string;
  readonly walletId: string;
  readonly transactionId: string;
  readonly direction: LedgerDirection;
  readonly amount: string;
  readonly currency: string;
  readonly balanceBeforeAmount: string;
  readonly balanceAfterAmount: string;
  readonly createdAt: Date;
}

export class WalletLedgerEntry {
  private constructor(
    public readonly id: string,
    public readonly walletId: string,
    public readonly transactionId: string,
    public readonly direction: LedgerDirection,
    public readonly money: Money,
    public readonly balanceBefore: Money,
    public readonly balanceAfter: Money,
    public readonly createdAt: Date,
  ) {}

  /**
   * Factory method to create a new Ledger Entry with strict arithmetic consistency check.
   */
  public static create(props: CreateLedgerEntryProps): WalletLedgerEntry {
    if (!props.id || !props.walletId || !props.transactionId) {
      throw new UnbalancedLedgerEntryError("Ledger entry requires id, walletId, and transactionId");
    }

    if (!props.money.isPositive()) {
      throw new InvalidMoneyValueError(
        `Ledger amount must be strictly positive, received '${props.money.toString()}'`,
      );
    }

    if (
      props.money.currency !== props.balanceBefore.currency ||
      props.money.currency !== props.balanceAfter.currency
    ) {
      throw new CurrencyMismatchError(
        props.balanceBefore.currency,
        props.money.currency,
      );
    }

    const entry = new WalletLedgerEntry(
      props.id,
      props.walletId,
      props.transactionId,
      props.direction,
      props.money,
      props.balanceBefore,
      props.balanceAfter,
      props.createdAt || new Date(),
    );

    if (!entry.isBalanced()) {
      const expected =
        entry.direction === LedgerDirection.Credit
          ? entry.balanceBefore.add(entry.money).toString()
          : entry.balanceBefore.subtract(entry.money).toString();

      throw new UnbalancedLedgerEntryError(
        `Arithmetic check failed for ${entry.direction}: balanceBefore (${entry.balanceBefore.toString()}) ` +
          `with money (${entry.money.toString()}) must equal balanceAfter (${entry.balanceAfter.toString()}), expected ${expected}.`,
      );
    }

    return entry;
  }

  /**
   * Rehydrates an existing entry from persistence without re-running transition checks.
   */
  public static rehydrate(state: LedgerEntryState): WalletLedgerEntry {
    const money = Money.from({ amount: state.amount, currency: state.currency });
    const balanceBefore = Money.from({
      amount: state.balanceBeforeAmount,
      currency: state.currency,
    });
    const balanceAfter = Money.from({
      amount: state.balanceAfterAmount,
      currency: state.currency,
    });

    return new WalletLedgerEntry(
      state.id,
      state.walletId,
      state.transactionId,
      state.direction,
      money,
      balanceBefore,
      balanceAfter,
      state.createdAt,
    );
  }

  /**
   * Verifies that balanceBefore ± money === balanceAfter.
   */
  public isBalanced(): boolean {
    if (this.direction === LedgerDirection.Credit) {
      return this.balanceBefore.add(this.money).equals(this.balanceAfter);
    }
    return this.balanceBefore.subtract(this.money).equals(this.balanceAfter);
  }

  public toJSON(): {
    id: string;
    walletId: string;
    transactionId: string;
    direction: LedgerDirection;
    money: MoneyProps;
    balanceBefore: MoneyProps;
    balanceAfter: MoneyProps;
    createdAt: string;
  } {
    return {
      id: this.id,
      walletId: this.walletId,
      transactionId: this.transactionId,
      direction: this.direction,
      money: this.money.toJSON(),
      balanceBefore: this.balanceBefore.toJSON(),
      balanceAfter: this.balanceAfter.toJSON(),
      createdAt: this.createdAt.toISOString(),
    };
  }
}

