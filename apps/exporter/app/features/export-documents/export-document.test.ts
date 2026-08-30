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
    expect(document.invoice_number).toBe("");
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
    expect(document.related_invoice).toBe("INV-DEMO-20260829-001");
    expect(document.exporter.region).toBe("Scotland");
    expect(document.importer.country).toBe("Taiwan");
    expect(document.cargo[0]?.description).toBe("Unicorn");
    expect(document.cargo[0]?.quantity).toBe(10000);
    expect(document.cargo[0]?.unit).toBe("HEAD");
    expect(document.packages.total_quantity).toBe(document.cargo[0]?.quantity);
    expect(document.weight.gross_weight_kg).toBeGreaterThan(
      document.weight.net_weight_kg,
    );
  });

  it("generates a unique UUID document number for each test data set", () => {
    const first = createTestExportDocument(
      "COMMERCIAL_INVOICE",
      "Sinclair Livestock Exports Ltd.",
    );
    const second = createTestExportDocument(
      "COMMERCIAL_INVOICE",
      "Sinclair Livestock Exports Ltd.",
    );

    expect(first.document_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(second.document_id).not.toBe(first.document_id);
  });

  it("loads the same 10,000 Scottish unicorns in the invoice", () => {
    const document = createTestExportDocument(
      "COMMERCIAL_INVOICE",
      "Sinclair Livestock Exports Ltd.",
    );

    if (document.document_type !== "COMMERCIAL_INVOICE")
      throw new Error("unexpected type");
    expect(document.invoice_number).toBe("INV-DEMO-20260829-001");
    expect(document.items[0]?.description).toBe("Unicorn");
    expect(document.items[0]?.quantity).toBe(10000);
    expect(document.items[0]?.unit).toBe("HEAD");
    expect(document.totals.total_quantity).toBe(10000);
    expect(document.totals.total_amount).toBe(
      document.items[0]!.quantity * document.items[0]!.unit_price,
    );
  });

  it.each(["UNICORN", "UFO"] as const)(
    "links %s invoice and packing list with one shared demo invoice number",
    (dataSet) => {
      const invoice = createTestExportDocument(
        "COMMERCIAL_INVOICE",
        "Sinclair Livestock Exports Ltd.",
        dataSet,
      );
      const packingList = createTestExportDocument(
        "PACKING_LIST",
        "Sinclair Livestock Exports Ltd.",
        dataSet,
      );

      if (invoice.document_type !== "COMMERCIAL_INVOICE")
        throw new Error("unexpected invoice type");
      if (packingList.document_type !== "PACKING_LIST")
        throw new Error("unexpected packing-list type");
      expect(invoice.invoice_number).toBe("INV-DEMO-20260829-001");
      expect(packingList.related_invoice).toBe(invoice.invoice_number);
    },
  );

  it("loads a verifiable low-carbon DPP example", () => {
    const document = createTestExportDocument(
      "DIGITAL_PRODUCT_PASSPORT",
      "Sinclair Livestock Exports Ltd.",
    );

    if (document.document_type !== "DIGITAL_PRODUCT_PASSPORT")
      throw new Error("unexpected type");
    expect(document.dpp_id).toBe("DPP-UNICORN-SCO-20260829-001");
    expect(document.product.batch_id).toBe(document.dpp_id);
    expect(document.product.quantity).toBe(10000);
    expect(document.product.unit).toBe("HEAD");
    expect(document.carbon_footprint.reduction_percent).toBe(28);
    expect(document.carbon_footprint.product_carbon_footprint_kg_co2e).toBe(
      document.carbon_footprint.baseline_kg_co2e * 0.72,
    );
    expect(parseExportDocument(JSON.stringify(document))).toEqual(document);
  });

  it.each([
    "COMMERCIAL_INVOICE",
    "PACKING_LIST",
    "DIGITAL_PRODUCT_PASSPORT",
  ] as const)("loads 50 UFOs for %s", (documentType) => {
    const document = createTestExportDocument(
      documentType,
      "Sinclair Livestock Exports Ltd.",
      "UFO",
    );

    if (document.document_type === "COMMERCIAL_INVOICE") {
      expect(document.items[0]?.description).toBe(
        "Unidentified Flying Object",
      );
      expect(document.items[0]?.quantity).toBe(50);
      expect(document.items[0]?.unit).toBe("UNIT");
    } else if (document.document_type === "PACKING_LIST") {
      expect(document.cargo[0]?.description).toBe(
        "Unidentified Flying Object",
      );
      expect(document.cargo[0]?.quantity).toBe(50);
      expect(document.packages.quantity_per_package).toBe(5);
    } else {
      expect(document.product.name).toBe("Unidentified Flying Object");
      expect(document.product.quantity).toBe(50);
      expect(document.product.unit).toBe("UNIT");
    }

    expect(parseExportDocument(JSON.stringify(document))).toEqual(document);
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
    const missingShipment = structuredClone(document) as Partial<
      typeof document
    >;
    delete missingShipment.shipment;

    expect(() => parseExportDocument(JSON.stringify(missingShipment))).toThrow(
      /shipment/,
    );
    expect(() =>
      parseExportDocument(JSON.stringify({ ...document, items: [] })),
    ).toThrow(/items/);
  });
});
