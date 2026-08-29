import { generateAiAnswer, type ChatMessage } from "../../../lib/ai";
import { mcpResultText, withMcpClient } from "../../../lib/mcp";

export const runtime = "nodejs";
const instructions = `你是進口商 AI 助理。先用 get_import_quote 免費取得報價並向使用者說明 quoteId、稅費、報關行服務費與有效期限。
只有使用者在後續訊息明確同意付款時，才可用該 quoteId 呼叫 submit_import_declaration；不可跳過報價，也不可自行將 humanApproved 設為 true。
請使用繁體中文簡潔回答，並清楚標示交易與申報結果。`;

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { message?: string; messages?: ChatMessage[] };
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
    const answer = await withMcpClient(async (mcp) => {
      const listed = await mcp.listTools();
      const tools = listed.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema as Record<string, unknown>
      }));
      return generateAiAnswer({
        messages,
        instructions,
        tools,
        callTool: async (name, args) => {
          if (name === "submit_import_declaration") {
            args.humanApproved = args.humanApproved === true && paymentApproved;
          }
          return mcpResultText(await mcp.callTool({ name, arguments: args }));
        }
      });
    });
    return Response.json({ answer });
  } catch (error) {
    console.error("chat.failed", error instanceof Error ? error.message : error);
    return Response.json({ error: error instanceof Error ? error.message : "處理失敗" }, { status: 500 });
  }
}
