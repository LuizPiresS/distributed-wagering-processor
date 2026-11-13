import {
  Controller,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
} from "@nestjs/common";
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from "@nestjs/swagger";
import { WalletNotFoundError } from "../../application/errors/application.error";
import { ReconcileWalletUseCase } from "../../application/use-cases/reconcile-wallet.use-case";

@ApiTags("Wallets")
@Controller("wallets/:walletId/reconciliation")
export class ReconciliationController {
  constructor(private readonly reconcileWalletUseCase: ReconcileWalletUseCase) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Auditar e reconciliar saldo da carteira contra o Ledger",
    description:
      "Executa agregação atômica em SQL recalculando todo o extrato contábil permanente. Retorna 200 OK com consistent: true se divergência for zero. Não realiza autocorreção silenciosa em caso de divergência.",
  })
  @ApiParam({
    name: "walletId",
    description: "UUID da carteira",
    example: "3ba3d156-fcf4-4b57-a423-a55e2d6bce72",
  })
  @ApiResponse({
    status: 200,
    description: "Auditoria contábil realizada com sucesso.",
  })
  @ApiResponse({ status: 404, description: "Carteira não encontrada." })
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

