import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  FailureCode,
  type MoneyProps,
  WagerTransactionKind,
  WagerTransactionStatus,
} from "../../domain";
import { MoneyDto } from "./create-wallet.dto";

export class ProcessWagerTransactionDto {
  @ApiProperty({
    description: "Chave de idempotência única (UUIDv4) enviada no header ou payload",
    example: "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
  })
  public readonly idempotencyKey!: string;

  @ApiProperty({
    description: "Identificador do provedor do jogo parceiro",
    example: "pragmatic_play",
  })
  public readonly providerId!: string;

  @ApiProperty({
    description: "Identificador único da transação no sistema externo do provedor",
    example: "tx-ext-8842194",
  })
  public readonly externalTransactionId!: string;

  @ApiProperty({
    description: "Identificador único do jogador",
    example: "550e8400-e29b-41d4-a716-446655440000",
  })
  public readonly playerId!: string;

  @ApiProperty({
    description: "Identificador da carteira do jogador",
    example: "3ba3d156-fcf4-4b57-a423-a55e2d6bce72",
  })
  public readonly walletId!: string;

  @ApiProperty({
    description: "Identificador da rodada do jogo",
    example: "round-slot-10492",
  })
  public readonly roundId!: string;

  @ApiProperty({
    description: "Identificador do jogo no catálogo",
    example: "sweet-bonanza-1000",
  })
  public readonly gameId!: string;

  @ApiProperty({
    description: "Tipo de operação financeira de aposta",
    enum: WagerTransactionKind,
    example: WagerTransactionKind.Bet,
  })
  public readonly kind!: WagerTransactionKind;

  @ApiProperty({
    description: "Valor e moeda da transação",
    type: MoneyDto,
  })
  public readonly money!: MoneyProps;

  @ApiPropertyOptional({
    description: "Identificador externo da transação de referência (obrigatório para REFUND e ROLLBACK)",
    example: "tx-ext-8842194",
  })
  public readonly referenceExternalTransactionId?: string;

  @ApiPropertyOptional({
    description: "Identificador de correlação para rastreabilidade ponta a ponta",
    example: "corr-78219412",
  })
  public readonly correlationId?: string;
}

export interface ProcessWagerTransactionResult {
  readonly transactionId: string;
  readonly status: WagerTransactionStatus;
  readonly balance: MoneyProps;
  readonly idempotentReplay: boolean;
  readonly failureCode?: FailureCode;
}
