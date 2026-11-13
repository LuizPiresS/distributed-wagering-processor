import { LockMode } from "@mikro-orm/core";
import { EntityManager } from "@mikro-orm/postgresql";
import { Injectable, Optional } from "@nestjs/common";
import { v4 as uuidv4 } from "uuid";
import {
  CurrencyMismatchError,
  FailureCode,
  IntegrationEvent,
  LedgerDirection,
  Money,
  OutboxMessage,
  WagerTransaction,
  WagerTransactionKind,
  WagerTransactionPendingReference,
  WagerTransactionProcessed,
  WagerTransactionRejected,
  WagerTransactionStatus,
  WalletBalanceChanged,
  WalletLedgerEntry,
} from "../../domain";
import {
  OutboxMessageOrmEntity,
  WagerTransactionOrmEntity,
  WalletLedgerEntryOrmEntity,
  WalletOrmEntity,
} from "../../infrastructure/database/entities";
import { MetricsService } from "../../infrastructure/observability/metrics.service";
import { computeCanonicalPayloadHash } from "../../infrastructure/security/canonical-hash";
import {
  ProcessWagerTransactionDto,
  ProcessWagerTransactionResult,
} from "../dto/process-wager.dto";
import {
  IdempotencyPayloadConflictError,
  InvalidPayloadError,
  WalletNotFoundError,
} from "../errors/application.error";

@Injectable()
export class ProcessWagerTransactionUseCase {
  constructor(
    private readonly em: EntityManager,
    @Optional() private readonly metricsService?: MetricsService
  ) {}

  public async execute(
    dto: ProcessWagerTransactionDto,
    emContext?: EntityManager
  ): Promise<ProcessWagerTransactionResult> {
    const startTime = Date.now();
    try {
      const result = await this.executeInternal(dto, emContext);
      if (result.idempotentReplay) {
        this.metricsService?.incrementDuplicateDetected();
      }
      this.metricsService?.incrementTransaction(result.status);
      return result;
    } catch (err: any) {
      if (
        err?.name === "LockNotAvailableException" ||
        err?.message?.includes("deadlock") ||
        err?.code === "40P01"
      ) {
        this.metricsService?.incrementLockConflict();
      }
      throw err;
    } finally {
      this.metricsService?.recordProcessingLatency(Date.now() - startTime);
    }
  }

  private async executeInternal(
    dto: ProcessWagerTransactionDto,
    emContext?: EntityManager
  ): Promise<ProcessWagerTransactionResult> {
    if (dto.kind === WagerTransactionKind.Opening) {
      throw new InvalidPayloadError(
        "Transaction kind 'OPENING' is internal and cannot be submitted externally."
      );
    }

    const payloadHash = computeCanonicalPayloadHash({
      providerId: dto.providerId,
      externalTransactionId: dto.externalTransactionId,
      playerId: dto.playerId,
      walletId: dto.walletId,
      roundId: dto.roundId,
      gameId: dto.gameId,
      kind: dto.kind,
      money: dto.money,
      referenceExternalTransactionId: dto.referenceExternalTransactionId,
    });

    const correlationId = dto.correlationId || uuidv4();

    const runInTransaction = async (em: EntityManager) => {
      // 1. Pessimistic Lock on the Wallet (LockMode.PESSIMISTIC_WRITE)
      // Ensures concurrency is isolated strictly by walletId without table-level locking
      const walletOrm = await em.findOne(
        WalletOrmEntity,
        { id: dto.walletId },
        { lockMode: LockMode.PESSIMISTIC_WRITE },
      );

      if (!walletOrm) {
        throw new WalletNotFoundError(dto.walletId);
      }

      // 2. Idempotency Gate (Strict Database Level Check under wallet lock)
      const existingTxOrm = await em.findOne(WagerTransactionOrmEntity, {
        idempotencyKey: dto.idempotencyKey,
      });

      if (existingTxOrm) {
        if (existingTxOrm.payloadHash === payloadHash) {
          // Idempotent replay: return original transaction status and observed balance
          return {
            transactionId: existingTxOrm.id,
            status: existingTxOrm.status,
            balance: walletOrm.balance.toJSON(),
            idempotentReplay: true,
            failureCode: existingTxOrm.failureCode,
          };
        }

        // Same idempotency key with conflicting payload
        throw new IdempotencyPayloadConflictError(dto.idempotencyKey);
      }

      const wallet = walletOrm.toDomain();
      const transactionMoney = Money.fromInput(dto.money);

      // Validate currency and player match
      if (wallet.currency !== transactionMoney.currency) {
        throw new CurrencyMismatchError(wallet.currency, transactionMoney.currency);
      }

      if (wallet.playerId !== dto.playerId) {
        // Player mismatch: create rejected transaction
        const txId = uuidv4();
        const wagerTx = WagerTransaction.create({
          id: txId,
          providerId: dto.providerId,
          externalTransactionId: dto.externalTransactionId,
          idempotencyKey: dto.idempotencyKey,
          payloadHash,
          walletId: wallet.id,
          playerId: dto.playerId,
          roundId: dto.roundId,
          gameId: dto.gameId,
          kind: dto.kind,
          money: transactionMoney,
          referenceExternalTransactionId: dto.referenceExternalTransactionId,
        });

        wagerTx.reject(FailureCode.PLAYER_MISMATCH);
        em.persist(WagerTransactionOrmEntity.fromDomain(wagerTx));

        return {
          transactionId: wagerTx.id,
          status: wagerTx.status,
          balance: wallet.balance.toJSON(),
          idempotentReplay: false,
          failureCode: wagerTx.failureCode,
        };
      }

      // 3. Create WagerTransaction instance
      const txId = uuidv4();
      const wagerTx = WagerTransaction.create({
        id: txId,
        providerId: dto.providerId,
        externalTransactionId: dto.externalTransactionId,
        idempotencyKey: dto.idempotencyKey,
        payloadHash,
        walletId: wallet.id,
        playerId: dto.playerId,
        roundId: dto.roundId,
        gameId: dto.gameId,
        kind: dto.kind,
        money: transactionMoney,
        referenceExternalTransactionId: dto.referenceExternalTransactionId,
      });

      const outboxEvents: IntegrationEvent<unknown>[] = [];
      let ledgerEntry: WalletLedgerEntry | undefined;
      let balanceMutated = false;

      // 4. Execute Business Rules by Kind
      switch (dto.kind) {
        case WagerTransactionKind.Bet: {
          if (wallet.balance.isLessThan(transactionMoney)) {
            wagerTx.reject(FailureCode.INSUFFICIENT_FUNDS);
            outboxEvents.push(
              new WagerTransactionRejected({
                eventId: uuidv4(),
                aggregateId: wagerTx.id,
                correlationId,
                occurredAt: new Date(),
                data: {
                  transactionId: wagerTx.id,
                  providerId: wagerTx.providerId,
                  externalTransactionId: wagerTx.externalTransactionId,
                  playerId: wagerTx.playerId,
                  walletId: wagerTx.walletId,
                  roundId: wagerTx.roundId,
                  gameId: wagerTx.gameId,
                  kind: wagerTx.kind,
                  money: transactionMoney.toJSON(),
                  failureCode: FailureCode.INSUFFICIENT_FUNDS,
                  rejectedAt: new Date().toISOString(),
                },
              }),
            );
          } else {
            const mutation = wallet.debit(transactionMoney);
            balanceMutated = true;
            wagerTx.markProcessed(undefined);

            ledgerEntry = WalletLedgerEntry.create({
              id: uuidv4(),
              walletId: wallet.id,
              transactionId: wagerTx.id,
              direction: LedgerDirection.Debit,
              money: transactionMoney,
              balanceBefore: mutation.balanceBefore,
              balanceAfter: mutation.balanceAfter,
            });

            outboxEvents.push(
              new WagerTransactionProcessed({
                eventId: uuidv4(),
                aggregateId: wagerTx.id,
                correlationId,
                occurredAt: new Date(),
                data: {
                  transactionId: wagerTx.id,
                  providerId: wagerTx.providerId,
                  externalTransactionId: wagerTx.externalTransactionId,
                  playerId: wagerTx.playerId,
                  walletId: wagerTx.walletId,
                  roundId: wagerTx.roundId,
                  gameId: wagerTx.gameId,
                  kind: wagerTx.kind,
                  money: transactionMoney.toJSON(),
                  processedAt: new Date().toISOString(),
                },
              }),
              new WalletBalanceChanged({
                eventId: uuidv4(),
                aggregateId: wallet.id,
                correlationId,
                occurredAt: new Date(),
                data: {
                  walletId: wallet.id,
                  transactionId: wagerTx.id,
                  direction: LedgerDirection.Debit,
                  money: transactionMoney.toJSON(),
                  balanceBefore: mutation.balanceBefore.toJSON(),
                  balanceAfter: mutation.balanceAfter.toJSON(),
                  walletVersion: mutation.versionAfter,
                },
              }),
            );
          }
          break;
        }

        case WagerTransactionKind.Win: {
          const mutation = wallet.credit(transactionMoney);
          balanceMutated = true;
          wagerTx.markProcessed(undefined);

          ledgerEntry = WalletLedgerEntry.create({
            id: uuidv4(),
            walletId: wallet.id,
            transactionId: wagerTx.id,
            direction: LedgerDirection.Credit,
            money: transactionMoney,
            balanceBefore: mutation.balanceBefore,
            balanceAfter: mutation.balanceAfter,
          });

          outboxEvents.push(
            new WagerTransactionProcessed({
              eventId: uuidv4(),
              aggregateId: wagerTx.id,
              correlationId,
              occurredAt: new Date(),
              data: {
                transactionId: wagerTx.id,
                providerId: wagerTx.providerId,
                externalTransactionId: wagerTx.externalTransactionId,
                playerId: wagerTx.playerId,
                walletId: wagerTx.walletId,
                roundId: wagerTx.roundId,
                gameId: wagerTx.gameId,
                kind: wagerTx.kind,
                money: transactionMoney.toJSON(),
                processedAt: new Date().toISOString(),
              },
            }),
            new WalletBalanceChanged({
              eventId: uuidv4(),
              aggregateId: wallet.id,
              correlationId,
              occurredAt: new Date(),
              data: {
                walletId: wallet.id,
                transactionId: wagerTx.id,
                direction: LedgerDirection.Credit,
                money: transactionMoney.toJSON(),
                balanceBefore: mutation.balanceBefore.toJSON(),
                balanceAfter: mutation.balanceAfter.toJSON(),
                walletVersion: mutation.versionAfter,
              },
            }),
          );
          break;
        }

        case WagerTransactionKind.Loss: {
          wagerTx.markProcessed(undefined);

          outboxEvents.push(
            new WagerTransactionProcessed({
              eventId: uuidv4(),
              aggregateId: wagerTx.id,
              correlationId,
              occurredAt: new Date(),
              data: {
                transactionId: wagerTx.id,
                providerId: wagerTx.providerId,
                externalTransactionId: wagerTx.externalTransactionId,
                playerId: wagerTx.playerId,
                walletId: wagerTx.walletId,
                roundId: wagerTx.roundId,
                gameId: wagerTx.gameId,
                kind: wagerTx.kind,
                money: transactionMoney.toJSON(),
                processedAt: new Date().toISOString(),
              },
            }),
          );
          break;
        }

        case WagerTransactionKind.Refund:
        case WagerTransactionKind.Rollback: {
          // Resolve reference
          const refTxOrm = await em.findOne(WagerTransactionOrmEntity, {
            providerId: dto.providerId,
            externalTransactionId: dto.referenceExternalTransactionId,
          });

          if (!refTxOrm || refTxOrm.status !== WagerTransactionStatus.Processed) {
            // Reference not yet available: save as PENDING_REFERENCE
            wagerTx.markPendingReference();

            outboxEvents.push(
              new WagerTransactionPendingReference({
                eventId: uuidv4(),
                aggregateId: wagerTx.id,
                correlationId,
                occurredAt: new Date(),
                data: {
                  transactionId: wagerTx.id,
                  providerId: wagerTx.providerId,
                  externalTransactionId: wagerTx.externalTransactionId,
                  playerId: wagerTx.playerId,
                  walletId: wagerTx.walletId,
                  roundId: wagerTx.roundId,
                  gameId: wagerTx.gameId,
                  kind: wagerTx.kind,
                  money: transactionMoney.toJSON(),
                  referenceExternalTransactionId: dto.referenceExternalTransactionId!,
                  pendingSince: new Date().toISOString(),
                },
              }),
            );
            break;
          }

          const refTx = refTxOrm.toDomain();

          // Rule 2: same provider, player, wallet, currency, and round
          if (
            refTx.playerId !== dto.playerId ||
            refTx.walletId !== dto.walletId ||
            refTx.money.currency !== transactionMoney.currency ||
            refTx.roundId !== dto.roundId
          ) {
            wagerTx.reject(FailureCode.PLAYER_MISMATCH);
            break;
          }

          // Rule 3: REFUND only references BET. ROLLBACK references BET, WIN, or REFUND
          if (dto.kind === WagerTransactionKind.Refund && refTx.kind !== WagerTransactionKind.Bet) {
            wagerTx.reject(FailureCode.INVALID_REFERENCE_OPERATION);
            break;
          }

          // Rule 4: Reference cannot be reversed twice by the same kind of operation
          const priorReversal = await em.findOne(WagerTransactionOrmEntity, {
            referenceTransactionId: refTx.id,
            kind: dto.kind,
            status: WagerTransactionStatus.Processed,
          });

          if (priorReversal) {
            wagerTx.reject(FailureCode.REFERENCE_ALREADY_REVERSED);
            break;
          }

          // Rule 5: Value of REFUND / ROLLBACK must match referenced value exactly
          if (!transactionMoney.equals(refTx.money)) {
            wagerTx.reject(FailureCode.AMOUNT_MISMATCH);
            break;
          }

          // Apply reversal direction
          const direction = wagerTx.ledgerDirectionFor(refTx);

          if (direction === LedgerDirection.Credit) {
            const mutation = wallet.credit(transactionMoney);
            balanceMutated = true;
            wagerTx.markProcessed(refTx.id);

            ledgerEntry = WalletLedgerEntry.create({
              id: uuidv4(),
              walletId: wallet.id,
              transactionId: wagerTx.id,
              direction: LedgerDirection.Credit,
              money: transactionMoney,
              balanceBefore: mutation.balanceBefore,
              balanceAfter: mutation.balanceAfter,
            });

            outboxEvents.push(
              new WagerTransactionProcessed({
                eventId: uuidv4(),
                aggregateId: wagerTx.id,
                correlationId,
                occurredAt: new Date(),
                data: {
                  transactionId: wagerTx.id,
                  providerId: wagerTx.providerId,
                  externalTransactionId: wagerTx.externalTransactionId,
                  playerId: wagerTx.playerId,
                  walletId: wagerTx.walletId,
                  roundId: wagerTx.roundId,
                  gameId: wagerTx.gameId,
                  kind: wagerTx.kind,
                  money: transactionMoney.toJSON(),
                  referenceExternalTransactionId: dto.referenceExternalTransactionId,
                  referenceTransactionId: refTx.id,
                  processedAt: new Date().toISOString(),
                },
              }),
              new WalletBalanceChanged({
                eventId: uuidv4(),
                aggregateId: wallet.id,
                correlationId,
                occurredAt: new Date(),
                data: {
                  walletId: wallet.id,
                  transactionId: wagerTx.id,
                  direction: LedgerDirection.Credit,
                  money: transactionMoney.toJSON(),
                  balanceBefore: mutation.balanceBefore.toJSON(),
                  balanceAfter: mutation.balanceAfter.toJSON(),
                  walletVersion: mutation.versionAfter,
                },
              }),
            );
          } else {
            // Direction is DEBIT (e.g. Rollback of WIN or REFUND)
            // Section 7, rule 9: Reversal causing negative balance must be rejected with ROLLBACK_WOULD_CAUSE_NEGATIVE_BALANCE
            if (wallet.balance.isLessThan(transactionMoney)) {
              wagerTx.reject(FailureCode.ROLLBACK_WOULD_CAUSE_NEGATIVE_BALANCE);
              outboxEvents.push(
                new WagerTransactionRejected({
                  eventId: uuidv4(),
                  aggregateId: wagerTx.id,
                  correlationId,
                  occurredAt: new Date(),
                  data: {
                    transactionId: wagerTx.id,
                    providerId: wagerTx.providerId,
                    externalTransactionId: wagerTx.externalTransactionId,
                    playerId: wagerTx.playerId,
                    walletId: wagerTx.walletId,
                    roundId: wagerTx.roundId,
                    gameId: wagerTx.gameId,
                    kind: wagerTx.kind,
                    money: transactionMoney.toJSON(),
                    failureCode: FailureCode.ROLLBACK_WOULD_CAUSE_NEGATIVE_BALANCE,
                    rejectedAt: new Date().toISOString(),
                  },
                }),
              );
            } else {
              const mutation = wallet.debit(transactionMoney);
              balanceMutated = true;
              wagerTx.markProcessed(refTx.id);

              ledgerEntry = WalletLedgerEntry.create({
                id: uuidv4(),
                walletId: wallet.id,
                transactionId: wagerTx.id,
                direction: LedgerDirection.Debit,
                money: transactionMoney,
                balanceBefore: mutation.balanceBefore,
                balanceAfter: mutation.balanceAfter,
              });

              outboxEvents.push(
                new WagerTransactionProcessed({
                  eventId: uuidv4(),
                  aggregateId: wagerTx.id,
                  correlationId,
                  occurredAt: new Date(),
                  data: {
                    transactionId: wagerTx.id,
                    providerId: wagerTx.providerId,
                    externalTransactionId: wagerTx.externalTransactionId,
                    playerId: wagerTx.playerId,
                    walletId: wagerTx.walletId,
                    roundId: wagerTx.roundId,
                    gameId: wagerTx.gameId,
                    kind: wagerTx.kind,
                    money: transactionMoney.toJSON(),
                    referenceExternalTransactionId: dto.referenceExternalTransactionId,
                    referenceTransactionId: refTx.id,
                    processedAt: new Date().toISOString(),
                  },
                }),
                new WalletBalanceChanged({
                  eventId: uuidv4(),
                  aggregateId: wallet.id,
                  correlationId,
                  occurredAt: new Date(),
                  data: {
                    walletId: wallet.id,
                    transactionId: wagerTx.id,
                    direction: LedgerDirection.Debit,
                    money: transactionMoney.toJSON(),
                    balanceBefore: mutation.balanceBefore.toJSON(),
                    balanceAfter: mutation.balanceAfter.toJSON(),
                    walletVersion: mutation.versionAfter,
                  },
                }),
              );
            }
          }
          break;
        }

        default:
          break;
      }

      // 5. Atomic Commit: Update Wallet, Insert Transaction, Insert Ledger, Insert Outbox
      if (balanceMutated) {
        walletOrm.balance = wallet.balance;
        walletOrm.version = wallet.version;
        walletOrm.updatedAt = wallet.updatedAt;
      }

      em.persist(WagerTransactionOrmEntity.fromDomain(wagerTx));

      if (ledgerEntry) {
        em.persist(WalletLedgerEntryOrmEntity.fromDomain(ledgerEntry));
      }

      for (const event of outboxEvents) {
        const outbox = OutboxMessage.enqueue(event);
        em.persist(OutboxMessageOrmEntity.fromDomain(outbox));
      }

      return {
        transactionId: wagerTx.id,
        status: wagerTx.status,
        balance: wallet.balance.toJSON(),
        idempotentReplay: false,
        failureCode: wagerTx.failureCode,
      };
    };

    try {
      if (emContext) {
        return await runInTransaction(emContext);
      }
      return await this.em.transactional(runInTransaction);
    } catch (err: any) {
      if (
        err?.name === "UniqueConstraintViolationException" ||
        err?.code === "23505" ||
        err?.message?.includes("uq_wager_idempotency_key")
      ) {
        const existingTx = await this.em.findOne(WagerTransactionOrmEntity, {
          idempotencyKey: dto.idempotencyKey,
        });
        if (existingTx) {
          if (existingTx.payloadHash === payloadHash) {
            const wallet = await this.em.findOne(WalletOrmEntity, {
              id: existingTx.walletId,
            });
            return {
              transactionId: existingTx.id,
              status: existingTx.status,
              balance: wallet ? wallet.balance.toJSON() : existingTx.amount.toJSON(),
              idempotentReplay: true,
              failureCode: existingTx.failureCode,
            };
          }
          throw new IdempotencyPayloadConflictError(dto.idempotencyKey);
        }
      }
      throw err;
    }
  }
}

