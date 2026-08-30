import type { Session } from "@luluguard/api-client";
import { describe, expect, it } from "vitest";

import { mockApiFetch } from "./fetcher";

describe("development API adapter", () => {
  it("returns the current session", async () => {
    const session = await mockApiFetch<Session>("/session", { method: "GET" });
    expect(session.activeOrganization.kind).toBe("exporter");
    expect(session.organizations).toHaveLength(1);
    expect(session.permissions).toEqual(["document:upload"]);
  });
});
