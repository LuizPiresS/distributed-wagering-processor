import { LedgerDirection, MoneyProps } from "../../domain";

export interface GetWalletLedgerDto {
  readonly walletId: string;
  readonly limit?: number;
  readonly cursor?: string;
}

export interface WalletLedgerItemDto {
  readonly id: string;
  readonly walletId: string;
  readonly transactionId: string;
  readonly direction: LedgerDirection;
  readonly amount: MoneyProps;
  readonly balanceBefore: MoneyProps;
  readonly balanceAfter: MoneyProps;
  readonly createdAt: string;
}

export interface GetWalletLedgerResult {
  readonly items: readonly WalletLedgerItemDto[];
  readonly nextCursor?: string;
  readonly hasMore: boolean;
}

