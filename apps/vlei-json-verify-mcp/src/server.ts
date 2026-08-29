import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  VleiJsonSigning,
  type JsonValue,
  type SignedJsonEnvelope,
  type VerificationResult,
} from "@repo/vlei-json-signing";
import { z } from "zod";

export interface VerifyVleiJsonInput {
  envelope: Record<string, unknown>;
  expectedRootAid: string;
  expectedLei?: string | undefined;
}

export type VerifyVleiJson = (
  envelope: SignedJsonEnvelope,
  options: { expectedRootAid: string; expectedLei?: string | undefined },
) => Promise<VerificationResult>;

export async function verifyVleiJsonTool(
  input: VerifyVleiJsonInput,
  verify: VerifyVleiJson = VleiJsonSigning.verifyJson,
) {
  try {
    const envelope = input.envelope as unknown as SignedJsonEnvelope<JsonValue>;
    const result = await verify(envelope, {
      expectedRootAid: input.expectedRootAid,
      expectedLei: input.expectedLei,
    });

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(result, null, 2),
        },
      ],
      structuredContent: result,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      isError: true,
      content: [{ type: "text" as const, text: `vLEI JSON verification failed: ${message}` }],
    };
  }
}

export function createServer(verify: VerifyVleiJson = VleiJsonSigning.verifyJson) {
  const server = new McpServer({
    name: "vlei-json-verify-mcp",
    version: "0.1.0",
  });

  server.registerTool(
    "verify_vlei_json",
    {
      title: "Verify vLEI-signed JSON",
      description:
        "Verify a self-contained vLEI-signed JSON envelope against a trusted root AID and, optionally, an expected LEI. Returns the verified payload and signer when valid, or validation errors when invalid.",
      inputSchema: {
        envelope: z
          .record(z.string(), z.unknown())
          .describe("The complete vLEI signed JSON envelope"),
        expectedRootAid: z
          .string()
          .trim()
          .min(1)
          .describe("Trusted root AID that must anchor the envelope proof"),
        expectedLei: z
          .string()
          .trim()
          .min(1)
          .optional()
          .describe("Optional LEI that the signed JSON must belong to"),
      },
    },
    (input) => verifyVleiJsonTool(input, verify),
  );

  return server;
}
