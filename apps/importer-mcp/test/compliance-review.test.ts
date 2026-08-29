import assert from "node:assert/strict";
import { test } from "node:test";
import { reviewImportQuote } from "../src/compliance-review.js";
import { getMockExportDocuments } from "../src/mock-exporter.js";
import { validDutyQuote } from "./fixtures.js";

test("allows payment when quote arithmetic and broker fee match", () => {
  const review = reviewImportQuote(
    getMockExportDocuments("REVIEW"),
    validDutyQuote,
    0.01,
  );
  assert.equal(review.paymentAllowed, true);
  assert.equal(review.impliedDutyRatePercent, 5);
  assert.equal(review.impliedVatRatePercent, 5);
});

test("blocks payment when broker fee does not match x402 configuration", () => {
  const review = reviewImportQuote(
    getMockExportDocuments("REVIEW"),
    {
      ...validDutyQuote,
      customsBrokerFeeUsd: 0.5,
      totalEstimatedUsd: 2_909.43,
    },
    0.01,
  );
  assert.equal(review.paymentAllowed, false);
  assert.ok(
    review.findings.some((finding) => finding.code === "BROKER_FEE_MISMATCH"),
  );
});

test("blocks payment when broker duty rate differs from local mock tariff profile", () => {
  const review = reviewImportQuote(
    getMockExportDocuments("REVIEW"),
    { ...validDutyQuote, appliedDutyRatePercent: 8 },
    0.01,
  );
  assert.equal(review.paymentAllowed, false);
  assert.ok(
    review.findings.some(
      (finding) => finding.code === "MOCK_DUTY_RATE_MISMATCH",
    ),
  );
});
