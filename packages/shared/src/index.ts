export {
  TRADE_DOCUMENT_TYPES,
  REQUIRED_TRADE_DOCUMENT_TYPES,
  isTradeDocumentType,
  findTradeDocumentType,
} from "./document-types.js";
export type {
  TradeDocumentType,
  TradeDocumentTypeDefinition,
} from "./document-types.js";

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
