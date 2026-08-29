import type { JsonValue } from "./types.js";

function assertUnicodeScalarString(value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        throw new TypeError(
          "JSON strings must not contain unpaired UTF-16 surrogates",
        );
      }
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      throw new TypeError(
        "JSON strings must not contain unpaired UTF-16 surrogates",
      );
    }
  }
}

export function canonicalizeJson(input: JsonValue): string {
  const ancestors = new Set<object>();

  const visit = (value: unknown): string => {
    if (value === null) return "null";
    if (typeof value === "boolean") return value ? "true" : "false";
    if (typeof value === "string") {
      assertUnicodeScalarString(value);
      return JSON.stringify(value);
    }
    if (typeof value === "number") {
      if (!Number.isFinite(value)) {
        throw new TypeError("JSON numbers must be finite");
      }
      return JSON.stringify(value);
    }
    if (typeof value !== "object") {
      throw new TypeError(`Unsupported JSON value: ${typeof value}`);
    }

    if (ancestors.has(value)) {
      throw new TypeError("JSON values must not contain cycles");
    }
    ancestors.add(value);
    try {
      if (Array.isArray(value)) {
        return `[${value.map((entry) => visit(entry)).join(",")}]`;
      }

      const prototype = Object.getPrototypeOf(value);
      if (prototype !== Object.prototype && prototype !== null) {
        throw new TypeError("JSON objects must be plain objects");
      }
      const object = value as Record<string, unknown>;
      const entries = Object.keys(object)
        .sort()
        .map((key) => {
          assertUnicodeScalarString(key);
          return `${JSON.stringify(key)}:${visit(object[key])}`;
        });
      return `{${entries.join(",")}}`;
    } finally {
      ancestors.delete(value);
    }
  };

  return visit(input);
}
