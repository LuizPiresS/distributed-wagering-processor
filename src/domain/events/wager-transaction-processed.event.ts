import { WagerTransactionKind } from "../enums/transaction-kind.enum";
import { MoneyProps } from "../value-objects/money.vo";
import { IntegrationEvent, IntegrationEventProps } from "./integration-event.base";

export interface WagerTransactionProcessedData {
  readonly transactionId: string;
  readonly providerId: string;
  readonly externalTransactionId: string;
  readonly playerId: string;
  readonly walletId: string;
  readonly roundId: string;
  readonly gameId: string;
  readonly kind: WagerTransactionKind;
  readonly money: MoneyProps;
  readonly referenceExternalTransactionId?: string;
  readonly referenceTransactionId?: string;
  readonly processedAt: string;
}

export class WagerTransactionProcessed extends IntegrationEvent<WagerTransactionProcessedData> {
  public readonly eventType = "WagerTransactionProcessed";
  public readonly version = 1;

  public constructor(props: IntegrationEventProps<WagerTransactionProcessedData>) {
    super(props);
  }
}

