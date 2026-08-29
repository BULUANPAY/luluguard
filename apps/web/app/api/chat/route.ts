import { generateAiAnswer, type ChatMessage } from "../../../lib/ai";
import { mcpResultText, withMcpClient, withVleiVerifyMcpClient } from "../../../lib/mcp";
import {
  clearAuditTraceContext,
  newAuditId,
  writeAudit,
} from "../../../lib/audit";
import { sessionFromRequest } from "../../../lib/sandbox-auth";
import { createAgentAuthorization } from "../../../lib/vlei-authorization";

export const runtime = "nodejs";
const instructions = `你是進口商 AI 助理。使用者詢問已上傳的訂單文件或需要文件內容判斷時，使用 get_order_files；不得假設未出現在工具結果中的文件或欄位。
文件預檢階段使用 review_import_documents，在進口商端檢查文件並產生獨立預估，不得聯絡報關行。
使用者按下確認預估並詢價後，才使用 get_import_quote，把該 preflightId 的文件送給報關行，並比較 independentEstimate、quote 與 complianceReview。
向使用者說明候選稅則、預估稅費、報關行服務費、有效期限、缺件、差異與付款 blocker。不得宣稱 AI 已完成法定稅則核定。
只有使用者在後續訊息明確同意付款時，才可用該 quoteId 呼叫 submit_import_declaration；不可跳過報價，也不可自行將 humanApproved 設為 true。
complianceReview.paymentAllowed 為 false 時，不得嘗試付款，必須先請使用者補正 blocker。
使用者要求驗證已上傳的 vLEI 文件時，由你判斷是否呼叫 verify_uploaded_vlei_documents。此工具會從目前訂單讀取原始文件，並只驗證 v 為 "VLEIJSON-1.0" 且包含 payload、protected、signature、signer 與 proof 的文件；一般 JSON 不需驗證。可信任的 root AID 由 MCP 內部使用 VLEI_ROOT_SEED 固定推導，不可要求使用者提供，也不可把 envelope proof 內自帶的 rootAid 當成信任來源。驗證失敗時應清楚說明 errors，不可使用未驗證的 payload 做後續決策。
請使用繁體中文簡潔回答，並清楚標示交易與申報結果。`;

type WorkflowAction = "chat" | "precheck" | "broker_quote" | "payment";

type UploadedFile = {
  documentType: string;
  filename: string;
  content: unknown;
};

function isVleiEnvelopeCandidate(content: unknown): content is Record<string, unknown> {
  return Boolean(
    content && typeof content === "object"
      && "v" in content && content.v === "VLEIJSON-1.0"
      && "payload" in content
      && "protected" in content
      && "signature" in content
      && "signer" in content
      && "proof" in content
  );
}

function parseUploadedFiles(output: string): UploadedFile[] {
  const parsed = JSON.parse(output) as { files?: unknown };
  if (!Array.isArray(parsed.files)) throw new Error("get_order_files 未回傳 files array");
  return parsed.files.filter((file): file is UploadedFile => Boolean(
    file && typeof file === "object"
      && "documentType" in file && typeof file.documentType === "string"
      && "filename" in file && typeof file.filename === "string"
      && "content" in file
  ));
}

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
        const body = (await request.json()) as {
      message?: string;
      messages?: ChatMessage[];
      workflowAction?: WorkflowAction;
      orderId?: string;
      preflightId?: string;
      quoteId?: string;
        };
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
        const incoming =
      body.messages ??
      (body.message ? [{ role: "user" as const, content: body.message }] : []);
        const messages = incoming
      .filter((item): item is ChatMessage =>
        Boolean(
          item &&
          (item.role === "user" || item.role === "assistant") &&
          item.content?.trim(),
        ),
      )
      .slice(-20);
    const latest = messages.at(-1);
    if (!latest || latest.role !== "user") {
      writeAudit({
        traceId,
        spanId: requestId,
        component: "chat-api",
        action: "request.validate",
        status: "blocked",
        actor: "system",
        data: { reason: "LAST_MESSAGE_NOT_USER" },
      });
      clearAuditTraceContext(traceId);
      return Response.json(
        { error: "最後一則訊息必須是使用者訊息" },
        { status: 400 },
      );
    }
    const paymentApproved =
      /(同意|核准|確認).{0,12}(付款|支付)|(付款|支付).{0,12}(同意|核准|確認)|approve.{0,12}pay/i.test(
        latest.content,
      );
    const workflowAction = body.workflowAction ?? "chat";
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
                workflowAction === "broker_quote" ? true : undefined,
              humanApproved: workflowAction === "payment" ? true : undefined,
            },
          });
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
          description: "驗證目前訂單所有符合 VLEIJSON-1.0 signed envelope 格式的已上傳 JSON 文件。文件類型不限，且原始 signed envelope 不會經過模型重建。",
          inputSchema: { type: "object", properties: {}, additionalProperties: false }
        }
      ];
      const tools = availableTools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema as Record<string, unknown>,
        }));
      return generateAiAnswer({
        traceId,
        agentRunId,
        identity: {
          tenantId: session.employee.tenantId,
          userId: session.employee.id,
          sessionId: session.sessionId,
        },
        messages,
        instructions: `${instructions}\n本次動作：${workflowAction}。前端訂單編號：${body.orderId ?? "未提供"}。preflightId：${body.preflightId ?? "無"}。quoteId：${body.quoteId ?? "無"}。${workflowAction === "payment" ? "使用者已按下付款核准按鈕，你必須呼叫 submit_import_declaration。" : ""}`,
        tools,
        callTool: async (name, args) => {
          if (name === "verify_uploaded_vlei_documents") {
            if (!body.orderId) throw new Error("驗證已上傳文件時必須提供 orderId");
            if (!hasVleiVerifier) throw new Error("vLEI verifier MCP 未提供 verify_vlei_json");
            const fileOutput = mcpResultText(await mcp.callTool({
              name: "get_order_files",
              arguments: { orderId: body.orderId }
            }));
            const files = parseUploadedFiles(fileOutput)
              .filter(file => isVleiEnvelopeCandidate(file.content));
            if (files.length === 0) throw new Error("找不到符合 VLEIJSON-1.0 signed envelope 格式的已上傳文件");
            const verificationResults = await Promise.all(files.map(async (file) => ({
              documentType: file.documentType,
              filename: file.filename,
              result: JSON.parse(mcpResultText(await vleiMcp.callTool({
                name: "verify_vlei_json",
                arguments: { envelope: file.content }
              }))) as unknown
            })));
            return JSON.stringify({ orderId: body.orderId, files: verificationResults });
          }
          if (name === "review_import_documents") {
            args.orderId = body.orderId;
          }
          if (name === "get_order_files") {
            args.orderId = body.orderId;
          }
          if (name === "get_import_quote") {
            args.preflightId = body.preflightId;
            args.estimateApproved = workflowAction === "broker_quote";
          }
          if (name === "submit_import_declaration") {
            args.orderId = body.orderId;
            args.quoteId = body.quoteId;
            args.humanApproved =
              workflowAction === "payment" || paymentApproved;
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
          } catch (error) {
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
          }
        : undefined,
    });
  } catch (error) {
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
      { status: 500 },
    );
  }
}
