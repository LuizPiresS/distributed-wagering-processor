import { EntityManager } from "@mikro-orm/postgresql";
import { Injectable } from "@nestjs/common";
import {
  WalletLedgerEntryOrmEntity,
  WalletOrmEntity,
} from "../../infrastructure/database/entities";
import {
  GetWalletLedgerDto,
  GetWalletLedgerResult,
  WalletLedgerItemDto,
} from "../dto/get-wallet-ledger.dto";
import {
  InvalidPayloadError,
  WalletNotFoundError,
} from "../errors/application.error";

export interface DecodedCursor {
  readonly createdAt: string;
  readonly id: string;
}

export function encodeCursor(entry: { createdAt: Date; id: string }): string {
  const payload: DecodedCursor = {
    createdAt: entry.createdAt.toISOString(),
    id: entry.id,
  };
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

export function decodeCursor(cursor: string): DecodedCursor {
  try {
    const raw = Buffer.from(cursor, "base64url").toString("utf-8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.createdAt !== "string" || typeof parsed.id !== "string") {
      throw new Error("Invalid cursor shape");
    }
    return parsed;
  } catch {
    throw new InvalidPayloadError("Malformed or invalid opaque cursor.");
  }
}

@Injectable()
export class GetWalletLedgerUseCase {
  constructor(private readonly em: EntityManager) {}

  public async execute(dto: GetWalletLedgerDto): Promise<GetWalletLedgerResult> {
    const wallet = await this.em.findOne(WalletOrmEntity, { id: dto.walletId });
    if (!wallet) {
      throw new WalletNotFoundError(dto.walletId);
    }

    const limit = Math.min(Math.max(Number(dto.limit || 50), 1), 100);

    const qb = this.em
      .createQueryBuilder(WalletLedgerEntryOrmEntity, "l")
      .where({ walletId: dto.walletId });

    if (dto.cursor) {
      const decoded = decodeCursor(dto.cursor);
      const cursorDate = new Date(decoded.createdAt);
      qb.andWhere(
        "(l.created_at < ? or (l.created_at = ? and l.id < ?))",
        [cursorDate, cursorDate, decoded.id],
      );
    }

    qb.orderBy({ createdAt: "DESC", id: "DESC" });
    qb.limit(limit + 1);

    const entries = await qb.getResultList();
    const hasMore = entries.length > limit;

    const itemsToReturn = hasMore ? entries.slice(0, limit) : entries;

    let nextCursor: string | undefined;
    if (hasMore && itemsToReturn.length > 0) {
      const last = itemsToReturn[itemsToReturn.length - 1]!;
      nextCursor = encodeCursor(last);
    }

    const items: WalletLedgerItemDto[] = itemsToReturn.map((entry) => ({
      id: entry.id,
      walletId: entry.walletId,
      transactionId: entry.transactionId,
      direction: entry.direction,
      amount: entry.amount.toJSON(),
      balanceBefore: entry.balanceBefore.toJSON(),
      balanceAfter: entry.balanceAfter.toJSON(),
      counterpartyAccount: entry.counterpartyAccount,
      createdAt: entry.createdAt.toISOString(),
    }));

    return {
      items,
      nextCursor,
      hasMore,
    };
  }
}
