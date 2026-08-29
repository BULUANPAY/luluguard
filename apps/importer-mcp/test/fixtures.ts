import type { DutyQuote } from "../src/domain.js";

export const validDutyQuote: DutyQuote = {
  quoteId: "QUOTE-TEST",
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
  declarationId: "DECL-INV-TEST-001",
  goodsValueUsd: 25_000,
  freightUsd: 2_400,
  insuranceUsd: 850,
  customsValueUsd: 28_250,
  appliedDutyRatePercent: 5,
  tariffBasis: "mock-tariff-profile",
  dutyUsd: 1_412.5,
  taxUsd: 1_483.13,
  tradePromotionFeeUsd: 11.3,
  filingFeeUsd: 2,
  customsBrokerFeeUsd: 0.01,
  totalEstimatedUsd: 2_908.94,
};
