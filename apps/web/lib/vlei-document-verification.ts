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

export type DocumentVerificationResult = ReturnType<
  typeof expectedDocumentIssuerLei
> & {
  filename: string;
  actualLei?: string;
  result: {
    valid?: boolean;
    errors?: Array<{ code?: string; message?: string }>;
  };
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

export function formatVleiVerificationFailures(
  files: DocumentVerificationResult[],
): string {
  const descriptions = files.map((file) => {
    const definition = findTradeDocumentType(file.documentType);
    const label = definition?.label ?? file.documentType;
    const provider = file.providedBy === "exporter" ? "出口商" : "進口商";
    const errors = file.result.errors ?? [];
    if (errors.some((error) => error.code === "LEI_MISMATCH")) {
      const actual = file.actualLei
        ? `，但實際簽署 LEI 為 ${file.actualLei}`
        : "，但文件使用了其他 LEI 簽署";
      return `${label}（${file.filename}）由${provider}提供，簽發者 LEI 應為 ${file.expectedLei}${actual}。請由正確的${provider}身分重新簽署後上傳`;
    }
    const reasons = errors
      .map((error) => error.message)
      .filter((message): message is string => Boolean(message));
    return `${label}（${file.filename}）的 vLEI 驗證未通過${
      reasons.length > 0 ? `：${reasons.join("；")}` : ""
    }。請確認文件完整且由${provider}重新簽署後上傳`;
  });
  return `vLEI 文件驗證失敗。${descriptions.join("；")}。`;
}
