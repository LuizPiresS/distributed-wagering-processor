import { EntityManager } from "@mikro-orm/postgresql";
import { Injectable, Logger } from "@nestjs/common";
import {
  CounterpartyAccount,
  Currency,
  CurrencyCode,
  Money,
} from "../../domain";
import { TrialBalanceResultDto } from "../dto/trial-balance.dto";

@Injectable()
export class GetTrialBalanceUseCase {
  private readonly logger = new Logger(GetTrialBalanceUseCase.name);

  constructor(private readonly em: EntityManager) {}

  public async execute(currency: string = Currency.BRL): Promise<TrialBalanceResultDto> {
    const validCurrency = (currency.toUpperCase().trim() || Currency.BRL) as CurrencyCode;

    // Aggregate all ledger entries for the specified currency
    const rows = await this.em.getConnection().execute<{
      direction: string;
      counterparty_account: string;
      total_amount: string;
      entry_count: string | number;
    }[]>(
      `
      SELECT 
        direction,
        counterparty_account,
        SUM(amount) AS total_amount,
        COUNT(id) AS entry_count
      FROM wallet_ledger_entries
      WHERE currency = ?
      GROUP BY direction, counterparty_account;
    `,
      [validCurrency],
    );

    let playerDebits = Money.zero(validCurrency);
    let playerCredits = Money.zero(validCurrency);

    let houseHoldingDebits = Money.zero(validCurrency);
    let houseHoldingCredits = Money.zero(validCurrency);

    let houseExpenseDebits = Money.zero(validCurrency);
    let houseExpenseCredits = Money.zero(validCurrency);

    let escrowDebits = Money.zero(validCurrency);
    let escrowCredits = Money.zero(validCurrency);

    let totalEntries = 0;

    for (const row of rows) {
      const amount = Money.fromInput({
        amount: row.total_amount || "0.00",
        currency: validCurrency,
      });
      const count = Number(row.entry_count || 0);
      totalEntries += count;

      if (row.direction === "DEBIT") {
        // Player was debited -> counterparty is credited
        playerDebits = playerDebits.add(amount);

        if (row.counterparty_account === CounterpartyAccount.HouseHolding) {
          houseHoldingCredits = houseHoldingCredits.add(amount);
        } else if (row.counterparty_account === CounterpartyAccount.HouseExpense) {
          houseExpenseCredits = houseExpenseCredits.add(amount);
        } else if (row.counterparty_account === CounterpartyAccount.SettlementEscrow) {
          escrowCredits = escrowCredits.add(amount);
        } else {
          houseHoldingCredits = houseHoldingCredits.add(amount);
        }
      } else {
        // Player was credited -> counterparty is debited
        playerCredits = playerCredits.add(amount);

        if (row.counterparty_account === CounterpartyAccount.HouseHolding) {
          houseHoldingDebits = houseHoldingDebits.add(amount);
        } else if (row.counterparty_account === CounterpartyAccount.HouseExpense) {
          houseExpenseDebits = houseExpenseDebits.add(amount);
        } else if (row.counterparty_account === CounterpartyAccount.SettlementEscrow) {
          escrowDebits = escrowDebits.add(amount);
        } else {
          houseHoldingDebits = houseHoldingDebits.add(amount);
        }
      }
    }

    // Double-Entry Sums: Sum(Debits) must strictly equal Sum(Credits)
    const totalDebits = playerDebits
      .add(houseHoldingDebits)
      .add(houseExpenseDebits)
      .add(escrowDebits);

    const totalCredits = playerCredits
      .add(houseHoldingCredits)
      .add(houseExpenseCredits)
      .add(escrowCredits);

    const isBalanced = totalDebits.equals(totalCredits);
    const discrepancy = totalDebits.isGreaterThan(totalCredits)
      ? totalDebits.subtract(totalCredits)
      : totalCredits.subtract(totalDebits);

    if (!isBalanced) {
      this.logger.error(
        `CRITICAL: Double-entry trial balance mismatch! Debits=${totalDebits.toString()}, Credits=${totalCredits.toString()}, Discrepancy=${discrepancy.toString()}`,
      );
    }

    return {
      balanced: isBalanced,
      currency: validCurrency,
      totalDebits: totalDebits.toString(),
      totalCredits: totalCredits.toString(),
      discrepancy: discrepancy.toString(),
      totalTransactionsAudited: totalEntries,
      accounts: {
        playerWallets: {
          totalDebits: playerDebits.toString(),
          totalCredits: playerCredits.toString(),
          netBalance: playerCredits.subtract(playerDebits).toString(),
        },
        houseHolding: {
          totalDebits: houseHoldingDebits.toString(),
          totalCredits: houseHoldingCredits.toString(),
          netBalance: houseHoldingCredits.subtract(houseHoldingDebits).toString(),
        },
        houseExpense: {
          totalDebits: houseExpenseDebits.toString(),
          totalCredits: houseExpenseCredits.toString(),
          netBalance: houseExpenseDebits.subtract(houseExpenseCredits).toString(),
        },
        settlementEscrow: {
          totalDebits: escrowDebits.toString(),
          totalCredits: escrowCredits.toString(),
          netBalance: escrowCredits.subtract(escrowDebits).toString(),
        },
      },
      auditedAt: new Date().toISOString(),
    };
  }
}
