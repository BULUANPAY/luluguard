import { existsSync } from "node:fs";
import path from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  getDefaultEnvironment,
  StdioClientTransport
} from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

export async function withMcpClient<T>(operation: (client: Client) => Promise<T>): Promise<T> {
  const url = process.env.MCP_SERVER_URL ?? "http://127.0.0.1:4020/mcp";
  const apiKey = process.env.MCP_API_KEY;
  const client = new Client({ name: "x402-ai-web", version: "0.1.0" });
  const transport = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: apiKey ? { headers: { Authorization: `Bearer ${apiKey}` } } : undefined
  });
  await client.connect(transport);
  try {
    return await operation(client);
  } finally {
    await client.close();
  }
}

function findWorkspaceRoot(startDirectory: string): string {
  let directory = path.resolve(startDirectory);
  while (!existsSync(path.join(directory, "pnpm-workspace.yaml"))) {
    const parent = path.dirname(directory);
    if (parent === directory) {
      throw new Error("找不到 pnpm workspace root，請設定 VLEI_VERIFY_MCP_CWD");
    }
    directory = parent;
  }
  return directory;
}

function vleiVerifyMcpArgs(): string[] {
  const configured = process.env.VLEI_VERIFY_MCP_ARGS;
  if (!configured) return ["--filter", "@luluguard/vlei-json-verify-mcp", "start"];
  const parsed: unknown = JSON.parse(configured);
  if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === "string")) {
    throw new Error("VLEI_VERIFY_MCP_ARGS 必須是 JSON string array");
  }
  return parsed;
}

export async function withVleiVerifyMcpClient<T>(operation: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ name: "luluguard-web-vlei-verifier", version: "0.1.0" });
  const rootSeed = process.env.VLEI_ROOT_SEED;
  const transport = new StdioClientTransport({
    command: process.env.VLEI_VERIFY_MCP_COMMAND ?? "pnpm",
    args: vleiVerifyMcpArgs(),
    cwd: process.env.VLEI_VERIFY_MCP_CWD ?? findWorkspaceRoot(process.cwd()),
    env: {
      ...getDefaultEnvironment(),
      ...(rootSeed ? { VLEI_ROOT_SEED: rootSeed } : {})
    },
    stderr: "inherit"
  });
  await client.connect(transport);
  try {
    return await operation(client);
  } finally {
    await client.close();
  }
}

export function mcpResultText(result: unknown): string {
  if (!result || typeof result !== "object" || !("content" in result) || !Array.isArray(result.content)) {
    return JSON.stringify(result);
  }
  return result.content
    .filter((item): item is { type: "text"; text: string } =>
      Boolean(item && typeof item === "object" && item.type === "text" && typeof item.text === "string")
    )
    .map((item) => item.text)
    .join("\n");
}
