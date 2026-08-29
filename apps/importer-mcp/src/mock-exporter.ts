import type { ExportDocuments } from "./domain.js";

export function getMockExportDocuments(orderId: string): ExportDocuments {
  return {
    invoiceNumber: `INV-${orderId}`,
    exporter: "Demo Exporter Ltd.",
    importer: "Demo Importer Co.",
    originCountry: "JP",
    destinationCountry: "TW",
    currency: "USD",
    items: [
      {
        description: "Industrial temperature sensors",
        quantity: 10,
        unitPriceUsd: 120,
        hsCode: "9025.19"
      }
    ]
  };
}
