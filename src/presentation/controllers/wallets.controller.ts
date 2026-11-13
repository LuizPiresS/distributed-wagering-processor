import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Query,
} from "@nestjs/common";
import { CreateWalletDto } from "../../application/dto/create-wallet.dto";
import {
  InvalidPayloadError,
  WalletConflictError,
  WalletNotFoundError,
} from "../../application/errors/application.error";
import { CreateWalletUseCase } from "../../application/use-cases/create-wallet.use-case";
import { GetWalletLedgerUseCase } from "../../application/use-cases/get-wallet-ledger.use-case";
import { GetWalletUseCase } from "../../application/use-cases/get-wallet.use-case";
import { InvalidMoneyValueError } from "../../domain";

@Controller("wallets")
export class WalletsController {
  constructor(
    private readonly createWalletUseCase: CreateWalletUseCase,
    private readonly getWalletUseCase: GetWalletUseCase,
    private readonly getWalletLedgerUseCase: GetWalletLedgerUseCase,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  public async createWallet(@Body() body: CreateWalletDto) {
    if (!body || !body.playerId || !body.initialBalance) {
      throw new BadRequestException("playerId and initialBalance are required.");
    }

    try {
      return await this.createWalletUseCase.execute(body);
    } catch (error) {
      if (error instanceof WalletConflictError) {
        throw new ConflictException(error.message);
      }
      if (error instanceof InvalidMoneyValueError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }

  @Get(":walletId")
  public async getWallet(@Param("walletId") walletId: string) {
    try {
      return await this.getWalletUseCase.execute(walletId);
    } catch (error) {
      if (error instanceof WalletNotFoundError) {
        throw new NotFoundException(error.message);
      }
      throw error;
    }
  }

  @Get(":walletId/ledger")
  public async getLedger(
    @Param("walletId") walletId: string,
    @Query("cursor") cursor?: string,
    @Query("limit") limit?: string,
  ) {
    try {
      const parsedLimit = limit ? parseInt(limit, 10) : 50;
      return await this.getWalletLedgerUseCase.execute({
        walletId,
        cursor,
        limit: parsedLimit,
      });
    } catch (error) {
      if (error instanceof WalletNotFoundError) {
        throw new NotFoundException(error.message);
      }
      if (error instanceof InvalidPayloadError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }
}

