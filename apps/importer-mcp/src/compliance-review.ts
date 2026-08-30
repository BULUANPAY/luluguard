import { convertToTokenAmount, numberToDecimalString } from "@x402/core/utils";
import type { DutyQuote, ExportDocuments } from "./domain.js";
import { calculateImportCharges } from "./import-charges.js";

export type ReviewSeverity = "info" | "warning" | "blocker";

export interface ReviewFinding {
  code: string;
  severity: ReviewSeverity;
  message: string;
}

export interface ComplianceReview {
  paymentAllowed: boolean;
  reviewedAt: string;
  destination: string;
  goodsValueUsd: number;
  impliedDutyRatePercent: number | null;
  impliedVatRatePercent: number | null;
  tariffLookupRequired: boolean;
  officialReferences: Array<{ title: string; url: string }>;
  missingInformation: string[];
  findings: ReviewFinding[];
  disclaimer: string;
}

const centsEqual = (left: number, right: number) => Math.abs(left - right) <= 0.01;

function usdcAtomicAmount(value: number): string | undefined {
  if (!Number.isFinite(value) || value < 0) return undefined;
  let decimal: string;
  try {
    decimal = numberToDecimalString(value);
  } catch {
    return undefined;
  }
  const fractionalPart = decimal.split(".")[1] ?? "";
  if (/[1-9]/.test(fractionalPart.slice(6))) return undefined;
  try {
    return convertToTokenAmount(decimal, 6);
  } catch {
    return undefined;
  }
}

function sumUsdcAtomicAmounts(values: number[]): string | undefined {
  let total = 0n;
  for (const value of values) {
    const atomicAmount = usdcAtomicAmount(value);
    if (atomicAmount === undefined) return undefined;
    total += BigInt(atomicAmount);
  }
  return total.toString();
}

export function reviewImportQuote(
  documents: ExportDocuments,
  quote: DutyQuote,
  expectedBrokerFeeUsd: number
): ComplianceReview {
  const findings: ReviewFinding[] = [];
  const expected = calculateImportCharges(documents, expectedBrokerFeeUsd);

  if (documents.destinationCountry !== "TW") {
    findings.push({
      code: "DESTINATION_NOT_TAIWAN",
      severity: "blocker",
      message: "This review profile only supports imports whose destinationCountry is TW."
    });
  }
  if (!documents.items.length) {
    findings.push({ code: "NO_ITEMS", severity: "blocker", message: "Invoice contains no goods." });
  }
  if (documents.items.some(item => !item.hsCode)) {
    findings.push({
      code: "HS_CODE_MISSING",
      severity: "blocker",
      message: "Every item needs an HS code before customs filing."
    });
  }
  if (documents.items.some(item => item.hsCode && item.hsCode.replace(/\D/g, "").length < 8)) {
    findings.push({
      code: "TAIWAN_TARIFF_CODE_REQUIRES_CONFIRMATION",
      severity: "warning",
      message: "At least one HS code is shorter than a Taiwan tariff classification; confirm the applicable tariff line and import regulations."
    });
  }
  if (!centsEqual(quote.goodsValueUsd, expected.goodsValueUsd)) {
    findings.push({
      code: "GOODS_VALUE_MISMATCH",
      severity: "blocker",
      message: `Quoted goods value ${quote.goodsValueUsd} does not match invoice goods value ${expected.goodsValueUsd}.`
    });
  }
  if (!centsEqual(quote.freightUsd, expected.freightUsd)) {
    findings.push({
      code: "FREIGHT_VALUE_MISMATCH",
      severity: "blocker",
      message: `Quoted freight value ${quote.freightUsd} does not match document freight value ${expected.freightUsd}.`
    });
  }
  if (!centsEqual(quote.insuranceUsd, expected.insuranceUsd)) {
    findings.push({
      code: "INSURANCE_VALUE_MISMATCH",
      severity: "blocker",
      message: `Quoted insurance value ${quote.insuranceUsd} does not match document insurance value ${expected.insuranceUsd}.`
    });
  }
  if (!centsEqual(quote.customsValueUsd, expected.customsValueUsd)) {
    findings.push({
      code: "CUSTOMS_VALUE_MISMATCH",
      severity: "blocker",
      message: `Quoted customs value ${quote.customsValueUsd} does not match expected CIF value ${expected.customsValueUsd}.`
    });
  }
  const quotedBrokerFeeAtomic = usdcAtomicAmount(quote.customsBrokerFeeUsd);
  const expectedBrokerFeeAtomic = usdcAtomicAmount(expectedBrokerFeeUsd);
  if (
    quotedBrokerFeeAtomic === undefined ||
    expectedBrokerFeeAtomic === undefined ||
    quotedBrokerFeeAtomic !== expectedBrokerFeeAtomic
  ) {
    findings.push({
      code: "BROKER_FEE_MISMATCH",
      severity: "blocker",
      message: `Quoted broker fee ${quote.customsBrokerFeeUsd} differs from configured x402 fee ${expectedBrokerFeeUsd}.`
    });
  } else {
    findings.push({
      code: "BROKER_FEE_MATCHES_CONFIG",
      severity: "info",
      message: `The quoted broker fee matches the configured x402 fee of ${expectedBrokerFeeUsd} USDC; this does not assess the market price of broker services.`
    });
  }
  const quoteExpiresAt = Date.parse(quote.expiresAt);
  if (!Number.isFinite(quoteExpiresAt) || quoteExpiresAt <= Date.now()) {
    findings.push({
      code: "QUOTE_EXPIRED",
      severity: "blocker",
      message: "The broker quote has expired."
    });
  }
  const totalComponents = [
    quote.dutyUsd,
    quote.taxUsd,
    quote.tradePromotionFeeUsd,
    quote.filingFeeUsd,
    quote.customsBrokerFeeUsd
  ];
  const quotedTotalAtomic = usdcAtomicAmount(quote.totalEstimatedUsd);
  const expectedTotalAtomic = sumUsdcAtomicAmounts(totalComponents);
  if (quotedTotalAtomic === undefined || expectedTotalAtomic === undefined || quotedTotalAtomic !== expectedTotalAtomic) {
    findings.push({
      code: "QUOTE_TOTAL_MISMATCH",
      severity: "blocker",
      message: `Quoted total ${quote.totalEstimatedUsd} does not equal its fee components at USDC atomic precision.`
    });
  }

  const impliedDutyRatePercent = quote.customsValueUsd > 0
    ? Number((quote.dutyUsd / quote.customsValueUsd * 100).toFixed(4))
    : null;
  if (quote.appliedDutyRatePercent !== expected.dutyRatePercent) {
    findings.push({
      code: "MOCK_DUTY_RATE_MISMATCH",
      severity: "blocker",
      message: `Broker applied ${quote.appliedDutyRatePercent}% duty, but the local mock tariff profile expects ${expected.dutyRatePercent}% for the submitted HS codes.`
    });
  }
  if (!centsEqual(quote.dutyUsd, expected.dutyUsd)) {
    findings.push({
      code: "DUTY_AMOUNT_MISMATCH",
      severity: "blocker",
      message: `Quoted duty ${quote.dutyUsd} does not match the local mock calculation ${expected.dutyUsd}.`
    });
  }
  if (!centsEqual(quote.taxUsd, expected.vatUsd)) {
    findings.push({
      code: "VAT_AMOUNT_MISMATCH",
      severity: "blocker",
      message: `Quoted VAT ${quote.taxUsd} does not match the local mock calculation ${expected.vatUsd}.`
    });
  }
  if (!centsEqual(quote.tradePromotionFeeUsd, expected.tradePromotionFeeUsd)) {
    findings.push({
      code: "TRADE_PROMOTION_FEE_MISMATCH",
      severity: "blocker",
      message: `Quoted trade promotion fee ${quote.tradePromotionFeeUsd} does not match the local mock calculation ${expected.tradePromotionFeeUsd}.`
    });
  }
  if (!centsEqual(quote.filingFeeUsd, expected.filingFeeUsd)) {
    findings.push({
      code: "FILING_FEE_MISMATCH",
      severity: "blocker",
      message: `Quoted filing fee ${quote.filingFeeUsd} does not match the local mock calculation ${expected.filingFeeUsd}.`
    });
  }
  const vatBase = quote.customsValueUsd + quote.dutyUsd;
  const impliedVatRatePercent = vatBase > 0
    ? Number((quote.taxUsd / vatBase * 100).toFixed(4))
    : null;
  if (impliedVatRatePercent !== null && Math.abs(impliedVatRatePercent - 5) > 0.01) {
    findings.push({
      code: "VAT_RATE_UNEXPECTED",
      severity: "warning",
      message: `The implied VAT rate is ${impliedVatRatePercent}%; confirm the taxable base and any commodity, tobacco, alcohol, or health taxes.`
    });
  }

  const missingInformation = [
    !documents.importPermitNumber && "Taiwan import permit or competent-authority approval when applicable",
    !documents.certificateOfOriginNumber && "country-of-origin evidence and preferential tariff eligibility",
    documents.items.some(item => item.hsCode && item.hsCode.replace(/\D/g, "").length < 8) &&
      "complete Taiwan tariff classification"
  ].filter((item): item is string => Boolean(item));
  findings.push({
    code: "OFFICIAL_TARIFF_LOOKUP_REQUIRED",
    severity: "warning",
    message: "Passing the local mock tariff comparison does not establish the legal tariff; verify each item against Taiwan's official tariff and import-regulation lookup."
  });

  return {
    paymentAllowed: !findings.some(finding => finding.severity === "blocker"),
    reviewedAt: new Date().toISOString(),
    destination: documents.destinationCountry,
    goodsValueUsd: expected.goodsValueUsd,
    impliedDutyRatePercent,
    impliedVatRatePercent,
    tariffLookupRequired: true,
    officialReferences: [
      {
        title: "Taiwan Customs: taxes and fees on imported goods",
        url: "https://web.customs.gov.tw/singlehtml/1207?cntId=cus1_93288_1207"
      },
      {
        title: "Taiwan Customs: required import declaration documents",
        url: "https://web.customs.gov.tw/singlehtml/1207?cntId=cus1_93300_1207"
      },
      {
        title: "Taiwan Customs: tariff-rate lookup guidance",
        url: "https://web.customs.gov.tw/singlehtml/1207?cntId=cus1_93361_1207"
      }
    ],
    missingInformation,
    findings,
    disclaimer: "Advisory quote comparison only. Taiwan Customs and competent authorities make the final tariff, tax, permit, and valuation decisions."
  };
}
