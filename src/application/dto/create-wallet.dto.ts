import { ApiProperty } from "@nestjs/swagger";

export class MoneyDto {
  @ApiProperty({
    description: "Valor monetário com escala estrita de 2 casas decimais",
    example: "100.00",
  })
  public readonly amount!: string;

  @ApiProperty({
    description: "Código ISO da moeda (ex: BRL, USD, EUR)",
    example: "BRL",
  })
  public readonly currency!: string;
}

export class CreateWalletDto {
  @ApiProperty({
    description: "Identificador único universal do jogador",
    example: "550e8400-e29b-41d4-a716-446655440000",
  })
  public readonly playerId!: string;

  @ApiProperty({
    description: "Saldo inicial da carteira no momento da abertura",
    type: MoneyDto,
  })
  public readonly initialBalance!: MoneyDto;
}

export interface CreateWalletResult {
  readonly id: string;
  readonly playerId: string;
  readonly balance: {
    readonly amount: string;
    readonly currency: string;
  };
  readonly version: number;
}
