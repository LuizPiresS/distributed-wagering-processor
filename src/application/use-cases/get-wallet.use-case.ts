import { EntityManager } from "@mikro-orm/postgresql";
import { Injectable } from "@nestjs/common";
import { MoneyProps } from "../../domain";
import { WalletOrmEntity } from "../../infrastructure/database/entities";
import { WalletNotFoundError } from "../errors/application.error";

export interface GetWalletResult {
  readonly id: string;
  readonly playerId: string;
  readonly currency: string;
  readonly balance: MoneyProps;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

@Injectable()
export class GetWalletUseCase {
  constructor(private readonly em: EntityManager) {}

  public async execute(walletId: string): Promise<GetWalletResult> {
    const wallet = await this.em.findOne(WalletOrmEntity, { id: walletId });
    if (!wallet) {
      throw new WalletNotFoundError(walletId);
    }

    return {
      id: wallet.id,
      playerId: wallet.playerId,
      currency: wallet.currency,
      balance: wallet.balance.toJSON(),
      version: wallet.version,
      createdAt: wallet.createdAt.toISOString(),
      updatedAt: wallet.updatedAt.toISOString(),
    };
  }
}

