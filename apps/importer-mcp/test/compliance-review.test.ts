import assert from "node:assert/strict";
import { test } from "node:test";
import { reviewImportQuote } from "../src/compliance-review.js";
import { getMockExportDocuments } from "../src/mock-exporter.js";
import type { DutyQuote } from "../src/domain.js";

const validQuote: DutyQuote = {
  quoteId: "QUOTE-REVIEW",
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
  declarationId: "DECL-REVIEW",
  goodsValueUsd: 1200,
  freightUsd: 80,
  insuranceUsd: 12,
  customsValueUsd: 1292,
  appliedDutyRatePercent: 5,
  tariffBasis: "mock-tariff-profile",
  dutyUsd: 64.6,
  taxUsd: 67.83,
  tradePromotionFeeUsd: 0.52,
  filingFeeUsd: 2,
  customsBrokerFeeUsd: 0.01,
  totalEstimatedUsd: 134.96
};

test("allows payment when quote arithmetic and broker fee match", () => {
  const review = reviewImportQuote(getMockExportDocuments("REVIEW"), validQuote, 0.01);
  assert.equal(review.paymentAllowed, true);
  assert.equal(review.impliedDutyRatePercent, 5);
  assert.equal(review.impliedVatRatePercent, 5);
});

test("blocks payment when broker fee does not match x402 configuration", () => {
  const review = reviewImportQuote(
    getMockExportDocuments("REVIEW"),
    { ...validQuote, customsBrokerFeeUsd: 0.5, totalEstimatedUsd: 135.45 },
    0.01
  );
  assert.equal(review.paymentAllowed, false);
  assert.ok(review.findings.some(finding => finding.code === "BROKER_FEE_MISMATCH"));
});

test("blocks payment when broker duty rate differs from local mock tariff profile", () => {
  const review = reviewImportQuote(
    getMockExportDocuments("REVIEW"),
    { ...validQuote, appliedDutyRatePercent: 8 },
    0.01
  );
  assert.equal(review.paymentAllowed, false);
  assert.ok(review.findings.some(finding => finding.code === "MOCK_DUTY_RATE_MISMATCH"));
});
