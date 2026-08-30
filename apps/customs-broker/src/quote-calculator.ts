import { randomUUID } from "node:crypto";
import {
  ExportDocumentsSchema,
  MAX_MONEY_USD,
  type DutyQuote,
  type ExportDocuments
} from "./domain.js";

export const DEFAULT_QUOTE_TTL_SECONDS = 300;
export const DEFAULT_BROKER_FEE_USD = 0.01;
export const MOCK_VAT_RATE_PERCENT = 5;
export const MOCK_TRADE_PROMOTION_FEE_RATE = 0.0004;
export const MOCK_FILING_FEE_USD = 2;
export const USDC_DECIMALS = 6;

export interface MockQuoteOptions {
  now?: Date;
  quoteTtlSeconds?: number;
  brokerFeeUsd?: number;
  customsBrokerFeeUsd?: number;
  quoteId?: string;
  declarationId?: string;
}

const cents = (amount: number): number => {
  if (!Number.isFinite(amount) || amount < 0 || amount > MAX_MONEY_USD) {
    throw new RangeError("monetary calculation exceeds the safe supported range");
  }
  const scaled = amount * 100;
  const roundedCents = Math.round(scaled);
  if (!Number.isSafeInteger(roundedCents)) {
    throw new RangeError("monetary calculation exceeds the safe numeric range");
  }
  return roundedCents / 100;
};

const microUsd = (amount: number): number => {
  if (!Number.isFinite(amount) || amount < 0 || amount > MAX_MONEY_USD) {
    throw new RangeError("monetary calculation exceeds the safe supported range");
  }
  const scaled = amount * 10 ** USDC_DECIMALS;
  const rounded = Math.round(scaled);
  const tolerance = Number.EPSILON * Math.max(1, Math.abs(scaled)) * 8;
  if (!Number.isSafeInteger(rounded) || Math.abs(scaled - rounded) > tolerance) {
    throw new RangeError("monetary calculation exceeds the safe numeric range");
  }
  return rounded / 10 ** USDC_DECIMALS;
};

function safeAdd(left: number, right: number, name: string): number {
  const result = left + right;
  if (!Number.isFinite(result) || Math.abs(result) > Number.MAX_SAFE_INTEGER) {
    throw new RangeError(`${name} exceeds the safe numeric range`);
  }
  return result;
}

function safeMultiply(left: number, right: number, name: string): number {
  const result = left * right;
  if (!Number.isFinite(result) || Math.abs(result) > Number.MAX_SAFE_INTEGER) {
    throw new RangeError(`${name} exceeds the safe numeric range`);
  }
  return result;
}

function validNonNegativeNumber(name: string, value: number): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${name} must be a finite non-negative number`);
  }
  return value;
}

function validMoneyInput(name: string, value: number): number {
  const validated = validNonNegativeNumber(name, value);
  const scaled = validated * 100;
  const roundedCents = Math.round(scaled);
  const tolerance = Number.EPSILON * Math.max(1, Math.abs(scaled)) * 8;
  if (!Number.isSafeInteger(roundedCents) || Math.abs(scaled - roundedCents) > tolerance) {
    throw new RangeError(`${name} must have at most two decimal places`);
  }
  return validated;
}

function validUsdcInput(name: string, value: number): number {
  const validated = validNonNegativeNumber(name, value);
  if (validated > MAX_MONEY_USD) {
    throw new RangeError(`${name} exceeds the safe supported range`);
  }
  const scaled = validated * 10 ** USDC_DECIMALS;
  const rounded = Math.round(scaled);
  const tolerance = Number.EPSILON * Math.max(1, Math.abs(scaled)) * 8;
  if (!Number.isSafeInteger(rounded) || Math.abs(scaled - rounded) > tolerance) {
    throw new RangeError(`${name} must have at most ${USDC_DECIMALS} decimal places`);
  }
  return rounded / 10 ** USDC_DECIMALS;
}

function quoteTimestamp(now: Date | undefined): Date {
  const timestamp = now === undefined ? new Date() : new Date(now.getTime());
  if (!Number.isFinite(timestamp.getTime())) {
    throw new RangeError("now must be a valid Date");
  }
  return timestamp;
}

/**
 * Calculates the deterministic mock tariff profile shared with the importer.
 * This is an advisory quote only; it is not a legal tariff determination.
 */
export function calculateMockQuote(
  documents: ExportDocuments,
  options: MockQuoteOptions = {}
): DutyQuote {
  const normalizedDocuments = ExportDocumentsSchema.parse(documents);
  const now = quoteTimestamp(options.now);
  const quoteTtlSeconds = options.quoteTtlSeconds ?? DEFAULT_QUOTE_TTL_SECONDS;
  if (!Number.isSafeInteger(quoteTtlSeconds) || quoteTtlSeconds <= 0 || quoteTtlSeconds > 31_536_000) {
    throw new RangeError("quoteTtlSeconds must be a positive integer no greater than one year");
  }

  const configuredBrokerFee = options.brokerFeeUsd ?? options.customsBrokerFeeUsd ?? DEFAULT_BROKER_FEE_USD;
  const brokerFeeUsd = validUsdcInput("brokerFeeUsd", configuredBrokerFee);
  let goodsValueUsd = 0;
  for (const item of normalizedDocuments.items) {
    const itemValueUsd = safeMultiply(item.quantity, item.unitPriceUsd, "item value");
    goodsValueUsd = cents(safeAdd(goodsValueUsd, cents(itemValueUsd), "goods value"));
  }
  const freightUsd = cents(validMoneyInput("freightUsd", normalizedDocuments.freightUsd ?? 0));
  const insuranceUsd = cents(validMoneyInput("insuranceUsd", normalizedDocuments.insuranceUsd ?? 0));
  const customsValueUsd = cents(safeAdd(
    safeAdd(goodsValueUsd, freightUsd, "customs value"),
    insuranceUsd,
    "customs value"
  ));
  const appliedDutyRatePercent = normalizedDocuments.items.every((item) => item.hsCode?.startsWith("8471")) ? 0 : 5;
  const dutyUsd = cents(safeMultiply(customsValueUsd, appliedDutyRatePercent / 100, "duty"));
  const taxUsd = cents(safeMultiply(
    safeAdd(customsValueUsd, dutyUsd, "tax base"),
    MOCK_VAT_RATE_PERCENT / 100,
    "tax"
  ));
  const tradePromotionFeeUsd = cents(safeMultiply(
    customsValueUsd,
    MOCK_TRADE_PROMOTION_FEE_RATE,
    "trade promotion fee"
  ));
  const totalEstimatedUsd = microUsd(
    safeAdd(
      safeAdd(
        safeAdd(dutyUsd, taxUsd, "total estimate"),
        tradePromotionFeeUsd,
        "total estimate"
      ),
      safeAdd(MOCK_FILING_FEE_USD, brokerFeeUsd, "total estimate"),
      "total estimate"
    )
  );

  return {
    quoteId: options.quoteId ?? `QUOTE-${randomUUID()}`,
    expiresAt: new Date(now.getTime() + quoteTtlSeconds * 1_000).toISOString(),
    declarationId: options.declarationId ?? `DECL-${randomUUID()}`,
    goodsValueUsd,
    freightUsd,
    insuranceUsd,
    customsValueUsd,
    appliedDutyRatePercent,
    tariffBasis: "mock-tariff-profile",
    dutyUsd,
    taxUsd,
    tradePromotionFeeUsd,
    filingFeeUsd: MOCK_FILING_FEE_USD,
    customsBrokerFeeUsd: brokerFeeUsd,
    totalEstimatedUsd
  };
}

export const calculateDutyQuote = calculateMockQuote;
