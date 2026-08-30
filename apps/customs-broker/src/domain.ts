import {
  REQUIRED_TRADE_DOCUMENT_TYPES,
  TRADE_DOCUMENT_TYPES,
  type CustomsPowerOfAttorney,
  type TradeDocumentType
} from "@luluguard/shared";
import { z } from "zod";

export type { TradeDocumentType };

export const MAX_MONEY_USD = 1_000_000_000;
export const MAX_QUANTITY = 1_000_000;
export const MAX_ITEMS = 100;
const EVM_ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;
const TRANSACTION_PATTERN = /^0x[a-fA-F0-9]{64}$/;

const boundedText = (max: number) => z.string().trim().min(1).max(max);
const optionalItemText = (max: number) => z.string().trim().max(max).optional();

/**
 * A JavaScript number cannot represent every decimal exactly. Compare in
 * cents with a scale-relative tolerance so ordinary values such as 0.29 are
 * accepted while values with a real third decimal place are rejected.
 */
function hasAtMostTwoDecimalPlaces(value: number): boolean {
  const scaled = value * 100;
  const roundedCents = Math.round(scaled);
  if (!Number.isSafeInteger(roundedCents)) return false;
  const tolerance = Number.EPSILON * Math.max(1, Math.abs(scaled)) * 8;
  return Math.abs(scaled - roundedCents) <= tolerance;
}

const money = z.number()
  .finite()
  .nonnegative()
  .max(MAX_MONEY_USD)
  .refine(hasAtMostTwoDecimalPlaces, "must have at most two decimal places");
const positiveInteger = (max: number) => z.number().finite().int().positive().max(max);

export const CustomsPowerOfAttorneySchema: z.ZodType<CustomsPowerOfAttorney> =
  z.object({
    documentType: z.literal("power_of_attorney"),
    documentId: boundedText(256),
    version: z.literal("1.0"),
    orderId: boundedText(128),
    acceptedAt: z.string().datetime(),
    importer: z.object({
      name: boundedText(256),
      lei: boundedText(64),
    }).strict(),
    representative: z.object({
      employeeId: boundedText(128),
      name: boundedText(256),
      role: boundedText(128),
    }).strict(),
    scope: z.array(boundedText(256)).min(1).max(20),
    vleiAuthorization: z.object({
      authorizationId: boundedText(256),
      signerAid: boundedText(512),
      signerCredentialSaid: boundedText(512),
    }).strict(),
  }).strict();

export const tradeDocumentTypes = TRADE_DOCUMENT_TYPES.map(
  (document) => document.type
) as [TradeDocumentType, ...TradeDocumentType[]];

export const requiredTradeDocumentTypes = REQUIRED_TRADE_DOCUMENT_TYPES;

export const TradeItemSchema = z.object({
  description: boundedText(500),
  model: boundedText(256),
  // Some exporter invoice formats do not contain customs-classification
  // enrichment fields. Accept them when absent (or normalized to an empty
  // string by the importer) so the broker can still produce an advisory quote.
  material: optionalItemText(256),
  intendedUse: optionalItemText(500),
  quantity: positiveInteger(MAX_QUANTITY),
  unit: boundedText(64).optional(),
  unitPriceUsd: money,
  hsCode: z.string().trim().min(1).max(32).optional(),
  dppBatchId: boundedText(256).optional()
}).strict().superRefine((item, context) => {
  const itemUnitPriceCents = Math.round(item.unitPriceUsd * 100);
  const itemValueCents = item.quantity * itemUnitPriceCents;
  if (!Number.isSafeInteger(itemValueCents)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["unitPriceUsd"],
      message: "item value exceeds the safe numeric range"
    });
  }
});

export const PackingListSchema = z.object({
  relatedInvoice: boundedText(128).optional(),
  exporter: boundedText(256).optional(),
  importer: boundedText(256).optional(),
  vessel: boundedText(256).optional(),
  totalQuantity: positiveInteger(MAX_QUANTITY).optional(),
  unit: boundedText(64).optional(),
  cargo: z.array(z.object({
    description: boundedText(500),
    quantity: positiveInteger(MAX_QUANTITY),
    unit: boundedText(64).optional(),
    dppBatchId: boundedText(256).optional()
  }).strict()).max(MAX_ITEMS)
}).strict();

export const DigitalProductPassportSchema = z.object({
  documentId: boundedText(256),
  dppId: boundedText(256),
  product: z.object({
    name: boundedText(500),
    model: boundedText(256),
    hsCode: boundedText(32),
    batchId: boundedText(256),
    quantity: positiveInteger(MAX_QUANTITY),
    unit: boundedText(64)
  }).strict(),
  carbonFootprint: z.object({
    productCarbonFootprintKgCo2e: z.number().finite().nonnegative().max(MAX_MONEY_USD),
    baselineKgCo2e: z.number().finite().positive().max(MAX_MONEY_USD),
    claimedReductionPercent: z.number().finite().min(0).max(100),
    methodology: boundedText(500),
    systemBoundary: boundedText(500),
    verificationStandard: boundedText(256),
    verifiedBy: boundedText(500),
    verifiedAt: boundedText(64)
  }).strict(),
  validity: z.object({
    validFrom: boundedText(64),
    validUntil: boundedText(64)
  }).strict()
}).strict();

export const ExportDocumentsSchema = z.object({
  invoiceNumber: boundedText(128),
  invoiceDate: z.string().trim().min(1).max(32).optional(),
  exporter: boundedText(256),
  importer: boundedText(256),
  originCountry: z.string().trim().min(2).max(64),
  destinationCountry: z.string().trim().min(2).max(64),
  currency: z.literal("USD"),
  incoterm: z.enum(["EXW", "FOB", "CIF"]).optional(),
  freightUsd: money.optional(),
  insuranceUsd: money.optional(),
  packageCount: positiveInteger(MAX_QUANTITY).optional(),
  grossWeightKg: z.number().finite().positive().max(MAX_MONEY_USD).optional(),
  netWeightKg: z.number().finite().positive().max(MAX_MONEY_USD).optional(),
  packingList: PackingListSchema.optional(),
  billOfLadingNumber: z.string().trim().min(1).max(128).optional(),
  certificateOfOriginNumber: z.string().trim().min(1).max(128).optional(),
  importPermitNumber: z.string().trim().min(1).max(128).optional(),
  powerOfAttorney: CustomsPowerOfAttorneySchema.optional(),
  digitalProductPassport: DigitalProductPassportSchema.optional(),
  providedDocuments: z.array(z.enum(tradeDocumentTypes))
    .min(1)
    .max(tradeDocumentTypes.length)
    .superRefine((documentTypes, context) => {
      if (new Set(documentTypes).size !== documentTypes.length) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "providedDocuments must not contain duplicate document types"
        });
      }
    }),
  items: z.array(TradeItemSchema).min(1).max(MAX_ITEMS)
}).strict().superRefine((documents, context) => {
  if (
    documents.netWeightKg !== undefined &&
    documents.grossWeightKg !== undefined &&
    documents.netWeightKg > documents.grossWeightKg
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["netWeightKg"],
      message: "netWeightKg must not exceed grossWeightKg"
    });
  }
});

export type TradeItem = z.infer<typeof TradeItemSchema>;
export type ExportDocuments = z.infer<typeof ExportDocumentsSchema>;

export const QuoteRequestSchema = ExportDocumentsSchema.superRefine((documents, context) => {
  const provided = new Set(documents.providedDocuments);
  for (const documentType of requiredTradeDocumentTypes) {
    if (!provided.has(documentType)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["providedDocuments"],
        message: `required document is missing: ${documentType}`
      });
    }
  }
  if (
    provided.has("power_of_attorney") &&
    documents.powerOfAttorney === undefined
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["powerOfAttorney"],
      message: "power_of_attorney requires the attached authorization document",
    });
  }
  if (provided.has("commercial_invoice") && (
    documents.invoiceDate === undefined ||
    documents.incoterm === undefined ||
    documents.freightUsd === undefined ||
    documents.insuranceUsd === undefined
  )) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["providedDocuments"],
      message: "commercial_invoice requires invoiceDate, incoterm, freightUsd, and insuranceUsd"
    });
  }
  if (provided.has("packing_list") && (
    documents.packageCount === undefined ||
    documents.grossWeightKg === undefined ||
    documents.netWeightKg === undefined
  )) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["providedDocuments"],
      message: "packing_list requires packageCount, grossWeightKg, and netWeightKg"
    });
  }
  if (provided.has("bill_of_lading") && documents.billOfLadingNumber === undefined) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["billOfLadingNumber"],
      message: "bill_of_lading requires billOfLadingNumber"
    });
  }
  if (provided.has("certificate_of_origin") && documents.certificateOfOriginNumber === undefined) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["certificateOfOriginNumber"],
      message: "certificate_of_origin requires certificateOfOriginNumber"
    });
  }
  if (provided.has("import_permit") && documents.importPermitNumber === undefined) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["importPermitNumber"],
      message: "import_permit requires importPermitNumber"
    });
  }
});
export type QuoteRequest = ExportDocuments;

export const SettlementDetailsSchema = z.object({
  success: z.boolean(),
  transaction: z.string().trim().max(128).optional(),
  network: z.string().trim().min(1).max(128),
  payer: z.string().trim().min(1).max(42).optional(),
  amount: z.string().trim().regex(/^(0|[1-9][0-9]*)$/, "amount must be an unsigned integer").max(78).optional(),
  errorReason: z.string().trim().min(1).max(256).optional()
}).superRefine((settlement, context) => {
  if (
    settlement.success &&
    (!TRANSACTION_PATTERN.test(settlement.transaction ?? "") ||
      /^0x0{64}$/i.test(settlement.transaction ?? ""))
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["transaction"],
      message: "successful settlement transaction must be a 32-byte 0x-prefixed hash"
    });
  }
  if (settlement.payer !== undefined && !EVM_ADDRESS_PATTERN.test(settlement.payer)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["payer"],
      message: "payer must be an EVM address"
    });
  }
});

export type SettlementDetails = z.infer<typeof SettlementDetailsSchema>;

export interface SettlementExpectation {
  expectedNetwork: string;
  expectedAmount?: string;
}

export function parseSettlementDetails(
  input: unknown,
  expected: SettlementExpectation
): SettlementDetails {
  const settlement = SettlementDetailsSchema.parse(input);
  const expectedNetwork = expected.expectedNetwork.trim();
  if (!expectedNetwork || settlement.network !== expectedNetwork) {
    throw new z.ZodError([{
      code: z.ZodIssueCode.custom,
      path: ["network"],
      message: `network must equal ${expectedNetwork || "the expected network"}`
    }]);
  }
  if (
    settlement.amount !== undefined &&
    expected.expectedAmount !== undefined &&
    settlement.amount !== expected.expectedAmount
  ) {
    throw new z.ZodError([{
      code: z.ZodIssueCode.custom,
      path: ["amount"],
      message: `amount must equal ${expected.expectedAmount}`
    }]);
  }
  return settlement;
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

export interface CustomsBrokerResponse {
  quote: DutyQuote;
  receipt: CustomsBrokerReceipt;
}

export interface CustomsQuoteResponse {
  quote: DutyQuote;
}

export const DeclarationRequestSchema = z.object({
  quoteId: z.string().trim().min(1),
  documents: QuoteRequestSchema
}).strict();

export type DeclarationRequest = z.infer<typeof DeclarationRequestSchema>;
