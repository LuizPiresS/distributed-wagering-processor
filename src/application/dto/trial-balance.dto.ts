import { ApiProperty } from "@nestjs/swagger";

export class AccountBalanceSummaryDto {
  @ApiProperty({ description: "Total de débitos acumulados na conta", example: "5000.00" })
  public readonly totalDebits!: string;

  @ApiProperty({ description: "Total de créditos acumulados na conta", example: "12000.00" })
  public readonly totalCredits!: string;

  @ApiProperty({ description: "Saldo líquido da conta", example: "7000.00" })
  public readonly netBalance!: string;
}

export class TrialBalanceResultDto {
  @ApiProperty({
    description: "Indica se a equação contábil de partidas dobradas está perfeitamente balanceada (Débitos == Créditos)",
    example: true,
  })
  public readonly balanced!: boolean;

  @ApiProperty({ description: "Código ISO da moeda auditada", example: "BRL" })
  public readonly currency!: string;

  @ApiProperty({ description: "Soma total de todos os débitos da plataforma", example: "25000.00" })
  public readonly totalDebits!: string;

  @ApiProperty({ description: "Soma total de todos os créditos da plataforma", example: "25000.00" })
  public readonly totalCredits!: string;

  @ApiProperty({ description: "Diferença absoluta entre débitos e créditos (deve ser estritamente 0.00)", example: "0.00" })
  public readonly discrepancy!: string;

  @ApiProperty({ description: "Total de lançamentos contábeis auditados", example: 450 })
  public readonly totalTransactionsAudited!: number;

  @ApiProperty({ description: "Extrato segregado por conta contábil" })
  public readonly accounts!: {
    readonly playerWallets: AccountBalanceSummaryDto;
    readonly houseHolding: AccountBalanceSummaryDto;
    readonly houseExpense: AccountBalanceSummaryDto;
    readonly settlementEscrow: AccountBalanceSummaryDto;
  };

  @ApiProperty({ description: "Timestamp ISO da auditoria contábil", example: "2026-11-13T20:30:00.000Z" })
  public readonly auditedAt!: string;
}
