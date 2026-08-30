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
