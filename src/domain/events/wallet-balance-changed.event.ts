import { LedgerDirection } from "../enums/ledger-direction.enum";
import { MoneyProps } from "../value-objects/money.vo";
import { IntegrationEvent, IntegrationEventProps } from "./integration-event.base";

export interface WalletBalanceChangedData {
  readonly walletId: string;
  readonly transactionId: string;
  readonly direction: LedgerDirection;
  readonly money: MoneyProps;
  readonly balanceBefore: MoneyProps;
  readonly balanceAfter: MoneyProps;
  readonly walletVersion: number;
}

export class WalletBalanceChanged extends IntegrationEvent<WalletBalanceChangedData> {
  public readonly eventType = "WalletBalanceChanged";
  public readonly version = 1;

  public constructor(props: IntegrationEventProps<WalletBalanceChangedData>) {
    super(props);
  }
}

