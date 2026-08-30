import assert from "node:assert/strict";
import test from "node:test";
import {
  expectedDocumentIssuerLei,
  formatVleiVerificationFailures,
  type UploadedFile,
} from "../lib/vlei-document-verification";

const order = {
  exporter: { lei: "8755001ELOZEL05BVX22" },
  importer: { lei: "254900A1B2C3D4E5F667" },
};

function file(documentType: string): UploadedFile {
  return {
    documentType,
    filename: `${documentType}.json`,
    content: {},
  };
}

test("expects the exporter LEI for exporter-provided documents", () => {
  assert.deepEqual(expectedDocumentIssuerLei(file("commercial_invoice"), order), {
    documentType: "commercial_invoice",
    providedBy: "exporter",
    expectedLei: order.exporter.lei,
  });
});

test("expects the importer LEI for importer-provided documents", () => {
  assert.deepEqual(expectedDocumentIssuerLei(file("import_permit"), order), {
    documentType: "import_permit",
    providedBy: "importer",
    expectedLei: order.importer.lei,
  });
});

test("uses the signed payload type for an unclassified upload", () => {
  const uploaded: UploadedFile = {
    documentType: "unclassified",
    filename: "permit.json",
    content: {
      v: "VLEIJSON-1.0",
      payload: { document_type: "IMPORT_PERMIT" },
      protected: {},
      signature: "signature",
      signer: {},
      proof: {},
    },
  };
  assert.equal(expectedDocumentIssuerLei(uploaded, order).expectedLei, order.importer.lei);
});

test("rejects a signed document whose provider cannot be determined", () => {
  assert.throws(
    () => expectedDocumentIssuerLei(file("unclassified"), order),
    /無法判斷.*文件提供方/,
  );
});

test("describes an issuer LEI mismatch in natural language", () => {
  const message = formatVleiVerificationFailures([
    {
      filename: "packing-list.json",
      documentType: "packing_list",
      providedBy: "exporter",
      expectedLei: order.exporter.lei,
      actualLei: order.importer.lei,
      result: {
        valid: false,
        errors: [{ code: "LEI_MISMATCH", message: "LEI mismatch" }],
      },
    },
  ]);
  assert.equal(
    message,
    `vLEI 文件驗證失敗。裝箱單（packing-list.json）由出口商提供，簽發者 LEI 應為 ${order.exporter.lei}，但實際簽署 LEI 為 ${order.importer.lei}。請由正確的出口商身分重新簽署後上傳。`,
  );
});
