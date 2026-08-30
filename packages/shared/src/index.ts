// Single source of truth for trade document types used across the repo
// (importer-mcp domain model, mock exporter fixtures, document review rules,
// and the web chat UI's document metadata). Add or change document types
// here only; do not redeclare this list elsewhere.
export const TRADE_DOCUMENT_TYPES = [
  {
    type: "commercial_invoice",
    label: "商業發票",
    detail: "品名、價格、交易條件",
    required: true,
    providedByExporter: true,
  },
  {
    type: "packing_list",
    label: "裝箱單",
    detail: "件數、毛重與淨重",
    required: true,
    providedByExporter: true,
  },
  {
    type: "bill_of_lading",
    label: "海運提單",
    detail: "運送與提貨資料",
    required: false,
    providedByExporter: true,
  },
  {
    type: "certificate_of_origin",
    label: "產地證明",
    detail: "產地與優惠稅率佐證",
    required: false,
    providedByExporter: true,
  },
  {
    type: "product_specification",
    label: "產品規格書",
    detail: "型號、材質與用途",
    required: false,
    providedByExporter: true,
  },
  {
    type: "digital_product_passport",
    label: "DPP 數位產品護照",
    detail: "產品碳足跡、減量基準與第三方查證",
    required: false,
    providedByExporter: true,
  },
  {
    type: "import_permit",
    label: "輸入許可證",
    detail: "受管制商品適用",
    required: false,
    providedByExporter: false,
  },
  {
    type: "power_of_attorney",
    label: "委任書",
    detail: "報關委任關係與授權範圍",
    required: true,
    providedByExporter: false,
  },
] as const;

export type TradeDocumentType = (typeof TRADE_DOCUMENT_TYPES)[number]["type"];

export type TradeDocumentTypeDefinition = (typeof TRADE_DOCUMENT_TYPES)[number];

export const REQUIRED_TRADE_DOCUMENT_TYPES: TradeDocumentType[] =
  TRADE_DOCUMENT_TYPES.filter((document) => document.required).map(
    (document) => document.type,
  );

export function isTradeDocumentType(
  value: string,
): value is TradeDocumentType {
  return (TRADE_DOCUMENT_TYPES as readonly { type: string }[]).some(
    (document) => document.type === value,
  );
}

export function findTradeDocumentType(
  type: string,
): TradeDocumentTypeDefinition | undefined {
  return TRADE_DOCUMENT_TYPES.find((document) => document.type === type);
}

export interface CustomsPowerOfAttorney {
  documentType: "power_of_attorney";
  documentId: string;
  version: "1.0";
  orderId: string;
  acceptedAt: string;
  importer: {
    name: string;
    lei: string;
  };
  representative: {
    employeeId: string;
    name: string;
    role: string;
  };
  scope: string[];
  vleiAuthorization: {
    authorizationId: string;
    signerAid: string;
    signerCredentialSaid: string;
  };
}

export const PERMISSIONS = [
  "dashboard:read",
  "shipment:read",
  "shipment:create",
  "shipment:update",
  "export-object:create",
  "declaration:submit",
  "document:upload",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export type OrganizationKind = "importer" | "exporter" | "customs-broker";

export interface OrganizationSummary {
  id: string;
  name: string;
  kind: OrganizationKind;
}
