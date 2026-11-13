import { LockMode } from "@mikro-orm/core";
import { EntityManager } from "@mikro-orm/postgresql";
import { Injectable, Logger } from "@nestjs/common";
import { v4 as uuidv4 } from "uuid";
import {
  FailureCode,
  LedgerDirection,
  OutboxMessage,
  WagerTransactionKind,
  WagerTransactionProcessed,
  WagerTransactionRejected,
  WagerTransactionStatus,
  WalletBalanceChanged,
  WalletLedgerEntry,
} from "../../../domain";
import {
  OutboxMessageOrmEntity,
  WagerTransactionOrmEntity,
  WalletLedgerEntryOrmEntity,
  WalletOrmEntity,
} from "../../database/entities";

@Injectable()
export class PendingReferenceWorker {
  private readonly logger = new Logger(PendingReferenceWorker.name);
  private maxPendingAgeMs = 15 * 60 * 1000; // 15 minutes TTL

  constructor(private readonly em: EntityManager) {}

  public setMaxPendingAgeMs(ms: number): void {
    this.maxPendingAgeMs = ms;
  }

  /**
   * Scans and resolves transactions waiting in PENDING_REFERENCE status.
   * Uses FOR UPDATE SKIP LOCKED to allow safe concurrent execution across multiple workers.
   */
  public async processBatch(batchSize = 20): Promise<number> {
    return await this.em.transactional(async (em) => {
      // 1. Fetch pending reference transactions with SKIP LOCKED
      const pendingTxs = await em.find(
        WagerTransactionOrmEntity,
        {
          status: WagerTransactionStatus.PendingReference,
        },
        {
          orderBy: { createdAt: "ASC" },
          limit: batchSize,
          lockMode: LockMode.PESSIMISTIC_PARTIAL_WRITE,
        },
      );

      if (pendingTxs.length === 0) {
        return 0;
      }

      let resolvedCount = 0;
      const now = new Date();

      for (const txOrm of pendingTxs) {
        if (!txOrm.referenceExternalTransactionId) {
          continue;
        }

        // 2. Try to find referenced transaction
        const refTx = await em.findOne(WagerTransactionOrmEntity, {
          providerId: txOrm.providerId,
          externalTransactionId: txOrm.referenceExternalTransactionId,
        });

        if (refTx && refTx.status === WagerTransactionStatus.Processed) {
          // Referenced transaction has arrived and is processed! Resolve now.
          const walletOrm = await em.findOne(
            WalletOrmEntity,
            { id: txOrm.walletId },
            { lockMode: LockMode.PESSIMISTIC_WRITE },
          );

          if (!walletOrm) {
            continue;
          }

          const wallet = walletOrm.toDomain();
          const txMoney = txOrm.amount;
          const balanceBefore = wallet.balance;
          let ledgerDirection: LedgerDirection | null = null;
          let isProcessed = false;

          if (txOrm.kind === WagerTransactionKind.Refund) {
            // Refund of a debit: credits wallet
            wallet.credit(txMoney);
            ledgerDirection = LedgerDirection.Credit;
            isProcessed = true;
          } else if (txOrm.kind === WagerTransactionKind.Rollback) {
            // Determine direction based on referenced transaction
            if (refTx.kind === WagerTransactionKind.Win) {
              // Rollback of credit -> debit
              if (wallet.balance.isLessThan(txMoney)) {
                // Reject due to negative balance protection
                txOrm.status = WagerTransactionStatus.Rejected;
                txOrm.failureCode = FailureCode.ROLLBACK_WOULD_CAUSE_NEGATIVE_BALANCE;
                txOrm.processedAt = now;
                txOrm.referenceTransactionId = refTx.id;

                const event = new WagerTransactionRejected({
                  eventId: uuidv4(),
                  aggregateId: wallet.id,
                  correlationId: txOrm.id,
                  occurredAt: now,
                  data: {
                    transactionId: txOrm.id,
                    providerId: txOrm.providerId,
                    externalTransactionId: txOrm.externalTransactionId,
                    playerId: txOrm.playerId,
                    walletId: txOrm.walletId,
                    roundId: txOrm.roundId,
                    gameId: txOrm.gameId,
                    kind: txOrm.kind,
                    money: txMoney.toJSON(),
                    failureCode: FailureCode.ROLLBACK_WOULD_CAUSE_NEGATIVE_BALANCE,
                    rejectedAt: now.toISOString(),
                  },
                });
                em.persist(OutboxMessageOrmEntity.fromDomain(OutboxMessage.enqueue(event)));
                resolvedCount++;
                continue;
              } else {
                wallet.debit(txMoney);
                ledgerDirection = LedgerDirection.Debit;
                isProcessed = true;
              }
            } else {
              // Rollback of debit -> credit
              wallet.credit(txMoney);
              ledgerDirection = LedgerDirection.Credit;
              isProcessed = true;
            }
          } else if (txOrm.kind === WagerTransactionKind.Win) {
            wallet.credit(txMoney);
            ledgerDirection = LedgerDirection.Credit;
            isProcessed = true;
          }

          if (isProcessed && ledgerDirection) {
            const balanceAfter = wallet.balance;
            walletOrm.balance = wallet.balance;
            walletOrm.version = wallet.version;
            walletOrm.updatedAt = now;

            txOrm.status = WagerTransactionStatus.Processed;
            txOrm.referenceTransactionId = refTx.id;
            txOrm.processedAt = now;

            const ledgerEntry = WalletLedgerEntry.create({
              id: uuidv4(),
              walletId: wallet.id,
              transactionId: txOrm.id,
              direction: ledgerDirection,
              money: txMoney,
              balanceBefore,
              balanceAfter,
              createdAt: now,
            });
            em.persist(WalletLedgerEntryOrmEntity.fromDomain(ledgerEntry));

            const balanceEvent = new WalletBalanceChanged({
              eventId: uuidv4(),
              aggregateId: wallet.id,
              correlationId: txOrm.id,
              occurredAt: now,
              data: {
                walletId: wallet.id,
                transactionId: txOrm.id,
                direction: ledgerDirection,
                money: txMoney.toJSON(),
                balanceBefore: balanceBefore.toJSON(),
                balanceAfter: balanceAfter.toJSON(),
                walletVersion: wallet.version,
              },
            });
            const processedEvent = new WagerTransactionProcessed({
              eventId: uuidv4(),
              aggregateId: wallet.id,
              correlationId: txOrm.id,
              occurredAt: now,
              data: {
                transactionId: txOrm.id,
                providerId: txOrm.providerId,
                externalTransactionId: txOrm.externalTransactionId,
                playerId: txOrm.playerId,
                walletId: txOrm.walletId,
                roundId: txOrm.roundId,
                gameId: txOrm.gameId,
                kind: txOrm.kind,
                money: txMoney.toJSON(),
                referenceExternalTransactionId: txOrm.referenceExternalTransactionId,
                referenceTransactionId: refTx.id,
                processedAt: now.toISOString(),
              },
            });

            em.persist(OutboxMessageOrmEntity.fromDomain(OutboxMessage.enqueue(balanceEvent)));
            em.persist(OutboxMessageOrmEntity.fromDomain(OutboxMessage.enqueue(processedEvent)));

            resolvedCount++;
          }
        } else {
          // Referenced transaction still not present. Check TTL expiration.
          const ageMs = now.getTime() - txOrm.createdAt.getTime();
          if (ageMs > this.maxPendingAgeMs) {
            // Expired TTL: Reject as REFERENCE_NOT_FOUND
            txOrm.status = WagerTransactionStatus.Rejected;
            txOrm.failureCode = FailureCode.REFERENCE_NOT_FOUND;
            txOrm.processedAt = now;

            const rejectEvent = new WagerTransactionRejected({
              eventId: uuidv4(),
              aggregateId: txOrm.walletId,
              correlationId: txOrm.id,
              occurredAt: now,
              data: {
                transactionId: txOrm.id,
                providerId: txOrm.providerId,
                externalTransactionId: txOrm.externalTransactionId,
                playerId: txOrm.playerId,
                walletId: txOrm.walletId,
                roundId: txOrm.roundId,
                gameId: txOrm.gameId,
                kind: txOrm.kind,
                money: txOrm.amount.toJSON(),
                failureCode: FailureCode.REFERENCE_NOT_FOUND,
                rejectedAt: now.toISOString(),
              },
            });
            em.persist(OutboxMessageOrmEntity.fromDomain(OutboxMessage.enqueue(rejectEvent)));

            this.logger.warn(
              JSON.stringify({
                event: "pending_reference_ttl_expired",
                transactionId: txOrm.id,
                providerId: txOrm.providerId,
                referenceExternalTransactionId: txOrm.referenceExternalTransactionId,
                failureCode: FailureCode.REFERENCE_NOT_FOUND,
              }),
            );

            resolvedCount++;
          }
        }
      }

      return resolvedCount;
    });
  }
}
