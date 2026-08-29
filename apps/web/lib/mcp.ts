import { Client } from "@modelcontextprotocol/sdk/client/index.js";
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
