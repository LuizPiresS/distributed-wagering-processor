export enum WagerTransactionKind {
  Opening = "OPENING", // Internal: initial wallet opening credit
  Bet = "BET",
  Win = "WIN",
  Loss = "LOSS",
  Refund = "REFUND",
  Rollback = "ROLLBACK",
}

