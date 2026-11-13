import { EntityManager } from "@mikro-orm/postgresql";
import { Injectable, Logger } from "@nestjs/common";
import { CurrencyCode, Money } from "../../domain";
import { WalletOrmEntity } from "../../infrastructure/database/entities";
import {
  ReconcileWalletDto,
  ReconcileWalletResult,
} from "../dto/reconcile-wallet.dto";
import { WalletNotFoundError } from "../errors/application.error";

@Injectable()
export class ReconcileWalletUseCase {
  private readonly logger = new Logger(ReconcileWalletUseCase.name);

  constructor(private readonly em: EntityManager) {}

  public async execute(dto: ReconcileWalletDto): Promise<ReconcileWalletResult> {
    const wallet = await this.em.findOne(WalletOrmEntity, { id: dto.walletId });
    if (!wallet) {
      throw new WalletNotFoundError(dto.walletId);
    }

    // Execute atomic aggregate reconciliation query
    const rawResults = await this.em.getConnection().execute<{
      stored_balance: string;
      currency: string;
      calculated_balance: string;
      checked_entries: string | number;
    }[]>(
      `
      SELECT 
        w.balance AS stored_balance,
        w.currency AS currency,
        COALESCE(SUM(
          CASE 
            WHEN l.direction = 'CREDIT' THEN l.amount 
            WHEN l.direction = 'DEBIT' THEN -l.amount 
            ELSE 0 
          END
        ), 0.00) AS calculated_balance,
        COUNT(l.id) AS checked_entries
      FROM wallets w
      LEFT JOIN wallet_ledger_entries l ON l.wallet_id = w.id
      WHERE w.id = ?
      GROUP BY w.id;
    `,
      [dto.walletId],
    );

    const row = rawResults[0];
    const currency = (row?.currency || wallet.currency) as CurrencyCode;
    const storedMoney = Money.fromInput({
      amount: row?.stored_balance || wallet.balance.toString(),
      currency,
    });
    const calculatedMoney = Money.fromInput({
      amount: row?.calculated_balance || "0.00",
      currency,
    });

    const diffMoney = storedMoney.subtract(calculatedMoney);
    const consistent = diffMoney.isZero();
    const checkedEntries = Number(row?.checked_entries || 0);

    if (!consistent) {
      this.logger.error(
        JSON.stringify({
          event: "reconciliation_anomaly_detected",
          walletId: dto.walletId,
          currency,
          storedBalance: storedMoney.toString(),
          calculatedBalance: calculatedMoney.toString(),
          difference: diffMoney.toString(),
          checkedEntries,
        }),
      );
    } else {
      this.logger.log(
        JSON.stringify({
          event: "reconciliation_verified_consistent",
          walletId: dto.walletId,
          currency,
          balance: storedMoney.toString(),
          checkedEntries,
        }),
      );
    }

    return {
      walletId: dto.walletId,
      currency,
      storedBalance: storedMoney.toJSON(),
      calculatedBalance: calculatedMoney.toJSON(),
      difference: diffMoney.toJSON(),
      consistent,
      checkedEntries,
    };
  }
}

