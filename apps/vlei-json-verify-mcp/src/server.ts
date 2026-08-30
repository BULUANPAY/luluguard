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
  expectedLei?: string | undefined;
}

export type VerifyVleiJson = (
  envelope: SignedJsonEnvelope,
  options: { expectedRootAid: string; expectedLei?: string | undefined },
) => Promise<VerificationResult>;

export type DeriveRootAid = (seed: string) => Promise<string>;

export async function verifyVleiJsonTool(
  input: VerifyVleiJsonInput,
  verify: VerifyVleiJson = VleiJsonSigning.verifyJson,
  deriveRootAid: DeriveRootAid = VleiJsonSigning.deriveRootAid,
  rootSeed: string | undefined = process.env.VLEI_ROOT_SEED,
) {
  try {
    if (!rootSeed?.trim()) {
      throw new Error("VLEI_ROOT_SEED is required to derive the trusted root AID");
    }
    const expectedRootAid = await deriveRootAid(rootSeed);
    const envelope = input.envelope as unknown as SignedJsonEnvelope<JsonValue>;
    const result = await verify(envelope, {
      expectedRootAid,
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

export function createServer(
  verify: VerifyVleiJson = VleiJsonSigning.verifyJson,
  deriveRootAid: DeriveRootAid = VleiJsonSigning.deriveRootAid,
  rootSeed: string | undefined = process.env.VLEI_ROOT_SEED,
) {
  const server = new McpServer({
    name: "vlei-json-verify-mcp",
    version: "0.1.0",
  });

  server.registerTool(
    "verify_vlei_json",
    {
      title: "Verify vLEI-signed JSON",
      description:
        "Verify a self-contained vLEI-signed JSON envelope against the trusted root AID derived from the server's VLEI_ROOT_SEED and, optionally, an expected LEI. Returns the verified payload and signer when valid, or validation errors when invalid.",
      inputSchema: {
        envelope: z
          .record(z.string(), z.unknown())
          .describe("The complete vLEI signed JSON envelope"),
        expectedLei: z
          .string()
          .trim()
          .min(1)
          .optional()
          .describe("Optional LEI that the signed JSON must belong to"),
      },
    },
    (input) => verifyVleiJsonTool(input, verify, deriveRootAid, rootSeed),
  );

  return server;
}
