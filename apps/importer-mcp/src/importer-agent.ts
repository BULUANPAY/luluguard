import { isDeepStrictEqual } from "node:util";
import { createHash, randomUUID } from "node:crypto";
import { decodePaymentResponseHeader } from "@x402/fetch";
import type { SettleResponse } from "@x402/core/types";
import { convertToTokenAmount, numberToDecimalString } from "@x402/core/utils";
import { z } from "zod";
import type { CustomsPowerOfAttorney } from "@luluguard/shared";
import type {
  AgentPolicy,
  CustomsBrokerReceipt,
  CustomsBrokerResponse,
  DutyQuote,
  ExportDocuments,
} from "./domain.js";
import { log } from "./logger.js";
import {
  isAllowedPayee,
  PaymentPolicyError,
  PaymentReservationError,
  PaymentReservationStore,
  type PaymentPolicyDecision,
  type PaymentRecord,
} from "./payment/policy.js";
import {
  reviewImportQuote,
  type ComplianceReview,
} from "./compliance-review.js";
import {
  reviewDocumentsBeforeTransmission,
  type DocumentReview,
} from "./document-review.js";
import { estimateImportCosts, type ImportEstimate } from "./import-estimate.js";
import type { PaymentDispatchAwareFetch } from "./payment/client.js";
import { newAuditId, writeAudit, type AuditStatus } from "./audit.js";
import type { VerifiedAgentAuthorization } from "./vlei-authorization.js";

export interface PreflightResult {
  preflightId: string;
  orderId: string;
  documents: ExportDocuments;
  documentReview: DocumentReview;
  independentEstimate?: ImportEstimate;
  readyForBroker: boolean;
  transmittedToBroker: false;
  audit: string[];
}

export interface QuoteResult {
  preflightId: string;
  orderId: string;
  documents: ExportDocuments;
  documentReview: DocumentReview;
  independentEstimate: ImportEstimate;
  estimateApproved: true;
  transmittedToBroker: true;
  quote: DutyQuote;
  complianceReview: ComplianceReview;
  audit: string[];
}

export interface SubmissionResult extends QuoteResult {
  paymentPolicyDecision: PaymentPolicyDecision;
  receipt: CustomsBrokerReceipt;
  settlement: SettleResponse;
}

export type SettlementReconciliationState = "pending" | "ambiguous";

export interface SettlementReconciliationRecord {
  brokerEndpoint: string;
  brokerAddress: string;
  network: string;
  quoteId: string;
  declarationId: string;
  documentsHash: string;
  attemptId: string;
  reservationId?: string;
  reservationIds?: string[];
  state: SettlementReconciliationState;
  reason: string;
  recordedAt: string;
  settlement?: SettleResponse;
}

const USDC_DECIMALS = 6;
const MAX_QUOTE_ERROR_BODY_LENGTH = 512;
const TRANSACTION_HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/;

const quoteMoney = z.number().finite().nonnegative();
const quoteExpiry = z.string()
  .trim()
  .min(1)
  .refine(value => Number.isFinite(Date.parse(value)), "expiresAt must be a valid date");
const dutyQuoteSchema = z.object({
  quoteId: z.string().trim().min(1),
  expiresAt: quoteExpiry,
  declarationId: z.string().trim().min(1),
  goodsValueUsd: quoteMoney,
  freightUsd: quoteMoney,
  insuranceUsd: quoteMoney,
  customsValueUsd: quoteMoney,
  appliedDutyRatePercent: quoteMoney,
  tariffBasis: z.literal("mock-tariff-profile"),
  dutyUsd: quoteMoney,
  taxUsd: quoteMoney,
  tradePromotionFeeUsd: quoteMoney,
  filingFeeUsd: quoteMoney,
  customsBrokerFeeUsd: quoteMoney,
  totalEstimatedUsd: quoteMoney
}).strict();
const customsQuoteResponseSchema = z.object({ quote: dutyQuoteSchema }).strict();

type SettlementReconciliationStore = Map<string, SettlementReconciliationRecord>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stableCanonicalize(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(item => stableCanonicalize(item)).join(",")}]`;
  }
  if (isRecord(value)) {
    return `{${Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableCanonicalize(entry)}`)
      .join(",")}}`;
  }
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new TypeError("Reconciliation identity contains an unsupported value");
  return serialized;
}

function normalizeBrokerEndpoint(endpoint: string): string {
  try {
    const url = new URL(endpoint);
    url.hash = "";
    url.search = "";
    url.pathname = url.pathname.replace(/\/+$/, "");
    return url.toString().replace(/\/$/, "");
  } catch {
    return endpoint.trim().replace(/\/+$/, "");
  }
}

function hashDocumentsForReconciliation(documents: ExportDocuments): string {
  const normalized = {
    ...documents,
    providedDocuments: [...documents.providedDocuments].sort()
  };
  return createHash("sha256").update(stableCanonicalize(normalized), "utf8").digest("hex");
}

interface SettlementReconciliationIdentity {
  brokerEndpoint: string;
  brokerAddress: string;
  network: string;
  quoteId: string;
  declarationId: string;
  documentsHash: string;
}

function reconciliationIdentity(
  brokerEndpoint: string,
  brokerAddress: string,
  network: string,
  quoteId: string,
  declarationId: string,
  documents: ExportDocuments
): SettlementReconciliationIdentity {
  return {
    brokerEndpoint: normalizeBrokerEndpoint(brokerEndpoint),
    brokerAddress: brokerAddress.trim().toLowerCase(),
    network: network.trim().toLowerCase(),
    quoteId: quoteId.trim(),
    declarationId: declarationId.trim(),
    documentsHash: hashDocumentsForReconciliation(documents)
  };
}

function reconciliationBaseKey(identity: SettlementReconciliationIdentity): string {
  const {
    brokerEndpoint,
    brokerAddress,
    network,
    quoteId,
    declarationId,
    documentsHash
  } = identity;
  return createHash("sha256").update(stableCanonicalize({
    brokerEndpoint,
    brokerAddress,
    network,
    quoteId,
    declarationId,
    documentsHash
  }), "utf8").digest("hex");
}

function reconciliationRecordKey(
  identity: SettlementReconciliationIdentity,
  attemptId: string
): string {
  return createHash("sha256")
    .update(stableCanonicalize({ ...identity, attemptId }), "utf8")
    .digest("hex");
}

function reconciliationReservationIds(
  record: SettlementReconciliationRecord,
  additionalReservationId?: string
): string[] {
  const ids = [...(record.reservationIds ?? [])];
  if (record.reservationId !== undefined && !ids.includes(record.reservationId)) {
    ids.unshift(record.reservationId);
  }
  if (additionalReservationId !== undefined && !ids.includes(additionalReservationId)) {
    ids.push(additionalReservationId);
  }
  return ids;
}

function exactUsdcAtomicAmount(amountUsdc: number, label: string): string {
  const decimalAmount = numberToDecimalString(amountUsdc);
  const fractionalPart = decimalAmount.split(".")[1] ?? "";
  const excessPrecision = fractionalPart.slice(USDC_DECIMALS);
  if (/[1-9]/.test(excessPrecision)) {
    throw new Error(
      `${label} ${amountUsdc} cannot be represented exactly with USDC's ${USDC_DECIMALS} decimals`
    );
  }
  return convertToTokenAmount(decimalAmount, USDC_DECIMALS);
}

function expectedUsdcAtomicAmount(amountUsdc: number): string {
  return exactUsdcAtomicAmount(amountUsdc, "Configured broker fee");
}

function isNonZeroTransactionHash(value: string): boolean {
  return TRANSACTION_HASH_PATTERN.test(value) && !/^0x0{64}$/i.test(value);
}

function validateSettlement(
  value: unknown,
  expectedNetwork: string,
  importerAddress: string,
  expectedAmount: string
): asserts value is SettleResponse {
  if (!isRecord(value)) {
    throw new Error("PAYMENT-RESPONSE settlement must be a JSON object");
  }
  if (value.success !== true) {
    const reason = typeof value.errorReason === "string" ? `: ${value.errorReason}` : "";
    throw new Error(`PAYMENT-RESPONSE settlement was not successful${reason}`);
  }
  if (typeof value.transaction !== "string" || value.transaction.trim().length === 0) {
    throw new Error("PAYMENT-RESPONSE settlement transaction is required");
  }
  if (!isNonZeroTransactionHash(value.transaction)) {
    throw new Error("PAYMENT-RESPONSE settlement transaction must be a non-zero 32-byte hash");
  }
  if (value.network !== expectedNetwork) {
    throw new Error(
      `PAYMENT-RESPONSE settlement network ${String(value.network)} does not match ${expectedNetwork}`
    );
  }
  if (value.payer !== undefined) {
    if (typeof value.payer !== "string" || value.payer.toLowerCase() !== importerAddress.toLowerCase()) {
      throw new Error("PAYMENT-RESPONSE settlement payer does not match the importer address");
    }
  }
  if (value.amount !== undefined) {
    if (typeof value.amount !== "string" || !/^(0|[1-9][0-9]*)$/.test(value.amount)) {
      throw new Error("PAYMENT-RESPONSE settlement amount must be atomic USDC units");
    }
    try {
      if (BigInt(value.amount) !== BigInt(expectedAmount)) {
        throw new Error(
          `PAYMENT-RESPONSE settlement amount ${value.amount} does not match ${expectedAmount} atomic USDC units`
        );
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes("does not match")) throw error;
      throw new Error("PAYMENT-RESPONSE settlement amount must be atomic USDC units", { cause: error });
    }
  }
}

function decodeSettlementHeader(header: string): unknown {
  try {
    return decodePaymentResponseHeader(header);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid PAYMENT-RESPONSE settlement header: ${message}`, { cause: error });
  }
}

function isSettleResponse(value: unknown): value is SettleResponse {
  return isRecord(value) &&
    typeof value.success === "boolean" &&
    typeof value.transaction === "string" &&
    typeof value.network === "string";
}

function isSettlementPending(value: unknown): value is SettleResponse {
  return isRecord(value) &&
    !value.success &&
    typeof value.errorReason === "string" &&
    value.errorReason.trim().toLowerCase() === "settlement_pending";
}

function settlementSummary(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) return {};
  return {
    ...(typeof value.success === "boolean" ? { success: value.success } : {}),
    ...(typeof value.transaction === "string" ? { transaction: value.transaction } : {}),
    ...(typeof value.network === "string" ? { network: value.network } : {}),
    ...(typeof value.payer === "string" ? { payer: value.payer } : {}),
    ...(typeof value.amount === "string" ? { amount: value.amount } : {}),
    ...(typeof value.errorReason === "string" ? { errorReason: value.errorReason } : {})
  };
}

function settlementDiagnostic(header: string | null): string | undefined {
  if (!header) return undefined;
  try {
    return `PAYMENT-RESPONSE=${JSON.stringify(settlementSummary(decodePaymentResponseHeader(header)))}`;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `PAYMENT-RESPONSE could not be decoded (${message})`;
  }
}

function boundedResponseBody(body: string): string {
  const normalized = body.replace(/\s+/g, " ").trim();
  if (normalized.length <= MAX_QUOTE_ERROR_BODY_LENGTH) return normalized;
  return `${normalized.slice(0, MAX_QUOTE_ERROR_BODY_LENGTH - 1)}…`;
}

function paymentResponseHeader(response: Response, includeLegacyAlias: boolean): string | null {
  const canonical = response.headers.get("payment-response");
  if (canonical !== null || !includeLegacyAlias) return canonical;
  return response.headers.get("x-payment-response");
}

function cloneSettlement(settlement: SettleResponse): SettleResponse {
  return { ...settlement };
}

function paymentWasDispatched(fetch: PaymentDispatchAwareFetch): boolean {
  if (typeof fetch.getPaymentDispatchState !== "function") {
    throw new Error("Payment dispatch tracking is required for paidFetch");
  }
  const dispatched = fetch.getPaymentDispatchState();
  if (typeof dispatched !== "boolean") {
    throw new Error("Payment dispatch tracking must return a boolean");
  }
  return dispatched;
}

function validateBrokerResponse(
  value: unknown,
  expectedQuote: QuoteResult,
  expectedBrokerAddress: string,
  expectedBrokerFeeAtomic: string
): CustomsBrokerResponse {
  if (!isRecord(value) || !isRecord(value.quote) || !isRecord(value.receipt)) {
    throw new Error("Customs broker response must contain a quote and receipt");
  }
  const receivedQuote = value.quote;
  if (
    receivedQuote.quoteId !== expectedQuote.quote.quoteId ||
    receivedQuote.declarationId !== expectedQuote.quote.declarationId
  ) {
    throw new Error("Customs broker response quote does not match the reviewed quote");
  }
  const quoteFields: Array<keyof DutyQuote> = [
    "expiresAt",
    "goodsValueUsd",
    "freightUsd",
    "insuranceUsd",
    "customsValueUsd",
    "appliedDutyRatePercent",
    "tariffBasis",
    "dutyUsd",
    "taxUsd",
    "tradePromotionFeeUsd",
    "filingFeeUsd",
    "customsBrokerFeeUsd",
    "totalEstimatedUsd"
  ];
  for (const field of quoteFields) {
    if (receivedQuote[field] !== expectedQuote.quote[field]) {
      throw new Error(`Customs broker response quote field ${field} does not match the reviewed quote`);
    }
  }
  let receivedQuoteBrokerFeeAtomic: string;
  try {
    receivedQuoteBrokerFeeAtomic = exactUsdcAtomicAmount(
      receivedQuote.customsBrokerFeeUsd as number,
      "Broker quote fee"
    );
  } catch {
    throw new Error("Customs broker response quote has an invalid broker fee");
  }
  if (receivedQuoteBrokerFeeAtomic !== expectedBrokerFeeAtomic) {
    throw new Error("Customs broker response quote has an unexpected broker fee");
  }

  const receipt = value.receipt;
  if (typeof receipt.brokerFeeUsd !== "number" || !Number.isFinite(receipt.brokerFeeUsd)) {
    throw new Error("Customs broker response receipt has an invalid broker fee");
  }
  let receiptBrokerFeeAtomic: string;
  try {
    receiptBrokerFeeAtomic = exactUsdcAtomicAmount(
      receipt.brokerFeeUsd,
      "Broker receipt fee"
    );
  } catch {
    throw new Error("Customs broker response receipt has an invalid broker fee");
  }
  if (
    typeof receipt.receiptId !== "string" ||
    receipt.receiptId.trim().length === 0 ||
    receipt.declarationId !== expectedQuote.quote.declarationId ||
    receipt.status !== "filed" ||
    typeof receipt.brokerAddress !== "string" ||
    receiptBrokerFeeAtomic !== expectedBrokerFeeAtomic ||
    typeof receipt.timestamp !== "string" ||
    !Number.isFinite(Date.parse(receipt.timestamp))
  ) {
    throw new Error("Customs broker response receipt is invalid or does not match the payment");
  }
  if (receipt.brokerAddress.toLowerCase() !== expectedBrokerAddress.toLowerCase()) {
    throw new Error("Broker receipt address does not match the approved payee");
  }

  return value as unknown as CustomsBrokerResponse;
}

export class PaymentCoordinator {
  private tail: Promise<void> = Promise.resolve();

  async runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    let release: () => void = () => undefined;
    const turn = new Promise<void>((resolve) => {
      release = resolve;
    });
    const previous = this.tail;
    this.tail = turn;

    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }
}

export class ImporterAgent {
  constructor(
    private readonly customsBrokerApiUrl: string,
    private readonly policy: AgentPolicy,
    private readonly fetch: typeof globalThis.fetch,
    private readonly paidFetch: PaymentDispatchAwareFetch,
    private readonly brokerFeeUsd: number,
    private readonly brokerAddress: string,
    private readonly importerAddress: string,
    private readonly preflightStore = new Map<string, PreflightResult>(),
    private readonly quoteStore = new Map<string, QuoteResult>(),
    private readonly paymentHistory: PaymentRecord[] = [],
    private readonly x402Network = "eip155:84532",
    private readonly settlementPending: SettlementReconciliationStore = new Map(),
    private readonly paymentReservations = new PaymentReservationStore(),
    private readonly paymentCoordinator = new PaymentCoordinator(),
    private readonly traceId = newAuditId("TRACE"),
    private readonly identity?: VerifiedAgentAuthorization,
  ) {
    if (x402Network !== "eip155:84532") {
      throw new Error("X402_NETWORK must be eip155:84532 for the testnet importer");
    }
  }

  getPendingSettlement(quoteId: string): SettleResponse | undefined {
    const record = this.findSettlementReconciliation(quoteId)?.record;
    return record?.settlement === undefined ? undefined : cloneSettlement(record.settlement);
  }

  getSettlementReconciliation(quoteId: string): SettlementReconciliationRecord | undefined {
    const record = this.findSettlementReconciliation(quoteId)?.record;
    if (record === undefined) return undefined;
    return {
      ...record,
      ...(record.reservationIds === undefined ? {} : { reservationIds: [...record.reservationIds] }),
      ...(record.settlement === undefined ? {} : { settlement: cloneSettlement(record.settlement) })
    };
  }

  markSettlementReconciled(
    orderId: string,
    quoteId: string,
    attemptId: string,
    terminalSettlement: SettleResponse
  ): boolean {
    const reviewedQuote = this.quoteStore.get(quoteId);
    if (!reviewedQuote || reviewedQuote.orderId !== orderId) {
      throw new Error("A matching reviewed broker quote is required for reconciliation");
    }
    const identity = reconciliationIdentity(
      this.customsBrokerApiUrl,
      this.brokerAddress,
      this.x402Network,
      quoteId,
      reviewedQuote.quote.declarationId,
      reviewedQuote.documents
    );
    const current = this.findSettlementReconciliation(identity);
    if (current === undefined || current.record.attemptId !== attemptId) return false;
    this.validateTerminalFailure(terminalSettlement);
    this.validateReconciliationTransaction(current.record, terminalSettlement);
    if (!this.clearSettlementReconciliation(identity, attemptId)) return false;
    for (const reservationId of reconciliationReservationIds(current.record)) {
      this.paymentReservations.release(reservationId);
    }
    this.paymentReservations.releaseAllForQuote(quoteId);
    log("warn", "payment-audit", "payment.reconciled", {
      orderId,
      quoteId,
      attemptId,
      priorState: current.record.state,
      priorReason: current.record.reason,
      transaction: terminalSettlement.transaction,
      network: terminalSettlement.network,
      payer: terminalSettlement.payer,
      terminalErrorReason: terminalSettlement.errorReason
    });
    return true;
  }

  private validateReconciliationTransaction(
    record: SettlementReconciliationRecord,
    terminalSettlement: SettleResponse
  ): void {
    const recordedTransaction = record.settlement?.transaction;
    if (recordedTransaction === undefined || recordedTransaction === "") return;
    if (!isNonZeroTransactionHash(recordedTransaction)) {
      throw new Error("Recorded reconciliation transaction is not a valid non-zero 32-byte hash");
    }
    if (terminalSettlement.transaction.toLowerCase() !== recordedTransaction.toLowerCase()) {
      throw new Error("Reconciled settlement transaction does not match the recorded transaction");
    }
  }

  private recordSettlementReconciliation(
    identity: SettlementReconciliationIdentity,
    attemptId: string,
    reservationId: string | undefined,
    state: SettlementReconciliationState,
    reason: string,
    settlement?: SettleResponse
  ): SettlementReconciliationRecord {
    const current = this.findSettlementReconciliation(identity);
    if (current !== undefined && current.record.attemptId !== attemptId) {
      const reservationIds = reconciliationReservationIds(current.record, reservationId);
      if (reservationIds.length === reconciliationReservationIds(current.record).length) {
        return current.record;
      }
      const updatedRecord: SettlementReconciliationRecord = {
        ...current.record,
        reservationIds
      };
      this.settlementPending.set(current.key, updatedRecord);
      return updatedRecord;
    }
    const reservationIds = current === undefined
      ? reservationId === undefined ? [] : [reservationId]
      : reconciliationReservationIds(current.record, reservationId);
    const record: SettlementReconciliationRecord = {
      ...identity,
      attemptId,
      ...(reservationId === undefined ? {} : { reservationId }),
      ...(reservationIds.length > 1 ? { reservationIds } : {}),
      state,
      reason,
      recordedAt: new Date().toISOString(),
      ...(settlement === undefined ? {} : { settlement: cloneSettlement(settlement) })
    };
    if (current !== undefined) this.settlementPending.delete(current.key);
    this.settlementPending.set(reconciliationRecordKey(identity, attemptId), record);
    return record;
  }

  private findSettlementReconciliation(
    quoteIdOrIdentity: string | SettlementReconciliationIdentity
  ): { key: string; record: SettlementReconciliationRecord } | undefined {
    const target = typeof quoteIdOrIdentity === "string"
      ? undefined
      : reconciliationBaseKey(quoteIdOrIdentity);
    for (const [key, record] of this.settlementPending) {
      if (
        target !== undefined
          ? reconciliationBaseKey(record) === target
          : record.quoteId === quoteIdOrIdentity
      ) {
        return { key, record };
      }
    }
    return undefined;
  }

  private clearSettlementReconciliation(
    identity: SettlementReconciliationIdentity,
    attemptId: string
  ): boolean {
    const current = this.findSettlementReconciliation(identity);
    if (current === undefined || current.record.attemptId !== attemptId) return false;
    this.settlementPending.delete(current.key);
    return true;
  }

  private validateTerminalFailure(settlement: SettleResponse): void {
    if (!isSettleResponse(settlement) || settlement.success !== false) {
      throw new Error("Only a verified terminal failed settlement can clear reconciliation");
    }
    if (
      typeof settlement.errorReason !== "string" ||
      settlement.errorReason.trim().length === 0 ||
      settlement.errorReason.trim().toLowerCase() === "settlement_pending"
    ) {
      throw new Error("A terminal failure reason is required; settlement_pending is not terminal");
    }
    if (settlement.transaction !== "" && !isNonZeroTransactionHash(settlement.transaction)) {
      throw new Error("Reconciled settlement transaction must be a non-zero 32-byte hash when provided");
    }
    if (settlement.network !== this.x402Network) {
      throw new Error(`Reconciled settlement network ${settlement.network} does not match ${this.x402Network}`);
    }
    if (settlement.payer !== undefined &&
      settlement.payer.toLowerCase() !== this.importerAddress.toLowerCase()) {
      throw new Error("Reconciled settlement payer does not match the importer address");
    }
    if (settlement.amount !== undefined) {
      const expectedAmount = expectedUsdcAtomicAmount(this.brokerFeeUsd);
      if (settlement.amount !== expectedAmount) {
        throw new Error(`Reconciled settlement amount ${settlement.amount} does not match ${expectedAmount}`);
      }
    }
  }

  private recordPostPaymentValidationFailure(
    paymentAttemptId: string,
    auditId: string,
    orderId: string,
    quoteId: string,
    declarationId: string,
    documents: ExportDocuments,
    reason: string,
    settlement?: SettleResponse,
    reservationId?: string
  ): SettlementReconciliationRecord {
    let record: SettlementReconciliationRecord;
    try {
      const identity = reconciliationIdentity(
        this.customsBrokerApiUrl,
        this.brokerAddress,
        this.x402Network,
        quoteId,
        declarationId,
        documents
      );
      record = this.recordSettlementReconciliation(
        identity,
        paymentAttemptId,
        reservationId,
        isSettlementPending(settlement) ? "pending" : "ambiguous",
        reason,
        settlement
      );
    } catch (error) {
      if (reservationId !== undefined) this.paymentReservations.holdAmbiguous(reservationId);
      throw error;
    }
    log("error", "payment-audit", "payment.reconciliation_required", {
      paymentAttemptId,
      auditId,
      orderId,
      quoteId,
      state: record.state,
      reason: record.reason,
      settlement: settlementSummary(settlement)
    });
    return record;
  }

  private recordDispatchTrackingFailure(
    paymentAttemptId: string,
    auditId: string,
    orderId: string,
    quoteId: string,
    declarationId: string,
    documents: ExportDocuments,
    reservationId: string
  ): void {
    try {
      this.recordPostPaymentValidationFailure(
        paymentAttemptId,
        auditId,
        orderId,
        quoteId,
        declarationId,
        documents,
        "payment_dispatch_tracking_failed",
        undefined,
        reservationId
      );
    } catch (recordError) {
      log("error", "payment-audit", "payment.reconciliation_record_failed", {
        paymentAttemptId,
        auditId,
        orderId,
        quoteId,
        reason: "payment_dispatch_tracking_failed",
        message: recordError instanceof Error ? recordError.message : String(recordError)
      });
    } finally {
      this.paymentReservations.holdAmbiguous(reservationId);
    }
  }

  private audit(
    action: string,
    status: AuditStatus,
    data?: unknown,
    spanId?: string,
  ) {
    writeAudit({
      traceId: this.traceId,
      spanId,
      component: "importer-agent",
      action,
      status,
      actor: this.identity?.userId ?? "importer-agent",
      tenantId: this.identity?.tenantId,
      userId: this.identity?.userId,
      sessionId: this.identity?.sessionId,
      agentId: "luluguard-importer-agent",
      agentRunId: this.identity?.agentRunId,
      data,
    });
  }

  precheck(orderId: string, documents: ExportDocuments): PreflightResult {
    const audit: string[] = [];
    const preflightId = `PREFLIGHT-${randomUUID()}`;
    this.audit(
      "preflight.review",
      "attempted",
      { orderId, providedDocuments: documents.providedDocuments },
      preflightId,
    );
    log("info", "importer-agent", "preflight.started", {
      orderId,
      providedDocuments: documents.providedDocuments,
    });
    audit.push("Loaded export documents from the order's uploaded files");
    const documentReview = reviewDocumentsBeforeTransmission(documents);
    audit.push(
      `Document review completed; readyToTransmit=${documentReview.readyToTransmit}`,
    );
    const independentEstimate = documentReview.readyToTransmit
      ? estimateImportCosts(documents, this.brokerFeeUsd)
      : undefined;
    if (independentEstimate)
      audit.push(
        "Generated independent importer estimate; broker was not contacted",
      );
    const result: PreflightResult = {
      preflightId,
      orderId,
      documents,
      documentReview,
      independentEstimate,
      readyForBroker: documentReview.readyToTransmit,
      transmittedToBroker: false,
      audit,
    };
    this.preflightStore.set(preflightId, result);
    this.audit(
      "preflight.review",
      "succeeded",
      {
        input: { orderId, providedDocuments: documents.providedDocuments },
        result,
      },
      preflightId,
    );
    log(
      documentReview.readyToTransmit ? "info" : "warn",
      "importer-agent",
      "preflight.completed",
      {
        orderId,
        preflightId,
        readyForBroker: result.readyForBroker,
        estimatedTotalUsd: independentEstimate?.estimatedTotalUsd,
        transmittedToBroker: false,
      },
    );
    return result;
  }

  async getQuote(
    preflightId: string,
    estimateApproved: boolean,
    powerOfAttorney: CustomsPowerOfAttorney,
  ): Promise<QuoteResult> {
    this.audit(
      "broker-quote.prepare",
      "attempted",
      { preflightId, estimateApproved },
      preflightId,
    );
    const preflight = this.preflightStore.get(preflightId);
    if (!preflight) {
      this.audit(
        "broker-quote.prepare",
        "blocked",
        { preflightId, reason: "PREFLIGHT_NOT_FOUND" },
        preflightId,
      );
      throw new Error(
        "A valid importer preflight is required before broker quotation",
      );
    }
    if (!preflight.readyForBroker || !preflight.independentEstimate) {
      this.audit(
        "broker-quote.prepare",
        "blocked",
        { preflightId, reason: "DOCUMENT_REVIEW_NOT_READY", preflight },
        preflightId,
      );
      throw new Error("Document review must pass before broker quotation");
    }
    if (!estimateApproved) {
      this.audit(
        "broker-quote.prepare",
        "blocked",
        { preflightId, reason: "ESTIMATE_NOT_APPROVED" },
        preflightId,
      );
      throw new Error(
        "The user must confirm the independent estimate before documents are sent to the broker",
      );
    }
    const {
      orderId,
      documents: preflightDocuments,
      documentReview,
      independentEstimate,
    } =
      preflight;
    if (powerOfAttorney.orderId !== orderId) {
      throw new Error("Power of attorney does not match the preflight order");
    }
    if (!Number.isFinite(Date.parse(powerOfAttorney.acceptedAt))) {
      throw new Error("Power of attorney acceptance time is invalid");
    }
    const documents: ExportDocuments = {
      ...preflightDocuments,
      powerOfAttorney,
      providedDocuments: [
        ...new Set([
          ...preflightDocuments.providedDocuments,
          "power_of_attorney" as const,
        ]),
      ],
    };
    this.validateDocuments(documents);
    const audit = [
      ...preflight.audit,
      "User confirmed the independent estimate",
      `Attached signed power of attorney ${powerOfAttorney.documentId}`,
    ];
    log("info", "importer-agent", "broker_quote.started", {
      orderId,
      preflightId,
    });
    const brokerUrl = `${this.customsBrokerApiUrl}/customs/quotes`;
    this.audit(
      "broker.http.request",
      "attempted",
      { method: "POST", url: brokerUrl, body: documents },
      preflightId,
    );
    let response: Response;
    try {
      response = await this.fetch(brokerUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-audit-trace-id": this.traceId,
        },
        body: JSON.stringify(documents),
      });
    } catch (error) {
      this.audit(
        "broker.http.request",
        "failed",
        { method: "POST", url: brokerUrl, error },
        preflightId,
      );
      throw error;
    }
    if (!response.ok) {
      const responseText = await response.text();
      this.audit(
        "broker.http.response",
        "failed",
        { url: brokerUrl, status: response.status, body: responseText },
        preflightId,
      );
      const responseBody = boundedResponseBody(responseText);
      throw new Error(
        `Customs quote failed: ${response.status}`
        + (responseBody ? `; ${responseBody}` : "")
      );
    }
    let rawQuoteResponse: unknown;
    try {
      rawQuoteResponse = await response.json();
    } catch (error) {
      throw new Error("Customs broker quote response is not valid JSON", { cause: error });
    }
    const parsedQuoteResponse = customsQuoteResponseSchema.safeParse(rawQuoteResponse);
    if (!parsedQuoteResponse.success) {
      throw new Error(
        `Customs broker quote is invalid: ${parsedQuoteResponse.error.issues
          .map(issue => `${issue.path.join(".") || "response"} ${issue.message}`)
          .join("; ")}`
      );
    }
    const quote = parsedQuoteResponse.data.quote;
    this.audit(
      "broker.http.response",
      "succeeded",
      { url: brokerUrl, status: response.status, body: { quote } },
      preflightId,
    );
    const complianceReview = reviewImportQuote(
      documents,
      quote,
      this.brokerFeeUsd,
    );
    audit.push(
      `Received broker quote ${quote.quoteId} and compared it with the independent estimate`,
    );
    const result: QuoteResult = {
      preflightId,
      orderId,
      documents,
      documentReview,
      independentEstimate,
      estimateApproved: true,
      transmittedToBroker: true,
      quote,
      complianceReview,
      audit,
    };
    this.quoteStore.set(quote.quoteId, result);
    this.audit("broker-quote.review", "succeeded", { result }, preflightId);
    log("info", "importer-agent", "broker_quote.completed", {
      orderId,
      preflightId,
      quoteId: quote.quoteId,
      independentEstimateUsd: independentEstimate.estimatedTotalUsd,
      brokerEstimateUsd: quote.totalEstimatedUsd,
      paymentAllowed: complianceReview.paymentAllowed,
    });
    return result;
  }

  async submit(
    orderId: string,
    quoteId: string,
    humanApproved = false,
  ): Promise<SubmissionResult> {
    return this.paymentCoordinator.runExclusive(() =>
      this.submitExclusive(orderId, quoteId, humanApproved),
    );
  }

  private async submitExclusive(
    orderId: string,
    quoteId: string,
    humanApproved: boolean,
  ): Promise<SubmissionResult> {
    const audit: string[] = [];
    const paymentAttemptId = `ATTEMPT-${randomUUID()}`;
    this.audit(
      "payment.submit",
      "attempted",
      { orderId, quoteId, humanApproved },
      paymentAttemptId,
    );
    log("info", "payment-audit", "payment.attempted", {
      paymentAttemptId,
      orderId,
      quoteId,
      humanApproved,
    });
    const reviewedQuote = this.quoteStore.get(quoteId);
    if (!reviewedQuote || reviewedQuote.orderId !== orderId) {
      this.audit(
        "payment.submit",
        "blocked",
        { orderId, quoteId, reason: "REVIEWED_QUOTE_NOT_FOUND" },
        paymentAttemptId,
      );
      log("warn", "payment-audit", "payment.precondition_blocked", {
        paymentAttemptId,
        orderId,
        quoteId,
        reasonCode: "REVIEWED_QUOTE_NOT_FOUND",
      });
      throw new Error(
        "A matching reviewed broker quote is required before payment",
      );
    }
    const { documents } = reviewedQuote;
    const operationIdentity = reconciliationIdentity(
      this.customsBrokerApiUrl,
      this.brokerAddress,
      this.x402Network,
      quoteId,
      reviewedQuote.quote.declarationId,
      documents
    );
    const reconciliation = this.findSettlementReconciliation(operationIdentity)?.record;
    if (reconciliation !== undefined) {
      log("warn", "payment-audit", "payment.reconciliation_required", {
        paymentAttemptId,
        orderId,
        quoteId,
        state: reconciliation.state,
        reason: reconciliation.reason,
        transaction: reconciliation.settlement?.transaction,
        network: reconciliation.settlement?.network,
        payer: reconciliation.settlement?.payer
      });
      throw new Error(
        "A previous settlement is pending reconciliation or has an ambiguous outcome that requires reconciliation; refusing to submit the declaration again"
      );
    }
    const expectedBrokerFeeAtomic = expectedUsdcAtomicAmount(this.brokerFeeUsd);
    if (!reviewedQuote.complianceReview.paymentAllowed) {
      this.audit(
        "payment.submit",
        "blocked",
        {
          orderId,
          quoteId,
          reason: "COMPLIANCE_REVIEW_BLOCKED",
          complianceReview: reviewedQuote.complianceReview,
        },
        paymentAttemptId,
      );
      log("warn", "payment-audit", "payment.precondition_blocked", {
        paymentAttemptId,
        orderId,
        quoteId,
        reasonCode: "COMPLIANCE_REVIEW_BLOCKED",
      });
      throw new Error(
        "Broker quote comparison blocked payment; resolve blocker findings before filing",
      );
    }
    const quoteExpiresAt = Date.parse(reviewedQuote.quote.expiresAt);
    if (!Number.isFinite(quoteExpiresAt) || quoteExpiresAt <= Date.now()) {
      this.audit(
        "payment.submit",
        "blocked",
        {
          orderId,
          quoteId,
          reason: "QUOTE_EXPIRED",
          expiresAt: reviewedQuote.quote.expiresAt,
        },
        paymentAttemptId,
      );
      log("warn", "payment-audit", "payment.precondition_blocked", {
        paymentAttemptId,
        orderId,
        quoteId,
        reasonCode: "QUOTE_EXPIRED",
        expiresAt: reviewedQuote.quote.expiresAt,
      });
      throw new Error("Broker quote expired before payment");
    }
    this.validateDocuments(documents);
    paymentWasDispatched(this.paidFetch);
    log("info", "payment-audit", "policy.evaluation.started", {
      paymentAttemptId,
      orderId,
      quoteId,
      amountUsdc: this.brokerFeeUsd,
      payee: this.brokerAddress,
      humanApproved,
    });
    let paymentPolicyDecision: PaymentPolicyDecision;
    let reservationId: string;
    try {
      const reservation = this.paymentReservations.reserve(
        this.policy,
        this.brokerFeeUsd,
        this.brokerAddress,
        humanApproved,
        this.paymentHistory,
        quoteId
      );
      paymentPolicyDecision = reservation.decision;
      reservationId = reservation.reservationId;
    } catch (error) {
      if (error instanceof PaymentPolicyError) {
        log("warn", "payment-audit", "policy.evaluation.blocked", {
          paymentAttemptId,
          orderId,
          quoteId,
          ...error.decision,
        });
      } else if (error instanceof PaymentReservationError) {
        log("warn", "payment-audit", "policy.evaluation.blocked", {
          paymentAttemptId,
          orderId,
          quoteId,
          reasonCode: error.reasonCode,
          reservationId: error.reservation.reservationId
        });
      }
      this.audit(
        "payment.policy-evaluation",
        "blocked",
        { orderId, quoteId, error },
        paymentAttemptId,
      );
      throw error;
    }
    this.audit(
      "payment.policy-evaluation",
      "succeeded",
      { orderId, quoteId, decision: paymentPolicyDecision },
      paymentAttemptId,
    );
    audit.push(
      `Payment policy approved; auditId=${paymentPolicyDecision.auditId}`,
    );
    log("info", "payment-audit", "policy.evaluation.allowed", {
      orderId,
      quoteId,
      paymentAttemptId,
      ...paymentPolicyDecision,
      importerAddress: this.importerAddress,
      brokerAddress: this.brokerAddress,
      networkAction: "x402-payment",
    });
    log("info", "payment-audit", "payment.dispatched", {
      paymentAttemptId,
      auditId: paymentPolicyDecision.auditId,
      orderId,
      quoteId,
      amountUsdc: this.brokerFeeUsd,
    });
    let paidResponse: Response;
    const declarationUrl = `${this.customsBrokerApiUrl}/customs/declarations`;
    this.audit(
      "broker.paid-http.request",
      "attempted",
      {
        method: "POST",
        url: declarationUrl,
        body: {
          quoteId,
          documents,
          documentReview: reviewedQuote.documentReview,
        },
        paymentPolicyDecision,
      },
      paymentAttemptId,
    );
    try {
      paidResponse = await this.paidFetch(declarationUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-audit-trace-id": this.traceId,
        },
        body: JSON.stringify({
          quoteId,
          documents,
        }),
      });
    } catch (error) {
      let dispatched = false;
      let dispatchTrackingFailed = false;
      try {
        dispatched = paymentWasDispatched(this.paidFetch);
      } catch (trackingError) {
        dispatchTrackingFailed = true;
        this.recordDispatchTrackingFailure(
          paymentAttemptId,
          paymentPolicyDecision.auditId,
          orderId,
          quoteId,
          reviewedQuote.quote.declarationId,
          documents,
          reservationId
        );
        log("error", "payment-audit", "payment.dispatch_tracking_failed", {
          auditId: paymentPolicyDecision.auditId,
          paymentAttemptId,
          orderId,
          quoteId,
          message: trackingError instanceof Error ? trackingError.message : String(trackingError)
        });
      }
      log("error", "payment-audit", "payment.transport_failed", {
        auditId: paymentPolicyDecision.auditId,
        paymentAttemptId,
        orderId,
        quoteId,
        paymentDispatched: dispatched,
        message: error instanceof Error ? error.message : String(error),
      });
      this.audit(
        "broker.paid-http.request",
        "failed",
        { method: "POST", url: declarationUrl, error },
        paymentAttemptId,
      );
      if (dispatchTrackingFailed || dispatched) {
        if (dispatchTrackingFailed) {
          throw error;
        }
        this.recordPostPaymentValidationFailure(
          paymentAttemptId,
          paymentPolicyDecision.auditId,
          orderId,
          quoteId,
          reviewedQuote.quote.declarationId,
          documents,
          "payment_transport_error",
          undefined,
          reservationId
        );
        this.paymentReservations.holdAmbiguous(reservationId);
      } else {
        this.paymentReservations.release(reservationId);
      }
      throw error;
    }
    let paymentDispatched: boolean;
    try {
      paymentDispatched = paymentWasDispatched(this.paidFetch);
    } catch (error) {
      this.recordDispatchTrackingFailure(
        paymentAttemptId,
        paymentPolicyDecision.auditId,
        orderId,
        quoteId,
        reviewedQuote.quote.declarationId,
        documents,
        reservationId
      );
      throw error;
    }
    if (!paidResponse.ok) {
      const responseText = await paidResponse.text();
      const responseBody = boundedResponseBody(responseText);
      const paymentResponse = paymentResponseHeader(paidResponse, true);
      let decodedSettlement: unknown;
      let decodeFailed = false;
      if (paymentResponse) {
        try {
          decodedSettlement = decodeSettlementHeader(paymentResponse);
        } catch {
          decodeFailed = true;
        }
      }
      let reconciliation: SettlementReconciliationRecord | undefined;
      if (paymentDispatched) {
        if (!paymentResponse) {
          reconciliation = this.recordPostPaymentValidationFailure(
            paymentAttemptId,
            paymentPolicyDecision.auditId,
            orderId,
            quoteId,
            reviewedQuote.quote.declarationId,
            documents,
            "non_2xx_missing_payment_response",
            undefined,
            reservationId
          );
        } else if (decodeFailed) {
          reconciliation = this.recordPostPaymentValidationFailure(
            paymentAttemptId,
            paymentPolicyDecision.auditId,
            orderId,
            quoteId,
            reviewedQuote.quote.declarationId,
            documents,
            "non_2xx_malformed_payment_response",
            undefined,
            reservationId
          );
        } else if (isSettlementPending(decodedSettlement)) {
          reconciliation = this.recordPostPaymentValidationFailure(
            paymentAttemptId,
            paymentPolicyDecision.auditId,
            orderId,
            quoteId,
            reviewedQuote.quote.declarationId,
            documents,
            "non_2xx_settlement_pending",
            decodedSettlement,
            reservationId
          );
        } else if (isSettleResponse(decodedSettlement) && decodedSettlement.success === false) {
          try {
            this.validateTerminalFailure(decodedSettlement);
          } catch {
            reconciliation = this.recordPostPaymentValidationFailure(
              paymentAttemptId,
              paymentPolicyDecision.auditId,
              orderId,
              quoteId,
              reviewedQuote.quote.declarationId,
              documents,
              "non_2xx_terminal_failure_unverified",
              decodedSettlement,
              reservationId
            );
          }
        } else {
          reconciliation = this.recordPostPaymentValidationFailure(
            paymentAttemptId,
            paymentPolicyDecision.auditId,
            orderId,
            quoteId,
            reviewedQuote.quote.declarationId,
            documents,
            "non_2xx_settlement_unverified",
            isSettleResponse(decodedSettlement) ? decodedSettlement : undefined,
            reservationId
          );
        }
      }
      const settlementInfo = settlementDiagnostic(paymentResponse);
      this.audit(
        "broker.paid-http.response",
        "failed",
        {
          url: declarationUrl,
          status: paidResponse.status,
          body: responseText,
        },
        paymentAttemptId,
      );
      log("error", "payment-audit", "payment.rejected", {
        paymentAttemptId, auditId: paymentPolicyDecision.auditId,
        orderId,
        quoteId,
        status: paidResponse.status,
        paymentDispatched,
        settlement: settlementSummary(decodedSettlement),
        reconciliationState: reconciliation?.state,
        settlementPending: reconciliation?.state === "pending"
      });
      if (reconciliation !== undefined) {
        this.paymentReservations.holdAmbiguous(reservationId);
      } else {
        this.paymentReservations.release(reservationId);
      }
      throw new Error(
        `Customs broker payment failed: ${paidResponse.status}`
        + (responseBody ? `; response body: ${responseBody}` : "")
        + (settlementInfo ? `; ${settlementInfo}` : "")
      );
    }
    if (!paymentDispatched) {
      this.paymentReservations.release(reservationId);
      log("error", "payment-audit", "payment.response_without_dispatch", {
        paymentAttemptId,
        auditId: paymentPolicyDecision.auditId,
        orderId,
        quoteId
      });
      throw new Error("Paid customs broker response was received without a dispatched payment signature");
    }
    const paymentResponse = paymentResponseHeader(paidResponse, true);
    if (!paymentResponse) {
      if (paymentDispatched) {
        this.recordPostPaymentValidationFailure(
          paymentAttemptId,
          paymentPolicyDecision.auditId,
          orderId,
          quoteId,
          reviewedQuote.quote.declarationId,
          documents,
          "missing_payment_response",
          undefined,
          reservationId
        );
        this.paymentReservations.holdAmbiguous(reservationId);
      } else {
        this.paymentReservations.release(reservationId);
      }
      throw new Error("Paid customs broker response is missing PAYMENT-RESPONSE settlement header");
    }
    let decodedSettlement: unknown;
    try {
      decodedSettlement = decodeSettlementHeader(paymentResponse);
    } catch (error) {
      if (paymentDispatched) {
        this.recordPostPaymentValidationFailure(
          paymentAttemptId,
          paymentPolicyDecision.auditId,
          orderId,
          quoteId,
          reviewedQuote.quote.declarationId,
          documents,
          "malformed_payment_response",
          undefined,
          reservationId
        );
        this.paymentReservations.holdAmbiguous(reservationId);
      } else {
        this.paymentReservations.release(reservationId);
      }
      throw error;
    }
    try {
      validateSettlement(
        decodedSettlement,
        this.x402Network,
        this.importerAddress,
        expectedBrokerFeeAtomic
      );
    } catch (error) {
      log("error", "payment-audit", "payment.settlement_invalid", {
        paymentAttemptId,
        auditId: paymentPolicyDecision.auditId,
        orderId,
        quoteId,
        settlement: settlementSummary(decodedSettlement)
      });
      if (paymentDispatched) {
        this.recordPostPaymentValidationFailure(
          paymentAttemptId,
          paymentPolicyDecision.auditId,
          orderId,
          quoteId,
          reviewedQuote.quote.declarationId,
          documents,
          "invalid_payment_response",
          isSettleResponse(decodedSettlement) ? decodedSettlement : undefined,
          reservationId
        );
        this.paymentReservations.holdAmbiguous(reservationId);
      } else {
        this.paymentReservations.release(reservationId);
      }
      throw error;
    }
    let response: CustomsBrokerResponse;
    try {
      response = validateBrokerResponse(
        await paidResponse.json(),
        reviewedQuote,
        this.brokerAddress,
        expectedBrokerFeeAtomic
      );
      this.validateBrokerResponse(reviewedQuote.quote, response);
    } catch (error) {
      if (paymentDispatched) {
        this.recordPostPaymentValidationFailure(
          paymentAttemptId,
          paymentPolicyDecision.auditId,
          orderId,
          quoteId,
          reviewedQuote.quote.declarationId,
          documents,
          "invalid_broker_response",
          isSettleResponse(decodedSettlement) ? decodedSettlement : undefined,
          reservationId
        );
        this.paymentReservations.holdAmbiguous(reservationId);
      } else {
        this.paymentReservations.release(reservationId);
      }
      throw error;
    }
    this.audit(
      "broker.paid-http.response",
      "succeeded",
      {
        url: declarationUrl,
        status: paidResponse.status,
        body: response,
        paymentResponse,
        settlement: decodedSettlement,
      },
      paymentAttemptId,
    );
    this.paymentHistory.push({
      timestamp: new Date().toISOString(),
      amountUsdc: this.brokerFeeUsd,
      payee: this.brokerAddress,
      quoteId,
      receiptId: response.receipt.receiptId,
    });
    this.quoteStore.delete(quoteId);
    this.clearSettlementReconciliation(operationIdentity, paymentAttemptId);
    this.paymentReservations.commit(reservationId);
    log("info", "payment-audit", "payment.succeeded", {
      auditId: paymentPolicyDecision.auditId,
      paymentAttemptId,
      orderId,
      quoteId,
      receiptId: response.receipt.receiptId,
      amountUsdc: response.receipt.brokerFeeUsd,
      payee: response.receipt.brokerAddress,
      settlementRecorded: Boolean(decodedSettlement),
    });
    audit.push(
      `Paid customs broker and received receipt ${response.receipt.receiptId}`,
    );
    const result = {
      ...reviewedQuote,
      quote: response.quote,
      complianceReview: reviewImportQuote(
        documents,
        response.quote,
        this.brokerFeeUsd,
      ),
      paymentPolicyDecision,
      receipt: response.receipt,
      settlement: decodedSettlement,
      audit: [...reviewedQuote.audit, ...audit],
    };
    this.audit(
      "payment.submit",
      "succeeded",
      { orderId, quoteId, result },
      paymentAttemptId,
    );
    return result;
  }

  private validateDocuments(documents: ExportDocuments) {
    if (
      !documents.invoiceNumber ||
      !documents.exporter ||
      !documents.importer
    ) {
      throw new Error(
        "Trade documents are missing required parties or invoice number",
      );
    }
    if (!documents.items.length)
      throw new Error("Trade documents contain no items");
    if (documents.items.some((item) => !item.hsCode)) {
      throw new Error("Every item must have an HS code before customs filing");
    }
  }

  private validateBrokerResponse(
    reviewedQuote: DutyQuote,
    response: CustomsBrokerResponse,
  ) {
    if (!isDeepStrictEqual(response.quote, reviewedQuote)) {
      throw new Error("Paid broker response does not match the reviewed quote");
    }
    if (response.receipt.declarationId !== reviewedQuote.declarationId) {
      throw new Error(
        "Broker receipt declaration does not match the reviewed quote",
      );
    }
    if (
      Math.abs(response.receipt.brokerFeeUsd - this.brokerFeeUsd) > 0.000001
    ) {
      throw new Error("Broker receipt fee does not match the approved payment");
    }
    if (!isAllowedPayee(response.receipt.brokerAddress, this.brokerAddress)) {
      throw new Error(
        "Broker receipt address does not match the approved payee",
      );
    }
    if (response.receipt.status !== "filed") {
      throw new Error("Broker receipt does not confirm a filed declaration");
    }
    if (!Number.isFinite(Date.parse(response.receipt.timestamp))) {
      throw new Error("Broker receipt timestamp is invalid");
    }
  }
}
