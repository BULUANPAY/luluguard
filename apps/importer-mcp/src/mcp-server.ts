import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { ImporterAgent, PaymentCoordinator } from "./importer-agent.js";
import { log } from "./logger.js";
import { config } from "./config.js";
import { createUnpaidFetch, createX402PaidFetch } from "./payment/client.js";
import {
  PaymentReservationStore,
  type PaymentRecord,
} from "./payment/policy.js";
import { PolicyStore, type PolicyUpdate } from "./policy/policy-store.js";
import type { SettleResponse } from "@x402/core/types";
import {
  clearAuditTraceContext,
  newAuditId,
  writeAudit,
} from "./audit.js";
import {
  verifyAgentAuthorization,
  type VerifiedAgentAuthorization,
} from "./vlei-authorization.js";
import { getOrderFiles } from "./order-files.js";
import { buildExportDocuments } from "./uploaded-documents.js";
import type { CustomsPowerOfAttorney } from "@luluguard/shared";
import { resolve } from "node:path";

const uploadedFilesRoot = path.resolve(process.cwd(), "../..", "uploaded-files");

export interface ImporterServerStores {
  preflightStore: ConstructorParameters<typeof ImporterAgent>[7];
  quoteStore: ConstructorParameters<typeof ImporterAgent>[8];
  paymentHistory: PaymentRecord[];
  settlementReconciliationStore: ConstructorParameters<typeof ImporterAgent>[11];
  paymentReservationStore: PaymentReservationStore;
  paymentCoordinator: PaymentCoordinator;
  policyStore: PolicyStore;
}

export function createImporterServerStores(): ImporterServerStores {
  return {
    preflightStore: new Map(),
    quoteStore: new Map(),
    paymentHistory: [],
    settlementReconciliationStore: new Map(),
    paymentReservationStore: new PaymentReservationStore(),
    paymentCoordinator: new PaymentCoordinator(),
    policyStore: new PolicyStore({
      maxPaymentUsd: config.payment.maxUsdc,
      allowedPayees: [config.customsBroker.address],
      requireHumanApprovalAboveUsd: config.payment.humanApprovalAboveUsdc,
      maxDailySpendUsd: config.payment.maxDailyUsdc,
      maxPaymentsPerHour: config.payment.maxPaymentsPerHour,
    }),
  };
}

const defaultStores = createImporterServerStores();

export interface ImporterAppOptions {
  stores?: ImporterServerStores;
  policyAdminApiKey?: string;
}

function createServer(
  stores: ImporterServerStores,
  traceId = newAuditId("TRACE"),
) {
  const server = new McpServer({
    name: "x402-importer-agent",
    version: "0.4.0",
  });

  const createAgent = async (
    paid: boolean,
    identity: VerifiedAgentAuthorization,
  ) => {
    if (paid) stores.policyStore.assertPaymentEnabled();
    const paidFetch = paid ? await createX402PaidFetch() : createUnpaidFetch();
    return new ImporterAgent(
      config.customsBroker.apiUrl,
      stores.policyStore.paymentPolicy(),
      globalThis.fetch,
      paidFetch,
      config.customsBroker.feeUsdc,
      config.customsBroker.address,
      config.importer.address,
      stores.preflightStore,
      stores.quoteStore,
      stores.paymentHistory,
      config.x402.network,
      stores.settlementReconciliationStore,
      stores.paymentReservationStore,
      stores.paymentCoordinator,
      traceId,
      identity,
    );
  };

  server.registerTool(
    "get_order_files",
    {
      description:
        "讀取指定訂單在 uploaded-files 內的 JSON 文件。新上傳文件不預先分類，請依 JSON 內容判斷文件類型；此工具唯讀，不會聯絡報關行或付款。",
      inputSchema: {
        orderId: z.string().min(1).describe("要讀取文件的訂單編號"),
        documentTypes: z
          .array(z.string().min(1))
          .optional()
          .describe("選填；只回傳指定文件類型，省略時回傳訂單的全部文件"),
      },
    },
    async ({ orderId, documentTypes }) => {
      log("info", "mcp-server", "tool.called", {
        tool: "get_order_files",
        orderId,
        documentTypes,
      });
      try {
        stores.policyStore.assertAgentEnabled();
        const files = await getOrderFiles(
          uploadedFilesRoot,
          orderId,
          documentTypes,
        );
        const result = { orderId, fileCount: files.length, files };
        log("info", "mcp-server", "tool.completed", {
          tool: "get_order_files",
          orderId,
          fileCount: files.length,
        });
        return {
          content: [
            { type: "text" as const, text: JSON.stringify(result, null, 2) },
          ],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log("error", "mcp-server", "tool.failed", {
          tool: "get_order_files",
          orderId,
          message,
        });
        return {
          isError: true,
          content: [{ type: "text" as const, text: message }],
        };
      }
    },
  );

  server.registerTool(
    "review_import_documents",
    {
      description:
        "讀取指定訂單在 uploaded-files 內的所有 JSON 文件，在進口商端檢查並產生獨立費用預估。此工具不會聯絡報關行、不會付款。",
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
        stores.policyStore.assertAgentEnabled();
        const files = await getOrderFiles(uploadedFilesRoot, orderId);
        const documents = buildExportDocuments(files);
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
        powerOfAttorney: z
          .record(z.unknown())
          .describe("使用者同意後產生、隨訂單送交報關行的報關委任書"),
        authorization: z
          .record(z.unknown())
          .optional()
          .describe("Web 後端注入的 sandbox vLEI Agent Authorization"),
      },
    },
    async ({ preflightId, estimateApproved, powerOfAttorney, authorization }) => {
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
          arguments: {
            preflightId,
            estimateApproved,
            powerOfAttorneyDocumentId: powerOfAttorney.documentId,
          },
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
        stores.policyStore.assertAgentEnabled();
        const result = await (
          await createAgent(false, identity)
        ).getQuote(
          preflightId,
          estimateApproved,
          powerOfAttorney as unknown as CustomsPowerOfAttorney,
        );
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
            status: stores.policyStore.get().status,
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

const reconciliationResolveRequestSchema = z
  .object({
    orderId: z.string().trim().min(1),
    quoteId: z.string().trim().min(1),
    attemptId: z.string().trim().min(1),
    settlement: z.record(z.unknown()),
  })
  .strict();

function adminAuthorized(authorization: string | undefined, apiKey: string) {
  return Boolean(apiKey) && authorization === `Bearer ${apiKey}`;
}

export function createApp(options: ImporterAppOptions = {}) {
  const stores = options.stores ?? defaultStores;
  const policyAdminApiKey = options.policyAdminApiKey ?? config.policyAdmin.apiKey;
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

  app.get("/admin/policy", (req, res) => {
    if (!adminAuthorized(req.header("authorization"), policyAdminApiKey)) {
      log("warn", "policy-admin", "access.denied", {
        method: "GET",
        sourceIp: req.ip,
      });
      res.status(policyAdminApiKey ? 401 : 503).json({
        error: policyAdminApiKey
          ? "Unauthorized"
          : "POLICY_ADMIN_API_KEY is required",
      });
      return;
    }
    res.json({
      policy: stores.policyStore.get(),
      usage: {
        paymentRecords: stores.paymentHistory.length,
        settledUsdc: Number(
          stores.paymentHistory
            .reduce((sum, record) => sum + record.amountUsdc, 0)
            .toFixed(6),
        ),
      },
    });
  });

  app.put("/admin/policy", (req, res) => {
    if (!adminAuthorized(req.header("authorization"), policyAdminApiKey)) {
      log("warn", "policy-admin", "access.denied", {
        method: "PUT",
        sourceIp: req.ip,
      });
      res.status(policyAdminApiKey ? 401 : 503).json({
        error: policyAdminApiKey
          ? "Unauthorized"
          : "POLICY_ADMIN_API_KEY is required",
      });
      return;
    }
    try {
      const changed = stores.policyStore.update(req.body as PolicyUpdate);
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

  app.get("/admin/reconciliation/:quoteId", (req, res) => {
    if (!adminAuthorized(req.header("authorization"), policyAdminApiKey)) {
      log("warn", "policy-admin", "access.denied", {
        method: "GET",
        route: "reconciliation",
        sourceIp: req.ip,
      });
      res.status(policyAdminApiKey ? 401 : 503).json({
        error: policyAdminApiKey
          ? "Unauthorized"
          : "POLICY_ADMIN_API_KEY is required",
      });
      return;
    }
    try {
      const record = createServerAgent(stores).getSettlementReconciliation(
        req.params.quoteId,
      );
      if (record === undefined) {
        res
          .status(404)
          .json({ error: "Settlement reconciliation record not found" });
        return;
      }
      res.json(record);
    } catch (error) {
      log("error", "policy-admin", "reconciliation.lookup_failed", {
        quoteId: req.params.quoteId,
        message: error instanceof Error ? error.message : String(error),
      });
      res
        .status(500)
        .json({ error: "Unable to read settlement reconciliation" });
    }
  });

  app.post("/admin/reconciliation/resolve", (req, res) => {
    if (!adminAuthorized(req.header("authorization"), policyAdminApiKey)) {
      log("warn", "policy-admin", "access.denied", {
        method: "POST",
        route: "reconciliation",
        sourceIp: req.ip,
      });
      res.status(policyAdminApiKey ? 401 : 503).json({
        error: policyAdminApiKey
          ? "Unauthorized"
          : "POLICY_ADMIN_API_KEY is required",
      });
      return;
    }
    const parsed = reconciliationResolveRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "Invalid reconciliation request",
        issues: parsed.error.issues,
      });
      return;
    }
    const { orderId, quoteId, attemptId, settlement } = parsed.data;
    try {
      const agent = createServerAgent(stores);
      const record = agent.getSettlementReconciliation(quoteId);
      if (record === undefined) {
        res
          .status(404)
          .json({ error: "Settlement reconciliation record not found" });
        return;
      }
      if (record.attemptId !== attemptId) {
        res.status(409).json({
          error: "Settlement reconciliation attempt is not the current owner",
        });
        return;
      }
      const reconciled = agent.markSettlementReconciled(
        orderId,
        quoteId,
        attemptId,
        settlement as unknown as SettleResponse,
      );
      if (!reconciled) {
        res.status(409).json({
          error: "Settlement reconciliation attempt is not the current owner",
        });
        return;
      }
      log("warn", "policy-admin", "reconciliation.resolved", {
        orderId,
        quoteId,
        attemptId,
        priorState: record.state,
        priorReason: record.reason,
      });
      res.json({ resolved: true, reconciliation: record });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status = message.includes("matching reviewed broker quote")
        ? 409
        : 400;
      res.status(status).json({ error: message });
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
    const server = createServer(stores, res.locals.auditTraceId);
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

  return app;
}

function createServerAgent(stores: ImporterServerStores) {
  return new ImporterAgent(
    config.customsBroker.apiUrl,
    stores.policyStore.paymentPolicy(),
    createUnpaidFetch(),
    createUnpaidFetch(),
    config.customsBroker.feeUsdc,
    config.customsBroker.address,
    config.importer.address,
    stores.preflightStore,
    stores.quoteStore,
    stores.paymentHistory,
    config.x402.network,
    stores.settlementReconciliationStore,
    stores.paymentReservationStore,
    stores.paymentCoordinator,
  );
}

export const app = createApp();

export function startServer() {
  return app.listen(config.mcp.port, config.mcp.host, () => {
    log("info", "mcp-server", "server.started", {
      transport: "streamable-http",
      url: `http://${config.mcp.host}:${config.mcp.port}/mcp`,
      customsBrokerApiUrl: config.customsBroker.apiUrl,
      network: config.x402.network,
    });
  });
}

if (
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  startServer();
}
