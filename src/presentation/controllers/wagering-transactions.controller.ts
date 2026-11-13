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

@Controller("wagering/transactions")
export class WageringTransactionsController {
  constructor(
    private readonly processWagerUseCase: ProcessWagerTransactionUseCase,
    private readonly getWagerTransactionUseCase: GetWagerTransactionUseCase,
  ) {}

  @Post()
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
