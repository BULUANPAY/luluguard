import assert from "node:assert/strict";
import { test } from "node:test";
import type { OrderFile } from "../src/order-files.js";
import { buildExportDocuments } from "../src/uploaded-documents.js";

function file(documentType: string, content: unknown): OrderFile {
  return {
    documentType,
    content,
    filename: `${documentType}.json`,
    path: "uploaded-files/test.json",
    size: 1,
  };
}

test("builds broker documents from every uploaded order file", () => {
  const documents = buildExportDocuments([
    file("commercial_invoice", {
      payload: {
        document_type: "COMMERCIAL_INVOICE",
        document_id: "INV-1",
        issue_date: "2026-08-29",
        currency: "USD",
        exporter: { name: "Exporter", country: "Ireland" },
        importer: { name: "Importer", country: "Taiwan" },
        shipment: { country_of_origin: "Ireland", incoterm: "CIF Keelung" },
        items: [
          {
            description: "Goods",
            scientific_name: "Model",
            hs_code: "0101.21",
            quantity: 2,
            unit_price: 100,
          },
        ],
      },
    }),
    file("packing_list", {
      document_type: "PACKING_LIST",
      packages: { total_packages: 2 },
      weight: { gross_weight_kg: 20, net_weight_kg: 18 },
    }),
  ]);

  assert.equal(documents.invoiceNumber, "INV-1");
  assert.equal(documents.destinationCountry, "TW");
  assert.equal(documents.items[0]?.unitPriceUsd, 100);
  assert.deepEqual(documents.providedDocuments, [
    "commercial_invoice",
    "packing_list",
  ]);
  assert.equal(documents.packageCount, 2);
});

test("classifies documents from content in the unclassified upload inbox", () => {
  const documents = buildExportDocuments([
    file("unclassified", {
      invoiceNumber: "INV-AI-1",
      currency: "USD",
      items: [{ description: "Goods", quantity: 1, unitPriceUsd: 25 }],
    }),
    file("unclassified", {
      packages: { total_packages: 3 },
      weight: { gross_weight_kg: 12 },
    }),
  ]);

  assert.equal(documents.invoiceNumber, "INV-AI-1");
  assert.deepEqual(documents.providedDocuments, [
    "commercial_invoice",
    "packing_list",
  ]);
  assert.equal(documents.packageCount, 3);
});

test("rejects orders without files and non-USD invoices", () => {
  assert.throws(() => buildExportDocuments([]), /No JSON documents/);
  assert.throws(
    () =>
      buildExportDocuments([
        file("commercial_invoice", {
          document_type: "COMMERCIAL_INVOICE",
          currency: "EUR",
        }),
      ]),
    /currency EUR is not supported/,
  );
});
