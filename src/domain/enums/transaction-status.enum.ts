export enum WagerTransactionStatus {
  Pending = "PENDING",
  PendingReference = "PENDING_REFERENCE",
  Processed = "PROCESSED", // Terminal
  Rejected = "REJECTED", // Terminal (Business rule violation)
  Failed = "FAILED", // Terminal (Infrastructure/unrecoverable audit failure)
}

