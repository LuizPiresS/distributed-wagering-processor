import { FailureCode } from "../enums/failure-code.enum";
import { WagerTransactionKind } from "../enums/transaction-kind.enum";
import { MoneyProps } from "../value-objects/money.vo";
import { IntegrationEvent, IntegrationEventProps } from "./integration-event.base";

export interface WagerTransactionRejectedData {
  readonly transactionId: string;
  readonly providerId: string;
  readonly externalTransactionId: string;
  readonly playerId: string;
  readonly walletId: string;
  readonly roundId: string;
  readonly gameId: string;
  readonly kind: WagerTransactionKind;
  readonly money: MoneyProps;
  readonly failureCode: FailureCode;
  readonly rejectedAt: string;
}

export class WagerTransactionRejected extends IntegrationEvent<WagerTransactionRejectedData> {
  public readonly eventType = "WagerTransactionRejected";
  public readonly version = 1;

  public constructor(props: IntegrationEventProps<WagerTransactionRejectedData>) {
    super(props);
  }
}

