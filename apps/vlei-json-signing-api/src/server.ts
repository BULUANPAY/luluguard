import {
  canonicalizeJson,
  VleiJsonSigningError,
} from "@repo/vlei-json-signing";
import type {
  JsonObject,
  JsonValue,
  VleiJsonSigning,
} from "@repo/vlei-json-signing";
import { createHash } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";

interface SignRequestBody {
  signerInfo: JsonObject;
  lei: string;
  payload: JsonValue;
}

export const MAX_REQUEST_BODY_BYTES = 1024 * 1024;
export const DEFAULT_ALLOWED_ORIGIN = "http://localhost:5173";

export class RequestBodyTooLargeError extends Error {
  constructor() {
    super(`Request body exceeds ${MAX_REQUEST_BODY_BYTES} bytes`);
    this.name = "RequestBodyTooLargeError";
  }
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSignRequestBody(value: unknown): value is SignRequestBody {
  if (!isJsonObject(value)) {
    return false;
  }
  return (
    isJsonObject(value.signerInfo) &&
    typeof value.lei === "string" &&
    "payload" in value
  );
}

// Deterministic id so identical signerInfo always resolves to the same signer.
function deriveSignerId(info: JsonObject): string {
  const digest = createHash("sha256")
    .update(canonicalizeJson(info))
    .digest("hex");
  return `signer-${digest.slice(0, 32)}`;
}

export function corsHeaders(): Record<string, string> {
  return {
    "access-control-allow-origin":
      process.env.VLEI_SIGNING_ALLOWED_ORIGIN?.trim() || DEFAULT_ALLOWED_ORIGIN,
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type",
  };
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    "content-type": "application/json",
    ...corsHeaders(),
  });
  res.end(JSON.stringify(body));
}

export async function readRequestBody(req: IncomingMessage): Promise<unknown> {
  const declaredLength = Number(req.headers["content-length"]);
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > MAX_REQUEST_BODY_BYTES
  ) {
    req.resume();
    throw new RequestBodyTooLargeError();
  }

  const chunks: Buffer[] = [];
  let receivedBytes = 0;
  let tooLarge = false;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    receivedBytes += buffer.length;
    if (receivedBytes > MAX_REQUEST_BODY_BYTES) {
      tooLarge = true;
      continue;
    }
    chunks.push(buffer);
  }
  if (tooLarge) throw new RequestBodyTooLargeError();
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

async function handleSign(
  req: IncomingMessage,
  res: ServerResponse,
  signing: VleiJsonSigning,
): Promise<void> {
  let body: unknown;
  try {
    body = await readRequestBody(req);
  } catch (error) {
    const tooLarge = error instanceof RequestBodyTooLargeError;
    sendJson(res, tooLarge ? 413 : 400, {
      error: {
        code: tooLarge ? "PAYLOAD_TOO_LARGE" : "INVALID_JSON",
        message: tooLarge
          ? `Request body must not exceed ${MAX_REQUEST_BODY_BYTES} bytes`
          : "Request body must be valid JSON",
      },
    });
    return;
  }

  if (!isSignRequestBody(body)) {
    sendJson(res, 400, {
      error: {
        code: "INVALID_REQUEST",
        message: "Body must include signerInfo, lei, and payload",
      },
    });
    return;
  }

  try {
    const signerId = deriveSignerId(body.signerInfo);
    // Idempotent: registers the signer on first use, reuses it on subsequent calls with matching info.
    await signing.createSigner({ id: signerId, info: body.signerInfo });
    const envelope = await signing.signJson({
      signerId,
      lei: body.lei,
      payload: body.payload,
    });
    sendJson(res, 200, { ...envelope, signerId });
  } catch (error) {
    if (error instanceof VleiJsonSigningError) {
      sendJson(res, 400, {
        error: { code: error.code, message: error.message },
      });
      return;
    }
    sendJson(res, 500, {
      error: {
        code: "INTERNAL_ERROR",
        message: error instanceof Error ? error.message : "Unexpected error",
      },
    });
  }
}

export function createApp(signing: VleiJsonSigning) {
  return createServer((req, res) => {
    if (req.method === "OPTIONS") {
      res.writeHead(204, corsHeaders());
      res.end();
      return;
    }

    if (req.method === "GET" && req.url === "/health") {
      sendJson(res, 200, { status: "ok" });
      return;
    }

    if (req.method === "POST" && req.url === "/api/sign") {
      void handleSign(req, res, signing);
      return;
    }

    sendJson(res, 404, {
      error: { code: "NOT_FOUND", message: "Route not found" },
    });
  });
}
