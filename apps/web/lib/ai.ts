import { GoogleGenAI, type FunctionDeclaration } from "@google/genai";
import OpenAI from "openai";

export interface AiTool {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface GenerateAnswerOptions {
  messages: ChatMessage[];
  instructions: string;
  tools: AiTool[];
  callTool: (name: string, args: Record<string, unknown>) => Promise<string>;
  onProgress?: (message: string) => void;
}

const maxToolRounds = 30;

export async function generateAiAnswer(options: GenerateAnswerOptions): Promise<string> {
  const provider = (process.env.AI_PROVIDER ?? "openai").toLowerCase();
  if (provider === "openai") return generateWithOpenAi(options);
  if (provider === "gemini") return generateWithGemini(options);
  throw new Error(`不支援的 AI_PROVIDER：${provider}`);
}

async function generateWithOpenAi(options: GenerateAnswerOptions): Promise<string> {
  if (!process.env.OPENAI_API_KEY) throw new Error("伺服器尚未設定 OPENAI_API_KEY");
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const model = process.env.OPENAI_MODEL ?? "gpt-5-mini";
  const tools: OpenAI.Responses.Tool[] = options.tools.map((tool) => ({
    type: "function",
    name: tool.name,
    description: tool.description ?? "MCP tool",
    parameters: tool.inputSchema,
    strict: false
  }));
  let response = await openai.responses.create({
    model,
    instructions: options.instructions,
    input: options.messages.map((message) => ({ role: message.role, content: message.content })),
    tools
  });

  for (let round = 0; round < maxToolRounds; round += 1) {
    const calls = response.output.filter((item) => item.type === "function_call");
    if (calls.length === 0) return response.output_text;
    const outputs = await Promise.all(
      calls.map(async (call) => {
        options.onProgress?.(`正在使用 MCP 工具：${call.name}…`);
        return {
          type: "function_call_output" as const,
          call_id: call.call_id,
          output: await options.callTool(call.name, JSON.parse(call.arguments) as Record<string, unknown>)
        };
      })
    );
    options.onProgress?.("MCP 已回傳結果，正在整理回覆…");
    response = await openai.responses.create({
      model,
      instructions: options.instructions,
      previous_response_id: response.id,
      input: outputs,
      tools
    });
  }
  throw new Error("AI 工具呼叫次數超過上限");
}

async function generateWithGemini(options: GenerateAnswerOptions): Promise<string> {
  if (!process.env.GEMINI_API_KEY) throw new Error("伺服器尚未設定 GEMINI_API_KEY");
  const gemini = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const model = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";
  const functionDeclarations: FunctionDeclaration[] = options.tools.map((tool) => ({
    name: tool.name,
    description: tool.description ?? "MCP tool",
    parametersJsonSchema: tool.inputSchema
  }));
  const chat = gemini.chats.create({
    model,
    config: {
      systemInstruction: options.instructions,
      tools: [{ functionDeclarations }]
    },
    history: options.messages.slice(0, -1).map((message) => ({
      role: message.role === "assistant" ? "model" : "user",
      parts: [{ text: message.content }]
    }))
  });
  let response = await chat.sendMessage({ message: options.messages.at(-1)?.content ?? "" });

  for (let round = 0; round < maxToolRounds; round += 1) {
    const calls = response.functionCalls ?? [];
    if (calls.length === 0) return response.text ?? "";
    const functionResponses = await Promise.all(
      calls.map(async (call) => {
        if (!call.name) throw new Error("Gemini 回傳了沒有名稱的 function call");
        options.onProgress?.(`正在使用 MCP 工具：${call.name}…`);
        const output = await options.callTool(call.name, call.args ?? {});
        return {
          functionResponse: {
            id: call.id,
            name: call.name,
            response: { output }
          }
        };
      })
    );
    options.onProgress?.("MCP 已回傳結果，正在整理回覆…");
    response = await chat.sendMessage({ message: functionResponses });
  }
  throw new Error("AI 工具呼叫次數超過上限");
}
