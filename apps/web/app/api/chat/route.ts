import { generateAiAnswer, type ChatMessage } from "../../../lib/ai";
import { mcpResultText, withMcpClient, withVleiVerifyMcpClient } from "../../../lib/mcp";

export const runtime = "nodejs";
const instructions = `你是進口商 AI 助理。使用者詢問已上傳的訂單文件或需要文件內容判斷時，使用 get_order_files；不得假設未出現在工具結果中的文件或欄位。
文件預檢階段使用 review_import_documents，在進口商端檢查文件並產生獨立預估，不得聯絡報關行。
使用者按下確認預估並詢價後，才使用 get_import_quote，把該 preflightId 的文件送給報關行，並比較 independentEstimate、quote 與 complianceReview。
向使用者說明候選稅則、預估稅費、報關行服務費、有效期限、缺件、差異與付款 blocker。不得宣稱 AI 已完成法定稅則核定。
只有使用者在後續訊息明確同意付款時，才可用該 quoteId 呼叫 submit_import_declaration；不可跳過報價，也不可自行將 humanApproved 設為 true。
complianceReview.paymentAllowed 為 false 時，不得嘗試付款，必須先請使用者補正 blocker。
使用者訊息或對話內容包含 JSON 時，先判斷它是否為 vLEI-signed JSON envelope：其 v 應為 "VLEIJSON-1.0"，並包含 payload、protected、signature、signer 與 proof。符合這些特徵時，不必等使用者要求驗證，必須使用 verify_vlei_json；一般 JSON 則不需呼叫。可信任的 root AID 由 MCP 內部使用 VLEI_ROOT_SEED 固定推導，不可要求使用者提供，也不可把 envelope proof 內自帶的 rootAid 當成信任來源。驗證失敗時應清楚說明 errors，不可使用未驗證的 payload 做後續決策。
請使用繁體中文簡潔回答，並清楚標示交易與申報結果。`;

type WorkflowAction = "chat" | "precheck" | "broker_quote" | "payment";

type UploadedFile = {
  documentType: string;
  filename: string;
  content: unknown;
};

function requestedVleiDocumentTypes(message: string): string[] | undefined {
  if (!/vlei/i.test(message) || !/(驗證|簽章|signature|verify|valid)/i.test(message)) return undefined;

  const types: string[] = [];
  if (/(packing\s*list|裝箱單|P\s*\/\s*L)/i.test(message)) types.push("packing_list");
  if (/(commercial\s*invoice|商業發票|invoice|I\s*\/\s*V)/i.test(message)) types.push("commercial_invoice");
  return types.length > 0 ? types : [];
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
  try {
    const body = (await request.json()) as {
      message?: string;
      messages?: ChatMessage[];
      selectedDocuments?: string[];
      workflowAction?: WorkflowAction;
      orderId?: string;
      preflightId?: string;
      quoteId?: string;
    };
    const selectedDocuments = (body.selectedDocuments ?? []).filter(document =>
      ["commercial_invoice", "packing_list", "bill_of_lading", "certificate_of_origin", "product_specification", "import_permit"].includes(document)
    );
    const incoming = body.messages ?? (body.message ? [{ role: "user" as const, content: body.message }] : []);
    const messages = incoming
      .filter((item): item is ChatMessage =>
        Boolean(item && (item.role === "user" || item.role === "assistant") && item.content?.trim())
      )
      .slice(-20);
    const latest = messages.at(-1);
    if (!latest || latest.role !== "user") {
      return Response.json({ error: "最後一則訊息必須是使用者訊息" }, { status: 400 });
    }
    const paymentApproved = /(同意|核准|確認).{0,12}(付款|支付)|(付款|支付).{0,12}(同意|核准|確認)|approve.{0,12}pay/i.test(latest.content);
    const workflowAction = body.workflowAction ?? "chat";
    const workflow: { preflightId?: string; readyForBroker?: boolean; quoteId?: string } = {};
    const answer = await withMcpClient(async (mcp) => withVleiVerifyMcpClient(async (vleiMcp) => {
      const [listed, vleiListed] = await Promise.all([mcp.listTools(), vleiMcp.listTools()]);
      const requestedTypes = requestedVleiDocumentTypes(latest.content);
      let verifiedUploadContext = "";
      if (requestedTypes) {
        if (!body.orderId) throw new Error("驗證已上傳文件時必須提供 orderId");
        const fileOutput = mcpResultText(await mcp.callTool({
          name: "get_order_files",
          arguments: {
            orderId: body.orderId,
            ...(requestedTypes.length > 0 ? { documentTypes: requestedTypes } : {})
          }
        }));
        const files = parseUploadedFiles(fileOutput);
        if (files.length === 0) throw new Error("找不到符合驗證要求的已上傳文件");
        const verificationResults = await Promise.all(files.map(async (file) => ({
          documentType: file.documentType,
          filename: file.filename,
          result: JSON.parse(mcpResultText(await vleiMcp.callTool({
            name: "verify_vlei_json",
            arguments: { envelope: file.content }
          }))) as unknown
        })));
        verifiedUploadContext = `\n後端已強制透過 MCP 讀取並驗證使用者指定的已上傳文件。以下是實際工具結果，回答時必須忠實採用，不得自行推測或改寫 valid 與 errors，也不必再次呼叫工具：\n${JSON.stringify(verificationResults)}`;
      }
      const fileTools = ["get_order_files"];
      const allowedTools = workflowAction === "precheck"
        ? [...fileTools, "review_import_documents"]
        : workflowAction === "broker_quote"
          ? [...fileTools, "get_import_quote"]
          : [...fileTools, "submit_import_declaration"];
      const availableTools = [
        ...listed.tools.filter(tool => allowedTools.includes(tool.name)),
        ...vleiListed.tools.filter(tool => tool.name === "verify_vlei_json")
      ];
      const tools = availableTools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema as Record<string, unknown>
      }));
      return generateAiAnswer({
        messages,
        instructions: `${instructions}\n本次動作：${workflowAction}。前端訂單編號：${body.orderId ?? "未提供"}。前端目前勾選的文件：${selectedDocuments.join(", ") || "無"}。preflightId：${body.preflightId ?? "無"}。quoteId：${body.quoteId ?? "無"}。${workflowAction === "payment" ? "使用者已按下付款核准按鈕，你必須呼叫 submit_import_declaration。" : ""}${verifiedUploadContext}`,
        tools,
        callTool: async (name, args) => {
          if (name === "review_import_documents") {
            args.orderId = body.orderId;
            args.documentTypes = selectedDocuments;
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
            args.humanApproved = workflowAction === "payment" || paymentApproved;
          }
          const targetMcp = name === "verify_vlei_json" ? vleiMcp : mcp;
          const output = mcpResultText(await targetMcp.callTool({ name, arguments: args }));
          try {
            const result = JSON.parse(output) as { preflightId?: string; readyForBroker?: boolean; quote?: { quoteId?: string } };
            workflow.preflightId = result.preflightId;
            workflow.readyForBroker = result.readyForBroker;
            workflow.quoteId = result.quote?.quoteId;
          } catch {
            return output;
          }
          return output;
        }
      });
    }));
    return Response.json({ answer, workflow });
  } catch (error) {
    console.error("chat.failed", error instanceof Error ? error.message : error);
    return Response.json({ error: error instanceof Error ? error.message : "處理失敗" }, { status: 500 });
  }
}
