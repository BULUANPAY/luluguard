import { describe, expect, it } from "vitest";

import { createTestExportDocument } from "./export-document";
import { buildSignedResponseFileName } from "./response-download";
import type { SignedExportDocumentEnvelope } from "./signing-client";

describe("signed response download", () => {
  it.each([
    "COMMERCIAL_INVOICE",
    "PACKING_LIST",
    "DIGITAL_PRODUCT_PASSPORT",
  ] as const)("builds a safe %s response file name", (documentType) => {
    const payload = createTestExportDocument(
      documentType,
      '森沐/實業:台灣* "Demo"',
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

    envelope.payload.document_id = 'DOC/2026:08*29 "Demo"';

    expect(buildSignedResponseFileName(envelope)).toBe(
      `${documentType}_DOC-2026-08-29 -Demo-.json`,
    );
  });
});
