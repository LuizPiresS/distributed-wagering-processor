import {
  Controller,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
} from "@nestjs/common";
import { WalletNotFoundError } from "../../application/errors/application.error";
import { ReconcileWalletUseCase } from "../../application/use-cases/reconcile-wallet.use-case";

@Controller("wallets/:walletId/reconciliation")
export class ReconciliationController {
  constructor(private readonly reconcileWalletUseCase: ReconcileWalletUseCase) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  public async reconcile(@Param("walletId") walletId: string) {
    try {
      return await this.reconcileWalletUseCase.execute({ walletId });
    } catch (error) {
      if (error instanceof WalletNotFoundError) {
        throw new NotFoundException(error.message);
      }
      throw error;
    }
  }
}

