import { GoogleGenAI, type FunctionDeclaration } from "@google/genai";
import OpenAI from "openai";
import { newAuditId, writeAudit } from "./audit";

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
  traceId: string;
  agentRunId: string;
  identity: { tenantId: string; userId: string; sessionId: string };
  messages: ChatMessage[];
  instructions: string;
  tools: AiTool[];
  callTool: (name: string, args: Record<string, unknown>) => Promise<string>;
  onProgress?: (message: string) => void;
}

const maxToolRounds = 100;

export async function generateAiAnswer(
  options: GenerateAnswerOptions,
): Promise<string> {
  const provider = (process.env.AI_PROVIDER ?? "openai").toLowerCase();
  const spanId = newAuditId("AGENT");
  writeAudit({
    traceId: options.traceId,
    spanId,
    component: "ai-agent",
    action: "agent.run",
    status: "attempted",
    actor: "user",
    ...options.identity,
    agentId: "luluguard-importer-agent",
    agentRunId: options.agentRunId,
    data: {
      provider,
      messages: options.messages,
      instructions: options.instructions,
      tools: options.tools,
    },
  });
  try {
    const answer =
      provider === "openai"
        ? await generateWithOpenAi(options, spanId)
        : provider === "gemini"
          ? await generateWithGemini(options, spanId)
          : (() => {
              throw new Error(`不支援的 AI_PROVIDER：${provider}`);
            })();
    writeAudit({
      traceId: options.traceId,
      spanId,
      component: "ai-agent",
      action: "agent.run",
      status: "succeeded",
      actor: "ai-agent",
      data: { provider, answer },
    });
    return answer;
  } catch (error) {
    writeAudit({
      traceId: options.traceId,
      spanId,
      component: "ai-agent",
      action: "agent.run",
      status: "failed",
      actor: "ai-agent",
      data: { provider, error },
    });
    throw error;
  }
}

async function generateWithOpenAi(
  options: GenerateAnswerOptions,
  parentSpanId: string,
): Promise<string> {
  if (!process.env.OPENAI_API_KEY)
    throw new Error("伺服器尚未設定 OPENAI_API_KEY");
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const model = process.env.OPENAI_MODEL ?? "gpt-5-mini";
  const tools: OpenAI.Responses.Tool[] = options.tools.map((tool) => ({
    type: "function",
    name: tool.name,
    description: tool.description ?? "MCP tool",
    parameters: tool.inputSchema,
    strict: false,
  }));
  writeAudit({
    traceId: options.traceId,
    parentSpanId,
    component: "ai-provider",
    action: "model.request",
    status: "attempted",
    actor: "ai-agent",
    data: {
      provider: "openai",
      model,
      round: 0,
      messages: options.messages,
      tools,
    },
  });
  let response = await openai.responses.create({
    model,
    instructions: options.instructions,
    input: options.messages.map((message) => ({
      role: message.role,
      content: message.content,
    })),
    tools,
  });
  writeAudit({
    traceId: options.traceId,
    parentSpanId,
    component: "ai-provider",
    action: "model.response",
    status: "succeeded",
    actor: "openai",
    data: {
      provider: "openai",
      model,
      round: 0,
      responseId: response.id,
      output: response.output,
      outputText: response.output_text,
    },
  });

  for (let round = 0; round < maxToolRounds; round += 1) {
    const calls = response.output.filter(
      (item) => item.type === "function_call",
    );
    if (calls.length === 0) return response.output_text;
    const outputs = await Promise.all(
      calls.map(async (call) => {
        const args = JSON.parse(call.arguments) as Record<string, unknown>;
        writeAudit({
          traceId: options.traceId,
          parentSpanId,
          spanId: call.call_id,
          component: "ai-agent",
          action: "tool.decision",
          status: "attempted",
          actor: "openai",
          data: { round, tool: call.name, arguments: args },
        });
        try {
          const output = await options.callTool(call.name, args);
          writeAudit({
            traceId: options.traceId,
            parentSpanId,
            spanId: call.call_id,
            component: "ai-agent",
            action: "tool.decision",
            status: "succeeded",
            actor: "ai-agent",
            data: { round, tool: call.name, arguments: args, output },
          });
          return {
            type: "function_call_output" as const,
            call_id: call.call_id,
            output,
          };
        } catch (error) {
          writeAudit({
            traceId: options.traceId,
            parentSpanId,
            spanId: call.call_id,
            component: "ai-agent",
            action: "tool.decision",
            status: "failed",
            actor: "ai-agent",
            data: { round, tool: call.name, arguments: args, error },
          });
          throw error;
        }
      }),
    );
    writeAudit({
      traceId: options.traceId,
      parentSpanId,
      component: "ai-provider",
      action: "model.request",
      status: "attempted",
      actor: "ai-agent",
      data: {
        provider: "openai",
        model,
        round: round + 1,
        previousResponseId: response.id,
        toolOutputs: outputs,
      },
    });
    response = await openai.responses.create({
      model,
      instructions: options.instructions,
      previous_response_id: response.id,
      input: outputs,
      tools,
    });
    writeAudit({
      traceId: options.traceId,
      parentSpanId,
      component: "ai-provider",
      action: "model.response",
      status: "succeeded",
      actor: "openai",
      data: {
        provider: "openai",
        model,
        round: round + 1,
        responseId: response.id,
        output: response.output,
        outputText: response.output_text,
      },
    });
  }
  throw new Error("AI 工具呼叫次數超過上限");
}

async function generateWithGemini(
  options: GenerateAnswerOptions,
  parentSpanId: string,
): Promise<string> {
  if (!process.env.GEMINI_API_KEY)
    throw new Error("伺服器尚未設定 GEMINI_API_KEY");
  const gemini = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const model = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";
  const functionDeclarations: FunctionDeclaration[] = options.tools.map(
    (tool) => ({
      name: tool.name,
      description: tool.description ?? "MCP tool",
      parametersJsonSchema: tool.inputSchema,
    }),
  );
  const chat = gemini.chats.create({
    model,
    config: {
      systemInstruction: options.instructions,
      tools: [{ functionDeclarations }],
    },
    history: options.messages.slice(0, -1).map((message) => ({
      role: message.role === "assistant" ? "model" : "user",
      parts: [{ text: message.content }],
    })),
  });
  writeAudit({
    traceId: options.traceId,
    parentSpanId,
    component: "ai-provider",
    action: "model.request",
    status: "attempted",
    actor: "ai-agent",
    data: {
      provider: "gemini",
      model,
      round: 0,
      messages: options.messages,
      tools: functionDeclarations,
    },
  });
  let response = await chat.sendMessage({
    message: options.messages.at(-1)?.content ?? "",
  });
  const initialFunctionCalls = response.functionCalls ?? [];
  writeAudit({
    traceId: options.traceId,
    parentSpanId,
    component: "ai-provider",
    action: "model.response",
    status: "succeeded",
    actor: "gemini",
    data: {
      provider: "gemini",
      model,
      round: 0,
      text: initialFunctionCalls.length === 0 ? response.text : undefined,
      functionCalls: initialFunctionCalls,
    },
  });

  for (let round = 0; round < maxToolRounds; round += 1) {
    const calls = response.functionCalls ?? [];
    if (calls.length === 0) return response.text ?? "";
    const functionResponses = await Promise.all(
      calls.map(async (call) => {
        if (!call.name)
          throw new Error("Gemini 回傳了沒有名稱的 function call");
        options.onProgress?.(`正在使用 MCP 工具：${call.name}…`);
        const spanId = call.id ?? newAuditId("TOOL");
        writeAudit({
          traceId: options.traceId,
          parentSpanId,
          spanId,
          component: "ai-agent",
          action: "tool.decision",
          status: "attempted",
          actor: "gemini",
          data: { round, tool: call.name, arguments: call.args ?? {} },
        });
        let output: string;
        try {
          output = await options.callTool(call.name, call.args ?? {});
          writeAudit({
            traceId: options.traceId,
            parentSpanId,
            spanId,
            component: "ai-agent",
            action: "tool.decision",
            status: "succeeded",
            actor: "ai-agent",
            data: {
              round,
              tool: call.name,
              arguments: call.args ?? {},
              output,
            },
          });
        } catch (error) {
          writeAudit({
            traceId: options.traceId,
            parentSpanId,
            spanId,
            component: "ai-agent",
            action: "tool.decision",
            status: "failed",
            actor: "ai-agent",
            data: { round, tool: call.name, arguments: call.args ?? {}, error },
          });
          throw error;
        }
        return {
          functionResponse: {
            id: call.id,
            name: call.name,
            response: { output },
          },
        };
      }),
    );
    writeAudit({
      traceId: options.traceId,
      parentSpanId,
      component: "ai-provider",
      action: "model.request",
      status: "attempted",
      actor: "ai-agent",
      data: { provider: "gemini", model, round: round + 1, functionResponses },
    });
    options.onProgress?.("MCP 已回傳結果，正在整理回覆…");
    response = await chat.sendMessage({ message: functionResponses });
    const nextFunctionCalls = response.functionCalls ?? [];
    writeAudit({
      traceId: options.traceId,
      parentSpanId,
      component: "ai-provider",
      action: "model.response",
      status: "succeeded",
      actor: "gemini",
      data: {
        provider: "gemini",
        model,
        round: round + 1,
        text: nextFunctionCalls.length === 0 ? response.text : undefined,
        functionCalls: nextFunctionCalls,
      },
    });
  }
  throw new Error("AI 工具呼叫次數超過上限");
}
