import { describe, expect, it } from "vitest";

import {
  createRandomExportDocument,
  parseExportDocument,
} from "./export-document";

describe("export document helpers", () => {
  it("creates a commercial invoice with internally consistent totals", () => {
    const document = createRandomExportDocument(
      "COMMERCIAL_INVOICE",
      "森沐實業",
      new Date(2026, 7, 29, 10, 30),
      () => 0.25,
    );

    expect(document.document_type).toBe("COMMERCIAL_INVOICE");
    if (document.document_type !== "COMMERCIAL_INVOICE")
      throw new Error("unexpected type");
    expect(document.exporter.name).toBe("森沐實業");
    expect(document.issuer.organization).toBe("森沐實業");
    expect(document.items[0]?.amount).toBe(
      document.items[0]!.quantity * document.items[0]!.unit_price,
    );
    expect(document.totals.total_amount).toBe(document.items[0]?.amount);
  });

  it("creates a packing list whose quantities and weights are consistent", () => {
    const document = createRandomExportDocument(
      "PACKING_LIST",
      "森沐實業",
      new Date(2026, 7, 29, 10, 30),
      () => 0.5,
    );

    expect(document.document_type).toBe("PACKING_LIST");
    if (document.document_type !== "PACKING_LIST")
      throw new Error("unexpected type");
    expect(document.related_invoice).toMatch(/^INV-UNI-/);
    expect(document.packages.total_quantity).toBe(document.cargo[0]?.quantity);
    expect(document.weight.gross_weight_kg).toBeGreaterThan(
      document.weight.net_weight_kg,
    );
  });

  it("rejects JSON whose type does not match the selected generator", () => {
    const document = createRandomExportDocument("PACKING_LIST", "森沐實業");

    expect(() =>
      parseExportDocument(JSON.stringify(document), "COMMERCIAL_INVOICE"),
    ).toThrow("JSON 內容不一致");
  });
});
