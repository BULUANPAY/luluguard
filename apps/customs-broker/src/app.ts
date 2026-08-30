import { createHash } from "node:crypto";
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import type {
  Money,
  PaymentPayload,
  PaymentRequirements,
  SettleResponse,
  SupportedResponse,
  VerifyResponse
} from "@x402/core/types";
import { decodePaymentSignatureHeader } from "@x402/core/http";
import { convertToTokenAmount, numberToDecimalString } from "@x402/core/utils";
import {
  HTTPFacilitatorClient,
  type FacilitatorClient,
  type HTTPTransportContext,
  type SettleFailureContext,
  type SettleResultContext,
  type VerifyResultContext,
  type VerifiedPaymentCanceledContext,
  x402ResourceServer
} from "@x402/core/server";
import { paymentMiddleware } from "@x402/express";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { z } from "zod";
import { type BrokerConfig, config as defaultConfig } from "./config.js";
import {
  DeclarationRequestSchema,
  QuoteRequestSchema,
  MAX_MONEY_USD,
  type CustomsBrokerReceipt,
  type DeclarationRequest,
  type DutyQuote
} from "./domain.js";
import { createLogger } from "./logger.js";
import { calculateMockQuote, USDC_DECIMALS } from "./quote-calculator.js";
import { QuoteStore, QuoteStoreError } from "./quote-store.js";

export interface BrokerAppOptions {
  config?: BrokerConfig;
  facilitatorClient?: FacilitatorClient;
  quoteStore?: QuoteStore;
  maxPaymentTombstones?: number;
  logger?: ReturnType<typeof createLogger>;
  /**
   * Optional preparation seam for tests and compensatable pre-filing work.
   * Implementations must not perform irreversible filing or other external
   * side effects; a thrown error causes the processing attempt to roll back.
   */
  prepareDeclaration?: (context: {
    declaration: DeclarationRequest;
    quote: DutyQuote;
    preparedReceipt: ReturnType<QuoteStore["prepareReceipt"]>;
  }) => void | Promise<void>;
}

function normalizeFeeUsdc(feeUsdc: number): number {
  const scale = 10 ** USDC_DECIMALS;
  const scaled = feeUsdc * scale;
  const rounded = Math.round(scaled);
  const tolerance = Number.EPSILON * Math.max(1, Math.abs(scaled)) * 8;
  if (
    !Number.isFinite(feeUsdc) ||
    feeUsdc <= 0 ||
    feeUsdc > MAX_MONEY_USD ||
    !Number.isSafeInteger(rounded) ||
    Math.abs(scaled - rounded) > tolerance
  ) {
    throw new Error(
      "CUSTOMS_BROKER_FEE_USDC must be positive, no greater than 1000000000, and have at most 6 decimal places"
    );
  }
  return rounded / scale;
}

function feeAtomic(feeUsdc: number): string {
  const value = numberToDecimalString(normalizeFeeUsdc(feeUsdc));
  return convertToTokenAmount(value, 6).toString();
}

function errorStatus(error: unknown): number {
  if (error instanceof z.ZodError || error instanceof TypeError || error instanceof RangeError) return 400;
  if (error instanceof PaymentTombstoneCapacityError) return 503;
  if (!(error instanceof QuoteStoreError)) return 500;
  if (error.code === "QUOTE_NOT_FOUND") return 404;
  if (error.code === "QUOTE_EXPIRED") return 410;
  if (error.code === "QUOTE_STORE_CAPACITY") return 503;
  return 409;
}

function sendError(res: Response, error: unknown): void {
  res.status(errorStatus(error)).json({
    error: error instanceof Error ? error.message : "Internal Server Error"
  });
}

function requestBodyFromContext(context: { transportContext?: unknown }): object {
  const transport = context.transportContext as HTTPTransportContext | undefined;
  const getBody = transport?.request.adapter.getBody;
  if (!getBody) throw new Error("x402 HTTP transport did not expose the declaration body");
  const body = getBody.call(transport.request.adapter);
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new Error("x402 HTTP transport exposed an invalid declaration body");
  }
  return body;
}

function declarationFromContext(context: { transportContext?: unknown }): DeclarationRequest {
  return DeclarationRequestSchema.parse(requestBodyFromContext(context));
}

type JsonRecord = Record<string, unknown>;

function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function quoteIdFromContext(context: { transportContext?: unknown }): string | undefined {
  try {
    const parsed = DeclarationRequestSchema.safeParse(requestBodyFromContext(context));
    return parsed.success ? parsed.data.quoteId : undefined;
  } catch {
    return undefined;
  }
}

function safeFailureReason(value: unknown, fallback: string): string {
  if (!isJsonRecord(value)) return fallback;
  for (const key of ["invalidReason", "errorReason", "reason"] as const) {
    const reason = value[key];
    if (typeof reason === "string" && /^[a-zA-Z0-9_.:-]{1,128}$/.test(reason)) {
      return reason;
    }
  }
  return fallback;
}

function safeFailureTransaction(value: unknown): string | undefined {
  if (!isJsonRecord(value)) return undefined;
  const transaction = value.transaction;
  return typeof transaction === "string" && TRANSACTION_HASH_PATTERN.test(transaction)
    ? transaction
    : undefined;
}

function normalizeHexString(value: string): string {
  return /^0x[0-9a-fA-F]+$/i.test(value) ? value.toLowerCase() : value;
}

function normalizeSignedAddress(value: unknown): unknown {
  return typeof value === "string" && /^0x[0-9a-fA-F]{40}$/i.test(value)
    ? value.toLowerCase()
    : value;
}

function normalizeSignedUint(value: unknown): unknown {
  if (typeof value === "bigint") {
    return value >= 0n ? value.toString() : value;
  }
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value >= 0 ? BigInt(value).toString() : value;
  }
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (trimmed.length === 0) return value;
  try {
    const parsed = BigInt(trimmed);
    return parsed >= 0n ? parsed.toString() : value;
  } catch {
    return value;
  }
}

function normalizeEip3009Authorization(value: JsonRecord): JsonRecord {
  return {
    from: normalizeSignedAddress(value.from),
    to: normalizeSignedAddress(value.to),
    value: normalizeSignedUint(value.value),
    validAfter: normalizeSignedUint(value.validAfter),
    validBefore: normalizeSignedUint(value.validBefore),
    nonce: normalizeSignedUint(value.nonce)
  };
}

function normalizePermit2Authorization(value: JsonRecord): JsonRecord {
  const permitted = isJsonRecord(value.permitted) ? value.permitted : {};
  const witness = isJsonRecord(value.witness) ? value.witness : {};
  return {
    from: normalizeSignedAddress(value.from),
    permitted: {
      token: normalizeSignedAddress(permitted.token),
      amount: normalizeSignedUint(permitted.amount)
    },
    spender: normalizeSignedAddress(value.spender),
    nonce: normalizeSignedUint(value.nonce),
    deadline: normalizeSignedUint(value.deadline),
    witness: {
      to: normalizeSignedAddress(witness.to),
      validAfter: normalizeSignedUint(witness.validAfter)
    }
  };
}

function canonicalizePaymentIdentity(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(item => canonicalizePaymentIdentity(item)).join(",")}]`;
  }
  if (isJsonRecord(value)) {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalizePaymentIdentity(entry)}`)
      .join(",")}}`;
  }
  if (typeof value === "string") return JSON.stringify(normalizeHexString(value));
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new TypeError("Payment identity contains an unsupported value");
  return serialized;
}

function paymentKey(paymentPayload: unknown): string {
  const payload = isJsonRecord(paymentPayload) ? paymentPayload.payload : undefined;
  const identity = isJsonRecord(payload) && typeof payload.signature === "string" &&
    isJsonRecord(payload.authorization)
    ? {
      scheme: "eip3009",
      authorization: normalizeEip3009Authorization(payload.authorization),
      signature: normalizeHexString(payload.signature)
    }
    : isJsonRecord(payload) && typeof payload.signature === "string" &&
        isJsonRecord(payload.permit2Authorization)
      ? {
        scheme: "permit2",
        permit2Authorization: normalizePermit2Authorization(payload.permit2Authorization),
        signature: normalizeHexString(payload.signature)
      }
      : { unsupportedPayload: payload };
  return createHash("sha256").update(canonicalizePaymentIdentity(identity), "utf8").digest("hex");
}

function publicReceipt(prepared: ReturnType<QuoteStore["prepareReceipt"]>): CustomsBrokerReceipt {
  return { ...prepared, status: "filed" };
}

type AttemptBinding = { quoteId: string; attemptId: string };

type PaymentTombstoneState = "pending" | "ambiguous" | "settled";
const DEFAULT_MAX_PAYMENT_TOMBSTONES = 10_000;
const TRANSACTION_HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/;

interface PaymentTombstone {
  quoteId: string;
  attemptId: string;
  state: PaymentTombstoneState;
  /** EIP-3009 validBefore / Permit2 deadline, retained for lazy pruning. */
  authorizationValidBefore?: string;
  /** A broadcast transaction makes an ambiguous payment unsafe to unlock. */
  retainAfterExpiry: boolean;
  transaction?: string;
  network?: string;
  payer?: string;
}

class PaymentTombstoneCapacityError extends Error {
  constructor(maxTombstones: number) {
    super(`Payment tombstone capacity of ${maxTombstones} records has been reached`);
    this.name = "PaymentTombstoneCapacityError";
  }
}

function authorizationValidBefore(paymentPayload: unknown): string | undefined {
  if (!isJsonRecord(paymentPayload) || !isJsonRecord(paymentPayload.payload)) return undefined;
  const payload = paymentPayload.payload;
  const authorization = isJsonRecord(payload.authorization)
    ? payload.authorization
    : isJsonRecord(payload.permit2Authorization)
      ? payload.permit2Authorization
      : undefined;
  if (!authorization) return undefined;
  const value = authorization.validBefore ?? authorization.deadline;
  const normalized = normalizeSignedUint(value);
  return typeof normalized === "string" ? normalized : undefined;
}

function isPaymentTombstoneExpired(tombstone: PaymentTombstone, now = Date.now()): boolean {
  if (tombstone.authorizationValidBefore === undefined) return false;
  try {
    return BigInt(tombstone.authorizationValidBefore) <= BigInt(Math.floor(now / 1_000));
  } catch {
    return false;
  }
}

function sweepPaymentTombstones(
  tombstones: Map<string, PaymentTombstone>,
  store: QuoteStore,
  now = Date.now()
): void {
  for (const [key, tombstone] of tombstones) {
    if (!isPaymentTombstoneExpired(tombstone, now) || tombstone.retainAfterExpiry) continue;
    if ((tombstone.state === "ambiguous" || tombstone.state === "pending") && tombstone.attemptId) {
      const record = store.get(tombstone.quoteId);
      if (record?.status === "PROCESSING" && record.attemptId === tombstone.attemptId) {
        try {
          store.rollbackProcessing(tombstone.quoteId, tombstone.attemptId);
        } catch {
          // Keep the tombstone and the processing lock if ownership cannot be
          // proven or the store cannot safely release it yet.
          continue;
        }
      }
    }
    tombstones.delete(key);
  }
}

function getPaymentTombstone(
  tombstones: Map<string, PaymentTombstone>,
  store: QuoteStore,
  key: string
): PaymentTombstone | undefined {
  sweepPaymentTombstones(tombstones, store);
  return tombstones.get(key);
}

function commitPaymentTombstone(
  tombstones: Map<string, PaymentTombstone>,
  store: QuoteStore,
  reservedPaymentKeys: Set<string>,
  reservationOwners: Map<string, Set<object>>,
  key: string,
  tombstone: PaymentTombstone
): void {
  sweepPaymentTombstones(tombstones, store);
  if (!tombstones.has(key) && !reservedPaymentKeys.has(key)) {
    throw new Error("Payment tombstone commit has no reserved slot");
  }
  tombstones.set(key, tombstone);
  reservedPaymentKeys.delete(key);
  reservationOwners.delete(key);
}

function isSettlementPendingResult(result: unknown): result is SettleResponse {
  return isJsonRecord(result) &&
    result.success === false &&
    result.errorReason === "settlement_pending" &&
    typeof result.transaction === "string";
}

function isSettleError(error: unknown): error is JsonRecord {
  return isJsonRecord(error) && error.name === "SettleError";
}

function isRetryableSettlementError(error: unknown): boolean {
  return isSettleError(error) &&
    error.errorReason === "settlement_pending" &&
    typeof error.transaction === "string" &&
    error.transaction.trim().length > 0;
}

function terminalSettlementError(error: unknown): SettleResponse | undefined {
  if (!isSettleError(error) || typeof error.errorReason !== "string" || !error.errorReason.trim()) {
    return undefined;
  }
  if (error.errorReason === "settlement_pending") return undefined;
  if (
    typeof error.transaction !== "string" ||
    typeof error.network !== "string" ||
    !/^.+:.+$/.test(error.network)
  ) {
    return undefined;
  }
  return {
    success: false,
    errorReason: error.errorReason,
    ...(typeof error.errorMessage === "string" ? { errorMessage: error.errorMessage } : {}),
    transaction: error.transaction,
    network: error.network as `${string}:${string}`,
    ...(typeof error.payer === "string" ? { payer: error.payer } : {})
  };
}

function settlementTombstone(
  quoteId: string,
  attemptId: string,
  state: PaymentTombstoneState,
  paymentPayload: unknown,
  result?: unknown,
  retainAfterExpiry = false
): PaymentTombstone {
  const details = isJsonRecord(result) ? result : {};
  const validBefore = authorizationValidBefore(paymentPayload);
  return {
    quoteId,
    attemptId,
    state,
    retainAfterExpiry: retainAfterExpiry || (
      typeof details.transaction === "string" &&
      TRANSACTION_HASH_PATTERN.test(details.transaction) &&
      !/^0x0{64}$/i.test(details.transaction)
    ),
    ...(validBefore === undefined ? {} : { authorizationValidBefore: validBefore }),
    ...(typeof details.transaction === "string" ? { transaction: details.transaction } : {}),
    ...(typeof details.network === "string" ? { network: details.network } : {}),
    ...(typeof details.payer === "string" ? { payer: details.payer } : {})
  };
}

class FinalizingFacilitatorClient implements FacilitatorClient {
  private readonly pendingPaymentKeys = new Set<string>();

  constructor(
    private readonly delegate: FacilitatorClient,
    private readonly store: QuoteStore,
    private readonly attempts: Map<string, AttemptBinding>,
    private readonly paymentTombstones: Map<string, PaymentTombstone>,
    private readonly reservedPaymentKeys: Set<string>,
    private readonly reservationOwners: Map<string, Set<object>>,
    private readonly expectedNetwork: string,
    private readonly expectedAmount: string
  ) {}

  private setTombstone(
    key: string,
    quoteId: string,
    attemptId: string,
    state: PaymentTombstoneState,
    payload: PaymentPayload,
    result?: unknown,
    retainAfterExpiry = false
  ): void {
    commitPaymentTombstone(
      this.paymentTombstones,
      this.store,
      this.reservedPaymentKeys,
      this.reservationOwners,
      key,
      settlementTombstone(quoteId, attemptId, state, payload, result, retainAfterExpiry)
    );
  }

  getSupported(): Promise<SupportedResponse> {
    return this.delegate.getSupported();
  }

  verify(
    payload: PaymentPayload,
    requirements: PaymentRequirements
  ): Promise<VerifyResponse> {
    return this.delegate.verify(payload, requirements);
  }

  async settle(
    payload: PaymentPayload,
    requirements: PaymentRequirements
  ): Promise<SettleResponse> {
    const key = paymentKey(payload);
    const knownBinding = this.attempts.get(key);
    let result: SettleResponse;
    try {
      result = await this.delegate.settle(payload, requirements);
    } catch (error) {
      if (knownBinding !== undefined) {
        if (isRetryableSettlementError(error)) {
          if (this.pendingPaymentKeys.has(key)) {
            try {
              this.setTombstone(
                key,
                knownBinding.quoteId,
                knownBinding.attemptId,
                "ambiguous",
                payload,
                error
              );
            } finally {
              this.pendingPaymentKeys.delete(key);
              this.attempts.delete(key);
            }
          } else {
            this.pendingPaymentKeys.add(key);
            try {
              this.setTombstone(
                key,
                knownBinding.quoteId,
                knownBinding.attemptId,
                "pending",
                payload,
                error
              );
            } catch (setError) {
              this.pendingPaymentKeys.delete(key);
              this.attempts.delete(key);
              throw setError;
            }
          }
          throw error;
        }
        const terminalFailure = terminalSettlementError(error);
        if (terminalFailure !== undefined) {
          try {
            this.store.finishSettlement(knownBinding.attemptId, terminalFailure, {
              expectedNetwork: this.expectedNetwork,
              expectedAmount: this.expectedAmount
            });
            this.pendingPaymentKeys.delete(key);
            this.paymentTombstones.delete(key);
            this.attempts.delete(key);
            return terminalFailure;
          } catch (finishError) {
            // A structurally explicit failure with invalid fields is still a
            // malformed payment response, so only the payment is blocked.
            try {
              this.setTombstone(
                key,
                knownBinding.quoteId,
                knownBinding.attemptId,
                "ambiguous",
                payload,
                terminalFailure
              );
            } finally {
              this.pendingPaymentKeys.delete(key);
              this.attempts.delete(key);
            }
            throw finishError;
          }
        }
        // A thrown settle result is indeterminate: the facilitator may have
        // accepted the payment even though the response never reached us.
        // Keep the quote PROCESSING and block both replay and new signatures.
        try {
          this.setTombstone(
            key,
            knownBinding.quoteId,
            knownBinding.attemptId,
            "ambiguous",
            payload,
            error
          );
        } finally {
          this.pendingPaymentKeys.delete(key);
          this.attempts.delete(key);
        }
      }
      throw error;
    }
    const binding = this.attempts.get(key) ?? knownBinding;
    if (!binding) {
      this.pendingPaymentKeys.delete(key);
      throw new Error("Settlement has no matching broker processing attempt");
    }
    const isPending = isSettlementPendingResult(result);
    const isRetryablePending = isPending && Boolean(result.transaction);
    if (isRetryablePending && !this.pendingPaymentKeys.has(key)) {
      this.pendingPaymentKeys.add(key);
      try {
        this.setTombstone(key, binding.quoteId, binding.attemptId, "pending", payload, result);
      } catch (setError) {
        this.pendingPaymentKeys.delete(key);
        this.attempts.delete(key);
        throw setError;
      }
      return result;
    }
    if (isPending) {
      try {
        this.setTombstone(key, binding.quoteId, binding.attemptId, "ambiguous", payload, result);
      } finally {
        this.pendingPaymentKeys.delete(key);
        this.attempts.delete(key);
      }
      // A second pending response is not terminal. Keep the quote locked until
      // reconciliation rather than releasing it for a fresh signature.
      return result;
    }
    if (getPaymentTombstone(this.paymentTombstones, this.store, key)?.state === "pending") {
      try {
        this.setTombstone(key, binding.quoteId, binding.attemptId, "ambiguous", payload, result);
      } catch (setError) {
        this.pendingPaymentKeys.delete(key);
        this.attempts.delete(key);
        throw setError;
      }
    }
    try {
      const finished = this.store.finishSettlement(binding.attemptId, result, {
        expectedNetwork: this.expectedNetwork,
        expectedAmount: this.expectedAmount
      });
      if (finished.status === "FILED") {
        this.setTombstone(key, binding.quoteId, binding.attemptId, "settled", payload, result);
      }
      return result;
    } catch (error) {
      // A malformed settlement response is a payment-level ambiguity, but it
      // does not block the quote: a fresh authorization may retry it.
      this.setTombstone(key, binding.quoteId, binding.attemptId, "ambiguous", payload, result);
      try {
        const record = this.store.get(binding.quoteId);
        if (record?.status === "PROCESSING" && record.attemptId === binding.attemptId) {
          this.store.rollbackProcessing(binding.quoteId, binding.attemptId);
        }
      } catch {
        // Preserve the settlement validation/finalization error.
      }
      throw error;
    } finally {
      this.pendingPaymentKeys.delete(key);
      this.attempts.delete(key);
    }
  }

  clearPending(payload: unknown): void {
    this.pendingPaymentKeys.delete(paymentKey(payload));
  }
}

function validateBrokerConfig(config: BrokerConfig): void {
  normalizeFeeUsdc(config.feeUsdc);
  if (config.network !== "eip155:84532") {
    throw new Error("X402_NETWORK must be eip155:84532 for the testnet broker");
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(config.address) || /^0x0{40}$/i.test(config.address)) {
    throw new Error("CUSTOMS_BROKER_ADDRESS must be a non-zero EVM address");
  }
  if (
    !Number.isSafeInteger(config.quoteTtlSeconds) ||
    config.quoteTtlSeconds <= 0 ||
    config.quoteTtlSeconds > 31_536_000
  ) {
    throw new Error("CUSTOMS_BROKER_QUOTE_TTL_SECONDS must be a positive integer no greater than one year");
  }
  if (!Number.isSafeInteger(config.facilitatorTimeoutMs) || config.facilitatorTimeoutMs <= 0) {
    throw new Error("X402_FACILITATOR_TIMEOUT_MS must be a positive integer");
  }
  const facilitatorUrl = new URL(config.facilitatorUrl);
  if (facilitatorUrl.protocol !== "http:" && facilitatorUrl.protocol !== "https:") {
    throw new Error("X402_FACILITATOR_URL must use http or https");
  }
}

export function createApp(options: BrokerAppOptions = {}): {
  app: Express;
  quoteStore: QuoteStore;
  resourceServer: x402ResourceServer;
} {
  const brokerConfig = options.config ?? defaultConfig;
  validateBrokerConfig(brokerConfig);
  const brokerFeeUsdc = normalizeFeeUsdc(brokerConfig.feeUsdc);
  const maxPaymentTombstones = options.maxPaymentTombstones ?? DEFAULT_MAX_PAYMENT_TOMBSTONES;
  if (!Number.isSafeInteger(maxPaymentTombstones) || maxPaymentTombstones <= 0) {
    throw new RangeError("maxPaymentTombstones must be a positive safe integer");
  }
  const store = options.quoteStore ?? new QuoteStore();
  const configuredLog = options.logger ?? createLogger(brokerConfig);
  const log: ReturnType<typeof createLogger> = (level, event, data = {}) => {
    try {
      configuredLog(level, event, data);
    } catch {
      // Logging is observational and must never change payment behavior.
    }
  };
  const expectedAmount = feeAtomic(brokerFeeUsdc);
  const delegateFacilitator = options.facilitatorClient ?? new HTTPFacilitatorClient({
    url: brokerConfig.facilitatorUrl,
    timeoutMs: brokerConfig.facilitatorTimeoutMs
  });
  const paymentKeyByBody = new WeakMap<object, string>();
  const attemptByBody = new WeakMap<object, AttemptBinding>();
  const attemptByPayment = new Map<string, AttemptBinding>();
  const paymentTombstones = new Map<string, PaymentTombstone>();
  const reservedPaymentKeys = new Set<string>();
  const reservationOwners = new Map<string, Set<object>>();
  const facilitator = new FinalizingFacilitatorClient(
    delegateFacilitator,
    store,
    attemptByPayment,
    paymentTombstones,
    reservedPaymentKeys,
    reservationOwners,
    brokerConfig.network,
    expectedAmount
  );
  const resourceServer = new x402ResourceServer(facilitator);
  resourceServer.register(brokerConfig.network, new ExactEvmScheme());

  const assertPaymentTombstoneCapacity = () => {
    sweepPaymentTombstones(paymentTombstones, store);
    if (paymentTombstones.size + reservedPaymentKeys.size >= maxPaymentTombstones) {
      throw new PaymentTombstoneCapacityError(maxPaymentTombstones);
    }
  };

  const reservePaymentKey = (key: string, owner: object): void => {
    sweepPaymentTombstones(paymentTombstones, store);
    if (paymentTombstones.has(key)) return;
    const existingOwners = reservationOwners.get(key);
    if (existingOwners !== undefined) {
      existingOwners.add(owner);
      return;
    }
    if (reservedPaymentKeys.has(key)) {
      reservationOwners.set(key, new Set([owner]));
      return;
    }
    assertPaymentTombstoneCapacity();
    reservedPaymentKeys.add(key);
    reservationOwners.set(key, new Set([owner]));
  };

  const releasePaymentKey = (key: string, owner: object): void => {
    const owners = reservationOwners.get(key);
    if (owners === undefined) return;
    owners.delete(owner);
    if (owners.size === 0) {
      reservationOwners.delete(key);
      reservedPaymentKeys.delete(key);
    }
  };

  const paymentKeyFromRequest = (req: Request): string | undefined => {
    const encoded = req.get("payment-signature") ?? req.get("x-payment");
    if (!encoded) return undefined;
    try {
      return paymentKey(decodePaymentSignatureHeader(encoded));
    } catch {
      return undefined;
    }
  };

  const releaseReservationWhenResponseEnds = (res: Response, key: string, owner: object): void => {
    const releaseIfUncommitted = () => {
      if (!paymentTombstones.has(key) && !attemptByPayment.has(key)) {
        releasePaymentKey(key, owner);
      }
    };
    res.once("finish", releaseIfUncommitted);
    res.once("close", releaseIfUncommitted);
  };

  resourceServer.onBeforeVerify(async context => {
    const key = paymentKey(context.paymentPayload);
    const owner = requestBodyFromContext(context);
    const quoteId = quoteIdFromContext(context);
    const tombstone = getPaymentTombstone(
      paymentTombstones,
      store,
      key
    );
    if (tombstone !== undefined) {
      releasePaymentKey(key, owner);
      log("warn", "payment.tombstone_blocked", {
        quoteId: tombstone.quoteId,
        state: tombstone.state,
        transaction: tombstone.transaction,
        network: tombstone.network,
        payer: tombstone.payer
      });
      return {
        abort: true,
        reason: "payment_payload_already_used"
      };
    }
    try {
      reservePaymentKey(key, owner);
    } catch (error) {
      if (error instanceof PaymentTombstoneCapacityError) {
        return {
          abort: true,
          reason: "payment_tombstone_capacity"
        };
      }
      throw error;
    }
    log("info", "payment.verify_started", {
      ...(quoteId === undefined ? {} : { quoteId }),
      network: context.requirements.network
    });
  });

  resourceServer.onAfterVerify(async (context: VerifyResultContext) => {
    const key = paymentKey(context.paymentPayload);
    const owner = requestBodyFromContext(context);
    const quoteId = quoteIdFromContext(context);
    if (!context.result.isValid) {
      releasePaymentKey(key, owner);
      log("warn", "payment.verify_failed", {
        ...(quoteId === undefined ? {} : { quoteId }),
        network: context.requirements.network,
        reason: safeFailureReason(context.result, "invalid_payment"),
        ...(context.result.payer === undefined ? {} : { payer: context.result.payer })
      });
      return;
    }
    paymentKeyByBody.set(owner, key);
    log("info", "payment.verify_succeeded", {
      ...(quoteId === undefined ? {} : { quoteId }),
      network: context.requirements.network,
      ...(context.result.payer === undefined ? {} : { payer: context.result.payer })
    });
  });

  resourceServer.onVerifyFailure(async context => {
    const owner = requestBodyFromContext(context);
    releasePaymentKey(paymentKey(context.paymentPayload), owner);
    const quoteId = quoteIdFromContext(context);
    log("error", "payment.verify_failed", {
      ...(quoteId === undefined ? {} : { quoteId }),
      network: context.requirements.network,
      reason: safeFailureReason(context.error, "facilitator_error")
    });
  });

  resourceServer.onAfterSettle(async (context: SettleResultContext) => {
    const body = requestBodyFromContext(context);
    try {
      const request = declarationFromContext(context);
      log("info", "declaration.settled", {
        quoteId: request.quoteId,
        transaction: context.result.transaction,
        network: context.result.network,
        payer: context.result.payer
      });
    } finally {
      attemptByBody.delete(body);
      paymentKeyByBody.delete(body);
    }
  });

  const rollback = async (
    context: SettleFailureContext | VerifiedPaymentCanceledContext,
    event: string
  ) => {
    try {
      const request = declarationFromContext(context);
      const body = requestBodyFromContext(context);
      const key = paymentKey(context.paymentPayload);
      const binding = attemptByBody.get(body);
      const paymentBinding = attemptByPayment.get(key);
      const tombstone = getPaymentTombstone(paymentTombstones, store, key);
      facilitator.clearPending(context.paymentPayload);
      releasePaymentKey(key, body);
      if (
        binding !== undefined &&
        paymentBinding?.quoteId === binding.quoteId &&
        paymentBinding.attemptId === binding.attemptId &&
        !(tombstone?.state === "ambiguous" && tombstone.quoteId === binding.quoteId)
      ) {
        store.rollbackProcessing(binding.quoteId, binding.attemptId);
        if (attemptByPayment.get(key)?.attemptId === binding.attemptId) {
          attemptByPayment.delete(key);
        }
      }
      attemptByBody.delete(body);
      paymentKeyByBody.delete(body);
      const reason = "reason" in context
        ? context.reason
        : safeFailureReason(context.error, "settlement_error");
      const transaction = "error" in context
        ? safeFailureTransaction(context.error)
        : undefined;
      log("warn", event, {
        quoteId: request.quoteId,
        reason,
        ...(transaction === undefined ? {} : { transaction }),
        ...("responseStatus" in context && context.responseStatus !== undefined
          ? { responseStatus: context.responseStatus }
          : {})
      });
    } catch (error) {
      log("error", `${event}.rollback_failed`, {
        message: error instanceof Error ? error.message : String(error)
      });
    }
  };

  resourceServer.onSettleFailure(async context => rollback(context, "declaration.settlement_failed"));
  resourceServer.onVerifiedPaymentCanceled(async context => rollback(context, "declaration.payment_canceled"));

  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.get("/health", (_req, res) => res.json({ status: "ok", service: "x402-customs-broker" }));

  app.post("/customs/quotes", (req, res) => {
    try {
      assertPaymentTombstoneCapacity();
      const documents = QuoteRequestSchema.parse(req.body);
      const quote = calculateMockQuote(documents, {
        brokerFeeUsd: brokerFeeUsdc,
        quoteTtlSeconds: brokerConfig.quoteTtlSeconds
      });
      store.save(quote, documents);
      log("info", "quote.created", { quoteId: quote.quoteId, expiresAt: quote.expiresAt });
      res.json({ quote });
    } catch (error) {
      sendError(res, error);
    }
  });

  app.use("/customs/declarations", (req: Request, res: Response, next: NextFunction) => {
    try {
      sweepPaymentTombstones(paymentTombstones, store);
      const declaration = DeclarationRequestSchema.parse(req.body);
      const record = store.validateSubmission(declaration.quoteId, declaration.documents);
      if (record.status !== "OPEN") {
        throw new QuoteStoreError(
          record.status === "FILED" ? "QUOTE_ALREADY_FILED" : "QUOTE_ALREADY_PROCESSING",
          declaration.quoteId,
          `Quote ${declaration.quoteId} is ${record.status}`
        );
      }
      const key = paymentKeyFromRequest(req);
      if (key !== undefined && !getPaymentTombstone(paymentTombstones, store, key)) {
        req.body = declaration;
        reservePaymentKey(key, declaration);
        releaseReservationWhenResponseEnds(res, key, declaration);
      }
      req.body = declaration;
      next();
    } catch (error) {
      sendError(res, error);
    }
  });

  app.use(paymentMiddleware({
    "POST /customs/declarations": {
      accepts: [{
        scheme: "exact",
        price: `$${numberToDecimalString(brokerFeeUsdc)}` as Money,
        network: brokerConfig.network,
        payTo: brokerConfig.address
      }],
      description: "File a reviewed customs declaration",
      mimeType: "application/json"
    }
  }, resourceServer));

  app.post("/customs/declarations", async (req, res) => {
    const declaration = req.body as DeclarationRequest;
    const body = req.body as object;
    let attemptId: string | undefined;
    let key: string | undefined;
    try {
      const processing = store.beginProcessing(declaration.quoteId, declaration.documents);
      attemptId = processing.attemptId;
      key = paymentKeyByBody.get(req.body as object);
      if (!key) throw new Error("Verified payment was not bound to this declaration request");
      const binding = { quoteId: declaration.quoteId, attemptId };
      const existingBinding = attemptByPayment.get(key);
      const tombstone = getPaymentTombstone(paymentTombstones, store, key);
      if (tombstone?.state === "settled") {
        throw new QuoteStoreError(
          "PAYMENT_ALREADY_USED",
          declaration.quoteId,
          "The payment payload has already been used for a filed declaration"
        );
      }
      if (tombstone !== undefined) {
        throw new QuoteStoreError(
          "PAYMENT_RECONCILIATION_REQUIRED",
          declaration.quoteId,
          "The payment payload requires settlement reconciliation before reuse"
        );
      }
      if (existingBinding !== undefined) {
        throw new QuoteStoreError(
          "PAYMENT_ALREADY_BOUND",
          declaration.quoteId,
          "The payment payload is already bound to another declaration attempt"
        );
      }
      attemptByPayment.set(key, binding);
      attemptByBody.set(body, binding);
      const prepared = store.prepareReceipt(declaration.quoteId, attemptId, brokerConfig.address);
      if (options.prepareDeclaration !== undefined) {
        await options.prepareDeclaration({
          declaration,
          quote: processing.quote,
          preparedReceipt: prepared
        });
      }
      log("info", "declaration.prepared", {
        quoteId: declaration.quoteId,
        attemptId
      });
      res.json({ quote: processing.quote, receipt: publicReceipt(prepared) });
    } catch (error) {
      const binding = attemptByBody.get(body);
      if (binding?.attemptId === attemptId) {
        if (key && attemptByPayment.get(key)?.attemptId === attemptId) {
          attemptByPayment.delete(key);
        }
      }
      attemptByBody.delete(body);
      paymentKeyByBody.delete(body);
      if (key) releasePaymentKey(key, body);
      if (attemptId) {
        try {
          store.rollbackProcessing(declaration.quoteId, attemptId);
        } catch {
          // The x402 cancellation hook owns cleanup if this attempt already moved.
        }
      }
      sendError(res, error);
    }
  });

  return { app, quoteStore: store, resourceServer };
}
