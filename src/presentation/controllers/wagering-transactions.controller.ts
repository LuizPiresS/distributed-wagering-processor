import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Headers,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Req,
  Res,
} from "@nestjs/common";
import {
  ApiBody,
  ApiHeader,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import type { Request, Response } from "express";
import { ProcessWagerTransactionDto } from "../../application/dto/process-wager.dto";
import {
  IdempotencyPayloadConflictError,
  InvalidPayloadError,
  TransactionNotFoundError,
  WalletNotFoundError,
} from "../../application/errors/application.error";
import { GetWagerTransactionUseCase } from "../../application/use-cases/get-wager-transaction.use-case";
import { ProcessWagerTransactionUseCase } from "../../application/use-cases/process-wager-transaction.use-case";
import {
  CurrencyMismatchError,
  InvalidMoneyValueError,
  WagerTransactionKind,
  WagerTransactionStatus,
} from "../../domain";

@ApiTags("Wagering Transactions")
@Controller("wagering/transactions")
export class WageringTransactionsController {
  constructor(
    private readonly processWagerUseCase: ProcessWagerTransactionUseCase,
    private readonly getWagerTransactionUseCase: GetWagerTransactionUseCase,
  ) {}

  @Post()
  @ApiOperation({
    summary: "Submeter transação de aposta (BET, WIN, LOSS, REFUND, ROLLBACK)",
    description:
      "Processa operações financeiras com garantia estrita de idempotência (header Idempotency-Key obrigatório), lock pessimista por carteira e publicação transacional no Outbox.",
  })
  @ApiHeader({
    name: "Idempotency-Key",
    description:
      "Chave única universal de idempotência (UUIDv4) para prevenir double-spending e replay fraudulento",
    required: true,
    example: "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
  })
  @ApiBody({ type: ProcessWagerTransactionDto })
  @ApiResponse({
    status: 201,
    description: "Transação financeira criada e processada com sucesso.",
  })
  @ApiResponse({
    status: 200,
    description:
      "Replay idempotente idêntico devolvido sem reprocessamento (idempotentReplay: true).",
  })
  @ApiResponse({
    status: 202,
    description:
      "Reversão fora de ordem aceita e estacionada aguardando o BET original (status: PENDING_REFERENCE).",
  })
  @ApiResponse({
    status: 400,
    description: "Payload inválido, moeda divergente ou violação de esquema.",
  })
  @ApiResponse({
    status: 409,
    description:
      "Conflito de idempotência: chave já utilizada com payload comercial divergente.",
  })
  @ApiResponse({
    status: 422,
    description:
      "Regra financeira violada (saldo insuficiente, rollback causador de saldo negativo).",
  })
  public async submitTransaction(
    @Headers("idempotency-key") idempotencyKeyHeader: string | undefined,
    @Body() body: any,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    // 1. Mandatory Idempotency-Key Header
    if (!idempotencyKeyHeader || !idempotencyKeyHeader.trim()) {
      throw new BadRequestException("Header 'Idempotency-Key' is mandatory.");
    }

    const idempotencyKey = idempotencyKeyHeader.trim();

    // 2. Validate payload fields
    if (!body || typeof body !== "object") {
      throw new BadRequestException("Invalid request body.");
    }

    const requiredFields = [
      "providerId",
      "externalTransactionId",
      "playerId",
      "walletId",
      "roundId",
      "gameId",
      "kind",
      "money",
    ];

    for (const field of requiredFields) {
      if (!body[field]) {
        throw new BadRequestException(`Field '${field}' is required.`);
      }
    }

    if (body.kind === WagerTransactionKind.Opening) {
      throw new BadRequestException(
        "Transaction kind 'OPENING' is internal and cannot be submitted via API.",
      );
    }

    const validKinds = Object.values(WagerTransactionKind);
    if (!validKinds.includes(body.kind)) {
      throw new BadRequestException(
        `Invalid transaction kind '${body.kind}'. Must be one of: ${validKinds.join(", ")}`,
      );
    }

    if (!body.money.amount || !body.money.currency) {
      throw new BadRequestException(
        "money must contain 'amount' and 'currency' properties.",
      );
    }

    const correlationId =
      body.correlationId || req.correlationId || idempotencyKey;

    const dto: ProcessWagerTransactionDto = {
      idempotencyKey,
      providerId: body.providerId,
      externalTransactionId: body.externalTransactionId,
      playerId: body.playerId,
      walletId: body.walletId,
      roundId: body.roundId,
      gameId: body.gameId,
      kind: body.kind,
      money: body.money,
      referenceExternalTransactionId: body.referenceExternalTransactionId,
      correlationId,
    };

    try {
      const result = await this.processWagerUseCase.execute(dto);

      if (result.status === WagerTransactionStatus.Processed) {
        const httpStatus = result.idempotentReplay
          ? HttpStatus.OK
          : HttpStatus.CREATED;
        return res.status(httpStatus).json(result);
      }

      if (result.status === WagerTransactionStatus.PendingReference) {
        return res.status(HttpStatus.ACCEPTED).json(result);
      }

      if (result.status === WagerTransactionStatus.Rejected) {
        return res.status(HttpStatus.UNPROCESSABLE_ENTITY).json(result);
      }

      return res.status(HttpStatus.OK).json(result);
    } catch (error) {
      if (error instanceof IdempotencyPayloadConflictError) {
        throw new ConflictException(error.message);
      }
      if (error instanceof WalletNotFoundError) {
        throw new NotFoundException(error.message);
      }
      if (
        error instanceof InvalidMoneyValueError ||
        error instanceof InvalidPayloadError ||
        error instanceof CurrencyMismatchError
      ) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }

  @Get(":transactionId")
  @ApiOperation({
    summary: "Consultar transação de aposta pelo ID interno",
    description:
      "Retorna os detalhes, status e histórico da transação registrada no processador.",
  })
  @ApiParam({
    name: "transactionId",
    description: "UUID da transação interna",
    example: "45f47285-b9b5-410e-8f24-db0cbff51307",
  })
  @ApiResponse({ status: 200, description: "Transação encontrada." })
  @ApiResponse({ status: 404, description: "Transação não encontrada." })
  public async getTransaction(@Param("transactionId") transactionId: string) {
    try {
      return await this.getWagerTransactionUseCase.execute(transactionId);
    } catch (error) {
      if (error instanceof TransactionNotFoundError) {
        throw new NotFoundException(error.message);
      }
      throw error;
    }
  }
}
