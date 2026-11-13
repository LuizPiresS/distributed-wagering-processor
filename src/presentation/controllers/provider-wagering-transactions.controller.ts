import {
  Controller,
  Get,
  NotFoundException,
  Param,
} from "@nestjs/common";
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from "@nestjs/swagger";
import { TransactionNotFoundError } from "../../application/errors/application.error";
import { GetWagerTransactionUseCase } from "../../application/use-cases/get-wager-transaction.use-case";

@ApiTags("Wagering Transactions")
@Controller("providers/:providerId/wagering/transactions")
export class ProviderWageringTransactionsController {
  constructor(
    private readonly getWagerTransactionUseCase: GetWagerTransactionUseCase,
  ) {}

  @Get(":externalTransactionId")
  @ApiOperation({
    summary: "Consultar transação pelo ID externo do provedor",
    description:
      "Permite que provedores parceiros auditem e reconciliem transações utilizando seu próprio externalTransactionId.",
  })
  @ApiParam({
    name: "providerId",
    description: "Identificador do provedor",
    example: "pragmatic_play",
  })
  @ApiParam({
    name: "externalTransactionId",
    description: "ID externo da transação no provedor",
    example: "tx-ext-8842194",
  })
  @ApiResponse({ status: 200, description: "Transação encontrada." })
  @ApiResponse({
    status: 404,
    description: "Transação não encontrada para este provedor.",
  })
  public async getByExternalId(
    @Param("providerId") providerId: string,
    @Param("externalTransactionId") externalTransactionId: string
  ) {
    try {
      return await this.getWagerTransactionUseCase.executeByExternalId(
        providerId,
        externalTransactionId
      );
    } catch (error) {
      if (error instanceof TransactionNotFoundError) {
        throw new NotFoundException(error.message);
      }
      throw error;
    }
  }
}
