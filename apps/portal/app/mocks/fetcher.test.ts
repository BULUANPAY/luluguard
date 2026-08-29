import type { ExportObjectSubmission, Session, Shipment } from "@luluguard/api-client";
import { describe, expect, it } from "vitest";

import { mockApiFetch } from "./fetcher";

describe("development API adapter", () => {
  it("returns the current session", async () => {
    const session = await mockApiFetch<Session>("/session", { method: "GET" });
    expect(session.activeOrganization.kind).toBe("exporter");
  });

  it("filters shipments by search text", async () => {
    const shipments = await mockApiFetch<Shipment[]>("/shipments?search=Busan", {
      method: "GET",
    });
    expect(shipments).toHaveLength(1);
    expect(shipments[0]?.origin).toContain("Busan");
  });

  it("accepts an export object submission", async () => {
    const result = await mockApiFetch<ExportObjectSubmission>("/export-objects", {
      method: "POST",
      body: JSON.stringify({ reference: "EXP-20260829-123" }),
    });

    expect(result.accepted).toBe(true);
    expect(result.reference).toBe("EXP-20260829-123");
  });
});
