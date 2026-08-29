import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { ImporterAgent } from "./importer-agent.js";
import { log } from "./logger.js";
import { config } from "./config.js";
import { createX402PaidFetch } from "./payment/client.js";

function createServer() {
  const server = new McpServer({ name: "x402-importer-agent", version: "0.4.0" });

  const createAgent = (paid: boolean) => new ImporterAgent(
    config.customsBroker.apiUrl,
    {
      maxPaymentUsd: config.payment.maxUsdc,
      allowedPayees: [config.customsBroker.address],
      requireHumanApprovalAboveUsd: config.payment.humanApprovalAboveUsdc
    },
    globalThis.fetch,
    paid ? createX402PaidFetch() : globalThis.fetch,
    config.customsBroker.feeUsdc,
    config.customsBroker.address,
    config.importer.address
  );

  server.registerTool(
    "get_import_quote",
    {
      description: "免費取得出口文件與完整進口報價。不付款、不送出報關；回傳後續申報需要的 quoteId。",
      inputSchema: {
        orderId: z.string().min(1).describe("進口訂單編號")
      }
    },
    async ({ orderId }) => {
      log("info", "mcp-server", "tool.called", { tool: "get_import_quote", orderId });
      try {
        const result = await createAgent(false).getQuote(orderId);
        log("info", "mcp-server", "tool.completed", { tool: "get_import_quote", orderId, quoteId: result.quote.quoteId });
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log("error", "mcp-server", "tool.failed", { tool: "get_import_quote", orderId, message });
        return { isError: true, content: [{ type: "text" as const, text: message }] };
      }
    }
  );

  server.registerTool(
    "submit_import_declaration",
    {
      description: "使用先前取得且尚未過期的 quoteId，透過 x402 USDC 支付報關行服務費並正式送出報關。",
      inputSchema: {
        orderId: z.string().min(1).describe("原報價的進口訂單編號"),
        quoteId: z.string().min(1).describe("get_import_quote 回傳的報價編號"),
        humanApproved: z.boolean().default(false).describe("是否已取得人工付款核准")
      }
    },
    async ({ orderId, quoteId, humanApproved }) => {
      log("info", "mcp-server", "tool.called", { tool: "submit_import_declaration", orderId, quoteId, humanApproved });
      try {
        const result = await createAgent(true).submit(orderId, quoteId, humanApproved);
        log("info", "mcp-server", "tool.completed", { tool: "submit_import_declaration", orderId, quoteId });
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log("error", "mcp-server", "tool.failed", { tool: "submit_import_declaration", orderId, quoteId, message });
        return { isError: true, content: [{ type: "text" as const, text: message }] };
      }
    }
  );
  return server;
}

const app = createMcpExpressApp({ host: config.mcp.host });
app.use(express.json());
app.get("/health", (_req, res) => res.json({ status: "ok", service: "x402-importer-mcp" }));
app.post("/mcp", async (req, res) => {
  if (config.mcp.apiKey && req.header("authorization") !== `Bearer ${config.mcp.apiKey}`) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const server = createServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => {
    void transport.close();
    void server.close();
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    log("error", "mcp-server", "request.failed", {
      message: error instanceof Error ? error.message : String(error)
    });
    if (!res.headersSent) res.status(500).json({ error: "MCP request failed" });
  }
});

app.listen(config.mcp.port, config.mcp.host, () => {
  log("info", "mcp-server", "server.started", {
    transport: "streamable-http",
    url: `http://${config.mcp.host}:${config.mcp.port}/mcp`,
    customsBrokerApiUrl: config.customsBroker.apiUrl,
    network: config.x402.network
  });
});
