import {
  CurrencyMismatchError,
  InsufficientFundsError,
  InvalidMoneyValueError,
  WalletRuleViolationError,
} from "../errors/domain.error";
import { Money, MoneyProps } from "../value-objects/money.vo";

export interface OpenWalletProps {
  readonly id: string;
  readonly playerId: string;
  readonly initialBalance: Money;
  readonly createdAt?: Date;
}

export interface WalletState {
  readonly id: string;
  readonly playerId: string;
  readonly currency: string;
  readonly balanceAmount: string;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface BalanceMutationResult {
  readonly balanceBefore: Money;
  readonly balanceAfter: Money;
  readonly versionBefore: number;
  readonly versionAfter: number;
}

export class Wallet {
  private constructor(
    public readonly id: string,
    public readonly playerId: string,
    public readonly currency: string,
    private _balance: Money,
    private _version: number,
    public readonly createdAt: Date,
    private _updatedAt: Date,
  ) {}

  /**
   * Factory method to open a new Wallet.
   */
  public static open(props: OpenWalletProps): Wallet {
    if (!props.id || !props.playerId) {
      throw new WalletRuleViolationError("Wallet requires both id and playerId.");
    }

    if (!props.initialBalance) {
      throw new InvalidMoneyValueError("Initial balance is required.");
    }

    if (props.initialBalance.isNegative()) {
      throw new InvalidMoneyValueError("Initial balance cannot be negative.");
    }

    const now = props.createdAt || new Date();

    return new Wallet(
      props.id,
      props.playerId,
      props.initialBalance.currency,
      props.initialBalance,
      1, // Version starts at 1
      now,
      now,
    );
  }

  /**
   * Rehydrates a Wallet from persistent state without re-evaluating opening logic.
   */
  public static rehydrate(state: WalletState): Wallet {
    const balance = Money.from({
      amount: state.balanceAmount,
      currency: state.currency,
    });

    return new Wallet(
      state.id,
      state.playerId,
      state.currency,
      balance,
      state.version,
      state.createdAt,
      state.updatedAt,
    );
  }

  public get balance(): Money {
    return this._balance;
  }

  public get version(): number {
    return this._version;
  }

  public get updatedAt(): Date {
    return this._updatedAt;
  }

  /**
   * Applies a debit operation on the wallet.
   * Decreases balance and increments version only if sufficient funds exist.
   */
  public debit(money: Money, at: Date = new Date()): BalanceMutationResult {
    this.assertSameCurrency(money);

    if (!money.isPositive()) {
      throw new InvalidMoneyValueError("Debit amount must be strictly positive.");
    }

    if (this._balance.isLessThan(money)) {
      throw new InsufficientFundsError(
        this.id,
        this._balance.toString(),
        money.toString(),
      );
    }

    const balanceBefore = this._balance;
    const versionBefore = this._version;

    this._balance = this._balance.subtract(money);
    this._version++;
    this._updatedAt = at;

    return {
      balanceBefore,
      balanceAfter: this._balance,
      versionBefore,
      versionAfter: this._version,
    };
  }

  /**
   * Applies a credit operation on the wallet.
   * Increases balance and increments version.
   */
  public credit(money: Money, at: Date = new Date()): BalanceMutationResult {
    this.assertSameCurrency(money);

    if (!money.isPositive()) {
      throw new InvalidMoneyValueError("Credit amount must be strictly positive.");
    }

    const balanceBefore = this._balance;
    const versionBefore = this._version;

    this._balance = this._balance.add(money);
    this._version++;
    this._updatedAt = at;

    return {
      balanceBefore,
      balanceAfter: this._balance,
      versionBefore,
      versionAfter: this._version,
    };
  }

  public toJSON(): {
    id: string;
    playerId: string;
    currency: string;
    balance: MoneyProps;
    version: number;
    createdAt: string;
    updatedAt: string;
  } {
    return {
      id: this.id,
      playerId: this.playerId,
      currency: this.currency,
      balance: this._balance.toJSON(),
      version: this._version,
      createdAt: this.createdAt.toISOString(),
      updatedAt: this._updatedAt.toISOString(),
    };
  }

  private assertSameCurrency(money: Money): void {
    if (this.currency !== money.currency) {
      throw new CurrencyMismatchError(this.currency, money.currency);
    }
  }
}

