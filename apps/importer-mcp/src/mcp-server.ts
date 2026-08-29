import express from "express";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { ImporterAgent } from "./importer-agent.js";
import { log } from "./logger.js";
import { config } from "./config.js";
import { createX402PaidFetch } from "./payment/client.js";
import type { PaymentRecord } from "./payment/policy.js";
import { PolicyStore, type PolicyUpdate } from "./policy/policy-store.js";
import { getOrderFiles } from "./order-files.js";

const preflightStore = new Map();
const quoteStore = new Map();
const paymentHistory: PaymentRecord[] = [];
const policyStore = new PolicyStore({
  maxPaymentUsd: config.payment.maxUsdc,
  allowedPayees: [config.customsBroker.address],
  requireHumanApprovalAboveUsd: config.payment.humanApprovalAboveUsdc,
  maxDailySpendUsd: config.payment.maxDailyUsdc,
  maxPaymentsPerHour: config.payment.maxPaymentsPerHour
});

function createServer() {
  const server = new McpServer({ name: "x402-importer-agent", version: "0.4.0" });

  const createAgent = async (paid: boolean) => {
    if (paid) policyStore.assertPaymentEnabled();
    const paidFetch = paid ? await createX402PaidFetch() : globalThis.fetch;
    return new ImporterAgent(
      config.customsBroker.apiUrl,
      policyStore.paymentPolicy(),
      globalThis.fetch,
      paidFetch,
      config.customsBroker.feeUsdc,
      config.customsBroker.address,
      config.importer.address,
      preflightStore,
      quoteStore,
      paymentHistory
    );
  };

  server.registerTool(
    "get_order_files",
    {
      description: "讀取指定訂單在 uploaded-files 內的 JSON 文件。可取得預設與自訂文件類型；此工具唯讀，不會聯絡報關行或付款。",
      inputSchema: {
        orderId: z.string().min(1).describe("要讀取文件的訂單編號"),
        documentTypes: z.array(z.string().min(1)).optional().describe("選填；只回傳指定文件類型，省略時回傳訂單的全部文件")
      }
    },
    async ({ orderId, documentTypes }) => {
      log("info", "mcp-server", "tool.called", { tool: "get_order_files", orderId, documentTypes });
      try {
        policyStore.assertAgentEnabled();
        const storageRoot = path.resolve(process.cwd(), "../..", "uploaded-files");
        const files = await getOrderFiles(storageRoot, orderId, documentTypes);
        const result = { orderId, fileCount: files.length, files };
        log("info", "mcp-server", "tool.completed", { tool: "get_order_files", orderId, fileCount: files.length });
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log("error", "mcp-server", "tool.failed", { tool: "get_order_files", orderId, message });
        return { isError: true, content: [{ type: "text" as const, text: message }] };
      }
    }
  );

  server.registerTool(
    "review_import_documents",
    {
      description: "在進口商端檢查使用者勾選的 mock 文件並產生獨立費用預估。此工具不會聯絡報關行、不會付款。",
      inputSchema: {
        orderId: z.string().min(1).describe("進口商內部訂單編號，不會傳給報關行"),
        documentTypes: z.array(z.enum([
          "commercial_invoice",
          "packing_list",
          "bill_of_lading",
          "certificate_of_origin",
          "product_specification",
          "import_permit"
        ])).min(1).describe("使用者在前端勾選的 mock 文件")
      }
    },
    async ({ orderId, documentTypes }) => {
      log("info", "mcp-server", "tool.called", { tool: "review_import_documents", orderId, documentTypes });
      try {
        policyStore.assertAgentEnabled();
        const result = (await createAgent(false)).precheck(orderId, documentTypes);
        log("info", "mcp-server", "tool.completed", {
          tool: "review_import_documents",
          orderId,
          preflightId: result.preflightId,
          readyForBroker: result.readyForBroker,
          transmittedToBroker: result.transmittedToBroker
        });
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log("error", "mcp-server", "tool.failed", { tool: "review_import_documents", orderId, message });
        return { isError: true, content: [{ type: "text" as const, text: message }] };
      }
    }
  );

  server.registerTool(
    "get_import_quote",
    {
      description: "使用已通過文件檢查的 preflightId，並在使用者確認進口商獨立預估後，才把文件傳給報關行取得免費報價。此工具不付款。",
      inputSchema: {
        preflightId: z.string().min(1).describe("review_import_documents 回傳的預檢編號"),
        estimateApproved: z.boolean().describe("使用者是否已按下確認預估並詢價按鈕")
      }
    },
    async ({ preflightId, estimateApproved }) => {
      log("info", "mcp-server", "tool.called", { tool: "get_import_quote", preflightId, estimateApproved });
      try {
        policyStore.assertAgentEnabled();
        const result = await (await createAgent(false)).getQuote(preflightId, estimateApproved);
        log("info", "mcp-server", "tool.completed", {
          tool: "get_import_quote",
          preflightId,
          orderId: result.orderId,
          transmittedToBroker: result.transmittedToBroker,
          quoteId: result.quote.quoteId
        });
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log("error", "mcp-server", "tool.failed", { tool: "get_import_quote", preflightId, message });
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
        const result = await (await createAgent(true)).submit(orderId, quoteId, humanApproved);
        log("info", "mcp-server", "tool.completed", { tool: "submit_import_declaration", orderId, quoteId });
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes("policy status")) {
          log("warn", "payment-audit", "payment.runtime_blocked", {
            orderId, quoteId, status: policyStore.get().status
          });
        }
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

function adminAuthorized(authorization: string | undefined) {
  return Boolean(config.policyAdmin.apiKey) && authorization === `Bearer ${config.policyAdmin.apiKey}`;
}

app.get("/admin/policy", (req, res) => {
  if (!adminAuthorized(req.header("authorization"))) {
    log("warn", "policy-admin", "access.denied", { method: "GET", sourceIp: req.ip });
    res.status(config.policyAdmin.apiKey ? 401 : 503).json({
      error: config.policyAdmin.apiKey ? "Unauthorized" : "POLICY_ADMIN_API_KEY is required"
    });
    return;
  }
  res.json({ policy: policyStore.get(), usage: {
    paymentRecords: paymentHistory.length,
    settledUsdc: Number(paymentHistory.reduce((sum, record) => sum + record.amountUsdc, 0).toFixed(6))
  }});
});

app.put("/admin/policy", (req, res) => {
  if (!adminAuthorized(req.header("authorization"))) {
    log("warn", "policy-admin", "access.denied", { method: "PUT", sourceIp: req.ip });
    res.status(config.policyAdmin.apiKey ? 401 : 503).json({
      error: config.policyAdmin.apiKey ? "Unauthorized" : "POLICY_ADMIN_API_KEY is required"
    });
    return;
  }
  try {
    const changed = policyStore.update(req.body as PolicyUpdate);
    log("warn", "policy-admin", "policy.updated", {
      actor: req.header("x-policy-actor") ?? "unknown",
      previous: changed.previous,
      current: changed.current
    });
    res.json({ policy: changed.current });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Invalid policy" });
  }
});

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
