import { createHash } from "node:crypto";
import { ExportDocumentsSchema, type ExportDocuments } from "./domain.js";

type JsonRecord = Record<string, unknown>;

function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Sort JSON object keys by code unit, without locale-dependent collation. */
function compareJsonKeys(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

/**
 * Produces a stable JSON representation so equivalent documents hash to the
 * same value even when their object properties were inserted in another order.
 */
export function canonicalizeDocuments(documents: ExportDocuments): string {
  const parsedDocuments = ExportDocumentsSchema.parse(documents);
  const normalizedDocuments: ExportDocuments = {
    ...parsedDocuments,
    providedDocuments: [...parsedDocuments.providedDocuments].sort(compareJsonKeys)
  };
  const canonicalize = (value: unknown): string => {
    if (Array.isArray(value)) {
      return `[${value.map((item) => canonicalize(item)).join(",")}]`;
    }

    if (isJsonRecord(value)) {
      const entries = Object.entries(value)
        .filter(([, entryValue]) => entryValue !== undefined)
        .sort(([leftKey], [rightKey]) => compareJsonKeys(leftKey, rightKey));
      return `{${entries.map(([key, entryValue]) => (
        `${JSON.stringify(key)}:${canonicalize(entryValue)}`
      )).join(",")}}`;
    }

    const serialized = JSON.stringify(value);
    if (serialized === undefined) {
      throw new TypeError("Documents contain a value that cannot be hashed");
    }
    return serialized;
  };

  return canonicalize(normalizedDocuments);
}

export function hashDocuments(documents: ExportDocuments): string {
  return createHash("sha256")
    .update(canonicalizeDocuments(documents), "utf8")
    .digest("hex");
}

export const hashExportDocuments = hashDocuments;
