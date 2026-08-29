import { describe, expect, it } from "vitest";

import { createRandomExportDocument } from "./export-document";
import { buildSignedResponseFileName } from "./response-download";
import type { SignedExportDocumentEnvelope } from "./signing-client";

describe("signed response download", () => {
  it.each([
    ["COMMERCIAL_INVOICE", "I-V"],
    ["PACKING_LIST", "P-L"],
  ] as const)("builds a safe %s response file name", (documentType, label) => {
    const payload = createRandomExportDocument(
      documentType,
      '森沐/實業:台灣* "Demo"',
      new Date(2026, 7, 29),
      () => 0.2,
    );
    const envelope: SignedExportDocumentEnvelope = {
      v: "VLEIJSON-1.0",
      payload,
      protected: {
        payloadDigest: "digest",
        lei: "8755001ELOZEL05BVX22",
        signerAid: "aid",
        signerCredentialSaid: "said",
        signedAt: "2026-08-29T08:00:00Z",
      },
      signature: "signature",
      signerId: "signer-123",
    };

    expect(buildSignedResponseFileName(envelope)).toBe(
      `森沐-實業-台灣- -Demo-_${label}_2026-08-29.json`,
    );
  });
});
