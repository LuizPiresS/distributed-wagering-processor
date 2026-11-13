import { FailureCode } from "../enums/failure-code.enum";
import { LedgerDirection } from "../enums/ledger-direction.enum";
import { WagerTransactionKind } from "../enums/transaction-kind.enum";
import { WagerTransactionStatus } from "../enums/transaction-status.enum";
import {
  InvalidOperationReferenceError,
  InvalidTransactionStateError,
} from "../errors/domain.error";
import { Money, MoneyProps } from "../value-objects/money.vo";

export interface CreateWagerTransactionProps {
  readonly id: string;
  readonly providerId: string;
  readonly externalTransactionId: string;
  readonly idempotencyKey: string;
  readonly payloadHash: string;
  readonly walletId: string;
  readonly playerId: string;
  readonly roundId: string;
  readonly gameId: string;
  readonly kind: WagerTransactionKind;
  readonly money: Money;
  readonly referenceExternalTransactionId?: string;
  readonly createdAt?: Date;
}

export interface WagerTransactionState {
  readonly id: string;
  readonly providerId: string;
  readonly externalTransactionId: string;
  readonly idempotencyKey: string;
  readonly payloadHash: string;
  readonly walletId: string;
  readonly playerId: string;
  readonly roundId: string;
  readonly gameId: string;
  readonly kind: WagerTransactionKind;
  readonly amount: string;
  readonly currency: string;
  readonly referenceExternalTransactionId?: string;
  readonly status: WagerTransactionStatus;
  readonly referenceTransactionId?: string;
  readonly failureCode?: FailureCode;
  readonly createdAt: Date;
  readonly processedAt?: Date;
}

export class WagerTransaction {
  private constructor(
    public readonly id: string,
    public readonly providerId: string,
    public readonly externalTransactionId: string,
    public readonly idempotencyKey: string,
    public readonly payloadHash: string,
    public readonly walletId: string,
    public readonly playerId: string,
    public readonly roundId: string,
    public readonly gameId: string,
    public readonly kind: WagerTransactionKind,
    public readonly money: Money,
    public readonly referenceExternalTransactionId: string | undefined,
    public readonly createdAt: Date,
    private _status: WagerTransactionStatus,
    private _referenceTransactionId?: string,
    private _failureCode?: FailureCode,
    private _processedAt?: Date,
  ) {}

  /**
   * Factory method: Born in PENDING status. Validates reference requirements.
   */
  public static create(props: CreateWagerTransactionProps): WagerTransaction {
    const requiresRef =
      props.kind === WagerTransactionKind.Refund ||
      props.kind === WagerTransactionKind.Rollback;

    if (requiresRef && !props.referenceExternalTransactionId) {
      throw new InvalidOperationReferenceError(
        `Transaction of kind '${props.kind}' requires a referenceExternalTransactionId.`,
      );
    }

    return new WagerTransaction(
      props.id,
      props.providerId,
      props.externalTransactionId,
      props.idempotencyKey,
      props.payloadHash,
      props.walletId,
      props.playerId,
      props.roundId,
      props.gameId,
      props.kind,
      props.money,
      props.referenceExternalTransactionId,
      props.createdAt || new Date(),
      WagerTransactionStatus.Pending,
    );
  }

  /**
   * Rehydrates an existing transaction from persistence without re-validating transitions.
   */
  public static rehydrate(state: WagerTransactionState): WagerTransaction {
    const money = Money.from({
      amount: state.amount,
      currency: state.currency,
    });

    return new WagerTransaction(
      state.id,
      state.providerId,
      state.externalTransactionId,
      state.idempotencyKey,
      state.payloadHash,
      state.walletId,
      state.playerId,
      state.roundId,
      state.gameId,
      state.kind,
      money,
      state.referenceExternalTransactionId,
      state.createdAt,
      state.status,
      state.referenceTransactionId,
      state.failureCode,
      state.processedAt,
    );
  }

  public get status(): WagerTransactionStatus {
    return this._status;
  }

  public get referenceTransactionId(): string | undefined {
    return this._referenceTransactionId;
  }

  public get failureCode(): FailureCode | undefined {
    return this._failureCode;
  }

  public get processedAt(): Date | undefined {
    return this._processedAt;
  }

  // ---- State Transitions ----

  public markProcessed(referenceTransactionId: string | undefined, at: Date = new Date()): void {
    this.assertNotTerminal("markProcessed");
    this._status = WagerTransactionStatus.Processed;
    this._referenceTransactionId = referenceTransactionId;
    this._processedAt = at;
  }

  public markPendingReference(): void {
    this.assertNotTerminal("markPendingReference");
    this._status = WagerTransactionStatus.PendingReference;
  }

  public reject(code: FailureCode, at: Date = new Date()): void {
    this.assertNotTerminal("reject");
    this._status = WagerTransactionStatus.Rejected;
    this._failureCode = code;
    this._processedAt = at;
  }

  public fail(code: FailureCode, at: Date = new Date()): void {
    this.assertNotTerminal("fail");
    this._status = WagerTransactionStatus.Failed;
    this._failureCode = code;
    this._processedAt = at;
  }

  // ---- Domain Queries ----

  public isTerminal(): boolean {
    return (
      this._status === WagerTransactionStatus.Processed ||
      this._status === WagerTransactionStatus.Rejected ||
      this._status === WagerTransactionStatus.Failed
    );
  }

  public affectsBalance(): boolean {
    return this.kind !== WagerTransactionKind.Loss;
  }

  public requiresReference(): boolean {
    return (
      this.kind === WagerTransactionKind.Refund ||
      this.kind === WagerTransactionKind.Rollback
    );
  }

  public matchesPayload(payloadHash: string): boolean {
    return this.payloadHash === payloadHash;
  }

  /**
   * Computes the ledger direction for this transaction given its reference (if required).
   */
  public ledgerDirectionFor(reference?: WagerTransaction): LedgerDirection {
    switch (this.kind) {
      case WagerTransactionKind.Opening:
      case WagerTransactionKind.Win:
      case WagerTransactionKind.Refund:
        return LedgerDirection.Credit;
      case WagerTransactionKind.Bet:
        return LedgerDirection.Debit;
      case WagerTransactionKind.Rollback:
        if (!reference) {
          throw new InvalidOperationReferenceError(
            "Rollback requires the reference transaction to compute ledger direction.",
          );
        }
        // Rollback inverts the referenced operation:
        // Reverting a debit (BET) produces CREDIT.
        // Reverting a credit (WIN or REFUND) produces DEBIT.
        if (reference.kind === WagerTransactionKind.Bet) {
          return LedgerDirection.Credit;
        }
        return LedgerDirection.Debit;
      case WagerTransactionKind.Loss:
        throw new InvalidOperationReferenceError(
          "LOSS transaction does not produce any ledger direction.",
        );
    }
  }

  private assertNotTerminal(action: string): void {
    if (this.isTerminal()) {
      throw new InvalidTransactionStateError(this._status, action);
    }
  }

  public toJSON(): {
    id: string;
    providerId: string;
    externalTransactionId: string;
    idempotencyKey: string;
    walletId: string;
    playerId: string;
    roundId: string;
    gameId: string;
    kind: WagerTransactionKind;
    money: MoneyProps;
    status: WagerTransactionStatus;
    referenceExternalTransactionId?: string;
    referenceTransactionId?: string;
    failureCode?: FailureCode;
    createdAt: string;
    processedAt?: string;
  } {
    return {
      id: this.id,
      providerId: this.providerId,
      externalTransactionId: this.externalTransactionId,
      idempotencyKey: this.idempotencyKey,
      walletId: this.walletId,
      playerId: this.playerId,
      roundId: this.roundId,
      gameId: this.gameId,
      kind: this.kind,
      money: this.money.toJSON(),
      status: this._status,
      referenceExternalTransactionId: this.referenceExternalTransactionId,
      referenceTransactionId: this._referenceTransactionId,
      failureCode: this._failureCode,
      createdAt: this.createdAt.toISOString(),
      processedAt: this._processedAt?.toISOString(),
    };
  }
}

