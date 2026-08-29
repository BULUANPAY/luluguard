import type { ExportDocuments } from "./domain.js";
import type { ReviewFinding } from "./compliance-review.js";
import { calculateImportCharges } from "./import-charges.js";

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
  const charges = calculateImportCharges(documents, expectedBrokerFeeUsdc);
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
    goodsValueUsd: charges.goodsValueUsd,
    freightUsd: charges.freightUsd,
    insuranceUsd: charges.insuranceUsd,
    customsValueUsd: charges.customsValueUsd,
    candidateHsCode,
    estimatedDutyRatePercent: charges.dutyRatePercent,
    estimatedDutyUsd: charges.dutyUsd,
    estimatedVatRatePercent: charges.vatRatePercent,
    estimatedVatUsd: charges.vatUsd,
    estimatedTradePromotionFeeUsd: charges.tradePromotionFeeUsd,
    estimatedFilingFeeUsd: charges.filingFeeUsd,
    expectedBrokerFeeUsdc,
    estimatedTotalUsd: charges.totalUsd,
    findings,
    disclaimer: "Independent importer estimate for comparison only. It is not a Taiwan Customs tariff ruling."
  };
}
