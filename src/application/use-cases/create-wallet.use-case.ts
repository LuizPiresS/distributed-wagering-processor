import { EntityManager } from "@mikro-orm/postgresql";
import { Injectable } from "@nestjs/common";
import { v4 as uuidv4 } from "uuid";
import {
  CurrencyCode,
  LedgerDirection,
  Money,
  OutboxMessage,
  WagerTransaction,
  WagerTransactionKind,
  Wallet,
  WalletBalanceChanged,
  WalletLedgerEntry,
} from "../../domain";
import {
  OutboxMessageOrmEntity,
  WagerTransactionOrmEntity,
  WalletLedgerEntryOrmEntity,
  WalletOrmEntity,
} from "../../infrastructure/database/entities";
import { CreateWalletDto, CreateWalletResult } from "../dto/create-wallet.dto";
import { WalletConflictError } from "../errors/application.error";

@Injectable()
export class CreateWalletUseCase {
  constructor(private readonly em: EntityManager) {}

  public async execute(dto: CreateWalletDto): Promise<CreateWalletResult> {
    const initialMoney = Money.fromInput({
      amount: dto.initialBalance.amount,
      currency: dto.initialBalance.currency,
    });

    return await this.em.transactional(async (em) => {
      // 1. Check for existing wallet with the same playerId + currency
      const existing = await em.findOne(WalletOrmEntity, {
        playerId: dto.playerId,
        currency: initialMoney.currency,
      });

      if (existing) {
        throw new WalletConflictError(dto.playerId, initialMoney.currency);
      }

      // 2. Open domain Wallet
      const walletId = uuidv4();
      const wallet = Wallet.open({
        id: walletId,
        playerId: dto.playerId,
        initialBalance: initialMoney,
      });

      const walletOrm = WalletOrmEntity.fromDomain(wallet);
      em.persist(walletOrm);
      await em.flush();

      // 3. If initialBalance > 0, create internal OPENING transaction + CREDIT ledger entry atomically
      if (initialMoney.isPositive()) {
        const openingTxId = uuidv4();
        const openingTx = WagerTransaction.create({
          id: openingTxId,
          providerId: "system",
          externalTransactionId: `opening-${walletId}`,
          idempotencyKey: `system:opening:${walletId}`,
          payloadHash: "opening",
          walletId,
          playerId: dto.playerId,
          roundId: "system",
          gameId: "system",
          kind: WagerTransactionKind.Opening,
          money: initialMoney,
        });
        openingTx.markProcessed(undefined, wallet.createdAt);

        const ledgerEntry = WalletLedgerEntry.create({
          id: uuidv4(),
          walletId,
          transactionId: openingTxId,
          direction: LedgerDirection.Credit,
          money: initialMoney,
          balanceBefore: Money.zero(initialMoney.currency as CurrencyCode),
          balanceAfter: initialMoney,
          createdAt: wallet.createdAt,
        });

        const event = new WalletBalanceChanged({
          eventId: uuidv4(),
          aggregateId: walletId,
          correlationId: `opening-${walletId}`,
          occurredAt: wallet.createdAt,
          data: {
            walletId,
            transactionId: openingTxId,
            direction: LedgerDirection.Credit,
            money: initialMoney.toJSON(),
            balanceBefore: Money.zero(initialMoney.currency as CurrencyCode).toJSON(),
            balanceAfter: initialMoney.toJSON(),
            walletVersion: wallet.version,
          },
        });

        const outbox = OutboxMessage.enqueue(event);

        em.persist(WagerTransactionOrmEntity.fromDomain(openingTx));
        em.persist(WalletLedgerEntryOrmEntity.fromDomain(ledgerEntry));
        em.persist(OutboxMessageOrmEntity.fromDomain(outbox));
      }

      return {
        id: wallet.id,
        playerId: wallet.playerId,
        balance: wallet.balance.toJSON(),
        version: wallet.version,
      };
    });
  }
}
