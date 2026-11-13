import { WagerTransactionKind } from "../enums/transaction-kind.enum";
import { MoneyProps } from "../value-objects/money.vo";
import { IntegrationEvent, IntegrationEventProps } from "./integration-event.base";

export interface WagerTransactionPendingReferenceData {
  readonly transactionId: string;
  readonly providerId: string;
  readonly externalTransactionId: string;
  readonly playerId: string;
  readonly walletId: string;
  readonly roundId: string;
  readonly gameId: string;
  readonly kind: WagerTransactionKind;
  readonly money: MoneyProps;
  readonly referenceExternalTransactionId: string;
  readonly pendingSince: string;
}

export class WagerTransactionPendingReference extends IntegrationEvent<WagerTransactionPendingReferenceData> {
  public readonly eventType = "WagerTransactionPendingReference";
  public readonly version = 1;

  public constructor(
    props: IntegrationEventProps<WagerTransactionPendingReferenceData>,
  ) {
    super(props);
  }
}

