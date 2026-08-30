import type {
  CustomsPowerOfAttorney,
  TradeDocumentType,
} from "@luluguard/shared";

export type { TradeDocumentType };

export interface TradeItem {
  description: string;
  model: string;
  material: string;
  intendedUse: string;
  quantity: number;
  unit?: string;
  unitPriceUsd: number;
  hsCode?: string;
  dppBatchId?: string;
}

export interface PackingListData {
  relatedInvoice?: string;
  exporter?: string;
  importer?: string;
  vessel?: string;
  totalQuantity?: number;
  unit?: string;
  cargo: Array<{
    description: string;
    quantity: number;
    unit?: string;
    dppBatchId?: string;
  }>;
}

export interface DigitalProductPassportData {
  documentId: string;
  dppId: string;
  product: {
    name: string;
    model: string;
    hsCode: string;
    batchId: string;
    quantity: number;
    unit: string;
  };
  carbonFootprint: {
    productCarbonFootprintKgCo2e: number;
    baselineKgCo2e: number;
    claimedReductionPercent: number;
    methodology: string;
    systemBoundary: string;
    verificationStandard: string;
    verifiedBy: string;
    verifiedAt: string;
  };
  validity: {
    validFrom: string;
    validUntil: string;
  };
}

export interface ExportDocuments {
  invoiceNumber: string;
  invoiceDate?: string;
  exporter: string;
  importer: string;
  originCountry: string;
  destinationCountry: string;
  currency: "USD";
  incoterm?: "EXW" | "FOB" | "CIF";
  freightUsd?: number;
  insuranceUsd?: number;
  packageCount?: number;
  grossWeightKg?: number;
  netWeightKg?: number;
  packingList?: PackingListData;
  billOfLadingNumber?: string;
  certificateOfOriginNumber?: string;
  importPermitNumber?: string;
  digitalProductPassport?: DigitalProductPassportData;
  powerOfAttorney?: CustomsPowerOfAttorney;
  providedDocuments: TradeDocumentType[];
  items: TradeItem[];
}

export interface DutyQuote {
  quoteId: string;
  expiresAt: string;
  declarationId: string;
  goodsValueUsd: number;
  freightUsd: number;
  insuranceUsd: number;
  customsValueUsd: number;
  appliedDutyRatePercent: number;
  tariffBasis: "mock-tariff-profile";
  dutyUsd: number;
  taxUsd: number;
  tradePromotionFeeUsd: number;
  filingFeeUsd: number;
  customsBrokerFeeUsd: number;
  totalEstimatedUsd: number;
}

export interface CustomsBrokerReceipt {
  receiptId: string;
  declarationId: string;
  brokerFeeUsd: number;
  brokerAddress: string;
  status: "filed";
  timestamp: string;
}

export interface AgentPolicy {
  status?: "ACTIVE" | "PAYMENT_PAUSED" | "DISABLED";
  maxPaymentUsd: number;
  allowedPayees: string[];
  requireHumanApprovalAboveUsd: number;
  maxDailySpendUsd?: number;
  maxPaymentsPerHour?: number;
}

export interface CustomsBrokerResponse {
  quote: DutyQuote;
  receipt: CustomsBrokerReceipt;
}

export interface CustomsQuoteResponse {
  quote: DutyQuote;
}
