import { randomUUID } from "node:crypto";
import {
  parseSettlementDetails,
  type CustomsBrokerReceipt,
  type DutyQuote,
  type ExportDocuments,
  type SettlementDetails,
  type SettlementExpectation
} from "./domain.js";
import { hashDocuments } from "./document-hash.js";

export { SettlementDetailsSchema, parseSettlementDetails } from "./domain.js";
export type { SettlementDetails, SettlementExpectation } from "./domain.js";

export const quoteStatuses = ["OPEN", "PROCESSING", "FILED"] as const;
export type QuoteStatus = (typeof quoteStatuses)[number];
export const DEFAULT_MAX_QUOTE_RECORDS = 10_000;

export type QuoteStoreErrorCode =
  | "QUOTE_NOT_FOUND"
  | "QUOTE_ID_CONFLICT"
  | "QUOTE_EXPIRED"
  | "QUOTE_DOCUMENT_MISMATCH"
  | "QUOTE_ALREADY_PROCESSING"
  | "QUOTE_ALREADY_FILED"
  | "QUOTE_NOT_PROCESSING"
  | "STALE_PROCESSING_ATTEMPT"
  | "PAYMENT_ALREADY_BOUND"
  | "PAYMENT_ALREADY_USED"
  | "PAYMENT_RECONCILIATION_REQUIRED"
  | "INVALID_SETTLEMENT"
  | "SETTLEMENT_UNSUCCESSFUL"
  | "QUOTE_STORE_CAPACITY";

export class QuoteStoreError extends Error {
  constructor(
    public readonly code: QuoteStoreErrorCode,
    public readonly quoteId: string,
    message: string
  ) {
    super(message);
    this.name = "QuoteStoreError";
  }
}

export interface PreparedReceipt {
  receiptId: string;
  declarationId: string;
  brokerFeeUsd: number;
  brokerAddress: string;
  status: "prepared";
  timestamp: string;
}

export interface QuoteRecord {
  quote: DutyQuote;
  documentsHash: string;
  status: QuoteStatus;
  createdAt: string;
  updatedAt: string;
  attemptId?: string;
  preparedReceipt?: PreparedReceipt;
  receipt?: CustomsBrokerReceipt;
  settlement?: SettlementDetails;
}

export type ProcessingQuoteRecord = Omit<QuoteRecord, "status" | "attemptId"> & {
  status: "PROCESSING";
  attemptId: string;
};

export interface QuoteStoreOptions {
  clock?: () => Date;
  maxRecords?: number;
}

export interface ReceiptPreparationOptions {
  brokerAddress: string;
  receiptId?: string;
  timestamp?: Date;
}

type DocumentsOrHash = ExportDocuments | string;

function isDocuments(value: DocumentsOrHash): value is ExportDocuments {
  return typeof value !== "string";
}

function copySettlement(settlement: SettlementDetails): SettlementDetails {
  return { ...settlement };
}

export class QuoteStore {
  private readonly records = new Map<string, QuoteRecord>();
  private readonly attempts = new Map<string, string>();
  private readonly clock: () => Date;
  private readonly maxRecords: number;

  constructor(options: QuoteStoreOptions = {}) {
    this.clock = options.clock ?? (() => new Date());
    this.maxRecords = options.maxRecords ?? DEFAULT_MAX_QUOTE_RECORDS;
    if (!Number.isSafeInteger(this.maxRecords) || this.maxRecords <= 0) {
      throw new RangeError("maxRecords must be a positive safe integer");
    }
  }

  save(quote: DutyQuote, documents: ExportDocuments): QuoteRecord {
    if (!quote.quoteId) throw new TypeError("quote.quoteId is required");
    const timestamp = this.now();
    this.pruneExpiredOpen(timestamp);
    if (this.records.has(quote.quoteId)) {
      throw new QuoteStoreError(
        "QUOTE_ID_CONFLICT",
        quote.quoteId,
        `Quote ${quote.quoteId} already exists`
      );
    }
    if (this.records.size >= this.maxRecords) {
      throw new QuoteStoreError(
        "QUOTE_STORE_CAPACITY",
        quote.quoteId,
        `Quote store capacity of ${this.maxRecords} records has been reached`
      );
    }

    const record: QuoteRecord = {
      quote: { ...quote },
      documentsHash: hashDocuments(documents),
      status: "OPEN",
      createdAt: timestamp.toISOString(),
      updatedAt: timestamp.toISOString()
    };
    this.records.set(quote.quoteId, record);
    return this.copyRecord(record);
  }

  create(quote: DutyQuote, documents: ExportDocuments): QuoteRecord {
    return this.save(quote, documents);
  }

  get(quoteId: string): QuoteRecord | undefined {
    const record = this.records.get(quoteId);
    return record === undefined ? undefined : this.copyRecord(record);
  }

  getOrThrow(quoteId: string): QuoteRecord {
    return this.copyRecord(this.recordOrThrow(quoteId));
  }

  /** Validates expiry and document identity without changing the state. */
  validateSubmission(quoteId: string, documentsOrHash: DocumentsOrHash): QuoteRecord {
    const record = this.recordOrThrow(quoteId);
    this.assertMatchingDocuments(record, documentsOrHash);
    if (record.status === "PROCESSING" || record.status === "FILED") {
      return this.copyRecord(record);
    }
    this.assertNotExpired(record, this.now());
    return this.copyRecord(record);
  }

  /**
   * Atomically reserves an OPEN quote and returns its ownership token. No
   * await occurs between the state check and this synchronous map mutation.
   */
  beginProcessing(quoteId: string, documentsOrHash: DocumentsOrHash): ProcessingQuoteRecord {
    const record = this.recordOrThrow(quoteId);
    this.assertMatchingDocuments(record, documentsOrHash);

    if (record.status === "PROCESSING") {
      throw new QuoteStoreError(
        "QUOTE_ALREADY_PROCESSING",
        quoteId,
        `Quote ${quoteId} is already being processed`
      );
    }
    if (record.status === "FILED") {
      throw new QuoteStoreError(
        "QUOTE_ALREADY_FILED",
        quoteId,
        `Quote ${quoteId} has already been filed`
      );
    }
    this.assertNotExpired(record, this.now());

    let attemptId: string;
    do {
      attemptId = `ATTEMPT-${randomUUID()}`;
    } while (this.attempts.has(attemptId));
    const updatedAt = this.now().toISOString();
    record.status = "PROCESSING";
    record.attemptId = attemptId;
    record.updatedAt = updatedAt;
    this.attempts.set(attemptId, quoteId);
    return this.copyProcessingRecord(record);
  }

  prepareReceipt(
    quoteId: string,
    attemptId: string,
    options: ReceiptPreparationOptions | string
  ): PreparedReceipt {
    const record = this.recordOrThrow(quoteId);
    this.assertCurrentAttempt(record, attemptId);
    this.assertNotExpired(record, this.now());
    if (record.preparedReceipt !== undefined) return { ...record.preparedReceipt };

    const preparation = typeof options === "string"
      ? { brokerAddress: options }
      : options;
    if (!preparation.brokerAddress.trim()) {
      throw new TypeError("brokerAddress is required");
    }
    const timestamp = preparation.timestamp === undefined
      ? this.now()
      : new Date(preparation.timestamp.getTime());
    if (!Number.isFinite(timestamp.getTime())) throw new RangeError("timestamp must be a valid Date");
    const updatedAt = this.now();

    const preparedReceipt: PreparedReceipt = {
      receiptId: preparation.receiptId ?? `CBR-${randomUUID()}`,
      declarationId: record.quote.declarationId,
      brokerFeeUsd: record.quote.customsBrokerFeeUsd,
      brokerAddress: preparation.brokerAddress,
      status: "prepared",
      timestamp: timestamp.toISOString()
    };
    record.preparedReceipt = preparedReceipt;
    record.updatedAt = updatedAt.toISOString();
    return { ...preparedReceipt };
  }

  /**
   * Finishes the current attempt atomically. A failed facilitator result (or
   * malformed settlement result) releases PROCESSING and clears pending data;
   * a stale attempt can never resolve the record for a newer attempt.
   */
  finishSettlement(
    attemptId: string,
    result: unknown,
    expected: SettlementExpectation
  ): QuoteRecord {
    const record = this.recordForAttempt(attemptId);
    let settlement: SettlementDetails;
    try {
      settlement = parseSettlementDetails(result, expected);
    } catch (error) {
      this.releaseProcessing(record, attemptId);
      throw new QuoteStoreError(
        "INVALID_SETTLEMENT",
        record.quote.quoteId,
        `Invalid settlement for quote ${record.quote.quoteId}: ${error instanceof Error ? error.message : "validation failed"}`
      );
    }

    if (!settlement.success) {
      return this.releaseProcessing(record, attemptId);
    }

    const preparedReceipt = record.preparedReceipt;
    if (preparedReceipt === undefined) {
      this.releaseProcessing(record, attemptId);
      throw new QuoteStoreError(
        "INVALID_SETTLEMENT",
        record.quote.quoteId,
        `Quote ${record.quote.quoteId} has no prepared receipt`
      );
    }

    // Read all timestamps before changing the record so an invalid clock can
    // never leave a quote half-transitioned.
    let updatedAt: string;
    try {
      updatedAt = this.now().toISOString();
    } catch (error) {
      this.releaseProcessing(record, attemptId);
      throw error;
    }

    const receipt: CustomsBrokerReceipt = {
      receiptId: preparedReceipt.receiptId,
      declarationId: preparedReceipt.declarationId,
      brokerFeeUsd: preparedReceipt.brokerFeeUsd,
      brokerAddress: preparedReceipt.brokerAddress,
      status: "filed",
      timestamp: preparedReceipt.timestamp
    };
    record.status = "FILED";
    record.attemptId = undefined;
    record.preparedReceipt = undefined;
    record.receipt = receipt;
    record.settlement = copySettlement(settlement);
    record.updatedAt = updatedAt;
    this.attempts.delete(attemptId);
    return this.copyRecord(record);
  }

  /** Compatibility wrapper that returns the filed receipt on success. */
  completeSettlement(
    quoteId: string,
    attemptId: string,
    result: unknown,
    expected: SettlementExpectation
  ): CustomsBrokerReceipt {
    const record = this.recordOrThrow(quoteId);
    this.assertCurrentAttempt(record, attemptId);
    const finished = this.finishSettlement(attemptId, result, expected);
    if (finished.receipt === undefined) {
      throw new QuoteStoreError(
        "SETTLEMENT_UNSUCCESSFUL",
        quoteId,
        `Settlement for quote ${quoteId} was not successful`
      );
    }
    return { ...finished.receipt };
  }

  markSettlementSucceeded(
    quoteId: string,
    attemptId: string,
    result: unknown,
    expected: SettlementExpectation
  ): CustomsBrokerReceipt {
    return this.completeSettlement(quoteId, attemptId, result, expected);
  }

  /** Releases a handler failure without accepting a stale attempt. */
  failProcessing(quoteId: string, attemptId: string): QuoteRecord {
    return this.rollbackProcessing(quoteId, attemptId);
  }

  /**
   * Rolls a processing quote back to OPEN while checking the ownership token.
   * The one-argument form is useful to callers that only retain the token;
   * the two-argument form also checks the expected quote id.
   */
  rollbackProcessing(attemptId: string): QuoteRecord;
  rollbackProcessing(quoteId: string, attemptId: string): QuoteRecord;
  rollbackProcessing(quoteIdOrAttemptId: string, maybeAttemptId?: string): QuoteRecord {
    const attemptId = maybeAttemptId ?? quoteIdOrAttemptId;
    const record = maybeAttemptId === undefined
      ? this.recordForAttempt(attemptId)
      : this.recordOrThrow(quoteIdOrAttemptId);
    this.assertCurrentAttempt(record, attemptId);
    return this.releaseProcessing(record, attemptId);
  }

  /** Settlement failures use the same atomic path as successful settlement. */
  markSettlementFailed(
    attemptId: string,
    result: unknown,
    expected: SettlementExpectation
  ): QuoteRecord {
    return this.finishSettlement(attemptId, result, expected);
  }

  private recordOrThrow(quoteId: string): QuoteRecord {
    const record = this.records.get(quoteId);
    if (record === undefined) {
      throw new QuoteStoreError("QUOTE_NOT_FOUND", quoteId, `Quote ${quoteId} was not found`);
    }
    return record;
  }

  private recordForAttempt(attemptId: string): QuoteRecord {
    const quoteId = this.attempts.get(attemptId);
    if (quoteId === undefined) {
      throw new QuoteStoreError(
        "STALE_PROCESSING_ATTEMPT",
        "",
        `Processing attempt ${attemptId} is stale or no longer owns a quote`
      );
    }
    const record = this.recordOrThrow(quoteId);
    this.assertCurrentAttempt(record, attemptId);
    return record;
  }

  private assertCurrentAttempt(record: QuoteRecord, attemptId: string): void {
    if (record.status !== "PROCESSING" || record.attemptId !== attemptId) {
      throw new QuoteStoreError(
        "STALE_PROCESSING_ATTEMPT",
        record.quote.quoteId,
        `Processing attempt ${attemptId} no longer owns quote ${record.quote.quoteId}`
      );
    }
  }

  private assertNotExpired(record: QuoteRecord, now: Date): void {
    if (this.isExpired(record, now)) {
      throw new QuoteStoreError(
        "QUOTE_EXPIRED",
        record.quote.quoteId,
        `Quote ${record.quote.quoteId} has expired`
      );
    }
  }

  /**
   * Reclaims only expired OPEN quotes before accepting a new quote. In-flight
   * PROCESSING attempts and terminal FILED records are intentionally retained
   * so settlement reconciliation and idempotency cannot be lost.
   */
  private pruneExpiredOpen(now: Date): void {
    for (const [quoteId, record] of this.records) {
      if (record.status === "OPEN" && this.isExpired(record, now)) {
        this.records.delete(quoteId);
      }
    }
  }

  private isExpired(record: QuoteRecord, now: Date): boolean {
    const expiresAt = Date.parse(record.quote.expiresAt);
    return !Number.isFinite(expiresAt) || expiresAt <= now.getTime();
  }

  private assertMatchingDocuments(record: QuoteRecord, documentsOrHash: DocumentsOrHash): void {
    const submittedHash = isDocuments(documentsOrHash)
      ? hashDocuments(documentsOrHash)
      : documentsOrHash;
    if (submittedHash !== record.documentsHash) {
      throw new QuoteStoreError(
        "QUOTE_DOCUMENT_MISMATCH",
        record.quote.quoteId,
        `Submitted documents do not match quote ${record.quote.quoteId}`
      );
    }
  }

  private releaseProcessing(record: QuoteRecord, attemptId: string): QuoteRecord {
    this.assertCurrentAttempt(record, attemptId);
    record.status = "OPEN";
    record.attemptId = undefined;
    record.preparedReceipt = undefined;
    record.receipt = undefined;
    record.settlement = undefined;
    try {
      record.updatedAt = this.now().toISOString();
    } catch {
      // Preserve the last valid timestamp while still releasing the lock.
    }
    this.attempts.delete(attemptId);
    return this.copyRecord(record);
  }

  private now(): Date {
    const timestamp = this.clock();
    if (!(timestamp instanceof Date) || !Number.isFinite(timestamp.getTime())) {
      throw new RangeError("QuoteStore clock must return a valid Date");
    }
    return new Date(timestamp.getTime());
  }

  private copyProcessingRecord(record: QuoteRecord): ProcessingQuoteRecord {
    if (record.status !== "PROCESSING" || record.attemptId === undefined) {
      throw new Error("Expected a processing quote record");
    }
    const copy = this.copyRecord(record);
    return {
      ...copy,
      status: "PROCESSING",
      attemptId: record.attemptId
    };
  }

  private copyRecord(record: QuoteRecord): QuoteRecord {
    return {
      quote: { ...record.quote },
      documentsHash: record.documentsHash,
      status: record.status,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      ...(record.attemptId === undefined ? {} : { attemptId: record.attemptId }),
      ...(record.preparedReceipt === undefined ? {} : { preparedReceipt: { ...record.preparedReceipt } }),
      ...(record.receipt === undefined ? {} : { receipt: { ...record.receipt } }),
      ...(record.settlement === undefined ? {} : { settlement: copySettlement(record.settlement) })
    };
  }
}
