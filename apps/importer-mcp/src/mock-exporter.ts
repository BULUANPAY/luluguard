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
  {
    type: "digital_product_passport",
    label: "DPP 數位產品護照",
    required: true,
  },
  { type: "import_permit", label: "輸入許可證", required: false },
];

export const defaultMockDocumentTypes = availableMockDocuments
  .filter(
    (document) =>
      document.required ||
      document.type === "certificate_of_origin" ||
      document.type === "product_specification",
  )
  .map((document) => document.type);

export function getMockExportDocuments(
  orderId: string,
  selectedDocuments: TradeDocumentType[] = defaultMockDocumentTypes,
): ExportDocuments {
  const selected = new Set(selectedDocuments);
  const hasInvoice = selected.has("commercial_invoice");
  const hasPackingList = selected.has("packing_list");
  const hasBillOfLading = selected.has("bill_of_lading");
  const hasOrigin = selected.has("certificate_of_origin");
  const hasPermit = selected.has("import_permit");
  const hasDpp = selected.has("digital_product_passport");
  const externalReference = createHash("sha256")
    .update(orderId)
    .digest("hex")
    .slice(0, 10)
    .toUpperCase();
  return {
    invoiceNumber: hasInvoice ? `GB-SLE-${externalReference}-2026` : "",
    invoiceDate: hasInvoice ? "2026-08-20" : undefined,
    exporter: hasInvoice ? "Sinclair Livestock Exports Ltd." : "",
    importer: hasInvoice ? "Kaohsiung Livestock Import Center" : "",
    originCountry: "GB",
    destinationCountry: "TW",
    currency: "USD",
    incoterm: hasInvoice ? "CIF" : undefined,
    freightUsd: hasInvoice ? 2_400 : undefined,
    insuranceUsd: hasInvoice ? 850 : undefined,
    packageCount: hasPackingList ? 1 : undefined,
    grossWeightKg: hasPackingList ? 460 : undefined,
    netWeightKg: hasPackingList ? 420 : undefined,
    billOfLadingNumber: hasBillOfLading
      ? `SLEGB${externalReference}`
      : undefined,
    certificateOfOriginNumber: hasOrigin
      ? `COO-GB-${externalReference}`
      : undefined,
    importPermitNumber: hasPermit ? `MOEA-${externalReference}` : undefined,
    digitalProductPassport: hasDpp
      ? {
          documentId: `DPP-${externalReference}`,
          dppId: `DPP-PONY-${externalReference}`,
          product: {
            name: "Highland Pony",
            model: "Equus ferus caballus",
            hsCode: "0101.21",
            batchId: `DPP-PONY-${externalReference}`,
            quantity: 1,
            unit: "HEAD",
          },
          carbonFootprint: {
            productCarbonFootprintKgCo2e: 360,
            baselineKgCo2e: 500,
            claimedReductionPercent: 28,
            methodology: "ISO 14067 product carbon footprint",
            systemBoundary: "Cradle-to-port",
            verificationStandard: "ISO 14064-3",
            verifiedBy: "Caledonia Carbon Verification Ltd.",
            verifiedAt: new Date(Date.now() - 86_400_000).toISOString(),
          },
          validity: {
            validFrom: new Date(Date.now() - 86_400_000).toISOString(),
            validUntil: new Date(Date.now() + 365 * 86_400_000).toISOString(),
          },
        }
      : undefined,
    providedDocuments: [...selected],
    items: hasInvoice
      ? [
          {
            description: "Highland Pony",
            model: "Equus ferus caballus",
            material: "Live animal - equine",
            intendedUse:
              "Breeding stock for a licensed livestock import center",
            quantity: 1,
            unitPriceUsd: 25_000,
            hsCode: "0101.21",
            dppBatchId: `DPP-PONY-${externalReference}`,
          },
        ]
      : [],
  };
}
