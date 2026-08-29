import { describe, expect, it } from "vitest";

import {
  createEmptyExportDocument,
  createTestExportDocument,
  parseExportDocument,
} from "./export-document";

describe("export document helpers", () => {
  it("creates an empty commercial invoice without generated values", () => {
    const document = createEmptyExportDocument(
      "COMMERCIAL_INVOICE",
      "Sinclair Livestock Exports Ltd.",
    );

    expect(document.document_type).toBe("COMMERCIAL_INVOICE");
    if (document.document_type !== "COMMERCIAL_INVOICE")
      throw new Error("unexpected type");
    expect(document.exporter.name).toBe("Sinclair Livestock Exports Ltd.");
    expect(document.issuer.organization).toBe(
      "Sinclair Livestock Exports Ltd.",
    );
    expect(document.document_id).toBe("");
    expect(document.issue_date).toBe("");
    expect(document.items[0]?.description).toBe("");
    expect(document.totals.total_amount).toBe(0);
  });

  it("loads one fixed packing-list test data set", () => {
    const document = createTestExportDocument(
      "PACKING_LIST",
      "Sinclair Livestock Exports Ltd.",
    );

    expect(document.document_type).toBe("PACKING_LIST");
    if (document.document_type !== "PACKING_LIST")
      throw new Error("unexpected type");
    expect(document.related_invoice).toMatch(/^INV-UNI-/);
    expect(document.exporter.region).toBe("Scotland");
    expect(document.importer.country).toBe("Taiwan");
    expect(document.cargo[0]?.description).toBe("Unicorn");
    expect(document.cargo[0]?.quantity).toBe(10000);
    expect(document.packages.total_quantity).toBe(document.cargo[0]?.quantity);
    expect(document.weight.gross_weight_kg).toBeGreaterThan(
      document.weight.net_weight_kg,
    );
  });

  it("loads the same 10,000 Scottish unicorns in the invoice", () => {
    const document = createTestExportDocument(
      "COMMERCIAL_INVOICE",
      "Sinclair Livestock Exports Ltd.",
    );

    if (document.document_type !== "COMMERCIAL_INVOICE")
      throw new Error("unexpected type");
    expect(document.items[0]?.description).toBe("Unicorn");
    expect(document.items[0]?.quantity).toBe(10000);
    expect(document.totals.total_quantity).toBe(10000);
    expect(document.totals.total_amount).toBe(
      document.items[0]!.quantity * document.items[0]!.unit_price,
    );
  });

  it("rejects JSON whose type does not match the selected generator", () => {
    const document = createTestExportDocument(
      "PACKING_LIST",
      "Sinclair Livestock Exports Ltd.",
    );

    expect(() =>
      parseExportDocument(JSON.stringify(document), "COMMERCIAL_INVOICE"),
    ).toThrow("JSON 內容不一致");
  });

  it("round-trips a complete export document", () => {
    const document = createTestExportDocument(
      "COMMERCIAL_INVOICE",
      "Sinclair Livestock Exports Ltd.",
    );

    expect(parseExportDocument(JSON.stringify(document))).toEqual(document);
  });

  it("rejects incomplete nested data before rendering the editor", () => {
    const document = createTestExportDocument(
      "COMMERCIAL_INVOICE",
      "Sinclair Livestock Exports Ltd.",
    );
    const missingShipment = structuredClone(document) as Partial<typeof document>;
    delete missingShipment.shipment;

    expect(() => parseExportDocument(JSON.stringify(missingShipment))).toThrow(
      /shipment/,
    );
    expect(() =>
      parseExportDocument(JSON.stringify({ ...document, items: [] })),
    ).toThrow(/items/);
  });
});
