import { createHash } from "node:crypto";
import type { ExportDocuments, TradeDocumentType } from "./domain.js";

export const availableMockDocuments: Array<{
  type: TradeDocumentType;
  label: string;
  required: boolean;
}> = [
  { type: "commercial_invoice", label: "商業發票", required: true },
  { type: "packing_list", label: "裝箱單", required: true },
  { type: "bill_of_lading", label: "海運提單", required: true },
  { type: "certificate_of_origin", label: "產地證明", required: false },
  { type: "product_specification", label: "產品規格書", required: false },
  { type: "import_permit", label: "輸入許可證", required: false }
];

export const defaultMockDocumentTypes = availableMockDocuments
  .filter(document => document.required || document.type === "certificate_of_origin" || document.type === "product_specification")
  .map(document => document.type);

export function getMockExportDocuments(
  orderId: string,
  selectedDocuments: TradeDocumentType[] = defaultMockDocumentTypes
): ExportDocuments {
  const selected = new Set(selectedDocuments);
  const hasInvoice = selected.has("commercial_invoice");
  const hasPackingList = selected.has("packing_list");
  const hasBillOfLading = selected.has("bill_of_lading");
  const hasOrigin = selected.has("certificate_of_origin");
  const hasPermit = selected.has("import_permit");
  const externalReference = createHash("sha256")
    .update(orderId)
    .digest("hex")
    .slice(0, 10)
    .toUpperCase();
  return {
    invoiceNumber: hasInvoice ? `JP-TKY-${externalReference}-2026` : "",
    invoiceDate: hasInvoice ? "2026-08-20" : undefined,
    exporter: hasInvoice ? "Tokyo Precision Instruments Co., Ltd." : "",
    importer: hasInvoice ? "Formosa Industrial Systems Co., Ltd." : "",
    originCountry: "JP",
    destinationCountry: "TW",
    currency: "USD",
    incoterm: hasInvoice ? "CIF" : undefined,
    freightUsd: hasInvoice ? 80 : undefined,
    insuranceUsd: hasInvoice ? 12 : undefined,
    packageCount: hasPackingList ? 2 : undefined,
    grossWeightKg: hasPackingList ? 18.4 : undefined,
    netWeightKg: hasPackingList ? 15.2 : undefined,
    billOfLadingNumber: hasBillOfLading ? `ONEYTYO${externalReference}` : undefined,
    certificateOfOriginNumber: hasOrigin ? `COO-JP-${externalReference}` : undefined,
    importPermitNumber: hasPermit ? `MOEA-${externalReference}` : undefined,
    providedDocuments: [...selected],
    items: hasInvoice ? [
      {
        description: "Industrial digital temperature sensors",
        model: "TSP-500",
        material: "Stainless-steel probe with electronic sensing module",
        intendedUse: "Temperature monitoring in food-processing equipment",
        quantity: 10,
        unitPriceUsd: 120,
        hsCode: "9025.19"
      }
    ] : []
  };
}
