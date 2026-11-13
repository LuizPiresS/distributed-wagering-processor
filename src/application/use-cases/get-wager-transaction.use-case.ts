import { EntityManager } from "@mikro-orm/postgresql";
import { Injectable } from "@nestjs/common";
import { FailureCode, MoneyProps, WagerTransactionKind, WagerTransactionStatus } from "../../domain";
import { WagerTransactionOrmEntity } from "../../infrastructure/database/entities";
import { TransactionNotFoundError } from "../errors/application.error";

export interface GetWagerTransactionResult {
  readonly id: string;
  readonly providerId: string;
  readonly externalTransactionId: string;
  readonly idempotencyKey: string;
  readonly walletId: string;
  readonly playerId: string;
  readonly roundId: string;
  readonly gameId: string;
  readonly kind: WagerTransactionKind;
  readonly money: MoneyProps;
  readonly status: WagerTransactionStatus;
  readonly failureCode?: FailureCode;
  readonly referenceExternalTransactionId?: string;
  readonly referenceTransactionId?: string;
  readonly createdAt: string;
  readonly processedAt?: string;
}

@Injectable()
export class GetWagerTransactionUseCase {
  constructor(private readonly em: EntityManager) {}

  public async execute(transactionId: string): Promise<GetWagerTransactionResult> {
    const tx = await this.em.findOne(WagerTransactionOrmEntity, {
      id: transactionId,
    });

    if (!tx) {
      throw new TransactionNotFoundError(transactionId);
    }

    return this.mapToResult(tx);
  }

  public async executeByExternalId(
    providerId: string,
    externalTransactionId: string
  ): Promise<GetWagerTransactionResult> {
    const tx = await this.em.findOne(WagerTransactionOrmEntity, {
      providerId,
      externalTransactionId,
    });

    if (!tx) {
      throw new TransactionNotFoundError(
        `provider: ${providerId}, externalTransactionId: ${externalTransactionId}`
      );
    }

    return this.mapToResult(tx);
  }

  private mapToResult(tx: WagerTransactionOrmEntity): GetWagerTransactionResult {
    return {
      id: tx.id,
      providerId: tx.providerId,
      externalTransactionId: tx.externalTransactionId,
      idempotencyKey: tx.idempotencyKey,
      walletId: tx.walletId,
      playerId: tx.playerId,
      roundId: tx.roundId,
      gameId: tx.gameId,
      kind: tx.kind,
      money: tx.amount.toJSON(),
      status: tx.status,
      failureCode: tx.failureCode,
      referenceExternalTransactionId: tx.referenceExternalTransactionId,
      referenceTransactionId: tx.referenceTransactionId,
      createdAt: tx.createdAt.toISOString(),
      processedAt: tx.processedAt?.toISOString(),
    };
  }
}

