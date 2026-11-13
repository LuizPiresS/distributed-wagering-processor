export class CreateWalletDto {
  public readonly playerId!: string;
  public readonly initialBalance!: {
    readonly amount: string;
    readonly currency: string;
  };
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
