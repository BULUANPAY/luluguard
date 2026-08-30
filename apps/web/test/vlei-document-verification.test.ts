import assert from "node:assert/strict";
import test from "node:test";
import {
  expectedDocumentIssuerLei,
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
