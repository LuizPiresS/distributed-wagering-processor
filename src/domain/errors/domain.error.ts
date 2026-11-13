export abstract class DomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class InsufficientFundsError extends DomainError {
  constructor(walletId: string, currentBalance: string, requestedAmount: string) {
    super(
      `Wallet '${walletId}' has insufficient funds: current balance is ${currentBalance}, but requested ${requestedAmount}`,
    );
  }
}

export class CurrencyMismatchError extends DomainError {
  constructor(expectedCurrency: string, actualCurrency: string) {
    super(
      `Currency mismatch: expected currency '${expectedCurrency}', but received '${actualCurrency}'`,
    );
  }
}

export class InvalidMoneyValueError extends DomainError {
  constructor(reason: string) {
    super(`Invalid money value: ${reason}`);
  }
}

export class InvalidTransactionStateError extends DomainError {
  constructor(currentStatus: string, action: string) {
    super(
      `Cannot perform action '${action}' on transaction with terminal or incompatible status '${currentStatus}'`,
    );
  }
}

export class UnbalancedLedgerEntryError extends DomainError {
  constructor(details: string) {
    super(`Unbalanced ledger entry: ${details}`);
  }
}

export class WalletRuleViolationError extends DomainError {
  constructor(message: string) {
    super(`Wallet rule violation: ${message}`);
  }
}

export class InvalidOperationReferenceError extends DomainError {
  constructor(message: string) {
    super(`Invalid operation reference: ${message}`);
  }
}

