import {
  findTradeDocumentType,
  isTradeDocumentType,
  type TradeDocumentType,
} from "@luluguard/shared";

export type UploadedFile = {
  documentType: string;
  filename: string;
  content: unknown;
};

export type OrderParties = {
  exporter: { lei: string };
  importer: { lei: string };
};

export function isVleiEnvelopeCandidate(
  content: unknown,
): content is Record<string, unknown> {
  return Boolean(
    content &&
      typeof content === "object" &&
      "v" in content &&
      content.v === "VLEIJSON-1.0" &&
      "payload" in content &&
      "protected" in content &&
      "signature" in content &&
      "signer" in content &&
      "proof" in content,
  );
}

export function parseUploadedFiles(output: string): UploadedFile[] {
  const parsed = JSON.parse(output) as { files?: unknown };
  if (!Array.isArray(parsed.files)) {
    throw new Error("get_order_files 未回傳 files array");
  }
  return parsed.files.filter(
    (file): file is UploadedFile =>
      Boolean(
        file &&
          typeof file === "object" &&
          "documentType" in file &&
          typeof file.documentType === "string" &&
          "filename" in file &&
          typeof file.filename === "string" &&
          "content" in file,
      ),
  );
}

function documentTypeOf(file: UploadedFile): TradeDocumentType | undefined {
  if (isTradeDocumentType(file.documentType)) return file.documentType;
  if (!isVleiEnvelopeCandidate(file.content)) return undefined;
  const payload = file.content.payload;
  if (!payload || typeof payload !== "object" || !("document_type" in payload)) {
    return undefined;
  }
  const declared = payload.document_type;
  if (typeof declared !== "string") return undefined;
  const normalized = declared.toLowerCase();
  return isTradeDocumentType(normalized) ? normalized : undefined;
}

export function expectedDocumentIssuerLei(
  file: UploadedFile,
  order: OrderParties,
): {
  documentType: TradeDocumentType;
  providedBy: "exporter" | "importer";
  expectedLei: string;
} {
  const documentType = documentTypeOf(file);
  const definition = documentType && findTradeDocumentType(documentType);
  if (!definition) {
    throw new Error(`無法判斷 ${file.filename} 的文件提供方，不能驗證簽發者 LEI`);
  }
  const providedBy = definition.providedByExporter ? "exporter" : "importer";
  return {
    documentType,
    providedBy,
    expectedLei:
      providedBy === "exporter" ? order.exporter.lei : order.importer.lei,
  };
}
