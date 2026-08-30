import { generateAiAnswer } from "../../../lib/ai";
import { mcpResultText, withMcpClient, withVleiVerifyMcpClient } from "../../../lib/mcp";
import {
  clearAuditTraceContext,
  newAuditId,
  writeAudit,
} from "../../../lib/audit";
import { sessionFromRequest } from "../../../lib/sandbox-auth";
import { createAgentAuthorization } from "../../../lib/vlei-authorization";
import {
  parseWorkflowRequest,
  WorkflowRequestError,
} from "../../../lib/workflow-request";
import {
  type CustomsPowerOfAttorney,
} from "@luluguard/shared";
import {
  expectedDocumentIssuerLei,
  formatVleiVerificationFailures,
  isVleiEnvelopeCandidate,
  parseUploadedFiles,
} from "../../../lib/vlei-document-verification";
import exampleOrders from "../../example-orders.json";

export const runtime = "nodejs";
const instructions = `你是進口商 AI 助理。使用者詢問已上傳的訂單文件或需要文件內容判斷時，使用 get_order_files；不得假設未出現在工具結果中的文件或欄位。新上傳文件會直接放在訂單目錄，工具回傳的 unclassified 僅表示尚未預先分類；你必須依 JSON 內容判斷文件類型。
文件預檢階段使用 review_import_documents，在進口商端檢查文件並產生獨立預估，不得聯絡報關行。
使用者按下確認預估並詢價後，才使用 get_import_quote，把該 preflightId 的文件送給報關行，並比較 independentEstimate、quote 與 complianceReview。
向使用者說明候選稅則、預估稅費、報關行服務費、有效期限、缺件、差異與付款 blocker。不得宣稱 AI 已完成法定稅則核定。
只有使用者在後續訊息明確同意付款時，才可用該 quoteId 呼叫 submit_import_declaration；不可跳過報價，也不可自行將 humanApproved 設為 true。
complianceReview.paymentAllowed 為 false 時，不得嘗試付款，必須先請使用者補正 blocker。
文件預檢一定會先驗證所有已上傳的 vLEI 文件。verify_uploaded_vlei_documents 也可單獨驗證；兩者都只驗證 v 為 "VLEIJSON-1.0" 且包含 payload、protected、signature、signer 與 proof 的文件，一般 JSON 不需驗證。文件會依提供方強制比對簽章 LEI：出口商文件必須等於訂單出口商 LEI，進口商文件必須等於訂單進口商 LEI。可信任的 root AID 由 MCP 內部使用 VLEI_ROOT_SEED 固定推導，不可要求使用者提供，也不可把 envelope proof 內自帶的 rootAid 當成信任來源。驗證失敗時應清楚說明 errors，不可使用未驗證的 payload 做後續決策。
請使用繁體中文簡潔回答，並清楚標示交易與申報結果。`;

export async function POST(request: Request) {
  const traceId =
    request.headers.get("x-audit-trace-id") ?? newAuditId("TRACE");
  const requestId = newAuditId("REQUEST");
  const agentRunId = newAuditId("AGENT-RUN");
  const session = sessionFromRequest(request);
  const startedAt = Date.now();
  try {
    if (!session) {
      writeAudit({
        traceId,
        spanId: requestId,
        component: "chat-api",
        action: "request.authenticate",
        status: "blocked",
        actor: "anonymous-user",
        agentRunId,
        data: { reason: "SESSION_REQUIRED" },
      });
      clearAuditTraceContext(traceId);
      return Response.json(
        { error: "請先登入員工帳號", traceId },
        { status: 401 },
      );
    }
    const body = parseWorkflowRequest(await request.json());
    const customsAuthorizationAcceptedAt =
      body.workflowAction === "broker_quote"
        ? new Date().toISOString()
        : undefined;
    writeAudit({
      traceId,
      spanId: requestId,
      component: "chat-api",
      action: "request.receive",
      status: "attempted",
      actor: session.employee.id,
      tenantId: session.employee.tenantId,
      userId: session.employee.id,
      sessionId: session.sessionId,
      agentId: "luluguard-importer-agent",
      agentRunId,
      data: { method: request.method, url: request.url, body },
    });
    const { messages, workflowAction } = body;
    const workflow: {
      preflightId?: string;
      readyForBroker?: boolean;
      quoteId?: string;
    } = {};
    const authorization =
      workflowAction === "chat"
        ? undefined
        : await createAgentAuthorization({
            session,
            action: workflowAction,
            traceId,
            agentRunId,
            resource: {
              orderId: body.orderId,
              preflightId: body.preflightId,
              quoteId: body.quoteId,
              estimateApproved:
                workflowAction === "broker_quote"
                  ? body.estimateApproved
                  : undefined,
              customsAuthorizationAcceptedAt:
                workflowAction === "broker_quote"
                  ? customsAuthorizationAcceptedAt
                  : undefined,
              humanApproved:
                workflowAction === "payment"
                  ? body.paymentApproved
                  : undefined,
            },
          });
    const authorizationOrder = exampleOrders.find(
      (candidate) => candidate.orderId === body.orderId,
    );
    const powerOfAttorney: CustomsPowerOfAttorney | undefined =
      workflowAction === "broker_quote" &&
      authorization &&
      body.orderId &&
      customsAuthorizationAcceptedAt &&
      authorizationOrder
        ? {
            documentType: "power_of_attorney",
            documentId: `LOA-${body.orderId}-${authorization.payload.authorizationId}`,
            version: "1.0",
            orderId: body.orderId,
            acceptedAt: customsAuthorizationAcceptedAt,
            importer: authorizationOrder.importer,
            representative: {
              employeeId: session.employee.id,
              name: session.employee.name,
              role: session.employee.role,
            },
            scope: [
              "傳送本訂單文件給報關行",
              "進行稅則與稅費初步檢核",
              "取得報關服務報價",
            ],
            vleiAuthorization: {
              authorizationId: authorization.payload.authorizationId,
              signerAid: authorization.protected.signerAid,
              signerCredentialSaid:
                authorization.protected.signerCredentialSaid,
            },
          }
        : undefined;
    if (workflowAction === "broker_quote" && !powerOfAttorney) {
      throw new WorkflowRequestError("無法建立本訂單的報關委任書");
    }
    const answer = await withMcpClient(traceId, async (mcp) => withVleiVerifyMcpClient(async (vleiMcp) => {
      writeAudit({
        traceId,
        component: "mcp-client",
        action: "tools.list",
        status: "attempted",
        actor: "ai-agent",
      });
      const [listed, vleiListed] = await Promise.all([mcp.listTools(), vleiMcp.listTools()]);
      const hasVleiVerifier = vleiListed.tools.some(tool => tool.name === "verify_vlei_json");
      const verifyUploadedVleiDocuments = async (orderId: string) => {
        if (!hasVleiVerifier) throw new Error("vLEI verifier MCP 未提供 verify_vlei_json");
        const order = exampleOrders.find(candidate => candidate.orderId === orderId);
        if (!order) throw new Error(`找不到訂單 ${orderId} 的 LEI 資訊`);
        const fileOutput = mcpResultText(await mcp.callTool({
          name: "get_order_files",
          arguments: { orderId },
        }));
        const files = parseUploadedFiles(fileOutput).filter(file =>
          isVleiEnvelopeCandidate(file.content),
        );
        const verificationResults = await Promise.all(files.map(async (file) => {
          if (!isVleiEnvelopeCandidate(file.content)) {
            throw new Error(`${file.filename} 不是有效的 vLEI envelope`);
          }
          const issuer = expectedDocumentIssuerLei(file, order);
          const result = JSON.parse(mcpResultText(await vleiMcp.callTool({
            name: "verify_vlei_json",
            arguments: { envelope: file.content, expectedLei: issuer.expectedLei },
          }))) as {
            valid?: boolean;
            errors?: Array<{ code?: string; message?: string }>;
          };
          const actualLei =
            file.content.protected &&
            typeof file.content.protected === "object" &&
            "lei" in file.content.protected &&
            typeof file.content.protected.lei === "string"
              ? file.content.protected.lei
              : undefined;
          return { filename: file.filename, ...issuer, actualLei, result };
        }));
        return { orderId, files: verificationResults };
      };
      const fileTools = ["get_order_files"];
      writeAudit({
        traceId,
        component: "mcp-client",
        action: "tools.list",
        status: "succeeded",
        actor: "mcp-server",
        data: { tools: listed.tools },
      });
      const allowedTools =
        workflowAction === "precheck"
          ? [...fileTools, "review_import_documents"]
          : workflowAction === "broker_quote"
            ? [...fileTools, "get_import_quote"]
            : workflowAction === "payment"
              ? [...fileTools, "submit_import_declaration"]
              : [];
      const availableTools = [
        ...listed.tools
        .filter((tool) => allowedTools.includes(tool.name))
        ,
        {
          name: "verify_uploaded_vlei_documents",
          description: "驗證目前訂單所有符合 VLEIJSON-1.0 signed envelope 格式的已上傳 JSON 文件。出口商提供的文件會強制比對訂單出口商 LEI，且原始 signed envelope 不會經過模型重建。",
          inputSchema: { type: "object", properties: {}, additionalProperties: false }
        }
      ];
      const tools = availableTools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema as Record<string, unknown>,
        }));
      const singleUseToolResults = new Map<string, string>();
      const singleUseTools = new Set([
        "review_import_documents",
        "get_import_quote",
        "submit_import_declaration",
      ]);
      return generateAiAnswer({
        traceId,
        agentRunId,
        identity: {
          tenantId: session.employee.tenantId,
          userId: session.employee.id,
          sessionId: session.sessionId,
        },
        messages,
        instructions: `${instructions}\n本次動作：${workflowAction}。前端訂單編號：${body.orderId ?? "未提供"}。文件來源僅限於該訂單在 uploaded-files 內的所有檔案。preflightId：${body.preflightId ?? "無"}。quoteId：${body.quoteId ?? "無"}。受控 workflow 工具在本次 Agent run 只能呼叫一次；不論成功或失敗都不得重試，必須直接說明第一次結果。${workflowAction === "payment" ? "使用者已按下付款核准按鈕，你必須呼叫 submit_import_declaration 一次。" : ""}`,
        tools,
        callTool: async (name, args) => {
          if (singleUseTools.has(name) && singleUseToolResults.has(name)) {
            const firstResult = singleUseToolResults.get(name)!;
            writeAudit({
              traceId,
              component: "mcp-client",
              action: "tool.replay-blocked",
              status: "blocked",
              actor: "ai-agent",
              data: { name, reason: "SINGLE_USE_TOOL_ALREADY_CALLED" },
            });
            return `禁止重複呼叫 ${name}；請直接向使用者說明第一次執行結果：${firstResult}`;
          }
          if (singleUseTools.has(name)) {
            singleUseToolResults.set(name, "工具第一次呼叫仍在執行中");
          }
          if (name === "verify_uploaded_vlei_documents") {
            if (!body.orderId) throw new Error("驗證已上傳文件時必須提供 orderId");
            const verification = await verifyUploadedVleiDocuments(body.orderId);
            if (verification.files.length === 0) throw new Error("找不到符合 VLEIJSON-1.0 signed envelope 格式的已上傳文件");
            return JSON.stringify(verification);
          }
          if (name === "review_import_documents") {
            args.orderId = body.orderId;
            if (!body.orderId) throw new Error("文件預檢時必須提供 orderId");
            const verification = await verifyUploadedVleiDocuments(body.orderId);
            const invalid = verification.files.filter(file => file.result.valid !== true);
            if (invalid.length > 0) {
              throw new Error(formatVleiVerificationFailures(invalid));
            }
          }
          if (name === "get_order_files") {
            args.orderId = body.orderId;
          }
          if (name === "get_import_quote") {
            args.preflightId = body.preflightId;
            args.estimateApproved = body.estimateApproved;
            args.powerOfAttorney = powerOfAttorney;
          }
          if (name === "submit_import_declaration") {
            args.orderId = body.orderId;
            args.quoteId = body.quoteId;
            args.humanApproved = body.paymentApproved;
          }
          args.authorization = authorization;
          const targetMcp = name === "verify_vlei_json" ? vleiMcp : mcp;
          const toolCallId = newAuditId("MCP-CALL");
          writeAudit({
            traceId,
            spanId: toolCallId,
            component: "mcp-client",
            action: "tool.call",
            status: "attempted",
            actor: "ai-agent",
            data: { name, arguments: args },
          });
          let output: string;
          try {
            const result = await targetMcp.callTool({ name, arguments: args });
            output = mcpResultText(result);
            const isError = Boolean(
              result &&
              typeof result === "object" &&
              "isError" in result &&
              result.isError,
            );
            writeAudit({
              traceId,
              spanId: toolCallId,
              component: "mcp-client",
              action: "tool.call",
              status: isError ? "failed" : "succeeded",
              actor: "mcp-server",
              data: { name, arguments: args, output },
            });
            if (singleUseTools.has(name)) singleUseToolResults.set(name, output);
          } catch (error) {
            if (singleUseTools.has(name)) {
              singleUseToolResults.set(
                name,
                error instanceof Error ? error.message : String(error),
              );
            }
            writeAudit({
              traceId,
              spanId: toolCallId,
              component: "mcp-client",
              action: "tool.call",
              status: "failed",
              actor: "mcp-server",
              data: { name, arguments: args, error },
            });
            throw error;
          }
          try {
            const result = JSON.parse(output) as {
              preflightId?: string;
              readyForBroker?: boolean;
              quote?: { quoteId?: string };
            };
            workflow.preflightId = result.preflightId;
            workflow.readyForBroker = result.readyForBroker;
            workflow.quoteId = result.quote?.quoteId;
          } catch {
            return output;
          }
          return output;
        },
      });
    }));
    writeAudit({
      traceId,
      spanId: requestId,
      component: "chat-api",
      action: "request.complete",
      status: "succeeded",
      actor: "system",
      tenantId: session.employee.tenantId,
      userId: session.employee.id,
      sessionId: session.sessionId,
      agentId: "luluguard-importer-agent",
      agentRunId,
      data: { durationMs: Date.now() - startedAt, answer, workflow },
    });
    clearAuditTraceContext(traceId);
    return Response.json({
      answer,
      workflow,
      traceId,
      agentRunId,
      vleiAuthorization: authorization
        ? {
            authorizationId: authorization.payload.authorizationId,
            signerAid: authorization.protected.signerAid,
            signerCredentialSaid: authorization.protected.signerCredentialSaid,
            powerOfAttorneyDocumentId: powerOfAttorney?.documentId,
          }
        : undefined,
    });
  } catch (error) {
    const clientError = error instanceof WorkflowRequestError;
    console.error(
      "chat.failed",
      error instanceof Error ? error.message : error,
    );
    writeAudit({
      traceId,
      spanId: requestId,
      component: "chat-api",
      action: "request.complete",
      status: "failed",
      actor: "system",
      tenantId: session?.employee.tenantId,
      userId: session?.employee.id,
      sessionId: session?.sessionId,
      agentId: "luluguard-importer-agent",
      agentRunId,
      data: { durationMs: Date.now() - startedAt, error },
    });
    clearAuditTraceContext(traceId);
    return Response.json(
      { error: error instanceof Error ? error.message : "處理失敗", traceId },
      { status: clientError ? 400 : 500 },
    );
  }
}
