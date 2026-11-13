import {
  Controller,
  Get,
  NotFoundException,
  Param,
} from "@nestjs/common";
import { TransactionNotFoundError } from "../../application/errors/application.error";
import { GetWagerTransactionUseCase } from "../../application/use-cases/get-wager-transaction.use-case";

@Controller("providers/:providerId/wagering/transactions")
export class ProviderWageringTransactionsController {
  constructor(
    private readonly getWagerTransactionUseCase: GetWagerTransactionUseCase
  ) {}

  @Get(":externalTransactionId")
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
