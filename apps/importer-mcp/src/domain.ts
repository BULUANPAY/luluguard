export interface TradeItem {
  description: string;
  quantity: number;
  unitPriceUsd: number;
  hsCode?: string;
}

export interface ExportDocuments {
  invoiceNumber: string;
  exporter: string;
  importer: string;
  originCountry: string;
  destinationCountry: string;
  currency: "USD";
  items: TradeItem[];
}

export interface DutyQuote {
  quoteId: string;
  expiresAt: string;
  declarationId: string;
  customsValueUsd: number;
  dutyUsd: number;
  taxUsd: number;
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
  maxPaymentUsd: number;
  allowedPayees: string[];
  requireHumanApprovalAboveUsd: number;
}

export interface CustomsBrokerResponse {
  quote: DutyQuote;
  receipt: CustomsBrokerReceipt;
}

export interface CustomsQuoteResponse {
  quote: DutyQuote;
}
