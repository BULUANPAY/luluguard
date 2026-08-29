import { describe, expect, it, vi } from "vitest";

import { createRandomExportDocument } from "./export-document";
import { DEMO_SIGNING_LEI, signExportDocument } from "./signing-client";

describe("vLEI signing client", () => {
  it("wraps the export document in the signing API request", async () => {
    const document = createRandomExportDocument(
      "COMMERCIAL_INVOICE",
      "Sinclair Livestock Exports Ltd.",
      new Date(2026, 7, 29),
      () => 0.2,
    );
    let capturedInit: RequestInit | undefined;
    const fetcher = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        capturedInit = init;
        return new Response(
          JSON.stringify({
            v: "VLEIJSON-1.0",
            payload: document,
            protected: {
              payloadDigest: "digest",
              lei: DEMO_SIGNING_LEI,
              signerAid: "aid",
              signerCredentialSaid: "said",
              signedAt: "2026-08-29T00:00:00Z",
            },
            signature: "signature",
            signerId: "signer-123",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    );

    const result = await signExportDocument(
      document,
      {
        lei: DEMO_SIGNING_LEI,
        signer: document.issuer.authorized_signatory,
        role: document.issuer.role,
      },
      fetcher as typeof fetch,
    );

    expect(result.signerId).toBe("signer-123");
    const body = JSON.parse(String(capturedInit?.body));
    expect(body.lei).toBe(DEMO_SIGNING_LEI);
    expect(body.payload.document_id).toBe(document.document_id);
    expect(body.signerInfo.organization).toBe(document.issuer.organization);
    expect(body.signerInfo.authorizedSignatory).toBe(
      document.issuer.authorized_signatory,
    );
    expect(body.signerInfo.documentSource).toBe(
      "LuLuGuard exporter workspace",
    );
  });
});
