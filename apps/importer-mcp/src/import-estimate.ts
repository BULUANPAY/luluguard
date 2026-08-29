import type { ExportDocuments } from "./domain.js";
import type { ReviewFinding } from "./compliance-review.js";

export interface ImportEstimate {
  status: "ADVISORY";
  generatedAt: string;
  goodsValueUsd: number;
  freightUsd: number;
  insuranceUsd: number;
  customsValueUsd: number;
  candidateHsCode: string | null;
  estimatedDutyRatePercent: number;
  estimatedDutyUsd: number;
  estimatedVatRatePercent: 5;
  estimatedVatUsd: number;
  estimatedTradePromotionFeeUsd: number;
  estimatedFilingFeeUsd: number;
  expectedBrokerFeeUsdc: number;
  estimatedTotalUsd: number;
  findings: ReviewFinding[];
  disclaimer: string;
}

export function estimateImportCosts(
  documents: ExportDocuments,
  expectedBrokerFeeUsdc: number
): ImportEstimate {
  const goodsValueUsd = Number(documents.items.reduce(
    (sum, item) => sum + item.quantity * item.unitPriceUsd,
    0
  ).toFixed(2));
  const freightUsd = documents.freightUsd ?? 0;
  const insuranceUsd = documents.insuranceUsd ?? 0;
  const customsValueUsd = Number((goodsValueUsd + freightUsd + insuranceUsd).toFixed(2));
  const estimatedDutyRatePercent = documents.items.every(item => item.hsCode?.startsWith("8471")) ? 0 : 5;
  const estimatedDutyUsd = Number((customsValueUsd * estimatedDutyRatePercent / 100).toFixed(2));
  const estimatedVatUsd = Number(((customsValueUsd + estimatedDutyUsd) * 0.05).toFixed(2));
  const estimatedTradePromotionFeeUsd = Number((customsValueUsd * 0.0004).toFixed(2));
  const estimatedFilingFeeUsd = 2;
  const estimatedTotalUsd = Number((
    estimatedDutyUsd + estimatedVatUsd + estimatedTradePromotionFeeUsd +
    estimatedFilingFeeUsd + expectedBrokerFeeUsdc
  ).toFixed(2));
  const candidateHsCode = documents.items.length === 1 ? documents.items[0]?.hsCode ?? null : null;
  const findings: ReviewFinding[] = [{
    code: "CANDIDATE_TARIFF_ONLY",
    severity: "warning",
    message: "The HS code and duty rate are candidates from the local mock profile, not a legal tariff ruling."
  }];
  if (!documents.importPermitNumber) {
    findings.push({
      code: "IMPORT_REGULATION_REVIEW_REQUIRED",
      severity: "warning",
      message: "Confirm the official import regulations and whether a permit or inspection approval is required."
    });
  }
  return {
    status: "ADVISORY",
    generatedAt: new Date().toISOString(),
    goodsValueUsd,
    freightUsd,
    insuranceUsd,
    customsValueUsd,
    candidateHsCode,
    estimatedDutyRatePercent,
    estimatedDutyUsd,
    estimatedVatRatePercent: 5,
    estimatedVatUsd,
    estimatedTradePromotionFeeUsd,
    estimatedFilingFeeUsd,
    expectedBrokerFeeUsdc,
    estimatedTotalUsd,
    findings,
    disclaimer: "Independent importer estimate for comparison only. It is not a Taiwan Customs tariff ruling."
  };
}
