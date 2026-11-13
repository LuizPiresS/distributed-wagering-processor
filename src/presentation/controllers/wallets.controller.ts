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
import {
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
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

@ApiTags("Wallets")
@Controller("wallets")
export class WalletsController {
  constructor(
    private readonly createWalletUseCase: CreateWalletUseCase,
    private readonly getWalletUseCase: GetWalletUseCase,
    private readonly getWalletLedgerUseCase: GetWalletLedgerUseCase,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: "Criar uma nova carteira para um jogador",
    description:
      "Inicializa a carteira com saldo inicial e moeda especificada, gravando atomicamente o lançamento OPENING no ledger permanente.",
  })
  @ApiResponse({ status: 201, description: "Carteira criada com sucesso." })
  @ApiResponse({
    status: 400,
    description: "Dados inválidos ou valor monetário malformado.",
  })
  @ApiResponse({
    status: 409,
    description: "Carteira já existente para o jogador e moeda.",
  })
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
  @ApiOperation({
    summary: "Consultar saldo e detalhes da carteira",
    description:
      "Retorna o saldo atual, moeda e versão atômica da carteira pelo seu UUID.",
  })
  @ApiParam({
    name: "walletId",
    description: "UUID da carteira",
    example: "3ba3d156-fcf4-4b57-a423-a55e2d6bce72",
  })
  @ApiResponse({ status: 200, description: "Carteira encontrada." })
  @ApiResponse({ status: 404, description: "Carteira não encontrada." })
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
  @ApiOperation({
    summary: "Consultar extrato contábil da carteira com cursor opaco",
    description:
      "Retorna os lançamentos append-only do ledger de forma ordenada e paginada através de cursor opaco em Base64.",
  })
  @ApiParam({
    name: "walletId",
    description: "UUID da carteira",
    example: "3ba3d156-fcf4-4b57-a423-a55e2d6bce72",
  })
  @ApiQuery({
    name: "cursor",
    required: false,
    description: "Cursor opaco de paginação",
  })
  @ApiQuery({
    name: "limit",
    required: false,
    description: "Quantidade máxima de registros (padrão 50)",
    example: 50,
  })
  @ApiResponse({
    status: 200,
    description: "Página de lançamentos do ledger retornada.",
  })
  @ApiResponse({ status: 404, description: "Carteira não encontrada." })
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

