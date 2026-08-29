import assert from "node:assert/strict";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { createServer, verifyVleiJsonTool } from "../src/server.js";

const input = {
  envelope: { v: "VLEIJSON-1.0" },
  expectedRootAid: "ETrustedRootAid",
};

test("returns a structured successful verification result", async () => {
  const result = await verifyVleiJsonTool(input, async (_envelope, options) => {
    assert.equal(options.expectedRootAid, "ETrustedRootAid");
    return {
      valid: true,
      payload: { orderId: "ORD-001" },
      signer: {
        id: "alice",
        aid: "ESignerAid",
        credentialSaid: "ECredentialSaid",
        createdAt: "2026-08-29T00:00:00.000Z",
        info: { role: "Approver" },
      },
      rootAid: "ETrustedRootAid",
      lei: "8755001ELOZEL05BVX22",
      signedAt: "2026-08-29T00:00:00.000Z",
    };
  });

  assert.equal(result.isError, undefined);
  assert.equal(result.structuredContent?.valid, true);
});

test("returns invalid signatures as verification results, not tool errors", async () => {
  const result = await verifyVleiJsonTool(input, async () => ({
    valid: false,
    errors: [{ code: "SIGNATURE_INVALID", message: "Signature is invalid" }],
  }));

  assert.equal(result.isError, undefined);
  assert.deepEqual(result.structuredContent, {
    valid: false,
    errors: [{ code: "SIGNATURE_INVALID", message: "Signature is invalid" }],
  });
});

test("returns bridge failures as MCP tool errors", async () => {
  const result = await verifyVleiJsonTool(input, async () => {
    throw new Error("python3 was not found");
  });

  assert.equal(result.isError, true);
  assert.match(result.content[0]?.text ?? "", /python3 was not found/);
});

test("exposes verify_vlei_json through MCP", async () => {
  const server = createServer(async () => ({
    valid: false,
    errors: [{ code: "ROOT_AID_MISMATCH", message: "Unexpected root AID" }],
  }));
  const client = new Client({ name: "test-client", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const tools = await client.listTools();
    assert.deepEqual(tools.tools.map((tool) => tool.name), ["verify_vlei_json"]);

    const result = await client.callTool({
      name: "verify_vlei_json",
      arguments: input,
    });
    assert.equal(result.isError, undefined);
    assert.deepEqual(result.structuredContent, {
      valid: false,
      errors: [{ code: "ROOT_AID_MISMATCH", message: "Unexpected root AID" }],
    });
  } finally {
    await client.close();
    await server.close();
  }
});
