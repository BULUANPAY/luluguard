import type { ExportDocuments, TradeDocumentType, TradeItem } from "./domain.js";
import { getOrderFiles, type OrderFile } from "./order-files.js";

const knownDocumentTypes: readonly TradeDocumentType[] = [
  "commercial_invoice",
  "packing_list",
  "bill_of_lading",
  "certificate_of_origin",
  "product_specification",
  "import_permit"
];

function isKnownDocumentType(value: string): value is TradeDocumentType {
  return (knownDocumentTypes as readonly string[]).includes(value);
}

function firstFileOfType(files: OrderFile[], type: TradeDocumentType): OrderFile | undefined {
  return files.find(file => file.documentType === type);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asIncoterm(value: unknown): ExportDocuments["incoterm"] {
  return value === "EXW" || value === "FOB" || value === "CIF" ? value : undefined;
}

function asItems(value: unknown): TradeItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): TradeItem[] => {
    const record = asRecord(entry);
    if (!record) return [];
    const description = asString(record.description);
    const model = asString(record.model);
    const material = asString(record.material);
    const intendedUse = asString(record.intendedUse);
    const quantity = asNumber(record.quantity);
    const unitPriceUsd = asNumber(record.unitPriceUsd);
    if (!description || !model || !material || !intendedUse || quantity === undefined || unitPriceUsd === undefined)
      return [];
    const hsCode = asString(record.hsCode);
    return [{ description, model, material, intendedUse, quantity, unitPriceUsd, ...(hsCode ? { hsCode } : {}) }];
  });
}

/**
 * Builds an ExportDocuments record from the JSON files the user has actually uploaded
 * for the order (see order-files.ts). Document types with no uploaded file are simply
 * absent from providedDocuments; documents whose uploaded JSON does not match the
 * expected shape are still counted as provided but leave the corresponding structured
 * fields empty, so downstream document review reports them as incomplete.
 */
export async function buildExportDocumentsFromUploads(
  storageRoot: string,
  orderId: string
): Promise<ExportDocuments> {
  const files = await getOrderFiles(storageRoot, orderId);
  const providedDocuments = [...new Set(files.map(file => file.documentType))].filter(isKnownDocumentType);

  const invoice = asRecord(firstFileOfType(files, "commercial_invoice")?.content);
  const packingList = asRecord(firstFileOfType(files, "packing_list")?.content);
  const billOfLading = asRecord(firstFileOfType(files, "bill_of_lading")?.content);
  const certificateOfOrigin = asRecord(firstFileOfType(files, "certificate_of_origin")?.content);
  const importPermit = asRecord(firstFileOfType(files, "import_permit")?.content);

  return {
    invoiceNumber: asString(invoice?.invoiceNumber) ?? "",
    invoiceDate: asString(invoice?.invoiceDate),
    exporter: asString(invoice?.exporter) ?? "",
    importer: asString(invoice?.importer) ?? "",
    originCountry: asString(invoice?.originCountry) ?? "",
    destinationCountry: asString(invoice?.destinationCountry) ?? "TW",
    currency: "USD",
    incoterm: asIncoterm(invoice?.incoterm),
    freightUsd: asNumber(invoice?.freightUsd),
    insuranceUsd: asNumber(invoice?.insuranceUsd),
    packageCount: asNumber(packingList?.packageCount),
    grossWeightKg: asNumber(packingList?.grossWeightKg),
    netWeightKg: asNumber(packingList?.netWeightKg),
    billOfLadingNumber: asString(billOfLading?.billOfLadingNumber),
    certificateOfOriginNumber: asString(certificateOfOrigin?.certificateOfOriginNumber),
    importPermitNumber: asString(importPermit?.importPermitNumber),
    providedDocuments,
    items: asItems(invoice?.items)
  };
}
