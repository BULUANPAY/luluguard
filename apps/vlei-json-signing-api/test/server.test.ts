import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { test } from "node:test";
import type { IncomingMessage } from "node:http";
import {
  DEFAULT_ALLOWED_ORIGIN,
  MAX_REQUEST_BODY_BYTES,
  RequestBodyTooLargeError,
  corsHeaders,
  readRequestBody,
} from "../src/server.js";

function request(
  chunks: Array<string | Buffer>,
  contentLength?: number,
): IncomingMessage {
  const stream = Readable.from(chunks) as IncomingMessage;
  stream.headers = contentLength === undefined
    ? {}
    : { "content-length": String(contentLength) };
  return stream;
}

test("parses a JSON request split across chunks", async () => {
  const body = await readRequestBody(request(["{\"ok\":", "true}"]));
  assert.deepEqual(body, { ok: true });
});

test("rejects an oversized declared content length", async () => {
  await assert.rejects(
    readRequestBody(request([], MAX_REQUEST_BODY_BYTES + 1)),
    RequestBodyTooLargeError,
  );
});

test("rejects an oversized chunked request", async () => {
  await assert.rejects(
    readRequestBody(
      request([
        Buffer.alloc(MAX_REQUEST_BODY_BYTES),
        Buffer.from("one byte too many"),
      ]),
    ),
    RequestBodyTooLargeError,
  );
});

test("restricts browser access to the portal origin by default", () => {
  const previousOrigin = process.env.VLEI_SIGNING_ALLOWED_ORIGIN;
  delete process.env.VLEI_SIGNING_ALLOWED_ORIGIN;
  try {
    assert.equal(
      corsHeaders()["access-control-allow-origin"],
      DEFAULT_ALLOWED_ORIGIN,
    );
    process.env.VLEI_SIGNING_ALLOWED_ORIGIN = "https://portal.example";
    assert.equal(
      corsHeaders()["access-control-allow-origin"],
      "https://portal.example",
    );
  } finally {
    if (previousOrigin === undefined)
      delete process.env.VLEI_SIGNING_ALLOWED_ORIGIN;
    else process.env.VLEI_SIGNING_ALLOWED_ORIGIN = previousOrigin;
  }
});
