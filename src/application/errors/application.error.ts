export class ApplicationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class WalletNotFoundError extends ApplicationError {
  constructor(walletId: string) {
    super(`Wallet with id '${walletId}' not found.`);
  }
}

export class WalletConflictError extends ApplicationError {
  constructor(playerId: string, currency: string) {
    super(`A wallet for player '${playerId}' and currency '${currency}' already exists.`);
  }
}

export class IdempotencyPayloadConflictError extends ApplicationError {
  constructor(idempotencyKey: string) {
    super(
      `Idempotency key '${idempotencyKey}' was already used with a different payload.`,
    );
  }
}

export class InvalidPayloadError extends ApplicationError {
  constructor(message: string) {
    super(`Invalid payload: ${message}`);
  }
}

export class TransactionNotFoundError extends ApplicationError {
  constructor(transactionId: string) {
    super(`Transaction with id '${transactionId}' not found.`);
  }
}

