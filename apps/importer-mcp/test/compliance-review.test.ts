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

test("blocks a one-atomic-unit broker fee mismatch", () => {
  const review = reviewImportQuote(
    getMockExportDocuments("REVIEW"),
    { ...validDutyQuote, customsBrokerFeeUsd: 0.010001 },
    0.01,
  );
  assert.equal(review.paymentAllowed, false);
  assert.ok(
    review.findings.some(
      (finding) => finding.code === "BROKER_FEE_MISMATCH",
    ),
  );
});

test("blocks a one-atomic-unit total mismatch", () => {
  const review = reviewImportQuote(
    getMockExportDocuments("REVIEW"),
    { ...validDutyQuote, totalEstimatedUsd: 2_908.940001 },
    0.01,
  );
  assert.equal(review.paymentAllowed, false);
  assert.ok(
    review.findings.some(
      (finding) => finding.code === "QUOTE_TOTAL_MISMATCH",
    ),
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

test("blocks an internally consistent quote with incorrect calculated charges", () => {
  const review = reviewImportQuote(
    getMockExportDocuments("REVIEW"),
    {
      ...validDutyQuote,
      dutyUsd: 1_512.5,
      taxUsd: 1_488.13,
      totalEstimatedUsd: 3_013.94,
    },
    0.01,
  );

  assert.equal(review.paymentAllowed, false);
  assert.ok(
    review.findings.some((finding) => finding.code === "DUTY_AMOUNT_MISMATCH"),
  );
  assert.ok(
    review.findings.some((finding) => finding.code === "VAT_AMOUNT_MISMATCH"),
  );
});
