import { describe, expect, it } from "vitest";

import {
  buildExportObjectPayload,
  createRandomExportObject,
  exportObjectFormSchema,
} from "./export-object";

describe("export object helpers", () => {
  it("creates a valid randomized draft", () => {
    const draft = createRandomExportObject(
      "森沐實業",
      new Date("2026-08-29T00:00:00Z"),
      () => 0.25,
    );

    expect(exportObjectFormSchema.safeParse(draft).success).toBe(true);
    expect(draft.reference).toMatch(/^EXP-\d{8}-\d{3}$/);
    expect(draft.exporterCompany).toBe("森沐實業");
  });

  it("maps form values to the API-shaped JSON payload", () => {
    const draft = createRandomExportObject("森沐實業", new Date("2026-08-29"));
    const payload = buildExportObjectPayload(
      draft,
      new Date("2026-08-29T10:00:00Z"),
    );

    expect(payload.objectType).toBe("export-shipment-draft");
    expect(payload.exporter.companyName).toBe("森沐實業");
    expect(payload.goods[0]?.hsCode).toBe(draft.goods[0]?.hsCode);
    expect(payload.shipment.packageCount).toBe(draft.goods[0]?.packageCount);
    expect(payload.shipment.grossWeightKg).toBe(draft.goods[0]?.grossWeightKg);
  });
});
