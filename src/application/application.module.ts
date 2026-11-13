import { Module } from "@nestjs/common";
import { CreateWalletUseCase } from "./use-cases/create-wallet.use-case";
import { GetWagerTransactionUseCase } from "./use-cases/get-wager-transaction.use-case";
import { GetWalletLedgerUseCase } from "./use-cases/get-wallet-ledger.use-case";
import { GetWalletUseCase } from "./use-cases/get-wallet.use-case";
import { ProcessWagerTransactionUseCase } from "./use-cases/process-wager-transaction.use-case";
import { ReconcileWalletUseCase } from "./use-cases/reconcile-wallet.use-case";

@Module({
  providers: [
    CreateWalletUseCase,
    ProcessWagerTransactionUseCase,
    GetWalletUseCase,
    GetWalletLedgerUseCase,
    ReconcileWalletUseCase,
    GetWagerTransactionUseCase,
  ],
  exports: [
    CreateWalletUseCase,
    ProcessWagerTransactionUseCase,
    GetWalletUseCase,
    GetWalletLedgerUseCase,
    ReconcileWalletUseCase,
    GetWagerTransactionUseCase,
  ],
})
export class ApplicationModule {}

