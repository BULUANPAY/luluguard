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
import { clearAuditTraceContext, newAuditId, writeAudit } from "./audit.js";
import {
  verifyAgentAuthorization,
  type VerifiedAgentAuthorization,
} from "./vlei-authorization.js";
import { getOrderFiles } from "./order-files.js";
import { buildExportDocumentsFromUploads } from "./order-documents.js";

const uploadedFilesRoot = path.resolve(process.cwd(), "../..", "uploaded-files");
const preflightStore = new Map();
const quoteStore = new Map();
const paymentHistory: PaymentRecord[] = [];
const policyStore = new PolicyStore({
  maxPaymentUsd: config.payment.maxUsdc,
  allowedPayees: [config.customsBroker.address],
  requireHumanApprovalAboveUsd: config.payment.humanApprovalAboveUsdc,
  maxDailySpendUsd: config.payment.maxDailyUsdc,
  maxPaymentsPerHour: config.payment.maxPaymentsPerHour,
});

function createServer(traceId = newAuditId("TRACE")) {
  const server = new McpServer({
    name: "x402-importer-agent",
    version: "0.4.0",
  });

  const createAgent = async (
    paid: boolean,
    identity: VerifiedAgentAuthorization,
  ) => {
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
      paymentHistory,
      traceId,
      identity,
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
        const files = await getOrderFiles(uploadedFilesRoot, orderId, documentTypes);
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
      description:
        "讀取訂單目前已上傳的文件並產生獨立費用預估。此工具不會聯絡報關行、不會付款。",
      inputSchema: {
        orderId: z
          .string()
          .min(1)
          .describe("進口商內部訂單編號，不會傳給報關行"),
        authorization: z
          .record(z.unknown())
          .optional()
          .describe("Web 後端注入的 sandbox vLEI Agent Authorization"),
      },
    },
    async ({ orderId, authorization }) => {
      const toolCallId = newAuditId("MCP-CALL");
      writeAudit({
        traceId,
        spanId: toolCallId,
        component: "mcp-server",
        action: "tool.execute",
        status: "attempted",
        actor: "ai-agent",
        data: {
          tool: "review_import_documents",
          arguments: { orderId },
        },
      });
      log("info", "mcp-server", "tool.called", {
        tool: "review_import_documents",
        orderId,
      });
      try {
        const identity = await verifyAgentAuthorization({
          authorization,
          traceId,
          action: "precheck",
          resource: { orderId },
        });
        policyStore.assertAgentEnabled();
        const documents = await buildExportDocumentsFromUploads(uploadedFilesRoot, orderId);
        const result = (await createAgent(false, identity)).precheck(
          orderId,
          documents,
        );
        log("info", "mcp-server", "tool.completed", {
          tool: "review_import_documents",
          orderId,
          preflightId: result.preflightId,
          readyForBroker: result.readyForBroker,
          transmittedToBroker: result.transmittedToBroker,
        });
        writeAudit({
          traceId,
          spanId: toolCallId,
          component: "mcp-server",
          action: "tool.execute",
          status: "succeeded",
          actor: "importer-agent",
          data: {
            tool: "review_import_documents",
            arguments: { orderId },
            result,
          },
        });
        return {
          content: [
            { type: "text" as const, text: JSON.stringify(result, null, 2) },
          ],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log("error", "mcp-server", "tool.failed", {
          tool: "review_import_documents",
          orderId,
          message,
        });
        writeAudit({
          traceId,
          spanId: toolCallId,
          component: "mcp-server",
          action: "tool.execute",
          status: "failed",
          actor: "importer-agent",
          data: {
            tool: "review_import_documents",
            arguments: { orderId },
            error,
          },
        });
        return {
          isError: true,
          content: [{ type: "text" as const, text: message }],
        };
      }
    },
  );

  server.registerTool(
    "get_import_quote",
    {
      description:
        "使用已通過文件檢查的 preflightId，並在使用者確認進口商獨立預估後，才把文件傳給報關行取得免費報價。此工具不付款。",
      inputSchema: {
        preflightId: z
          .string()
          .min(1)
          .describe("review_import_documents 回傳的預檢編號"),
        estimateApproved: z
          .boolean()
          .describe("使用者是否已按下確認預估並詢價按鈕"),
        authorization: z
          .record(z.unknown())
          .optional()
          .describe("Web 後端注入的 sandbox vLEI Agent Authorization"),
      },
    },
    async ({ preflightId, estimateApproved, authorization }) => {
      const toolCallId = newAuditId("MCP-CALL");
      writeAudit({
        traceId,
        spanId: toolCallId,
        component: "mcp-server",
        action: "tool.execute",
        status: "attempted",
        actor: "ai-agent",
        data: {
          tool: "get_import_quote",
          arguments: { preflightId, estimateApproved },
        },
      });
      log("info", "mcp-server", "tool.called", {
        tool: "get_import_quote",
        preflightId,
        estimateApproved,
      });
      try {
        const identity = await verifyAgentAuthorization({
          authorization,
          traceId,
          action: "broker_quote",
          resource: { preflightId, estimateApproved },
        });
        policyStore.assertAgentEnabled();
        const result = await (
          await createAgent(false, identity)
        ).getQuote(preflightId, estimateApproved);
        log("info", "mcp-server", "tool.completed", {
          tool: "get_import_quote",
          preflightId,
          orderId: result.orderId,
          transmittedToBroker: result.transmittedToBroker,
          quoteId: result.quote.quoteId,
        });
        writeAudit({
          traceId,
          spanId: toolCallId,
          component: "mcp-server",
          action: "tool.execute",
          status: "succeeded",
          actor: "importer-agent",
          data: {
            tool: "get_import_quote",
            arguments: { preflightId, estimateApproved },
            result,
          },
        });
        return {
          content: [
            { type: "text" as const, text: JSON.stringify(result, null, 2) },
          ],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log("error", "mcp-server", "tool.failed", {
          tool: "get_import_quote",
          preflightId,
          message,
        });
        writeAudit({
          traceId,
          spanId: toolCallId,
          component: "mcp-server",
          action: "tool.execute",
          status: "failed",
          actor: "importer-agent",
          data: {
            tool: "get_import_quote",
            arguments: { preflightId, estimateApproved },
            error,
          },
        });
        return {
          isError: true,
          content: [{ type: "text" as const, text: message }],
        };
      }
    },
  );

  server.registerTool(
    "submit_import_declaration",
    {
      description:
        "使用先前取得且尚未過期的 quoteId，透過 x402 USDC 支付報關行服務費並正式送出報關。",
      inputSchema: {
        orderId: z.string().min(1).describe("原報價的進口訂單編號"),
        quoteId: z.string().min(1).describe("get_import_quote 回傳的報價編號"),
        humanApproved: z
          .boolean()
          .default(false)
          .describe("是否已取得人工付款核准"),
        authorization: z
          .record(z.unknown())
          .optional()
          .describe("Web 後端注入的 sandbox vLEI Agent Authorization"),
      },
    },
    async ({ orderId, quoteId, humanApproved, authorization }) => {
      const toolCallId = newAuditId("MCP-CALL");
      writeAudit({
        traceId,
        spanId: toolCallId,
        component: "mcp-server",
        action: "tool.execute",
        status: "attempted",
        actor: "ai-agent",
        data: {
          tool: "submit_import_declaration",
          arguments: { orderId, quoteId, humanApproved },
        },
      });
      log("info", "mcp-server", "tool.called", {
        tool: "submit_import_declaration",
        orderId,
        quoteId,
        humanApproved,
      });
      try {
        const identity = await verifyAgentAuthorization({
          authorization,
          traceId,
          action: "payment",
          resource: { orderId, quoteId, humanApproved },
        });
        const result = await (
          await createAgent(true, identity)
        ).submit(orderId, quoteId, humanApproved);
        log("info", "mcp-server", "tool.completed", {
          tool: "submit_import_declaration",
          orderId,
          quoteId,
        });
        writeAudit({
          traceId,
          spanId: toolCallId,
          component: "mcp-server",
          action: "tool.execute",
          status: "succeeded",
          actor: "importer-agent",
          data: {
            tool: "submit_import_declaration",
            arguments: { orderId, quoteId, humanApproved },
            result,
          },
        });
        return {
          content: [
            { type: "text" as const, text: JSON.stringify(result, null, 2) },
          ],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes("policy status")) {
          log("warn", "payment-audit", "payment.runtime_blocked", {
            orderId,
            quoteId,
            status: policyStore.get().status,
          });
        }
        log("error", "mcp-server", "tool.failed", {
          tool: "submit_import_declaration",
          orderId,
          quoteId,
          message,
        });
        writeAudit({
          traceId,
          spanId: toolCallId,
          component: "mcp-server",
          action: "tool.execute",
          status: "failed",
          actor: "importer-agent",
          data: {
            tool: "submit_import_declaration",
            arguments: { orderId, quoteId, humanApproved },
            error,
          },
        });
        return {
          isError: true,
          content: [{ type: "text" as const, text: message }],
        };
      }
    },
  );
  return server;
}

const app = createMcpExpressApp({ host: config.mcp.host });
app.use(express.json());
app.use((req, res, next) => {
  const traceId = req.header("x-audit-trace-id") ?? newAuditId("TRACE");
  const requestId = newAuditId("HTTP");
  const startedAt = Date.now();
  res.setHeader("x-audit-trace-id", traceId);
  res.locals.auditTraceId = traceId;
  writeAudit({
    traceId,
    spanId: requestId,
    component: "http-server",
    action: "request.receive",
    status: "attempted",
    actor: "remote-client",
    data: {
      method: req.method,
      path: req.path,
      headers: req.headers,
      body: req.body,
    },
  });
  res.on("finish", () => {
    writeAudit({
      traceId,
      spanId: requestId,
      component: "http-server",
      action: "request.complete",
      status: res.statusCode >= 400 ? "failed" : "succeeded",
      actor: "mcp-server",
      data: {
        method: req.method,
        path: req.path,
        statusCode: res.statusCode,
        durationMs: Date.now() - startedAt,
      },
    });
    clearAuditTraceContext(traceId);
  });
  next();
});
app.get("/health", (_req, res) =>
  res.json({ status: "ok", service: "x402-importer-mcp" }),
);

function adminAuthorized(authorization: string | undefined) {
  return (
    Boolean(config.policyAdmin.apiKey) &&
    authorization === `Bearer ${config.policyAdmin.apiKey}`
  );
}

app.get("/admin/policy", (req, res) => {
  if (!adminAuthorized(req.header("authorization"))) {
    log("warn", "policy-admin", "access.denied", {
      method: "GET",
      sourceIp: req.ip,
    });
    res.status(config.policyAdmin.apiKey ? 401 : 503).json({
      error: config.policyAdmin.apiKey
        ? "Unauthorized"
        : "POLICY_ADMIN_API_KEY is required",
    });
    return;
  }
  res.json({
    policy: policyStore.get(),
    usage: {
      paymentRecords: paymentHistory.length,
      settledUsdc: Number(
        paymentHistory
          .reduce((sum, record) => sum + record.amountUsdc, 0)
          .toFixed(6),
      ),
    },
  });
});

app.put("/admin/policy", (req, res) => {
  if (!adminAuthorized(req.header("authorization"))) {
    log("warn", "policy-admin", "access.denied", {
      method: "PUT",
      sourceIp: req.ip,
    });
    res.status(config.policyAdmin.apiKey ? 401 : 503).json({
      error: config.policyAdmin.apiKey
        ? "Unauthorized"
        : "POLICY_ADMIN_API_KEY is required",
    });
    return;
  }
  try {
    const changed = policyStore.update(req.body as PolicyUpdate);
    log("warn", "policy-admin", "policy.updated", {
      actor: req.header("x-policy-actor") ?? "unknown",
      previous: changed.previous,
      current: changed.current,
    });
    writeAudit({
      traceId: res.locals.auditTraceId,
      component: "policy-admin",
      action: "policy.update",
      status: "succeeded",
      actor: req.header("x-policy-actor") ?? "unknown",
      data: { previous: changed.previous, current: changed.current },
    });
    res.json({ policy: changed.current });
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : "Invalid policy",
    });
  }
});

app.post("/mcp", async (req, res) => {
  if (
    config.mcp.apiKey &&
    req.header("authorization") !== `Bearer ${config.mcp.apiKey}`
  ) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const server = createServer(res.locals.auditTraceId);
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });
  res.on("close", () => {
    void transport.close();
    void server.close();
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    log("error", "mcp-server", "request.failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    if (!res.headersSent) res.status(500).json({ error: "MCP request failed" });
  }
});

app.listen(config.mcp.port, config.mcp.host, () => {
  log("info", "mcp-server", "server.started", {
    transport: "streamable-http",
    url: `http://${config.mcp.host}:${config.mcp.port}/mcp`,
    customsBrokerApiUrl: config.customsBroker.apiUrl,
    network: config.x402.network,
  });
});
