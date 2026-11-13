import { MoneyProps } from "../../domain";

export interface ReconcileWalletDto {
  readonly walletId: string;
}

export interface ReconcileWalletResult {
  readonly walletId: string;
  readonly currency: string;
  readonly storedBalance: MoneyProps;
  readonly calculatedBalance: MoneyProps;
  readonly difference: MoneyProps;
  readonly consistent: boolean;
  readonly checkedEntries: number;
}

