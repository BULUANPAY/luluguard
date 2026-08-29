import type { ExportDocuments } from "./domain.js";

const MOCK_DUTY_RATE_PERCENT = 5;
const VAT_RATE_PERCENT = 5 as const;
const TRADE_PROMOTION_FEE_RATE = 0.0004;
const FILING_FEE_USD = 2;

export interface ImportChargeCalculation {
  goodsValueUsd: number;
  freightUsd: number;
  insuranceUsd: number;
  customsValueUsd: number;
  dutyRatePercent: number;
  dutyUsd: number;
  vatRatePercent: typeof VAT_RATE_PERCENT;
  vatUsd: number;
  tradePromotionFeeUsd: number;
  filingFeeUsd: number;
  brokerFeeUsd: number;
  totalUsd: number;
}

function roundUsd(value: number): number {
  return Number(value.toFixed(2));
}

export function mockDutyRatePercent(documents: ExportDocuments): number {
  return documents.items.every((item) => item.hsCode?.startsWith("8471"))
    ? 0
    : MOCK_DUTY_RATE_PERCENT;
}

export function calculateImportCharges(
  documents: ExportDocuments,
  brokerFeeUsd: number,
): ImportChargeCalculation {
  const goodsValueUsd = roundUsd(
    documents.items.reduce(
      (sum, item) => sum + item.quantity * item.unitPriceUsd,
      0,
    ),
  );
  const freightUsd = documents.freightUsd ?? 0;
  const insuranceUsd = documents.insuranceUsd ?? 0;
  const customsValueUsd = roundUsd(
    goodsValueUsd + freightUsd + insuranceUsd,
  );
  const dutyRatePercent = mockDutyRatePercent(documents);
  const dutyUsd = roundUsd((customsValueUsd * dutyRatePercent) / 100);
  const vatUsd = roundUsd(
    ((customsValueUsd + dutyUsd) * VAT_RATE_PERCENT) / 100,
  );
  const tradePromotionFeeUsd = roundUsd(
    customsValueUsd * TRADE_PROMOTION_FEE_RATE,
  );
  const totalUsd = roundUsd(
    dutyUsd + vatUsd + tradePromotionFeeUsd + FILING_FEE_USD + brokerFeeUsd,
  );

  return {
    goodsValueUsd,
    freightUsd,
    insuranceUsd,
    customsValueUsd,
    dutyRatePercent,
    dutyUsd,
    vatRatePercent: VAT_RATE_PERCENT,
    vatUsd,
    tradePromotionFeeUsd,
    filingFeeUsd: FILING_FEE_USD,
    brokerFeeUsd,
    totalUsd,
  };
}
