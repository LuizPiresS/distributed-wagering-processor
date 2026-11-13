import {
  FailureCode,
  MoneyProps,
  WagerTransactionKind,
  WagerTransactionStatus,
} from "../../domain";

export class ProcessWagerTransactionDto {
  public readonly idempotencyKey!: string;
  public readonly providerId!: string;
  public readonly externalTransactionId!: string;
  public readonly playerId!: string;
  public readonly walletId!: string;
  public readonly roundId!: string;
  public readonly gameId!: string;
  public readonly kind!: WagerTransactionKind;
  public readonly money!: MoneyProps;
  public readonly referenceExternalTransactionId?: string;
  public readonly correlationId?: string;
}

export interface ProcessWagerTransactionResult {
  readonly transactionId: string;
  readonly status: WagerTransactionStatus;
  readonly balance: MoneyProps;
  readonly idempotentReplay: boolean;
  readonly failureCode?: FailureCode;
}
