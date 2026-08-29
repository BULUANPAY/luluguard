import { describe, expect, it } from "vitest";

import { hasPermission, requirePermission } from "./permissions";

describe("permission helpers", () => {
  const permissions = ["shipment:read", "document:upload"] as const;

  it("recognizes an allowed capability", () => {
    expect(hasPermission(permissions, "shipment:read")).toBe(true);
  });

  it("rejects a missing capability", () => {
    expect(hasPermission(permissions, "shipment:create")).toBe(false);
    expect(() => requirePermission(permissions, "shipment:create")).toThrow();
  });
});
